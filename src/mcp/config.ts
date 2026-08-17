import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import ConfigManager from '../config/ConfigManager.js';
import type { MCPServerConfig } from './client.js';

export interface MCPConfig {
  servers: MCPServerConfig[];
}

export interface SuggestedMCPServer {
  name: string;
  description: string;
  config: MCPServerConfig;
  available: boolean;
  commandPath: string;
}

function resolveChromaMcpCommand(): string {
  if (process.env.CHROMA_MCP) {
    return process.env.CHROMA_MCP;
  }

  const candidates = [
    path.join(os.homedir(), 'Code', 'chroma', 'bin', 'chroma-mcp'),
    path.join(os.homedir(), 'code', 'chroma', 'bin', 'chroma-mcp'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

function buildChromaConfig(): MCPServerConfig {
  const command = resolveChromaMcpCommand();
  return {
    name: 'chroma',
    transport: {
      type: 'stdio',
      command,
      args: [],
      env: {},
    },
  };
}

/** Predefined MCP servers that `cobot mcp add <name>` can install by suggestion. */
export const PREDEFINED_SERVERS: Record<string, MCPServerConfig> = {
  get chroma() {
    return buildChromaConfig();
  },
};

const SUGGESTED_DESCRIPTIONS: Record<string, string> = {
  chroma: 'Native macOS image editor — open images, crop/geometry, adjust color, snapshot for vision, export via AgentBridge.',
};

export function listSuggestedMCPServers(): SuggestedMCPServer[] {
  return Object.keys(PREDEFINED_SERVERS).map((name) => {
    const config = PREDEFINED_SERVERS[name];
    const commandPath = config.transport?.command || config.command || '';
    return {
      name,
      description: SUGGESTED_DESCRIPTIONS[name] || `Predefined MCP server: ${name}`,
      config,
      available: Boolean(commandPath && fs.existsSync(commandPath)),
      commandPath,
    };
  });
}

export function loadMCPConfig(): MCPConfig {
  const manager = new ConfigManager();
  return { servers: manager.getMCPServers() };
}

export function addMCPServer(config: MCPServerConfig): void {
  const manager = new ConfigManager();
  const servers = manager.getMCPServersRecord();
  servers[config.name] = config;
  manager.setMCPServers(servers);
}

export function removeMCPServer(serverName: string): void {
  const manager = new ConfigManager();
  const servers = manager.getMCPServersRecord();
  if (!(serverName in servers)) {
    return;
  }
  delete servers[serverName];
  manager.setMCPServers(servers);
}

export function getMCPServer(serverName: string): MCPServerConfig | undefined {
  return loadMCPConfig().servers.find((server) => server.name === serverName);
}
