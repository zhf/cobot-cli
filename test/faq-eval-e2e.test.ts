import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const roots: string[] = [];
const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => { servers.forEach(s => s.stop(true)); roots.forEach(p => rmSync(p, { recursive: true, force: true })); });
const cli = resolve('eval/faq/run.mjs');
function fixture() {
	const root = mkdtempSync(join(tmpdir(), 'faq-eval-')); roots.push(root);
	writeFileSync(join(root, 'questions.json'), JSON.stringify([{ id: 3, question: 'How to retrieve evidence?', expected: 'SECRET GOLDEN', rubric: ['SECRET RUBRIC'] }]));
	return root;
}
async function run(args: string[]) {
	const proc = Bun.spawn(['node', cli, ...args], { stdout: 'pipe', stderr: 'pipe' });
	return { code: await proc.exited, stdout: await new Response(proc.stdout).text(), stderr: await new Response(proc.stderr).text() };
}
function server(events: object[], bodies: any[], cancels: string[], hang = false) {
	const s = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
		const url = new URL(req.url);
		if (req.method === 'POST') { bodies.push(await req.json()); return Response.json({ runId: `r${bodies.length}` }); }
		if (req.method === 'DELETE') { cancels.push(url.pathname); return Response.json({ ok: true }); }
		return new Response(new ReadableStream({ start(controller) {
			const text = events.map(e => JSON.stringify(e)).join('\n') + '\n';
			controller.enqueue(new TextEncoder().encode(text.slice(0, 13)));
			controller.enqueue(new TextEncoder().encode(text.slice(13)));
			if (!hang) controller.close();
		} }));
	} }); servers.push(s); return `http://127.0.0.1:${s.port}`;
}
test('CLI runs balanced fresh forks, handles chunked events, and never sends private fields', async () => {
	const root = fixture(), bodies: any[] = [], cancels: string[] = [];
	const url = server([{ type: 'tool', status: 'started', name: 'read_file' }, { type: 'done', text: 'Supported answer file.ts:1' }], bodies, cancels);
	const result = await run(['run', '--questions', join(root, 'questions.json'), '--out', root, '--url', url, '--token', 'test', '--repeats', '2']);
	expect(result.code).toBe(0);
	expect(bodies).toHaveLength(4);
	expect(JSON.stringify(bodies)).not.toContain('SECRET');
	expect(bodies.every(b => b.fork === 'readonly')).toBe(true);
	expect(bodies[0].instructions).toBe(bodies[3].instructions);
	expect(bodies[1].instructions).toBe(bodies[2].instructions);
	const results = JSON.parse(readFileSync(join(root, 'results.json'), 'utf8'));
	expect(results.every((r: any) => r.status === 'done' && r.toolCalls === 1)).toBe(true);
});
for (const [label, events] of [['empty', [{ type: 'done', text: '' }]], ['EOF', [{ type: 'tool', status: 'started' }]], ['error', [{ type: 'error', message: 'limit' }]]] as const) {
	test(`CLI treats ${label} as failure`, async () => {
		const root = fixture(), bodies: any[] = [], cancels: string[] = [];
		const result = await run(['run', '--questions', join(root, 'questions.json'), '--out', root, '--url', server([...events], bodies, cancels), '--token', 'test', '--repeats', '1']);
		expect(result.code).toBe(1);
		expect(JSON.parse(readFileSync(join(root, 'results.json'), 'utf8')).every((r: any) => r.status === 'error')).toBe(true);
	});
}
test('timeout cancels the remote run', async () => {
	const root = fixture(), bodies: any[] = [], cancels: string[] = [];
	const result = await run(['run', '--questions', join(root, 'questions.json'), '--out', root, '--url', server([], bodies, cancels, true), '--token', 'test', '--repeats', '1', '--timeout-ms', '100']);
	expect(result.code).toBe(1); expect(cancels).toHaveLength(2);
});
test('report requires complete human reviews and rejects fabricated answer evidence', async () => {
	const root = fixture();
	writeFileSync(join(root, 'results.json'), JSON.stringify([{ id: 'q3-baseline-1', questionId: 3, variant: 'baseline', status: 'done', answer: 'Supported answer' }]));
	writeFileSync(join(root, 'rubrics.json'), JSON.stringify({ 3: [{ id: 'route', description: 'correct route' }] }));
	const args = ['report', '--out', root, '--rubrics', join(root, 'rubrics.json')];
	const pending = await run(args); expect(pending.stdout).toContain('UNREVIEWED');
	writeFileSync(join(root, 'reviews.json'), JSON.stringify([{ id: 'q3-baseline-1', criteria: { route: { met: true, quote: 'Not in answer' } }, incorrectClaims: [], citationSupport: 'supported', unnecessaryDetail: 'low' }]));
	expect((await run(args)).code).toBe(1);
});

test('citation audit checks source hash and exact line excerpt, not just file existence', async () => {
	const { createHash } = await import('node:crypto');
	const root = fixture(); writeFileSync(join(root, 'source.ts'), 'first\nsecond\n');
	const citation = { path: 'source.ts', startLine: 2, endLine: 2, excerpt: 'second', sha256: createHash('sha256').update('first\nsecond\n').digest('hex') };
	writeFileSync(join(root, 'results.json'), JSON.stringify([{ id: 'test', citations: [citation] }]));
	const args = ['audit', '--out', root, '--source', root];
	expect((await run(args)).code).toBe(0);
	writeFileSync(join(root, 'source.ts'), 'first\nchanged\n');
	expect((await run(args)).code).toBe(1);
	expect(JSON.parse(readFileSync(join(root, 'citation-audit.json'), 'utf8'))[0].valid).toBe(false);
});

test('Cursor selection reaches authentication and run API without claiming the Cobot round cap', async () => {
	const root = fixture(), requests: any[] = [];
	writeFileSync(join(root, 'clients.json'), JSON.stringify({ testing: { secret: 'test-secret' } }));
	const s = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
		const pathname = new URL(req.url).pathname;
		if (req.method === 'POST') {
			requests.push({ pathname, body: await req.json() });
			return Response.json(pathname === '/auth/token' ? { token: 'test-token' } : { runId: `r${requests.length}` });
		}
		return new Response(JSON.stringify({ type: 'done', text: 'Cursor answer' }) + '\n');
	} }); servers.push(s);
	const result = await run(['run', '--questions', join(root, 'questions.json'), '--out', root, '--url', `http://127.0.0.1:${s.port}`, '--clients-file', join(root, 'clients.json'), '--client', 'testing', '--pod', 'fixture', '--backend', 'cursor', '--model', 'composer-2.5', '--agent', 'agent', '--variant', 'baseline', '--repeats', '3']);
	expect(result.code).toBe(0);
	expect(requests[0].body.backend).toBe('cursor');
	expect(requests.slice(1)).toHaveLength(3);
	expect(requests.slice(1).every(r => r.body.model === 'composer-2.5' && r.body.agent === 'agent' && r.body.fork === 'readonly')).toBe(true);
	const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
	expect(manifest.backend).toBe('cursor'); expect(manifest.roundLimit).toBeNull();
	expect(manifest.schedule.every((s: any) => s.variant === 'baseline')).toBe(true);
});
