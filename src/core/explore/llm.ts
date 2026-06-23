import OpenAI from 'openai';
import { createChatCompletion } from '../openai-helper.js';
import {
	EXPLORE_ROUNDS,
	FINAL_SYNTHESIS_MAX_TOKENS,
	WORKER_MAX_TOKENS,
} from './constants.js';
import type {
	ExploreProgressUsage,
	ExploreWorkerFocus,
	ExploreWorkerResult,
	RunParallelExploreOptions,
	SharedEvidence,
	ThinkingPlan,
} from './types.js';
import { formatEvidenceHistoryForPrompt, formatLedgerForPrompt } from './format.js';
import { thinkingExtraBody } from './options.js';
import { parseJsonObject, truncate } from './text-utils.js';

export async function runExploreWorker(options: RunParallelExploreOptions & {
	context: string;
	worker: ExploreWorkerFocus;
	round: number;
	ledgerSummary: string;
	evidenceSummary: string;
	thinkingPlan: ThinkingPlan;
}): Promise<ExploreWorkerResult> {
	if (options.shouldStop?.()) {
		return fallbackWorkerResult(options, 'Worker was interrupted before producing a final ledger entry.');
	}

	const completion = await createChatCompletion(options.client, {
		model: options.model,
		messages: [
			{
				role: 'system',
				content: buildWorkerSystemPrompt(),
			},
			{
				role: 'user',
				content: buildWorkerPrompt(options),
			},
		],
		temperature: Math.min(options.temperature, 0.25),
		max_tokens: WORKER_MAX_TOKENS,
		signal: options.signal,
		extraBody: thinkingExtraBody(options.thinkingPlan.worker),
	});

	reportUsage(options, completion.usage);
	const content = completion.choices[0]?.message?.content || '';
	return {
		worker: options.worker.name,
		round: options.round,
		content,
		parsed: parseJsonObject(content),
	};
}

export async function synthesizeExploreResult(options: RunParallelExploreOptions & {
	context: string;
	ledger: ExploreWorkerResult[];
	evidenceHistory: SharedEvidence[];
	thinkingPlan: ThinkingPlan;
}): Promise<{ content: string; usage?: ExploreProgressUsage }> {
	if (options.shouldStop?.()) {
		return { content: '' };
	}

	const completion = await createChatCompletion(options.client, {
		model: options.model,
		messages: [
			{
				role: 'system',
				content: [
					'You are the coordinator for a parallel codebase exploration.',
					'Synthesize only from the shared evidence and worker ledger.',
					'Exact-match evidence is authoritative. If workers contradict exact-match evidence, trust the exact-match evidence.',
					'For broad architecture or wiring requests, rank definitions, configuration, factories, resolvers, loaders, contexts, and creation paths above repeated leaf usages.',
					'When both method declarations and call sites are present, cite the declaration as implementation evidence and the call sites as entrypoint evidence.',
					'Be concise. Do not invent files, line numbers, or behavior not supported by the evidence.',
					'Never use markdown tables.',
				].join('\n'),
			},
			{
				role: 'user',
				content: [
					`User request:\n${options.userInput}`,
					'',
					`Conversation context:\n${options.context}`,
					'',
					`Shared deterministic evidence:\n${formatEvidenceHistoryForPrompt(options.evidenceHistory)}`,
					'',
					`Worker ledger:\n${formatLedgerForPrompt(options.ledger)}`,
					'',
					'Write the final answer with these sections:',
					'- Likely Files',
					'- Evidence',
					'- Dead Ends',
					'- Recommended Next Steps',
					'Include confidence where useful. Keep paths and line references specific.',
				].join('\n'),
			},
		],
		temperature: Math.min(options.temperature, 0.25),
		max_tokens: FINAL_SYNTHESIS_MAX_TOKENS,
		signal: options.signal,
		extraBody: thinkingExtraBody(options.thinkingPlan.synthesis),
	});

	reportUsage(options, completion.usage);
	const content = completion.choices[0]?.message?.content?.trim();
	return {
		content: content || fallbackSynthesis(options.ledger),
		usage: toExploreUsage(completion.usage),
	};
}

function toExploreUsage(usage?: OpenAI.Completions.CompletionUsage): ExploreProgressUsage | undefined {
	if (!usage) {
		return undefined;
	}

	return {
		prompt_tokens: usage.prompt_tokens,
		completion_tokens: usage.completion_tokens,
		total_tokens: usage.total_tokens,
	};
}

function buildWorkerSystemPrompt(): string {
	return [
		'You are an internal read-only reasoner in a parallel codebase exploration.',
		'You do not have tools. Use only the shared deterministic evidence, prior ledger, and conversation context.',
		'Your job is to interpret, rank, and connect evidence for your assigned lane.',
		'For broad architecture or wiring requests, prefer evidence from definitions, configuration, factories, resolvers, loaders, contexts, and creation paths over repeated leaf usages.',
		'When both method declarations and call sites are present, cite the declaration as implementation evidence and the call sites as entrypoint evidence.',
		'Call out weak evidence, dead ends, and concrete follow-up search terms or files for the coordinator.',
		'Return one valid JSON object and no markdown.',
		'JSON shape: {"summary": string, "findings": [{"file": string, "lines": string, "evidence": string, "reason": string}], "searched_terms": string[], "dead_ends": string[], "follow_up_leads": string[], "confidence": "low"|"medium"|"high"}.',
	].join('\n');
}

function buildWorkerPrompt(options: RunParallelExploreOptions & {
	context: string;
	worker: ExploreWorkerFocus;
	round: number;
	ledgerSummary: string;
	evidenceSummary: string;
}): string {
	return [
		`User request:\n${options.userInput}`,
		'',
		`Conversation context:\n${options.context}`,
		'',
		`Worker lane: ${options.worker.name}`,
		`Worker focus: ${options.worker.focus}`,
		`Round: ${options.round} of ${EXPLORE_ROUNDS}`,
		'',
		options.ledgerSummary
			? `Shared ledger from earlier rounds:\n${options.ledgerSummary}`
			: 'Shared ledger from earlier rounds: empty',
		'',
		`Shared deterministic evidence for this round:\n${options.evidenceSummary}`,
		'',
		'Return the JSON ledger entry now.',
	].join('\n');
}

function fallbackWorkerResult(
	options: {
		worker: ExploreWorkerFocus;
		round: number;
	},
	summary: string,
): ExploreWorkerResult {
	const content = JSON.stringify({
		summary,
		findings: [],
		searched_terms: [],
		dead_ends: [],
		follow_up_leads: [],
		confidence: 'low',
	});

	return {
		worker: options.worker.name,
		round: options.round,
		content,
		parsed: parseJsonObject(content),
	};
}

function fallbackSynthesis(ledger: ExploreWorkerResult[]): string {
	const summaries = ledger.map((entry) => `- ${entry.worker} round ${entry.round}: ${truncate(entry.content, 800)}`);
	return [
		'## Likely Files',
		'The coordinator could not produce a synthesized response, but worker findings were collected.',
		'',
		'## Evidence',
		...summaries,
		'',
		'## Dead Ends',
		'- Not available from the fallback synthesis.',
		'',
		'## Recommended Next Steps',
		'- Re-run the exploration with a narrower request or inspect the listed worker evidence.',
	].join('\n');
}

function reportUsage(
	options: Pick<RunParallelExploreOptions, 'onApiUsage'>,
	usage?: OpenAI.Completions.CompletionUsage,
): void {
	if (!usage || !options.onApiUsage) {
		return;
	}

	options.onApiUsage({
		prompt_tokens: usage.prompt_tokens,
		completion_tokens: usage.completion_tokens,
		total_tokens: usage.total_tokens,
	});
}