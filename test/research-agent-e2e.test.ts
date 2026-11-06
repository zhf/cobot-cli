import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Agent } from '../src/core/agent.ts';
import { setWorkspaceRoot } from '../src/tools/workspace-path.ts';

const originalCwd = process.cwd();
let root: string;
let server: ReturnType<typeof Bun.serve>;
let requests: any[];
let respond: (body: any, round: number) => any;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'cobot-research-e2e-'));
	mkdirSync(join(root, 'src'));
	writeFileSync(join(root, 'AGENTS.md'), '# Repo notes\nRoutes live in src/.');
	writeFileSync(join(root, 'src', 'route.ts'), 'export function handler() {\n  return status(201);\n}\n');
	writeFileSync(join(root, 'src', 'noisy.ts'), Array.from({ length: 50 }, (_, i) => `status(${i});`).join('\n'));
	requests = [];
	server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
		const body = await req.json(); requests.push(body);
		const delta = respond(body, requests.length);
		const chunk = { id: 'mock', object: 'chat.completion.chunk', created: 0, model: 'test', choices: [{ index: 0, delta, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }] };
		return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
	} });
});
afterEach(() => { server.stop(true); setWorkspaceRoot(originalCwd); rmSync(root, { recursive: true, force: true }); });

async function createAgent(system: string | null = null) {
	const agent = await Agent.create('test', 0, system, false, 'research', { cwd: root, configDir: root, skipMcp: true });
	agent.setBaseURL(`http://127.0.0.1:${server.port}/v1`);
	agent.setApiKey('test-only');
	return agent;
}

const call = (id: string, name: string, args: Record<string, unknown>) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

test('research keeps its method under operator instructions, orients from AGENTS.md, and exposes only research tools', async () => {
	respond = () => ({ content: 'done' });
	const agent = await createAgent('Answer in English. Cite file:line.');
	await agent.chat('Where is the handler?');
	const [request] = requests;
	const system = request.messages.filter((m: any) => m.role === 'system').map((m: any) => m.content);
	expect(system[0]).toContain('codebase research agent');
	expect(system[0]).toContain('Operator instructions');
	expect(system[0]).toContain('Cite file:line.');
	expect(system[1]).toContain('Top-level entries');
	expect(system[1]).toContain('Routes live in src/.');
	const tools = request.tools.map((t: any) => t.function.name);
	expect(tools).toEqual(expect.arrayContaining(['read_file', 'search_files', 'glob', 'list_files']));
	for (const denied of ['open_file', 'edit_file', 'execute_command', 'question', 'create_tasks', 'webfetch']) expect(tools).not.toContain(denied);
});

test('independent read tools run in one round with compact, per-file-capped output and preserved order', async () => {
	const started: string[] = [];
	respond = (_body, round) => round === 1
		? { tool_calls: [
			{ index: 0, ...call('s1', 'search_files', { pattern: 'status(', directory: 'src' }) },
			{ index: 1, ...call('r1', 'read_file', { file_path: 'src/route.ts' }) },
			{ index: 2, ...call('o1', 'open_file', { file_path: 'src/route.ts' }) },
		] }
		: { content: 'handler at src/route.ts:1-3' };
	const agent = await createAgent();
	agent.setToolCallbacks({ onToolStart: (name) => { started.push(name); } });
	await agent.chat('Find status codes.');
	expect(requests).toHaveLength(2);
	const toolMessages = requests[1].messages.filter((m: any) => m.role === 'tool');
	expect(toolMessages.map((m: any) => m.tool_call_id)).toEqual(['s1', 'r1', 'o1']);
	const search = toolMessages[0].content as string;
	expect(search).toContain('src/noisy.ts');
	expect(search).toContain('src/route.ts');
	expect(search).toContain('  2: return status(201);');
	expect(search.split('\n').filter((line) => line.startsWith('  ')).length).toBeLessThanOrEqual(21);
	expect(search).not.toContain('matchPositions');
	expect(toolMessages[1].content).toContain('1: export function handler()');
	expect(toolMessages[2].content).toMatch(/not available to the research agent/);
	expect(started).not.toContain('open_file');
});

test('explore now runs the research loop and the deterministic pipeline remains as explore-legacy', async () => {
	respond = () => ({ content: 'done' });
	const agent = await Agent.create('test', 0, null, false, 'explore', { cwd: root, configDir: root, skipMcp: true });
	agent.setBaseURL(`http://127.0.0.1:${server.port}/v1`);
	agent.setApiKey('test-only');
	await agent.chat('Where is the handler?');
	const [request] = requests;
	expect(request.messages[0].content).toContain('codebase research agent');
	expect(request.messages[1].content).toContain('Top-level entries');
	expect(request.tools.map((t: any) => t.function.name)).toContain('search_files');
	expect(agent.listCodingAgents().map((a) => a.name)).toEqual(expect.arrayContaining(['explore', 'explore-legacy', 'research']));
});

test('unattended runs stop after repeated identical provider failures instead of burning 50 rounds', async () => {
	server.stop(true);
	server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
		requests.push(await req.json());
		return new Response(JSON.stringify({ error: { message: 'Model Not Exist', code: 'invalid_request_error' } }), { status: 400, headers: { 'content-type': 'application/json' } });
	} });
	const agent = await createAgent();
	await expect(agent.chat('Anything')).rejects.toThrow(/Model Not Exist.*3 consecutive failures/);
	expect(requests).toHaveLength(3);
}, 15000);

test('a dangling symlink under .agents/skills does not break agent creation', async () => {
	const { mkdirSync: mk, symlinkSync } = await import('node:fs');
	mk(join(root, '.agents', 'skills'), { recursive: true });
	symlinkSync('../../missing-target', join(root, '.agents', 'skills', 'dangling'));
	process.chdir(root);
	try {
		respond = () => ({ content: 'ok' });
		const agent = await createAgent();
		await agent.chat('hello');
		expect(requests).toHaveLength(1);
	} finally {
		process.chdir(originalCwd);
	}
});
