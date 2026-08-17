import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { EventEmitter } from 'events';
import { createTransport, MCPTransport, TransportType, TransportConfig } from './transports.js';

export interface MCPServerConfig {
  name: string;
  transport: TransportConfig;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverName: string;
}

export class MCPManager extends EventEmitter {
  private clients: Map<string, Client> = new Map();
  private transports: Map<string, MCPTransport> = new Map();
  private tools: Map<string, MCPTool> = new Map();
  private initializing: Promise<void> | null = null;

  async addServer(config: MCPServerConfig): Promise<void> {
    let transportConfig = config.transport;
    if (!transportConfig && config.command) {
      transportConfig = {
        type: 'stdio',
        command: config.command,
        args: config.args,
        env: config.env,
      };
    }

    if (!transportConfig) {
      throw new Error('Transport configuration is required');
    }

    if (this.clients.has(config.name)) {
      await this.removeServer(config.name);
    }

    const transport = createTransport(transportConfig);
    this.transports.set(config.name, transport);

    const client = new Client(
      {
        name: 'cobot-cli',
        version: '1.0.0',
      },
      {
        capabilities: {},
      },
    );

    this.clients.set(config.name, client);

    try {
      const sdkTransport = await transport.connect();
      await client.connect(sdkTransport);

      const toolsResult = await client.listTools();

      for (const tool of toolsResult.tools) {
        const mcpTool: MCPTool = {
          name: `mcp__${config.name}__${tool.name}`,
          description: tool.description || `Tool from ${config.name} server`,
          inputSchema: (tool.inputSchema as Record<string, unknown>) || {
            type: 'object',
            properties: {},
          },
          serverName: config.name,
        };
        this.tools.set(mcpTool.name, mcpTool);
      }

      this.emit('serverAdded', config.name, toolsResult.tools.length);
    } catch (error) {
      this.clients.delete(config.name);
      this.transports.delete(config.name);
      this.emit('serverError', config.name, error);
      throw error;
    }
  }

  async removeServer(serverName: string): Promise<void> {
    for (const [toolName, tool] of this.tools.entries()) {
      if (tool.serverName === serverName) {
        this.tools.delete(toolName);
      }
    }

    const client = this.clients.get(serverName);
    if (client) {
      await client.close();
      this.clients.delete(serverName);
    }

    const transport = this.transports.get(serverName);
    if (transport) {
      await transport.disconnect();
      this.transports.delete(serverName);
    }

    this.emit('serverRemoved', serverName);
  }

  async callTool(toolName: string, arguments_: Record<string, unknown>): Promise<CallToolResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new Error(`Tool ${toolName} not found`);
    }

    const client = this.clients.get(tool.serverName);
    if (!client) {
      throw new Error(`Server ${tool.serverName} not connected`);
    }

    const originalToolName = toolName.replace(`mcp__${tool.serverName}__`, '');

    return await client.callTool({
      name: originalToolName,
      arguments: arguments_,
    }) as CallToolResult;
  }

  getTools(): MCPTool[] {
    return Array.from(this.tools.values());
  }

  getServers(): string[] {
    return Array.from(this.clients.keys());
  }

  getTransportType(serverName: string): TransportType | undefined {
    return this.transports.get(serverName)?.getType();
  }

  async shutdown(): Promise<void> {
    const serverNames = Array.from(this.clients.keys());
    await Promise.all(serverNames.map((name) => this.removeServer(name)));
  }

  async ensureServersInitialized(): Promise<void> {
    if (this.clients.size > 0) {
      return;
    }

    if (this.initializing) {
      await this.initializing;
      return;
    }

    this.initializing = (async () => {
      const { loadMCPConfig } = await import('./config.js');
      const config = loadMCPConfig();

      await Promise.all(config.servers.map(async (serverConfig) => {
        try {
          await this.addServer(serverConfig);
        } catch (error) {
          console.warn(`Failed to initialize MCP server ${serverConfig.name}:`, error);
        }
      }));
    })();

    try {
      await this.initializing;
    } finally {
      this.initializing = null;
    }
  }
}

let mcpManager: MCPManager | null = null;

export function getMCPManager(): MCPManager {
  if (!mcpManager) {
    mcpManager = new MCPManager();
  }
  return mcpManager;
}

export async function initializeMCPServers(): Promise<void> {
  await getMCPManager().ensureServersInitialized();
}
