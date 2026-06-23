import * as path from 'path';
import type { ExploreAdaptiveConfig } from '../../config/ConfigManager.js';
import { debugLog } from '../logger.js';
import {
	DETERMINISTIC_FOLLOW_UP_FILES,
	EXPLORE_ROUNDS,
	FAST_PATH_MIN_EXACT_FILES,
	FAST_PATH_MIN_EXACT_MATCHES,
	MAX_TERMS_PER_ROUND,
	WORKER_FOCI,
} from './constants.js';
import type { AdaptiveRound2Decision, ExploreAdaptiveGate, ExploreWorkerResult, SharedEvidence } from './types.js';
import { compareMatchesForEvidence, mergeEvidenceFiles } from './evidence.js';
import {
	filePathTermVariants,
	hasExactFilenameMatch,
	hasFilenameMatch,
	isLowSignalPath,
	roleForFile,
} from './paths.js';
import { stringArrayField } from './text-utils.js';
import {
	extractActionObjectTerms,
	extractDomainHints,
	extractFileLikeTerms,
	extractKeyboardTerms,
	extractQuotedTerms,
	extractRoleObjectTerms,
	extractStructuredTerms,
	extractWordVariants,
	isStrongExactMatchTerm,
	uniqueTerms,
} from './terms.js';

export function deriveRequiredBuckets(userInput: string): string[] {
	const lowerValue = userInput.toLowerCase();
	const buckets = new Set<string>();

	if (/\bconfig(?:uration)?s?\b|\bsettings?\b|\bschemas?\b|\bxml\b|\byaml\b|\btoml\b|\bjson\s+config\b/.test(lowerValue)) {
		buckets.add('config');
	}
	if (/\bdeclar(?:e|ation|ations)\b|\bdefinitions?\b|\binterface\b|\bclass\b|\btype\b|\benum\b/.test(lowerValue)) {
		buckets.add('declaration');
	}
	if (/\bresolv(?:e|er|ers)\b|\bprovider(?:s)?\b/.test(lowerValue)) {
		buckets.add('resolver');
	}
	if (/\bcreat(?:e|es|ed|ion)\b|\bfactor(?:y|ies)\b|\blaunch(?:es|ed)?\b|\bconstruct(?:s|ed|ion)?\b|\bopen(?:s)?\b/.test(lowerValue)) {
		buckets.add('creation');
	}
	if (/\bload(?:s|ed|er)?\b|\bread(?:s|er)?\b|\bparse(?:r)?\b/.test(lowerValue)) {
		buckets.add('loader');
	}
	if (/\bcontext\b|\bcontainer\b|\bstartup\b|\bwiring\b|\bdispatch(?:er)?\b/.test(lowerValue)) {
		buckets.add('context');
	}
	if (/\bservice(?:s)?\b/.test(lowerValue)) {
		buckets.add('resolver');
	}

	return [...buckets];
}

export function evaluateAdaptiveRound2(
	evidenceHistory: SharedEvidence[],
	ledger: ExploreWorkerResult[],
	requiredBuckets: string[],
	adaptiveConfig: ExploreAdaptiveConfig,
): AdaptiveRound2Decision {
	const gates: ExploreAdaptiveGate[] = [];
	const reasons: string[] = [];

	if (evidenceHistory.length === 0) {
		const reason = 'No evidence collected in round 1.';
		gates.push({ gate: 'evidence-present', passed: false, detail: reason });
		return { skip: false, reasons: [reason], gates };
	}

	const minHighPriorityFiles = adaptiveConfig.minHighPriorityFiles ?? 4;
	const minDeclarationEvidence = adaptiveConfig.minDeclarationEvidence ?? 1;
	const maxLowSignalRatio = adaptiveConfig.maxLowSignalRatio ?? 0.5;

	const evidence = evidenceHistory[evidenceHistory.length - 1];
	const allFiles = [...evidence.exactFiles, ...evidence.files];

	const highPriorityFiles = allFiles.filter((file) => file.score >= 200 || hasExactFilenameMatch(file) || hasFilenameMatch(file));
	const highPriorityPassed = highPriorityFiles.length >= minHighPriorityFiles;
	gates.push({
		gate: 'high-priority-files',
		passed: highPriorityPassed,
		detail: `${highPriorityFiles.length}/${minHighPriorityFiles} required`,
	});
	if (!highPriorityPassed) {
		const reason = `Only ${highPriorityFiles.length} high-priority files (need ${minHighPriorityFiles}).`;
		reasons.push(reason);
		debugLog(`Adaptive: keeping round 2 — ${reason}`);
	}

	const declarationEvidence = allFiles.filter((file) => file.matches.some((match) => /\b(class|interface|enum|type|function|const|record|struct|register|configuration|config|setting|command|provider|service|default|factory|resolver|loader|startup|context|container|profile|definition|dispatch|create|launch|initialize|initialise)\b/i.test(match.lineContent)));
	const declarationPassed = declarationEvidence.length >= minDeclarationEvidence;
	gates.push({
		gate: 'declaration-evidence',
		passed: declarationPassed,
		detail: `${declarationEvidence.length}/${minDeclarationEvidence} required`,
	});
	if (!declarationPassed) {
		const reason = 'No declaration/method evidence found.';
		reasons.push(reason);
		debugLog(`Adaptive: keeping round 2 — ${reason}`);
	}

	const topFiles = evidence.files.slice(0, Math.min(8, evidence.files.length));
	const lowSignalCount = topFiles.filter((file) => isLowSignalPath(file.filePath)).length;
	const lowSignalRatio = topFiles.length > 0 ? lowSignalCount / topFiles.length : 0;
	const lowSignalPassed = topFiles.length === 0 || lowSignalRatio <= maxLowSignalRatio;
	gates.push({
		gate: 'low-signal-ratio',
		passed: lowSignalPassed,
		detail: topFiles.length > 0 ? `${lowSignalCount}/${topFiles.length} top files low-signal` : 'no top files',
	});
	if (!lowSignalPassed) {
		const reason = `Top files are mostly low-signal (${lowSignalCount}/${topFiles.length}).`;
		reasons.push(reason);
		debugLog(`Adaptive: keeping round 2 — ${reason}`);
	}

	const coveredBuckets = new Set<string>();
	for (const file of allFiles) {
		coveredBuckets.add(roleForFile(file.filePath));
	}
	const missingBuckets = requiredBuckets.filter((bucket) => !coveredBuckets.has(bucket));
	const bucketPassed = missingBuckets.length === 0;
	gates.push({
		gate: 'required-buckets',
		passed: bucketPassed,
		detail: bucketPassed ? `covered: ${requiredBuckets.join(', ') || '(none)'}` : `missing: ${missingBuckets.join(', ')}`,
	});
	if (!bucketPassed) {
		const reason = `Missing required buckets: ${missingBuckets.join(', ')}.`;
		reasons.push(reason);
		debugLog(`Adaptive: keeping round 2 — ${reason}`);
	}

	let workerPassed = true;
	for (const entry of ledger.slice(-WORKER_FOCI.length)) {
		if (entry.parsed && typeof entry.parsed === 'object') {
			const parsed = entry.parsed as Record<string, unknown>;
			const deadEnds = stringArrayField(parsed.dead_ends);
			if (deadEnds.some((deadEnd) => /missing|not found|absent|no\s+\w+\s+(file|evidence|declaration)/i.test(deadEnd))) {
				workerPassed = false;
				const reason = `Worker ${entry.worker} reports missing evidence.`;
				reasons.push(reason);
				debugLog(`Adaptive: keeping round 2 — ${reason}`);
				break;
			}
			const confidence = parsed.confidence;
			if (confidence === 'low') {
				workerPassed = false;
				const reason = `Worker ${entry.worker} reports low confidence.`;
				reasons.push(reason);
				debugLog(`Adaptive: keeping round 2 — ${reason}`);
				break;
			}
		}
	}
	gates.push({
		gate: 'worker-confidence',
		passed: workerPassed,
		detail: workerPassed ? 'workers report adequate confidence' : reasons.at(-1),
	});

	return {
		skip: reasons.length === 0,
		reasons,
		gates,
	};
}

export function shouldSkipRound2(
	evidenceHistory: SharedEvidence[],
	ledger: ExploreWorkerResult[],
	requiredBuckets: string[],
	adaptiveConfig: ExploreAdaptiveConfig,
): boolean {
	return evaluateAdaptiveRound2(evidenceHistory, ledger, requiredBuckets, adaptiveConfig).skip;
}

export function shouldUseDeterministicFastPath(userInput: string, evidenceHistory: SharedEvidence[]): boolean {
	if (isBroadArchitectureRequest(userInput)) {
		return false;
	}

	const exactFilePaths = new Set<string>();
	let exactMatches = 0;

	for (const evidence of evidenceHistory) {
		for (const file of evidence.exactFiles) {
			const matches = file.matches.filter((match) => isStrongExactMatchTerm(match.term));
			if (matches.length === 0) {
				continue;
			}
			exactFilePaths.add(file.filePath);
			exactMatches += matches.length;
		}
	}

	return exactFilePaths.size >= FAST_PATH_MIN_EXACT_FILES && exactMatches >= FAST_PATH_MIN_EXACT_MATCHES;
}

export function isBroadArchitectureRequest(value: string): boolean {
	const lowerValue = value.toLowerCase();
	const asksForFlow = /\b(trace|flow|path|wiring|startup|lifecycle|call\s+chain|control\s+flow|data\s+flow)\b/.test(lowerValue);
	const asksForResolution = /\b(resolve|resolves|resolved|resolver|loads?|loader|creates?|creation|launch(?:es|ed)?|factory|factories|construct(?:s|ed|ion)?|initiali[sz](?:e|es|ed|ation))\b/.test(lowerValue);
	const asksForArchitecturePieces = /\b(config(?:uration)?|setting|settings|service|services|registry|registries|provider|providers|context|container|dispatcher|profile|profiles|declaration|definitions?)\b/.test(lowerValue);
	const asksForMultipleEvidenceKinds = /\bidentify\b/.test(lowerValue)
		&& /(?:\band\b.+\band\b|\bclasses\b|\bfiles\b|\bpath and line evidence\b)/.test(lowerValue);
	const asksForImplementation = /\bhow\s+(?:is|are|does|do)\b/.test(lowerValue)
		&& /\b(?:implemented|implement(?:s|ation)?|provision(?:s|ed|ing)?|wired|works?|load(?:s|ed|ing)?)\b/.test(lowerValue);

	return (asksForFlow && (asksForResolution || asksForArchitecturePieces))
		|| (asksForResolution && asksForArchitecturePieces)
		|| asksForMultipleEvidenceKinds
		|| (asksForImplementation && asksForArchitecturePieces);
}

export function extractDeterministicFollowUpSearchTerms(userInput: string, evidenceHistory: SharedEvidence[]): string[] {
	const terms: string[] = [];

	for (const file of mergeEvidenceFiles(evidenceHistory, DETERMINISTIC_FOLLOW_UP_FILES)) {
		if (isLowSignalPath(file.filePath)) {
			continue;
		}

		terms.push(...filePathTermVariants(file.filePath));
		for (const match of file.matches.slice(0, 12)) {
			terms.push(...extractStructuredTerms(match.lineContent));
			terms.push(...extractFileLikeTerms(match.lineContent));
			terms.push(...extractQuotedTerms(match.lineContent));
		}
	}

	terms.push(
		...extractFileLikeTerms(userInput),
		...extractActionObjectTerms(userInput),
		...extractStructuredTerms(userInput),
		...extractDomainHints(userInput),
		...extractKeyboardTerms(userInput),
	);

	const previousTerms = new Set(evidenceHistory.flatMap((evidence) => evidence.terms.map((term) => term.toLowerCase())));
	return uniqueTerms(terms)
		.filter((term) => !previousTerms.has(term.toLowerCase()))
		.slice(0, MAX_TERMS_PER_ROUND);
}

export function extractInitialSearchTerms(userInput: string): string[] {
	const actionTerms = extractActionObjectTerms(userInput);
	const roleObjectTerms = extractRoleObjectTerms(userInput);
	return uniqueTerms([
		...extractStructuredTerms(userInput),
		...extractFileLikeTerms(userInput),
		...extractKeyboardTerms(userInput),
		...actionTerms.slice(0, 6),
		...roleObjectTerms.slice(0, 6),
		...extractDomainHints(userInput),
		...roleObjectTerms.slice(6),
		...actionTerms.slice(6),
		...extractWordVariants(userInput),
	]).slice(0, MAX_TERMS_PER_ROUND);
}

export function extractAuthoritativeTerms(userInput: string): string[] {
	const structuredTerms = uniqueTerms([
		...extractFileLikeTerms(userInput),
		...extractStructuredTerms(userInput),
	]);
	if (structuredTerms.length > 0) {
		return structuredTerms.slice(0, MAX_TERMS_PER_ROUND);
	}

	return uniqueTerms(extractDomainHints(userInput)).slice(0, MAX_TERMS_PER_ROUND);
}

export function stripSearchMetadataLines(value: string): string {
	return value
		.split('\n')
		.map((line) => line.replace(/\s*(?:cache[-_ ]?buster|nonce)\s*:\s*[^\n]*/gi, ''))
		.filter((line) => line.trim().length > 0)
		.join('\n')
		.trim();
}

export function extractFollowUpSearchTerms(userInput: string, ledger: ExploreWorkerResult[], evidenceHistory: SharedEvidence[]): string[] {
	const terms = [
		...extractStructuredTerms(userInput),
		...extractFileLikeTerms(userInput),
		...extractActionObjectTerms(userInput),
		...extractRoleObjectTerms(userInput),
		...extractDomainHints(userInput),
		...extractKeyboardTerms(userInput),
	];

	for (const entry of ledger.slice(-WORKER_FOCI.length)) {
		terms.push(...extractStructuredTerms(entry.content));
		terms.push(...extractQuotedTerms(entry.content));
		if (entry.parsed && typeof entry.parsed === 'object') {
			const parsed = entry.parsed as Record<string, unknown>;
			terms.push(...stringArrayField(parsed.follow_up_leads));
			terms.push(...stringArrayField(parsed.searched_terms));
		}
	}

	for (const evidence of evidenceHistory) {
		for (const file of evidence.files.slice(0, 16)) {
			terms.push(path.basename(file.filePath, path.extname(file.filePath)));
			const sortedMatches = [...file.matches]
				.sort((left, right) => compareMatchesForEvidence(file.filePath, left, right))
				.slice(0, 8);
			for (const match of sortedMatches) {
				terms.push(...extractStructuredTerms(match.lineContent));
				terms.push(...extractFileLikeTerms(match.lineContent));
				terms.push(...extractQuotedTerms(match.lineContent));
			}
		}
	}

	return uniqueTerms(terms)
		.filter((term) => !evidenceHistory.some((evidence) => evidence.terms.includes(term)))
		.slice(0, MAX_TERMS_PER_ROUND);
}