import type OpenAI from 'openai';
import type { Message } from '../messages.js';
import type { ExploreRerankConfig, ExploreThinkingConfig, ExploreAdaptiveConfig, ExploreScanConfig } from '../../config/ConfigManager.js';

export interface ExploreWorkerFocus {
	name: string;
	focus: string;
}

export interface ExploreWorkerResult {
	worker: string;
	round: number;
	content: string;
	parsed?: unknown;
}

export interface RunParallelExploreOptions {
	client: OpenAI;
	model: string;
	temperature: number;
	messages: Message[];
	userInput: string;
	signal?: AbortSignal;
	shouldStop?: () => boolean;
	onProgress?: (event: ExploreProgressEvent) => void;
	skillContext?: string;
	skillNames?: string[];
	onApiUsage?: (usage: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
		total_time?: number;
		rerank_tokens?: number;
		rerank_latency_ms?: number;
		rerank_candidate_count?: number;
		rerank_selected_count?: number;
		rerank_fallback_count?: number;
	}) => void;
}

export interface SourceFile {
	absolutePath: string;
	relativePath: string;
	size: number;
}

export interface EvidenceMatch {
	term: string;
	lineNumber: number;
	lineContent: string;
}

export interface EvidenceFile {
	filePath: string;
	score: number;
	reasons: string[];
	matches: EvidenceMatch[];
	excerpts: string[];
}

export interface SharedEvidence {
	round: number;
	terms: string[];
	filesScanned: number;
	filesMatched: number;
	files: EvidenceFile[];
	exactFiles: EvidenceFile[];
	deadEnds: string[];
}

export interface RerankChunk {
	filePath: string;
	role: string;
	text: string;
	originalIndex: number;
}

export interface RerankPlan {
	config: ExploreRerankConfig;
	query: string;
}

export interface ThinkingPlan {
	worker: ExploreThinkingConfig['worker'];
	synthesis: ExploreThinkingConfig['synthesis'];
}

export interface ExploreOptions {
	rerankPlan: RerankPlan | null;
	thinkingPlan: ThinkingPlan;
	adaptiveConfig: ExploreAdaptiveConfig;
	scanConfig: Required<ExploreScanConfig>;
}

export interface CollectSourceFilesResult {
	files: SourceFile[];
	scanStrategy: 'single-repo' | 'multi-repo-recent-first';
	reposScanned?: string[];
}

export interface VisitContext {
	root: string;
	files: SourceFile[];
	maxFiles: number;
	budget?: number;
}

export interface ParallelExploreResult {
	content: string;
	ledger: ExploreWorkerResult[];
}

export interface ExploreAdaptiveGate {
	gate: string;
	passed: boolean;
	detail?: string;
}

export interface AdaptiveRound2Decision {
	skip: boolean;
	reasons: string[];
	gates: ExploreAdaptiveGate[];
}

export type ExploreProgressPhase =
	| 'scanning'
	| 'reranking'
	| 'workers'
	| 'adaptive-check'
	| 'synthesis'
	| 'validation'
	| 'fast-path'
	| 'skills';

export type ExploreProgressStatus = 'started' | 'completed' | 'skipped';

export type ExploreScanStep = 'collect' | 'match';

export interface ExploreProgressUsage {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
}

export interface ExploreProgressEvent {
	type: 'progress';
	phase: ExploreProgressPhase;
	status?: ExploreProgressStatus;
	step?: ExploreScanStep;
	round?: number;
	totalRounds?: number;
	workersCompleted?: number;
	totalWorkers?: number;
	workerName?: string;
	rerankCandidates?: number;
	rerankSelected?: number;
	rerankLatencyMs?: number;
	adaptiveSkipped?: boolean;
	adaptiveReasons?: string[];
	adaptiveGates?: ExploreAdaptiveGate[];
	fileCount?: number;
	evidenceCount?: number;
	exactMatchCount?: number;
	deadEndCount?: number;
	searchTerms?: string[];
	topFiles?: string[];
	skillsLoaded?: string[];
	skipReason?: string;
	message?: string;
	elapsedMs?: number;
	totalElapsedMs?: number;
	broadArchitecture?: boolean;
	honorGitignore?: boolean;
	unverifiedPaths?: string[];
	usage?: ExploreProgressUsage;
	scanStrategy?: 'single-repo' | 'multi-repo-recent-first';
	reposScanned?: string[];
}

export interface ExploreResultEvent {
	type: 'result';
	content: string;
	ledger: ExploreWorkerResult[];
}

export interface ExploreErrorEvent {
	type: 'error';
	message: string;
}

export type ExploreEvent = ExploreProgressEvent | ExploreResultEvent | ExploreErrorEvent;