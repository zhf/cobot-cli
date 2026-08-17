import { createInterface, type Interface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { ToolSchema } from './schemas/index.js';
import type { ToolBackend } from './backend.js';
import type { ToolResult } from './files.js';
import type { ToolWorkerRequest, ToolWorkerResponse } from './worker-protocol.js';

export interface RemoteToolBackendOptions {
	input: Readable;
	output: Writable;
}

function createRequestId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class RemoteToolBackend implements ToolBackend {
	private readonly pending = new Map<string, {
		resolve: (value: ToolWorkerResponse) => void;
		reject: (error: Error) => void;
	}>();

	private readonly rl: Interface;

	constructor(private readonly options: RemoteToolBackendOptions) {
		this.rl = createInterface({ input: options.input });
		this.rl.on('line', (line) => this.handleLine(line));
	}

	async execute(name: string, args: Record<string, unknown>): Promise<ToolResult> {
		const response = await this.send({ type: 'execute', name, args });
		if (response.type === 'result') {
			return response.result;
		}
		if (response.type === 'error') {
			return { success: false, error: response.error };
		}
		return { success: false, error: 'Tool worker returned an unexpected response' };
	}

	async listMcpSchemas(): Promise<ToolSchema[]> {
		const response = await this.send({ type: 'mcp_schemas' });
		if (response.type !== 'mcp_schemas') {
			return [];
		}
		return response.schemas;
	}

	async close(): Promise<void> {
		try {
			await this.send({ type: 'shutdown' });
		} catch {
			// Worker may already be gone.
		}
		this.rl.close();
		this.rejectAll(new Error('Tool backend closed'));
	}

	private async send(message: ToolWorkerRequest['message']): Promise<ToolWorkerResponse> {
		const id = createRequestId();
		const request: ToolWorkerRequest = { id, message };
		return new Promise<ToolWorkerResponse>((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			if (!this.options.output.writable) {
				this.pending.delete(id);
				reject(new Error('Tool worker stdin is closed'));
				return;
			}
			this.options.output.write(`${JSON.stringify(request)}\n`);
		});
	}

	private handleLine(line: string): void {
		let response: ToolWorkerResponse;
		try {
			response = JSON.parse(line) as ToolWorkerResponse;
		} catch {
			return;
		}
		const pending = this.pending.get(response.id);
		if (!pending) {
			return;
		}
		this.pending.delete(response.id);
		pending.resolve(response);
	}

	private rejectAll(error: Error): void {
		for (const pending of this.pending.values()) {
			pending.reject(error);
		}
		this.pending.clear();
	}
}
