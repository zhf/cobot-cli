import { WORKER_FOCI } from './constants.js';
import type { ExploreAdaptiveGate, ExploreWorkerFocus } from './types.js';

export type ExploreDelegationMode = 'hardcoded' | 'adaptive';

export interface WorkerDelegationPlan {
	workers: ExploreWorkerFocus[];
	reasons: string[];
	strategy: 'hardcoded' | 'prompt-heuristic' | 'round2-targeted';
}

interface WorkerScores {
	surface: number;
	flow: number;
	validation: number;
}

const PIPELINE_PHASE_TERMS = [
	'scanning',
	'reranking',
	'rerank',
	'workers',
	'adaptive',
	'synthesis',
	'validation',
	'delegation',
];

function scoreWorkers(userInput: string, broadArchitecture: boolean): WorkerScores {
	if (broadArchitecture) {
		return { surface: 3, flow: 3, validation: 3 };
	}

	const lower = userInput.toLowerCase();
	const scores: WorkerScores = { surface: 0, flow: 0, validation: 0 };

	const hasSurfaceSignals = /\b(cli|command|subcommand|entrypoint|entry point|user-facing|expose|readme|documentation|contribution)\b/.test(lower);
	if (hasSurfaceSignals) {
		scores.surface += 2;
	}
	if (/\b(config|configuration|settings?|env|apikey|theme)\b/.test(lower)) {
		scores.surface += 1;
	}
	if (/\b(where is|what is|what are|defined|definition|located|find)\b/.test(lower)) {
		scores.surface += 2;
	}
	if (/\b(file|path|filename|symbol|class|function|export)\b/.test(lower)) {
		scores.surface += 1;
	}
	if (/\b(registered|registration|register)\b/.test(lower)) {
		scores.surface += 1;
		if (hasSurfaceSignals) {
			scores.flow += 2;
		}
	}

	if (/\b(trace|flow|wiring|call path|imports?|end-to-end|end to end|pipeline|orchestrat|lifecycle|startup|scanning|synthesis|rerank)\b/.test(lower)) {
		scores.flow += 2;
	}
	if (/\b(how is|how are|how does|how do|implemented|works?|wired)\b/.test(lower)) {
		scores.flow += 2;
	}
	if (/\b(resolver|factory|loader|registry|service|dispatch)\b/.test(lower)) {
		scores.flow += 1;
	}

	if (/\b(test|edge case|example|contradiction|dead end|verify|validation|coverage)\b/.test(lower)) {
		scores.validation += 2;
	}
	if (/\b(bug|regression|missing|broken|fails?)\b/.test(lower)) {
		scores.validation += 1;
	}

	return scores;
}

function selectWorkersFromScores(scores: WorkerScores, minScore = 2): ExploreWorkerFocus[] {
	const ranked = WORKER_FOCI
		.map((worker) => ({
			worker,
			score: scores[worker.name as keyof WorkerScores] ?? 0,
		}))
		.sort((left, right) => right.score - left.score);

	const selected = ranked
		.filter((entry) => entry.score >= minScore)
		.map((entry) => entry.worker);

	if (selected.length > 0) {
		return selected;
	}

	const fallback = ranked.filter((entry) => entry.score > 0).map((entry) => entry.worker);
	if (fallback.length > 0) {
		return fallback.slice(0, 2);
	}

	return [WORKER_FOCI.find((worker) => worker.name === 'surface') ?? WORKER_FOCI[0]];
}

function describeScoreReasons(scores: WorkerScores, workers: ExploreWorkerFocus[]): string[] {
	const reasons: string[] = [];
	for (const worker of workers) {
		const score = scores[worker.name as keyof WorkerScores] ?? 0;
		reasons.push(`${worker.name} (score ${score})`);
	}
	const skipped = WORKER_FOCI
		.filter((worker) => !workers.some((selected) => selected.name === worker.name))
		.map((worker) => worker.name);
	if (skipped.length > 0) {
		reasons.push(`skipped: ${skipped.join(', ')}`);
	}
	return reasons;
}

function workersNeededForAdaptiveFailures(
	adaptiveGates: ExploreAdaptiveGate[],
	adaptiveReasons: string[],
): Set<string> {
	const needed = new Set<string>();

	for (const gate of adaptiveGates) {
		if (gate.passed) {
			continue;
		}

		switch (gate.gate) {
			case 'high-priority-files':
			case 'declaration-evidence':
			case 'required-buckets':
				needed.add('flow');
				needed.add('surface');
				break;
			case 'low-signal-ratio':
				needed.add('surface');
				needed.add('validation');
				break;
			case 'worker-confidence': {
				needed.add('validation');
				const workerMatch = gate.detail?.match(/Worker\s+(\w+)/i);
				if (workerMatch) {
					needed.add(workerMatch[1].toLowerCase());
				}
				break;
			}
			default:
				break;
		}
	}

	const combinedReasons = adaptiveReasons.join(' ').toLowerCase();
	if (/missing evidence|low confidence|dead end|contradiction/.test(combinedReasons)) {
		needed.add('validation');
	}
	if (/declaration|high-priority|bucket|wiring|implementation/.test(combinedReasons)) {
		needed.add('flow');
	}
	if (/low-signal|documentation|entrypoint|command|config/.test(combinedReasons)) {
		needed.add('surface');
	}

	return needed;
}

function planRound2Workers(options: {
	userInput: string;
	broadArchitecture: boolean;
	round1WorkerNames: string[];
	adaptiveGates: ExploreAdaptiveGate[];
	adaptiveReasons: string[];
}): WorkerDelegationPlan {
	const scores = scoreWorkers(options.userInput, options.broadArchitecture);
	const targetNames = workersNeededForAdaptiveFailures(options.adaptiveGates, options.adaptiveReasons);
	const missing = WORKER_FOCI.filter((worker) => !options.round1WorkerNames.includes(worker.name));
	const reasons: string[] = [];

	let workers = missing.filter((worker) => targetNames.has(worker.name));
	if (workers.length > 0) {
		reasons.push(`targeted for adaptive gates: ${workers.map((worker) => worker.name).join(', ')}`);
	}

	if (workers.length === 0) {
		const rankedMissing = missing
			.map((worker) => ({
				worker,
				score: scores[worker.name as keyof WorkerScores] ?? 0,
			}))
			.sort((left, right) => right.score - left.score);
		workers = rankedMissing.filter((entry) => entry.score > 0).map((entry) => entry.worker);
		if (workers.length > 0) {
			reasons.push(`fallback to top missing lanes: ${workers.map((worker) => worker.name).join(', ')}`);
		}
	}

	if (workers.length === 0 && missing.length > 0) {
		workers = [...missing];
		reasons.push(`fallback to all missing lanes: ${workers.map((worker) => worker.name).join(', ')}`);
	}

	const skippedFromRound1 = options.round1WorkerNames.filter(Boolean);
	if (skippedFromRound1.length > 0) {
		reasons.push(`reusing round 1 lanes: ${skippedFromRound1.join(', ')}`);
	}

	return {
		workers,
		reasons,
		strategy: 'round2-targeted',
	};
}

export function planWorkerDelegation(options: {
	mode: ExploreDelegationMode;
	userInput: string;
	round: number;
	broadArchitecture?: boolean;
	round1WorkerNames?: string[];
	adaptiveGates?: ExploreAdaptiveGate[];
	adaptiveReasons?: string[];
}): WorkerDelegationPlan {
	if (options.mode === 'hardcoded') {
		return {
			workers: [...WORKER_FOCI],
			reasons: ['explore.delegation.mode=hardcoded'],
			strategy: 'hardcoded',
		};
	}

	const broadArchitecture = options.broadArchitecture ?? false;
	const scores = scoreWorkers(options.userInput, broadArchitecture);

	if (
		options.round > 1
		&& options.round1WorkerNames
		&& options.round1WorkerNames.length > 0
	) {
		return planRound2Workers({
			userInput: options.userInput,
			broadArchitecture,
			round1WorkerNames: options.round1WorkerNames,
			adaptiveGates: options.adaptiveGates ?? [],
			adaptiveReasons: options.adaptiveReasons ?? [],
		});
	}

	const workers = selectWorkersFromScores(scores);
	return {
		workers,
		reasons: describeScoreReasons(scores, workers),
		strategy: 'prompt-heuristic',
	};
}

export function workerNamesForRound(ledger: { worker: string; round: number }[], round: number): string[] {
	return ledger.filter((entry) => entry.round === round).map((entry) => entry.worker);
}