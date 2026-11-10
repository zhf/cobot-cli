import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { RemoteToolBackend } from '../src/tools/remote-backend.ts';
import { runToolWorker } from '../src/tools/worker.ts';
import { setWorkspaceRoot } from '../src/tools/workspace-path.ts';

const originalCwd = process.cwd();
let root: string;
let backend: RemoteToolBackend;
let done: Promise<void>;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'cobot-command-timeout-'));
	const input = new PassThrough();
	const output = new PassThrough();
	done = runToolWorker({ cwd: root, input, output });
	backend = new RemoteToolBackend({ input: output, output: input });
});
afterEach(async () => {
	await backend.close();
	await done;
	process.chdir(originalCwd);
	setWorkspaceRoot(originalCwd);
	rmSync(root, { recursive: true, force: true });
});

test('remote execute_command interprets the advertised timeout in seconds', async () => {
	const result = await backend.execute('execute_command', {
		command: `exec node -e 'setTimeout(() => console.log("finished"), 150)'`,
		command_type: 'bash', timeout: 2,
	});
	expect(result.success).toBe(true);
	expect(result.content).toContain('finished');
});

test('remote execute_command still stops commands exceeding the deadline', async () => {
	const start = performance.now();
	const result = await backend.execute('execute_command', {
		command: `exec node -e 'setTimeout(() => console.log("too late"), 3000)'`,
		command_type: 'bash', timeout: 1,
	});
	expect(result.success).toBe(false);
	expect(result.error).toContain('timed out');
	expect(performance.now() - start).toBeGreaterThan(800);
	expect(performance.now() - start).toBeLessThan(2500);
});

test('remote execute_command rejects timeouts outside its schema', async () => {
	for (const timeout of [0, -1, 301, 1.5, '2']) {
		const result = await backend.execute('execute_command', {
			command: 'echo should-not-run', command_type: 'bash', timeout,
		});
		expect(result.success).toBe(false);
		expect(result.error).toContain('timeout');
	}
});
