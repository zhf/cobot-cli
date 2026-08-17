import { createInterface } from 'node:readline';
import { initializeMCPServers } from '../mcp/client.js';
import { LocalToolBackend } from './backend.js';
import { getWorkspaceRoot, setWorkspaceRoot } from './workspace-path.js';
import type { ToolWorkerRequest, ToolWorkerResponse } from './worker-protocol.js';

export interface ToolWorkerOptions {
	cwd?: string;
	input?: NodeJS.ReadableStream;
	output?: NodeJS.WritableStream;
}

function writeResponse(output: NodeJS.WritableStream, response: ToolWorkerResponse): void {
	output.write(`${JSON.stringify(response)}\n`);
}

export async function runToolWorker(options: ToolWorkerOptions = {}): Promise<void> {
	const cwd = options.cwd ?? process.env.COBOT_WORKSPACE ?? process.cwd();
	setWorkspaceRoot(cwd);
	process.chdir(getWorkspaceRoot());

	const backend = new LocalToolBackend();
	try {
		await initializeMCPServers();
	} catch {
		// MCP is optional in the tool worker.
	}

	const input = options.input ?? process.stdin;
	const output = options.output ?? process.stdout;
	const rl = createInterface({ input });

	for await (const line of rl) {
		let request: ToolWorkerRequest;
		try {
			request = JSON.parse(line) as ToolWorkerRequest;
		} catch {
			writeResponse(output, { id: 'unknown', type: 'error', error: 'Invalid tool worker request' });
			continue;
		}

		const { id, message } = request;
		if (message.type === 'shutdown') {
			writeResponse(output, { id, type: 'shutdown' });
			rl.close();
			return;
		}

		if (message.type === 'mcp_schemas') {
			const schemas = await backend.listMcpSchemas();
			writeResponse(output, { id, type: 'mcp_schemas', schemas });
			continue;
		}

		if (message.type === 'execute') {
			try {
				const result = await backend.execute(message.name, message.args);
				writeResponse(output, { id, type: 'result', result });
			} catch (error) {
				const text = error instanceof Error ? error.message : 'Tool execution failed';
				writeResponse(output, { id, type: 'error', error: text });
			}
		}
	}
}
