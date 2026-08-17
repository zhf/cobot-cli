import { executeMCPTool, getMCPToolSchemas, isMCPToolName } from '../mcp/tools.js';
import type { ToolSchema } from './schemas/index.js';
import { executeTool } from './registry.js';
import type { ToolResult } from './files.js';

export const HOST_LLM_TOOLS = new Set(['create_web_page']);

export interface ToolBackend {
	execute(name: string, args: Record<string, unknown>): Promise<ToolResult>;
	listMcpSchemas?(): Promise<ToolSchema[]>;
	close?(): Promise<void>;
}

export class LocalToolBackend implements ToolBackend {
	async execute(name: string, args: Record<string, unknown>): Promise<ToolResult> {
		if (isMCPToolName(name)) {
			return executeMCPTool(name, args);
		}
		return executeTool(name, args) as Promise<ToolResult>;
	}

	async listMcpSchemas(): Promise<ToolSchema[]> {
		return getMCPToolSchemas();
	}
}

export class CompositeToolBackend implements ToolBackend {
	constructor(
		private readonly primary: ToolBackend,
		private readonly host: ToolBackend,
		private readonly hostTools: Set<string> = HOST_LLM_TOOLS,
	) {}

	async execute(name: string, args: Record<string, unknown>): Promise<ToolResult> {
		if (this.hostTools.has(name)) {
			return this.host.execute(name, args);
		}
		return this.primary.execute(name, args);
	}

	async listMcpSchemas(): Promise<ToolSchema[]> {
		if (this.primary.listMcpSchemas) {
			return this.primary.listMcpSchemas();
		}
		if (this.host.listMcpSchemas) {
			return this.host.listMcpSchemas();
		}
		return [];
	}

	async close(): Promise<void> {
		await this.primary.close?.();
		await this.host.close?.();
	}
}
