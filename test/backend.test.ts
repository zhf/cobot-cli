import { mkdtemp } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { LocalToolBackend } from '../src/tools/backend.ts';
import { setWorkspaceRoot } from '../src/tools/workspace-path.ts';

const previousCwd = process.cwd();

afterEach(() => {
	setWorkspaceRoot(previousCwd);
});

describe('LocalToolBackend', () => {
	test('reads a file inside the workspace', async () => {
		const cwd = await mkdtemp(join(tmpdir(), 'cobot-backend-'));
		setWorkspaceRoot(cwd);
		writeFileSync(join(cwd, 'hello.txt'), 'hello from workspace');
		const backend = new LocalToolBackend();
		const result = await backend.execute('read_file', { file_path: 'hello.txt' });
		expect(result.success).toBe(true);
		expect(result.content).toBe('hello from workspace');
	});

	test('refuses to read files outside the workspace', async () => {
		const cwd = await mkdtemp(join(tmpdir(), 'cobot-backend-'));
		setWorkspaceRoot(cwd);
		const backend = new LocalToolBackend();
		const result = await backend.execute('read_file', { file_path: '/etc/passwd' });
		expect(result.success).toBe(false);
		expect(result.error ?? '').toMatch(/outside the workspace/i);
	});
});
