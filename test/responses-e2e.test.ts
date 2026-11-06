import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import OpenAI from 'openai';
import ConfigManager from '../src/config/ConfigManager.ts';
import { Agent } from '../src/core/agent.ts';
import { createChatCompletion, createStreamingChatCompletion } from '../src/core/openai-helper.ts';
import { setWorkspaceRoot } from '../src/tools/workspace-path.ts';

const originalCwd = process.cwd();
let root: string;
let server: ReturnType<typeof Bun.serve>;
let requests: any[];
let respond: (body: any, round: number) => Response;
const reasoning = { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'opaque-reasoning' };
const call = (n: number) => ({ type: 'function_call', id: `fc_${n}`, call_id: `call_${n}`, name: 'read_file', arguments: '{"file_path":"note.txt"}', status: 'completed' });
const message = (text: string) => ({ type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] });
const response = (output: any[]) => ({ id: 'resp_1', object: 'response', created_at: 1, model: 'gpt-6.1-sol', status: 'completed', output, usage: { input_tokens: 30, output_tokens: 12, total_tokens: 42, input_tokens_details: { cached_tokens: 4 }, output_tokens_details: { reasoning_tokens: 7 } } });
function sse(events: any[]) {
	return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}
function completed(output: any[], prefix: any[] = []) {
	return sse([...prefix, { type: 'response.completed', response: response(output) }]);
}
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'cobot-responses-e2e-'));
	mkdirSync(join(root, '.cobot'));
	writeFileSync(join(root, 'note.txt'), 'evidence');
	writeFileSync(join(root, '.cobot/config.json'), JSON.stringify({ openaiApi: 'responses', extraRequest: JSON.stringify({ reasoning: { effort: 'low' } }) }));
	requests = [];
	server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
		const body = await req.json(); requests.push({ ...body, path: new URL(req.url).pathname });
		if (new URL(req.url).pathname !== '/v1/responses') return Response.json({ error: { message: 'Responses API required' } }, { status: 400 });
		return respond(body, requests.length);
	} });
});
afterEach(() => { server.stop(true); setWorkspaceRoot(originalCwd); rmSync(root, { recursive: true, force: true }); });
async function agent() {
	const a = await Agent.create('gpt-6.1-sol', 0.7, 'Use evidence.', false, 'yolo', { cwd: root, configDir: root, skipMcp: true });
	a.setBaseURL(`http://127.0.0.1:${server.port}/v1/`); a.setApiKey('test-only');
	return a;
}
function client() { return new OpenAI({ apiKey: 'test-only', baseURL: `http://127.0.0.1:${server.port}/v1/`, maxRetries: 0 }); }
function options() { return { model: 'gpt-6.1-sol', messages: [{ role: 'user' as const, content: 'Hello' }], config: new ConfigManager(root) }; }

test('real agent streams Responses, executes parallel tools and preserves reasoning across restored turns', async () => {
	respond = (_body, round) => round === 1
		? completed([reasoning, call(1), call(2)])
		: completed([message('Evidence answer')], [{ type: 'response.output_text.delta', delta: 'Evidence ' }, { type: 'response.output_text.delta', delta: 'answer' }]);
	const a = await agent();
	let text = ''; const usages: any[] = [];
	a.setToolCallbacks({ onStreamStart: () => 'stream', onStreamUpdate: (_id, value) => { text = value; }, onApiUsage: value => usages.push(value) });
	await a.chat('Read note.txt twice.');
	expect(text).toBe('Evidence answer');
	expect(requests).toHaveLength(2);
	for (const req of requests) {
		expect(req.path).toBe('/v1/responses'); expect(req.store).toBe(false);
		expect(req.include).toContain('reasoning.encrypted_content');
		expect(req.reasoning).toEqual({ effort: 'low' });
		expect(req.temperature).toBeUndefined(); expect(req.max_tokens).toBeUndefined();
		expect(req.max_output_tokens).toBe(8000); expect(req.stream_options).toBeUndefined();
		expect(req.tools.find((t: any) => t.name === 'read_file').strict).toBe(false);
	}
	expect(requests[1].input).toContainEqual(reasoning);
	expect(requests[1].input.filter((i: any) => i.type === 'function_call')).toEqual([call(1), call(2)]);
	const outputs = requests[1].input.filter((i: any) => i.type === 'function_call_output');
	expect(outputs.map((i: any) => i.call_id)).toEqual(['call_1', 'call_2']);
	expect(outputs.every((i: any) => i.output.includes('1: evidence'))).toBe(true);
	expect(usages).toEqual([{ prompt_tokens: 30, completion_tokens: 12, total_tokens: 42, cached_prompt_tokens: 4 }, { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42, cached_prompt_tokens: 4 }]);
	const b = await agent(); b.loadSessionState('gpt-6.1-sol', 0.7, a.exportMessages(), a.exportBaseMessages());
	await b.chat('Follow-up');
	expect(requests[2].input.filter((i: any) => i.type === 'reasoning')).toEqual([reasoning]);
	expect(requests[2].input.filter((i: any) => i.type === 'message' && i.role === 'assistant')).toEqual([message('Evidence answer')]);
}, 15000);

test('Responses retains the 50-round budget and disables tools for the last request', async () => {
	respond = (body, round) => completed(body.tool_choice === 'none' ? [message('Final answer')] : [call(round)]);
	const a = await agent(); let text = '';
	a.setToolCallbacks({ onFinalMessage: value => { text = value; } });
	await a.chat('Find evidence');
	expect(requests).toHaveLength(50); expect(requests[49].tool_choice).toBe('none'); expect(text).toBe('Final answer');
	expect(requests[49].input.filter((i: any) => i.role === 'system' && JSON.stringify(i.content).includes('Round '))).toHaveLength(1);
}, 15000);

test('nonstreaming Responses supports image input and reports usage', async () => {
	respond = () => Response.json(response([message('Image answer')]));
	const result = await createChatCompletion(client(), { ...options(), messages: [{ role: 'user', content: [{ type: 'text', text: 'Describe' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,abc', detail: 'high' } }] }] });
	expect(result.choices[0].message.content).toBe('Image answer'); expect(result.usage?.total_tokens).toBe(42);
	expect(requests[0].input[0].content[1]).toEqual({ type: 'input_image', image_url: 'data:image/png;base64,abc', detail: 'high' });
});

for (const mode of ['failed', 'incomplete', 'error', 'truncated']) {
	test(`Responses ${mode} stream cannot become a successful answer`, async () => {
		respond = () => sse([{ type: 'response.output_text.delta', delta: 'Partial answer' }, ...(mode === 'truncated' ? [] : [mode === 'error' ? { type: 'error', message: 'provider error' } : { type: `response.${mode}`, response: { ...response([]), status: mode, error: { message: 'provider error' }, incomplete_details: { reason: 'max_output_tokens' } } }])]);
		await expect((async () => { const stream = await createStreamingChatCompletion(client(), options()); for await (const _chunk of stream) { /* consume */ } })()).rejects.toThrow(mode === 'truncated' ? /before response.completed/ : /Responses/);
		expect(requests[0].path).toBe('/v1/responses');
	});
}

test('Responses cancellation reaches the HTTP stream', async () => {
	respond = () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('event: response.created\ndata: {"type":"response.created"}\n\n')); } }), { headers: { 'content-type': 'text/event-stream' } });
	const controller = new AbortController();
	const pending = (async () => { const stream = await createStreamingChatCompletion(client(), { ...options(), signal: controller.signal }); for await (const _chunk of stream) { /* consume */ } })();
	const timer = setTimeout(() => controller.abort(), 30);
	try { await expect(pending).rejects.toThrow(/abort/i); expect(requests[0].path).toBe('/v1/responses'); } finally { clearTimeout(timer); }
});
