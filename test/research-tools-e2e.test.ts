import { PassThrough } from 'node:stream';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
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
	root = mkdtempSync(join(tmpdir(), 'cobot-research-tools-'));
	mkdirSync(join(root, 'src/nested'), { recursive: true });
	writeFileSync(join(root, 'src/main.ts'), 'alpha\nbeta\nalpha|beta');
	writeFileSync(join(root, 'src/nested/[id].ts'), 'beta');
	writeFileSync(join(root, 'src/skip.js'), 'beta');
	writeFileSync(join(root, 'src/ignored.ts'), 'beta');
	writeFileSync(join(root, '.gitignore'), 'src/ignored.ts\n');
	symlinkSync(tmpdir(), join(root, 'escape'));
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

test('search path globs match relative paths and respect directories and gitignore', async () => {
	for (const file_pattern of ['src/*.ts', 'src/**/*.ts', 'src/nested/[id].ts']) {
		const result = await backend.execute('search_files', { pattern: 'beta', file_pattern });
		expect(result.success).toBe(true);
		expect(new Set(result.content.map((hit: any) => hit.filePath)).size).toBe(file_pattern === 'src/**/*.ts' ? 2 : 1);
		expect(JSON.stringify(result.content)).not.toContain('ignored.ts');
	}
	const result = await backend.execute('search_files', { pattern: 'beta', directory: 'src', file_pattern: 'nested/*.ts' });
	expect(result.content[0].filePath).toBe('src/nested/[id].ts');
});

test('literal searches remain literal and no-match results explain regex mode', async () => {
	const literal = await backend.execute('search_files', { pattern: 'alpha|beta', file_pattern: 'main.ts' });
	expect(literal.content).toHaveLength(1);
	const regex = await backend.execute('search_files', { pattern: 'alpha|beta', pattern_type: 'regex', file_pattern: 'main.ts' });
	expect(regex.content).toHaveLength(3);
	const missing = await backend.execute('search_files', { pattern: 'gamma|delta' });
	expect(missing.content).toEqual([]);
	expect(missing.message).toMatch(/substring/);
	expect(missing.message).toMatch(/pattern_type="regex"/);
});

test('recursive listing filters files, labels the root as dot, and never traverses symlinks', async () => {
	const flat = await backend.execute('list_files', { directory: '.', pattern: '*.ts' });
	const nested = await backend.execute('list_files', { directory: '.', pattern: '*.ts', recursive: true });
	expect(flat.content).toStartWith('./\n');
	expect(flat.content).not.toContain('main.ts');
	expect(nested.content).toContain('main.ts');
	expect(nested.content).toContain('[id].ts');
	expect(nested.content).not.toContain('skip.js');
	expect(nested.content).not.toContain('ignored.ts');
	expect(nested.content).not.toContain('escape');
});

test('file reads supply original line numbers and support explicit raw content', async () => {
	const result = await backend.execute('read_file', { file_path: 'src/main.ts', start_line: 2, end_line: 3 });
	expect(result.content).toBe('2: beta\n3: alpha|beta');
	const raw = await backend.execute('read_file', { file_path: 'src/main.ts', line_numbers: false });
	expect(raw.content).toBe('alpha\nbeta\nalpha|beta');
});
