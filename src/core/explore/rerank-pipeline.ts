import { rerankDocuments, RerankHit } from '../rerank.js';
import { debugLog } from '../logger.js';
import {
	MAX_EVIDENCE_FILES,
	MAX_RERANK_CANDIDATES,
	MAX_RERANK_CHUNK_CHARS,
	MAX_TERMS_PER_ROUND,
} from './constants.js';
import type { EvidenceFile, RerankChunk, RerankPlan, RunParallelExploreOptions, SharedEvidence } from './types.js';
import { compareEvidenceFiles, roleForFile } from './paths.js';
import { mergeEvidenceFile, uniqueEvidenceFiles } from './evidence.js';
import { truncate, uniqueStrings } from './text-utils.js';
import { uniqueTerms } from './terms.js';

export async function applyRerankToEvidence(
	evidence: SharedEvidence,
	plan: RerankPlan,
	options: RunParallelExploreOptions,
): Promise<SharedEvidence> {
	if (evidence.files.length === 0) {
		return evidence;
	}

	const chunks = buildRerankChunks(evidence);
	if (chunks.length === 0) {
		return evidence;
	}

	const startedAt = Date.now();
	const result = await rerankDocuments({
		apiKey: plan.config.apiKey as string,
		baseURL: plan.config.baseURL as string,
		model: plan.config.model as string,
		query: plan.query,
		documents: chunks.map((chunk) => chunk.text),
		topN: Math.min(plan.config.topN ?? MAX_EVIDENCE_FILES, chunks.length),
		instruct: plan.config.instruct,
		signal: options.signal,
		timeoutMs: plan.config.timeoutMs,
	});
	const latencyMs = Date.now() - startedAt;

	if (!result) {
		reportRerankUsage(options, {
			latencyMs,
			totalTokens: 0,
			candidateCount: chunks.length,
			selectedCount: 0,
			fallbackCount: 1,
		});
		debugLog('Rerank returned no result; falling back to deterministic ordering.');
		return evidence;
	}

	reportRerankUsage(options, {
		latencyMs,
		totalTokens: result.totalTokens,
		candidateCount: chunks.length,
		selectedCount: result.results.length,
		fallbackCount: 0,
	});

	return reorderEvidenceByRerank(evidence, chunks, result.results, plan.config.perRole ?? 0);
}

export async function buildRerankedSynthesisHistory(
	evidenceHistory: SharedEvidence[],
	plan: RerankPlan,
	options: RunParallelExploreOptions,
): Promise<SharedEvidence[]> {
	if (evidenceHistory.length === 0) {
		return evidenceHistory;
	}

	const merged = mergeEvidenceHistoryForSynthesis(evidenceHistory);
	const reranked = await applyRerankToEvidence(merged, plan, options);
	return [reranked];
}

export function mergeEvidenceHistoryForSynthesis(evidenceHistory: SharedEvidence[]): SharedEvidence {
	const filesByPath = new Map<string, EvidenceFile>();
	const exactByPath = new Map<string, EvidenceFile>();

	for (const evidence of evidenceHistory) {
		for (const file of evidence.files) {
			mergeEvidenceFile(filesByPath, file);
		}
		for (const file of evidence.exactFiles) {
			mergeEvidenceFile(exactByPath, file);
		}
	}

	const files = [...filesByPath.values()].sort(compareEvidenceFiles).slice(0, MAX_EVIDENCE_FILES * 2);
	const exactFiles = [...exactByPath.values()].sort(compareEvidenceFiles).slice(0, 16);

	return {
		round: 0,
		terms: uniqueTerms(evidenceHistory.flatMap((evidence) => evidence.terms)).slice(0, MAX_TERMS_PER_ROUND),
		filesScanned: evidenceHistory[evidenceHistory.length - 1]?.filesScanned ?? 0,
		filesMatched: filesByPath.size,
		files,
		exactFiles,
		deadEnds: uniqueStrings(evidenceHistory.flatMap((evidence) => evidence.deadEnds)).slice(0, 12),
	};
}

export function buildRerankChunks(evidence: SharedEvidence): RerankChunk[] {
	const chunks: RerankChunk[] = [];
	let fileIndex = 0;

	for (const file of evidence.files) {
		const role = roleForFile(file.filePath);
		const baseText = `path: ${file.filePath}\nrole: ${role}`;
		const excerptText = file.excerpts.length > 0
			? file.excerpts.slice(0, 16).join('\n')
			: file.matches.slice(0, 6).map((match) => `line ${match.lineNumber}: ${match.lineContent}`).join('\n');

		if (excerptText) {
			chunks.push({
				filePath: file.filePath,
				role,
				text: truncate(`${baseText}\n${excerptText}`, MAX_RERANK_CHUNK_CHARS),
				originalIndex: fileIndex,
			});
		} else {
			chunks.push({
				filePath: file.filePath,
				role,
				text: truncate(`${baseText}\nreasons: ${file.reasons.slice(0, 3).join('; ')}`, MAX_RERANK_CHUNK_CHARS),
				originalIndex: fileIndex,
			});
		}
		fileIndex++;

		if (chunks.length >= MAX_RERANK_CANDIDATES) {
			break;
		}
	}

	return chunks;
}

function reorderEvidenceByRerank(
	evidence: SharedEvidence,
	chunks: RerankChunk[],
	hits: RerankHit[],
	perRoleMin: number,
): SharedEvidence {
	const filesByPath = new Map(evidence.files.map((file) => [file.filePath, file]));
	const chunkByFilePath = new Map(chunks.map((chunk) => [chunk.filePath, chunk]));

	const rankedFilePaths: string[] = [];
	const seenFilePaths = new Set<string>();
	for (const hit of hits) {
		const chunk = chunks[hit.index];
		if (!chunk || seenFilePaths.has(chunk.filePath)) {
			continue;
		}
		seenFilePaths.add(chunk.filePath);
		rankedFilePaths.push(chunk.filePath);
	}

	for (const file of evidence.files) {
		if (!seenFilePaths.has(file.filePath)) {
			seenFilePaths.add(file.filePath);
			rankedFilePaths.push(file.filePath);
		}
	}

	const orderedFiles = rankedFilePaths
		.map((filePath) => filesByPath.get(filePath))
		.filter((file): file is EvidenceFile => Boolean(file));

	const finalFiles = perRoleMin > 0 ? enforcePerRoleMinima(orderedFiles, chunkByFilePath, perRoleMin) : orderedFiles;

	return {
		...evidence,
		files: finalFiles.slice(0, MAX_EVIDENCE_FILES),
	};
}

function enforcePerRoleMinima(
	orderedFiles: EvidenceFile[],
	chunkByFilePath: Map<string, RerankChunk>,
	perRoleMin: number,
): EvidenceFile[] {
	const roleCounts = new Map<string, number>();
	const result: EvidenceFile[] = [];
	const included = new Set<string>();

	for (const file of orderedFiles) {
		const role = chunkByFilePath.get(file.filePath)?.role ?? 'usage';
		result.push(file);
		included.add(file.filePath);
		roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
	}

	for (const [role, count] of roleCounts) {
		if (count >= perRoleMin) {
			continue;
		}
		const needed = perRoleMin - count;
		let injected = 0;
		for (const file of orderedFiles) {
			if (injected >= needed) {
				break;
			}
			if (included.has(file.filePath)) {
				continue;
			}
			const fileRole = chunkByFilePath.get(file.filePath)?.role ?? 'usage';
			if (fileRole !== role) {
				continue;
			}
			result.push(file);
			included.add(file.filePath);
			injected++;
		}
	}

	return result;
}

function reportRerankUsage(
	options: RunParallelExploreOptions,
	data: {
		latencyMs: number;
		totalTokens: number;
		candidateCount: number;
		selectedCount: number;
		fallbackCount: number;
	},
): void {
	if (!options.onApiUsage) {
		return;
	}

	options.onApiUsage({
		prompt_tokens: 0,
		completion_tokens: 0,
		total_tokens: 0,
		rerank_tokens: data.totalTokens,
		rerank_latency_ms: data.latencyMs,
		rerank_candidate_count: data.candidateCount,
		rerank_selected_count: data.selectedCount,
		rerank_fallback_count: data.fallbackCount,
	});
}