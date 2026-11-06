import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
const tool = (round: number) => ({ tool_calls: [{ index: 0, id: `read_${round}`, type: 'function', function: { name: 'read_file', arguments: '{"file_path":"note.txt"}' } }] });
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'cobot-agent-e2e-'));
	writeFileSync(join(root, 'note.txt'), 'evidence');
	requests = [];
	server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
		const body = await req.json(); requests.push(body);
		const delta = respond(body, requests.length);
		const chunk = { id: 'mock', object: 'chat.completion.chunk', created: 0, model: 'test', choices: [{ index: 0, delta, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }] };
		return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
	} });
});
afterEach(() => { server.stop(true); setWorkspaceRoot(originalCwd); rmSync(root, { recursive: true, force: true }); });
async function createAgent() {
	const agent = await Agent.create('test', 0, 'TASK-SPECIFIC: explain the evidence accurately.', false, 'yolo', { cwd: root, configDir: root, skipMcp: true });
	agent.setBaseURL(`http://127.0.0.1:${server.port}/v1`);
	agent.setApiKey('test-only');
	return agent;
}

test('agent selection and runtime model updates preserve custom instructions and same-agent history', async () => {
	respond = () => ({ content: 'answer' });
	const agent = await createAgent();
	agent.switchCodingAgent('build');
	agent.switchCodingAgent('yolo');
	agent.setRuntimeModel('test');
	await agent.chat('First question');
	agent.switchCodingAgent('yolo');
	await agent.chat('Follow-up question');
	for (const req of requests) expect(req.messages[0].content).toContain('TASK-SPECIFIC');
	expect(requests[1].messages.some((m: any) => m.role === 'user' && m.content === 'First question')).toBe(true);
});

test('research guidance and remaining budget reach the provider, with final synthesis inside 50 rounds', async () => {
	respond = (body, round) => body.tool_choice === 'none' ? { content: 'Answer from note.txt:1; remaining gaps disclosed.' } : tool(round);
	const agent = await createAgent();
	let answer = '';
	agent.setToolCallbacks({ onFinalMessage: text => { answer = text; } });
	await agent.chat('Explain the code using evidence.');
	expect(requests).toHaveLength(50);
	expect(requests[49].tool_choice).toBe('none');
	expect(answer).toContain('Answer from note.txt:1');
	expect(JSON.stringify(requests[0].messages)).toContain('Round 1 of 50');
	expect(JSON.stringify(requests[49].messages)).toContain('Round 50 of 50');
	expect(JSON.stringify(requests[0].messages)).toContain('unresolved');
	expect(requests[49].messages.filter((m: any) => m.role === 'system' && m.content.includes('Round '))).toHaveLength(1);
	expect(requests[1].messages.find((m: any) => m.role === 'tool').content).toContain('1: evidence');
}, 15000);

test('a provider that keeps requesting tools cannot turn exhaustion into empty success', async () => {
	respond = (_body, round) => tool(round);
	const agent = await createAgent();
	await expect(agent.chat('Explain the code.')).rejects.toThrow(/50.*round|round.*50/i);
	expect(requests).toHaveLength(50);
}, 15000);
