import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
	resolveWorkspaceFile,
	setWorkspaceRoot,
	WorkspacePathError,
} from '../src/tools/workspace-path.ts';

const previousCwd = process.cwd();

afterEach(() => {
	setWorkspaceRoot(previousCwd);
});

describe('workspace path jail', () => {
	test('resolves files inside the workspace', async () => {
		const cwd = await mkdtemp(join(tmpdir(), 'cobot-jail-'));
		setWorkspaceRoot(cwd);
		writeFileSync(join(cwd, 'readme.md'), 'ok');
		expect(resolveWorkspaceFile('readme.md')).toBe(join(cwd, 'readme.md'));
	});

	test('rejects absolute paths outside the workspace', async () => {
		const cwd = await mkdtemp(join(tmpdir(), 'cobot-jail-'));
		setWorkspaceRoot(cwd);
		expect(() => resolveWorkspaceFile('/etc/passwd')).toThrow(WorkspacePathError);
	});

	test('rejects parent-directory escapes', async () => {
		const cwd = await mkdtemp(join(tmpdir(), 'cobot-jail-'));
		setWorkspaceRoot(cwd);
		expect(() => resolveWorkspaceFile('../secret.json')).toThrow(WorkspacePathError);
	});

	test('rejects symlink escapes', async () => {
		const cwd = await mkdtemp(join(tmpdir(), 'cobot-jail-'));
		const outside = await mkdtemp(join(tmpdir(), 'cobot-outside-'));
		writeFileSync(join(outside, 'secret.json'), '{"token":"nope"}');
		setWorkspaceRoot(cwd);
		mkdirSync(join(cwd, 'linkdir'));
		symlinkSync(outside, join(cwd, 'escape'));
		expect(() => resolveWorkspaceFile('escape/secret.json')).toThrow(WorkspacePathError);
	});
});
