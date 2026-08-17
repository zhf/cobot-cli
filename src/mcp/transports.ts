import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export type TransportType = 'stdio';

export interface TransportConfig {
  type: TransportType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface MCPTransport {
  connect(): Promise<Transport>;
  disconnect(): Promise<void>;
  getType(): TransportType;
}

export class StdioTransport implements MCPTransport {
  private transport?: StdioClientTransport;

  constructor(private config: TransportConfig) {
    if (!config.command) {
      throw new Error('Command is required for stdio transport');
    }
  }

  async connect(): Promise<Transport> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === 'string') {
        env[key] = value;
      }
    }
    Object.assign(env, this.config.env || {});

    this.transport = new StdioClientTransport({
      command: this.config.command!,
      args: this.config.args || [],
      env,
    });

    return this.transport;
  }

  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
      this.transport = undefined;
    }
  }

  getType(): TransportType {
    return 'stdio';
  }
}

export function createTransport(config: TransportConfig): MCPTransport {
  if (config.type !== 'stdio') {
    throw new Error(`Unsupported transport type: ${config.type}`);
  }

  return new StdioTransport(config);
}
