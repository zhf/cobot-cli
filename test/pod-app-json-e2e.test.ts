import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Agent } from '../src/core/agent.ts';
import { parseJsonObject } from '../src/core/json-output.ts';
import { resolveCodingAgent } from '../src/core/coding-agents.ts';
import { setWorkspaceRoot } from '../src/tools/workspace-path.ts';

const originalCwd = process.cwd();
let root: string;
let server: ReturnType<typeof Bun.serve>;
let requests: any[];
let replies: string[];
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'cobot-pod-app-'));
	requests = [];
	server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
		requests.push(await req.json());
		const content = replies[Math.min(requests.length - 1, replies.length - 1)];
		const chunk = { id: 'mock', object: 'chat.completion.chunk', created: 0, model: 'test', choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }] };
		const usage = { id: 'mock', object: 'chat.completion.chunk', created: 0, model: 'test', choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } };
		return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(usage)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
	} });
});
afterEach(() => { server.stop(true); setWorkspaceRoot(originalCwd); rmSync(root, { recursive: true, force: true }); });

async function createAgent(system = 'Summarize the open tasks.') {
	const agent = await Agent.create('test', 0, system, false, 'pod-app', { cwd: root, configDir: root, skipMcp: true });
	agent.setBaseURL(`http://127.0.0.1:${server.port}/v1`);
	agent.setApiKey('test-only');
	return agent;
}

test('parseJsonObject accepts one object, optionally fenced, and nothing else', () => {
	expect(parseJsonObject(' {"a":1} ')).toEqual({ a: 1 });
	expect(parseJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
	for (const text of ['Sure: {"a":1}', '[1]', '{"a":1} trailing', '', 'null']) expect(parseJsonObject(text)).toBeUndefined();
});

test('the pod-app profile only exposes read tools and pod_app, and keeps its rules beside action instructions', async () => {
	const profile = resolveCodingAgent('pod-app');
	expect(profile.permission).toMatchObject({ read: 'allow', edit: 'deny', bash: 'deny', web: 'deny', interaction: 'deny', skill: 'deny', podapp: 'allow' });
	expect(resolveCodingAgent('yolo').permission.podapp).toBe('deny');
	replies = ['{"summary":"2 open"}'];
	const agent = await createAgent('ACTION: summarize tasks.');
	await agent.chatJson('{"input":{}}');
	const tools = requests[0].tools.map((t: any) => t.function.name);
	expect(tools).toContain('pod_app');
	expect(tools).not.toContain('execute_command');
	expect(tools).not.toContain('create_file');
	expect(tools).not.toContain('webfetch');
	const system = requests[0].messages[0].content;
	expect(system).toContain('untrusted data');
	expect(system).toContain('ACTION: summarize tasks.');
});

test('chatJson repairs one invalid answer, validates and reports usage', async () => {
	replies = ['Here you go: 2 open tasks', '{"summary":1}', '{"summary":"2 open"}'];
	const agent = await createAgent();
	const result = await agent.chatJson('{"input":{}}', { validate: value => typeof value.summary === 'string' ? [] : ['$.summary must be string'], repairs: 2 });
	expect(result.output).toEqual({ summary: '2 open' });
	expect(requests).toHaveLength(3);
	expect(JSON.stringify(requests[2].messages)).toContain('$.summary must be string');
	expect(result.usage).toEqual({ inputTokens: 300, outputTokens: 60 });
});

test('chatJson fails after the repair budget', async () => {
	replies = ['not json'];
	const agent = await createAgent();
	await expect(agent.chatJson('{"input":{}}')).rejects.toThrow(/Invalid JSON answer/);
	expect(requests).toHaveLength(2);
});
