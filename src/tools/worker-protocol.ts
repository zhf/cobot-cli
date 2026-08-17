import type { ToolSchema } from './schemas/index.js';
import type { ToolResult } from './files.js';

export type ToolWorkerMessage =
	| { type: 'execute'; name: string; args: Record<string, unknown> }
	| { type: 'mcp_schemas' }
	| { type: 'shutdown' };

export interface ToolWorkerRequest {
	id: string;
	message: ToolWorkerMessage;
}

export type ToolWorkerResponse =
	| { id: string; type: 'result'; result: ToolResult }
	| { id: string; type: 'mcp_schemas'; schemas: ToolSchema[] }
	| { id: string; type: 'error'; error: string }
	| { id: string; type: 'shutdown' };
