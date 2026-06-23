import { debugLog } from '../logger.js';
import {
	EXPLORE_ROUNDS,
	MAX_RERANK_CANDIDATES,
	WORKER_FOCI,
} from './constants.js';
import { ExploreProgressTracker } from './progress.js';
import type {
	ExploreWorkerResult,
	ParallelExploreResult,
	RunParallelExploreOptions,
	SharedEvidence,
} from './types.js';
import { collectSharedEvidence } from './evidence.js';
import {
	formatConversationContext,
	formatCoverageHighlights,
	formatDeterministicExploreResult,
	formatEvidenceForPrompt,
	formatExactSummary,
	formatLedgerForPrompt,
} from './format.js';
import { runExploreWorker, synthesizeExploreResult } from './llm.js';
import { resolveExploreOptions } from './options.js';
import { applyRerankToEvidence, buildRerankedSynthesisHistory } from './rerank-pipeline.js';
import {
	deriveRequiredBuckets,
	evaluateAdaptiveRound2,
	extractAuthoritativeTerms,
	extractDeterministicFollowUpSearchTerms,
	extractFollowUpSearchTerms,
	extractInitialSearchTerms,
	isBroadArchitectureRequest,
	shouldUseDeterministicFastPath,
	stripSearchMetadataLines,
} from './request-heuristics.js';
import { extractRootNoiseTerms, filterNoiseTerms } from './terms.js';
import { collectSourceFiles } from './scan.js';
import { validateCitedPathsWithMeta } from './validation.js';

function topEvidenceFilePaths(evidence: SharedEvidence, limit = 8): string[] {
	return evidence.files.slice(0, limit).map((file) => file.filePath);
}

function countExactMatches(evidence: SharedEvidence): number {
	return evidence.exactFiles.reduce((count, file) => count + file.matches.length, 0);
}

export async function runParallelExplore(options: RunParallelExploreOptions): Promise<ParallelExploreResult> {
	const progress = new ExploreProgressTracker((event) => {
		options.onProgress?.(event);
	});
	const ledger: ExploreWorkerResult[] = [];

	if (options.skillNames && options.skillNames.length > 0) {
		progress.complete({
			phase: 'skills',
			skillsLoaded: options.skillNames,
			message: `Loaded ${options.skillNames.length} skill(s).`,
		});
	} else {
		progress.skipped({
			phase: 'skills',
			skipReason: options.skillContext ? 'skills configured but none matched prompt' : 'no matching skills for prompt',
		});
	}

	const context = formatConversationContext(options.messages, options.skillContext);
	const exploreOptions = resolveExploreOptions();
	const broadArchitectureRequest = isBroadArchitectureRequest(stripSearchMetadataLines(options.userInput));

	progress.start({
		phase: 'scanning',
		step: 'collect',
		round: 0,
		totalRounds: EXPLORE_ROUNDS,
		broadArchitecture: broadArchitectureRequest,
		honorGitignore: exploreOptions.scanConfig.honorGitignore,
	});
	const scanResult = await collectSourceFiles(process.cwd(), exploreOptions.scanConfig);
	const sourceFiles = scanResult.files;
	progress.complete({
		phase: 'scanning',
		step: 'collect',
		round: 0,
		totalRounds: EXPLORE_ROUNDS,
		fileCount: sourceFiles.length,
		scanStrategy: scanResult.scanStrategy,
		reposScanned: scanResult.reposScanned,
		honorGitignore: exploreOptions.scanConfig.honorGitignore,
		message: `Indexed ${sourceFiles.length} source files (${scanResult.scanStrategy}).`,
	});

	const evidenceHistory: SharedEvidence[] = [];
	const searchInput = stripSearchMetadataLines(options.userInput);
	const rootNoiseTerms = extractRootNoiseTerms(process.cwd());
	const authoritativeTerms = filterNoiseTerms(extractAuthoritativeTerms(searchInput), rootNoiseTerms);
	let terms = filterNoiseTerms(extractInitialSearchTerms(searchInput), rootNoiseTerms);
	const requiredBuckets = deriveRequiredBuckets(searchInput);
	let rerankSkipAnnounced = false;

	let rounds = EXPLORE_ROUNDS;
	for (let round = 1; round <= rounds; round++) {
		if (options.shouldStop?.()) {
			break;
		}

		progress.start({
			phase: 'scanning',
			step: 'match',
			round,
			totalRounds: rounds,
			searchTerms: terms,
			broadArchitecture: broadArchitectureRequest,
		});
		let evidence = await collectSharedEvidence(sourceFiles, terms, round, authoritativeTerms, !broadArchitectureRequest);

		if (exploreOptions.rerankPlan) {
			progress.start({
				phase: 'reranking',
				round,
				totalRounds: rounds,
				rerankCandidates: Math.min(MAX_RERANK_CANDIDATES, evidence.files.length),
			});
			const rerankStartedAt = Date.now();
			evidence = await applyRerankToEvidence(evidence, exploreOptions.rerankPlan, options);
			progress.complete({
				phase: 'reranking',
				round,
				totalRounds: rounds,
				rerankCandidates: Math.min(MAX_RERANK_CANDIDATES, evidence.files.length),
				rerankSelected: evidence.files.length,
				elapsedMs: Date.now() - rerankStartedAt,
			});
		} else if (!rerankSkipAnnounced) {
			progress.skipped({
				phase: 'reranking',
				round,
				skipReason: 'explore.rerank.model and explore.rerank.apiKey not configured',
			});
			rerankSkipAnnounced = true;
		}

		evidenceHistory.push(evidence);
		progress.complete({
			phase: 'scanning',
			step: 'match',
			round,
			totalRounds: rounds,
			evidenceCount: evidence.files.length,
			exactMatchCount: countExactMatches(evidence),
			deadEndCount: evidence.deadEnds.length,
			searchTerms: evidence.terms,
			topFiles: topEvidenceFilePaths(evidence),
			message: `Matched ${evidence.files.length} files for ${evidence.terms.length} terms.`,
		});

		if (shouldUseDeterministicFastPath(searchInput, evidenceHistory)) {
			progress.complete({
				phase: 'fast-path',
				round,
				message: 'High-confidence exact matches found; skipping worker synthesis.',
			});
			const followUpTerms = filterNoiseTerms(extractDeterministicFollowUpSearchTerms(searchInput, evidenceHistory), rootNoiseTerms);
			if (followUpTerms.length > 0 && round < EXPLORE_ROUNDS) {
				progress.start({
					phase: 'scanning',
					step: 'match',
					round: round + 1,
					totalRounds: EXPLORE_ROUNDS,
					searchTerms: followUpTerms,
					message: 'Fast-path follow-up term scan.',
				});
				let followUpEvidence = await collectSharedEvidence(sourceFiles, followUpTerms, round + 1, authoritativeTerms, !broadArchitectureRequest);
				if (exploreOptions.rerankPlan) {
					followUpEvidence = await applyRerankToEvidence(followUpEvidence, exploreOptions.rerankPlan, options);
				}
				evidenceHistory.push(followUpEvidence);
				progress.complete({
					phase: 'scanning',
					step: 'match',
					round: round + 1,
					totalRounds: EXPLORE_ROUNDS,
					evidenceCount: followUpEvidence.files.length,
					searchTerms: followUpTerms,
					topFiles: topEvidenceFilePaths(followUpEvidence),
				});
			}

			const fastContent = formatDeterministicExploreResult(searchInput, evidenceHistory);
			progress.start({ phase: 'validation', message: 'Validating cited paths.' });
			const validation = validateCitedPathsWithMeta(fastContent, sourceFiles, evidenceHistory);
			progress.complete({
				phase: 'validation',
				unverifiedPaths: validation.unverifiedPaths,
				totalElapsedMs: progress.totalElapsedMs(),
				message: validation.unverifiedPaths.length > 0
					? `Flagged ${validation.unverifiedPaths.length} unverified cited path(s).`
					: 'All cited paths verified.',
			});
			return {
				content: validation.content,
				ledger,
			};
		}

		if (broadArchitectureRequest && round === 1) {
			progress.skipped({
				phase: 'fast-path',
				round,
				skipReason: 'broad architecture request requires worker synthesis',
			});
		}

		const ledgerSummary = formatLedgerForPrompt(ledger);
		const evidenceSummary = formatEvidenceForPrompt(evidence);
		progress.start({
			phase: 'workers',
			round,
			totalRounds: rounds,
			totalWorkers: WORKER_FOCI.length,
			workersCompleted: 0,
		});

		const roundResults: ExploreWorkerResult[] = [];
		let workersCompleted = 0;
		const workerPromises = WORKER_FOCI.map((worker) => runExploreWorker({
			...options,
			context,
			worker,
			round,
			ledgerSummary,
			evidenceSummary,
			thinkingPlan: exploreOptions.thinkingPlan,
		}).then((result) => {
			workersCompleted++;
			progress.event({
				phase: 'workers',
				status: 'completed',
				round,
				totalRounds: rounds,
				totalWorkers: WORKER_FOCI.length,
				workersCompleted,
				workerName: worker.name,
			});
			return result;
		}));
		const results = await Promise.all(workerPromises);
		roundResults.push(...results);
		ledger.push(...roundResults);
		progress.complete({
			phase: 'workers',
			round,
			totalRounds: rounds,
			totalWorkers: WORKER_FOCI.length,
			workersCompleted: WORKER_FOCI.length,
			message: `Completed ${WORKER_FOCI.length} worker lane(s).`,
		});

		if (round === 1 && rounds > 1) {
			progress.start({ phase: 'adaptive-check', round, totalRounds: rounds });
			const adaptiveDecision = evaluateAdaptiveRound2(evidenceHistory, ledger, requiredBuckets, exploreOptions.adaptiveConfig);
			if (adaptiveDecision.skip) {
				debugLog('Adaptive: skipping round 2 — coverage gates met after round 1.');
				progress.complete({
					phase: 'adaptive-check',
					round,
					totalRounds: rounds,
					adaptiveSkipped: true,
					adaptiveGates: adaptiveDecision.gates,
					message: 'Round 2 skipped — adaptive coverage gates met.',
				});
				rounds = 1;
				break;
			}
			progress.complete({
				phase: 'adaptive-check',
				round,
				totalRounds: rounds,
				adaptiveSkipped: false,
				adaptiveReasons: adaptiveDecision.reasons,
				adaptiveGates: adaptiveDecision.gates,
				message: `Round 2 required — ${(adaptiveDecision.reasons[0] ?? 'coverage gates not met').replace(/\.$/, '')}.`,
			});
		}

		terms = filterNoiseTerms(extractFollowUpSearchTerms(searchInput, ledger, evidenceHistory), rootNoiseTerms);
		if (terms.length === 0) {
			debugLog(`Explore: stopping after round ${round} — no follow-up terms.`);
			break;
		}
	}

	const synthesisEvidenceHistory = exploreOptions.rerankPlan
		? await buildRerankedSynthesisHistory(evidenceHistory, exploreOptions.rerankPlan, options)
		: evidenceHistory;

	progress.start({ phase: 'synthesis', message: 'Synthesizing final answer from evidence and worker ledger.' });
	const synthesis = await synthesizeExploreResult({
		...options,
		context,
		ledger,
		evidenceHistory: synthesisEvidenceHistory,
		thinkingPlan: exploreOptions.thinkingPlan,
	});
	progress.complete({
		phase: 'synthesis',
		usage: synthesis.usage,
		message: synthesis.usage
			? `Synthesis used ${synthesis.usage.total_tokens} tokens.`
			: 'Synthesis complete.',
	});

	const exactSummary = broadArchitectureRequest ? '' : formatExactSummary(evidenceHistory);
	const coverageSummary = broadArchitectureRequest ? formatCoverageHighlights(searchInput, evidenceHistory) : '';

	progress.start({ phase: 'validation', message: 'Validating cited paths.' });
	const validated = validateCitedPathsWithMeta(
		[coverageSummary, exactSummary, synthesis.content].filter(Boolean).join('\n\n'),
		sourceFiles,
		evidenceHistory,
	);
	progress.complete({
		phase: 'validation',
		unverifiedPaths: validated.unverifiedPaths,
		totalElapsedMs: progress.totalElapsedMs(),
		message: validated.unverifiedPaths.length > 0
			? `Flagged ${validated.unverifiedPaths.length} unverified cited path(s).`
			: 'All cited paths verified.',
	});

	return {
		content: validated.content,
		ledger,
	};
}