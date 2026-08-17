import { PassThrough } from 'node:stream';
import { mkdtemp } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { RemoteToolBackend } from '../src/tools/remote-backend.ts';
import { runToolWorker } from '../src/tools/worker.ts';
import { setWorkspaceRoot } from '../src/tools/workspace-path.ts';

const previousCwd = process.cwd();

afterEach(() => {
	setWorkspaceRoot(previousCwd);
});

describe('RemoteToolBackend', () => {
	test('round-trips read_file through the JSON-lines worker', async () => {
		const cwd = await mkdtemp(join(tmpdir(), 'cobot-rpc-'));
		writeFileSync(join(cwd, 'note.txt'), 'rpc-ok');

		const toWorker = new PassThrough();
		const fromWorker = new PassThrough();
		const workerDone = runToolWorker({ cwd, input: toWorker, output: fromWorker });
		const backend = new RemoteToolBackend({ input: fromWorker, output: toWorker });

		const result = await backend.execute('read_file', { file_path: 'note.txt' });
		expect(result.success).toBe(true);
		expect(result.content).toBe('rpc-ok');

		await backend.close();
		await workerDone;
	});
});
