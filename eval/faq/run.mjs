#!/usr/bin/env node
// Standalone Node runner: public questions only may be copied to an evaluation host.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';

const [command, ...argv] = process.argv.slice(2);
const opts = {};
for (let i = 0; i < argv.length; i += 2) {
	if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw new Error('Expected --option value');
	opts[argv[i].slice(2)] = argv[i + 1];
}
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const save = (p, value) => fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n');
const log = value => process.stdout.write(JSON.stringify(value) + '\n');
const baseInstructions = 'You are answering a third-party developer question by investigating the Wiki source in the current workspace. Use actual implementation and existing tests as evidence. Include precise repository-relative file:line citations supporting the requested conclusions. Treat stated assumptions as fixed. Explicitly distinguish static verification from executed tests. Be complete but concise. This is read-only: do not modify files, install dependencies, start services, create deliverables, propose publication, or use other agents. Do not read or copy any developer FAQ answer key. Do not read credential files. Answer in English. Give the answer directly; do not ask the user questions.';
const discoveryInstructions = 'Before choosing a solution, identify the relevant public entry points using the repository overview or integration documentation, then verify their implementations. Compare plausible entry points against the caller and workflow in the question; choose the simplest supported fit, and distinguish optional alternatives. Do not stop at the first related internal helper or feature. Before answering, check that each requested outcome has supporting evidence and distinguish missing evidence from absence of a feature. Keep this discovery bounded to the question.';

function request(url, { method = 'GET', body, token, basic, timeout = 30000 } = {}) {
	return new Promise((resolve, reject) => {
		const payload = body === undefined ? undefined : JSON.stringify(body);
		const req = (url.protocol === 'https:' ? https : http).request(url, { method, headers: {
			...(basic ? { Authorization: `Basic ${basic}` } : token ? { Authorization: `Bearer ${token}` } : {}),
			...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
		} }, res => {
			if (res.statusCode < 200 || res.statusCode >= 300) {
				res.resume(); reject(new Error(`HTTP ${res.statusCode} ${method} ${url.pathname}`));
			} else resolve(res);
		});
		req.setTimeout(timeout, () => req.destroy(new Error('HTTP timeout')));
		req.on('error', reject); req.end(payload);
	});
}
async function json(url, options) {
	const res = await request(url, options); let text = '';
	for await (const chunk of res) text += chunk;
	return JSON.parse(text);
}

async function run() {
	const out = path.resolve(opts.out || 'faq-results'); fs.mkdirSync(out, { recursive: true });
	if (fs.existsSync(path.join(out, 'results.json'))) throw new Error('Output contains results; choose a new directory');
	const questions = read(opts.questions).map(q => ({ id: q.id, question: q.question }));
	if (!questions.length || questions.some(q => !Number.isInteger(q.id) || typeof q.question !== 'string' || !q.question.trim()) || new Set(questions.map(q => q.id)).size !== questions.length) throw new Error('Invalid questions');
	const selected = opts.ids ? questions.filter(q => opts.ids.split(',').map(Number).includes(q.id)) : questions;
	if (!selected.length) throw new Error('No selected questions');
	const repeats = Number(opts.repeats || 3), timeout = Number(opts['timeout-ms'] || 720000);
	if (!Number.isInteger(repeats) || repeats < 1 || !Number.isFinite(timeout) || timeout <= 0) throw new Error('Invalid repeats/timeout');
	const backend = opts.backend || 'cobot';
	if (!['cobot', 'cursor', 'pi', 'grok'].includes(backend)) throw new Error('Invalid backend');
	const variantSelection = opts.variant || 'both';
	if (!['baseline', 'discovery', 'both'].includes(variantSelection)) throw new Error('Invalid variant');
	const model = opts.model || (backend === 'cobot' ? 'deepseek-v4-flash' : backend === 'cursor' ? 'composer-2.5' : undefined);
	if (!model) throw new Error('--model is required for this backend');
	const agent = opts.agent || (backend === 'cobot' ? 'yolo' : 'agent');
	const baseURL = new URL(opts.url || 'http://127.0.0.1:2644');
	let token = process.env.ORCA_EVAL_TOKEN || opts.token;
	if (!token) {
		const client = opts.client || 'wiki';
		const secret = read(opts['clients-file'] || '/etc/orca/service-clients.json')[client].secret;
		const auth = await json(new URL('/auth/token', baseURL), { method: 'POST', basic: Buffer.from(`${client}:${secret}`).toString('base64'), body: { pod: opts.pod, backend, expiresIn: 21600 } });
		token = auth.token;
	}
	const schedule = [];
	for (let repeat = 1; repeat <= repeats; repeat++) {
		for (let index = 0; index < selected.length; index++) {
			const variants = variantSelection === 'both' ? ((repeat + index) % 2 ? ['baseline', 'discovery'] : ['discovery', 'baseline']) : [variantSelection];
			for (const variant of variants) schedule.push({ id: `q${selected[index].id}-${variant}-${repeat}`, questionId: selected[index].id, question: selected[index].question, variant, repeat });
		}
	}
	save(path.join(out, 'manifest.json'), { createdAt: new Date().toISOString(), model, backend, agent, roundLimit: backend === 'cobot' ? 50 : null, roundLimitSource: backend === 'cobot' ? 'deployed Cobot configuration; not measured by public events' : 'not configured or exposed by this Orca adapter', baseInstructions, discoveryInstructions, questionHash: createHash('sha256').update(JSON.stringify(selected)).digest('hex'), schedule, source: opts.source || 'unspecified' });
	const results = [];
	for (const item of schedule) {
		const started = Date.now(); const result = { ...item, status: 'error', answer: '', toolCalls: 0, toolNames: {}, citations: [] };
		let runId, stream, deadline;
		log({ type: 'started', id: item.id });
		try {
			const instructions = baseInstructions + (item.variant === 'discovery' ? '\n\n' + discoveryInstructions : '');
			const created = await json(new URL('/v1/runs', baseURL), { method: 'POST', token, body: { message: `${baseInstructions}\n\nQuestion ${item.questionId}:\n${item.question}`, instructions, agent, model, fork: 'readonly' } });
			runId = result.runId = created.runId;
			if (!runId) throw new Error('Missing run ID');
			stream = await request(new URL(`/v1/runs/${encodeURIComponent(runId)}/events?after=0&follow=1`, baseURL), { token });
			deadline = setTimeout(() => stream.destroy(new Error('Run deadline exceeded')), timeout);
			let buffer = '', terminal;
			const consume = line => {
				if (!line.trim()) return;
				const event = JSON.parse(line);
				fs.appendFileSync(path.join(out, 'events.ndjson'), JSON.stringify({ id: item.id, event }) + '\n');
				if (event.type === 'tool' && event.status === 'started') {
					result.toolCalls++; const name = event.name || event.tool || 'unknown'; result.toolNames[name] = (result.toolNames[name] || 0) + 1;
				}
				if (event.type === 'cite') result.citations.push(event);
				if (['done', 'error', 'cancelled'].includes(event.type)) { terminal = event.type; result.answer = event.text || ''; }
			};
			stream.setEncoding('utf8');
			for await (const chunk of stream) {
				buffer += chunk; let index;
				while ((index = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, index)); buffer = buffer.slice(index + 1); }
				if (terminal) { stream.destroy(); break; }
			}
			if (!terminal && buffer.trim()) consume(buffer);
			if (terminal !== 'done') throw new Error(terminal ? `Terminal ${terminal}` : 'EOF without terminal event');
			if (!result.answer.trim()) throw new Error('Empty final answer');
			result.status = 'done';
		} catch (error) {
			result.error = error.message;
			if (runId) await json(new URL(`/v1/runs/${encodeURIComponent(runId)}`, baseURL), { method: 'DELETE', token }).catch(() => {});
		} finally { clearTimeout(deadline); stream?.destroy(); }
		result.elapsedMs = Date.now() - started; results.push(result);
		fs.writeFileSync(path.join(out, `${item.id}.txt`), result.answer);
		save(path.join(out, 'results.json'), results);
		log({ type: 'finished', id: result.id, status: result.status, toolCalls: result.toolCalls, elapsedMs: result.elapsedMs, error: result.error });
	}
	if (results.some(r => r.status !== 'done')) process.exitCode = 1;
}

function report() {
	const out = path.resolve(opts.out), results = read(path.join(out, 'results.json'));
	const rubrics = read(opts.rubrics);
	const reviewPath = path.join(out, 'reviews.json'), reviews = fs.existsSync(reviewPath) ? read(reviewPath) : [];
	if (new Set(reviews.map(r => r.id)).size !== reviews.length || reviews.some(r => !results.some(x => x.id === r.id))) throw new Error('Duplicate or unknown review ID');
	const rows = results.map(result => {
		const review = reviews.find(r => r.id === result.id), criteria = rubrics[result.questionId];
		if (!review || !criteria?.length) return { id: result.id, variant: result.variant, questionId: result.questionId, verdict: 'UNREVIEWED' };
		for (const criterion of criteria) {
			const score = review.criteria?.[criterion.id];
			if (typeof score?.met !== 'boolean' || (score.met && (!score.quote?.trim() || !result.answer.includes(score.quote)))) throw new Error(`Missing/invalid review evidence: ${result.id}/${criterion.id}`);
			if (!score.met && !score.reason) throw new Error(`Missing failure reason: ${result.id}/${criterion.id}`);
		}
		if (!Array.isArray(review.incorrectClaims) || !['supported', 'partial', 'unsupported'].includes(review.citationSupport) || !['low', 'medium', 'high'].includes(review.unnecessaryDetail)) throw new Error(`Incomplete review: ${result.id}`);
		const met = criteria.filter(c => review.criteria[c.id].met).length;
		return { id: result.id, questionId: result.questionId, variant: result.variant, verdict: result.status === 'done' && met === criteria.length && review.incorrectClaims.length === 0 && review.citationSupport === 'supported' ? 'PASS' : 'FAIL', met, total: criteria.length, incorrectClaims: review.incorrectClaims.length, citationSupport: review.citationSupport, unnecessaryDetail: review.unnecessaryDetail, toolCalls: result.toolCalls, elapsedMs: result.elapsedMs };
	});
	const groups = ['baseline', 'discovery'].map(variant => {
		const rs = rows.filter(r => r.variant === variant), complete = rs.filter(r => r.verdict !== 'UNREVIEWED');
		return { variant, runs: rs.length, reviewed: complete.length, passes: rs.filter(r => r.verdict === 'PASS').length, factsMet: complete.reduce((n, r) => n + r.met, 0), factsTotal: complete.reduce((n, r) => n + r.total, 0), incorrectClaims: complete.reduce((n, r) => n + r.incorrectClaims, 0) };
	});
	const report = { rows, groups, caution: 'Human source review required. Quotes verify review provenance, not truth. Small repeated sample; no statistical significance claim. Model rounds unavailable from public events.' };
	save(path.join(out, 'report.json'), report); process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
function audit() {
	const out = path.resolve(opts.out), source = fs.realpathSync(opts.source);
	const rows = read(path.join(out, 'results.json')).flatMap(result => (result.citations || []).map(citation => {
		const row = { id: result.id, ...citation, valid: false };
		try {
			const file = fs.realpathSync(path.resolve(source, citation.path));
			if (!file.startsWith(source + path.sep)) throw new Error('Citation escapes snapshot');
			const content = fs.readFileSync(file), lines = content.toString('utf8').split(/\r?\n/);
			row.hashMatches = createHash('sha256').update(content).digest('hex') === citation.sha256;
			row.excerptMatches = Number.isInteger(citation.startLine) && Number.isInteger(citation.endLine) && citation.startLine >= 1 && citation.endLine >= citation.startLine && citation.endLine <= lines.length && lines.slice(citation.startLine - 1, citation.endLine).join('\n') === citation.excerpt;
			row.valid = row.hashMatches && row.excerptMatches;
		} catch (error) { row.error = error.message; }
		return row;
	}));
	save(path.join(out, 'citation-audit.json'), rows);
	log({ citations: rows.length, invalid: rows.filter(r => !r.valid).length, note: 'Exact source integrity only; semantic support requires review.' });
	if (rows.some(r => !r.valid)) process.exitCode = 1;
}

try {
	if (command === 'run') await run();
	else if (command === 'report') report();
	else if (command === 'audit') audit();
	else throw new Error('Usage: node eval/faq/run.mjs run|report|audit --option value (see README.md)');
} catch (error) { console.error(error.message); process.exitCode = 1; }
