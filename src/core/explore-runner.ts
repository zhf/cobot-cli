import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { createChatCompletion } from './openai-helper.js';
import { Message } from './messages.js';
import ConfigManager, { ExploreRerankConfig, ExploreThinkingConfig, ExploreAdaptiveConfig, ExploreScanConfig } from '../config/ConfigManager.js';
import { rerankDocuments, RerankHit } from './rerank.js';
import { debugLog } from './logger.js';

interface ExploreWorkerFocus {
	name: string;
	focus: string;
}

interface ExploreWorkerResult {
	worker: string;
	round: number;
	content: string;
	parsed?: unknown;
}

interface RunParallelExploreOptions {
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

interface SourceFile {
	absolutePath: string;
	relativePath: string;
	size: number;
}

interface EvidenceMatch {
	term: string;
	lineNumber: number;
	lineContent: string;
}

interface EvidenceFile {
	filePath: string;
	score: number;
	reasons: string[];
	matches: EvidenceMatch[];
	excerpts: string[];
}

interface SharedEvidence {
	round: number;
	terms: string[];
	filesScanned: number;
	filesMatched: number;
	files: EvidenceFile[];
	exactFiles: EvidenceFile[];
	deadEnds: string[];
}

interface RerankChunk {
	filePath: string;
	role: string;
	text: string;
	originalIndex: number;
}

interface RerankPlan {
	config: ExploreRerankConfig;
	query: string;
}

interface ThinkingPlan {
	worker: ExploreThinkingConfig['worker'];
	synthesis: ExploreThinkingConfig['synthesis'];
}

interface ExploreOptions {
	rerankPlan: RerankPlan | null;
	thinkingPlan: ThinkingPlan;
	adaptiveConfig: ExploreAdaptiveConfig;
	scanConfig: Required<ExploreScanConfig>;
}

export interface ParallelExploreResult {
	content: string;
	ledger: ExploreWorkerResult[];
}

export interface ExploreProgressEvent {
	type: 'progress';
	phase: 'scanning' | 'reranking' | 'workers' | 'adaptive-check' | 'synthesis' | 'validation' | 'fast-path' | 'skills';
	round?: number;
	totalRounds?: number;
	workersCompleted?: number;
	totalWorkers?: number;
	rerankCandidates?: number;
	rerankSelected?: number;
	adaptiveSkipped?: boolean;
	fileCount?: number;
	evidenceCount?: number;
	skillsLoaded?: string[];
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

const EXPLORE_ROUNDS = 2;
const FINAL_SYNTHESIS_MAX_TOKENS = 5000;
const WORKER_MAX_TOKENS = 3000;
const MAX_CONTEXT_CHARS = 14000;
const MAX_LEDGER_CHARS = 24000;
const MAX_EVIDENCE_CHARS = 42000;
const MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TERMS_PER_ROUND = 24;
const MAX_MATCHES_PER_FILE = 20;
const MAX_EVIDENCE_FILES = 32;
const MAX_EXCERPT_LINES_PER_FILE = 60;
const FAST_PATH_MIN_EXACT_MATCHES = 2;
const FAST_PATH_MIN_EXACT_FILES = 1;
const DETERMINISTIC_FOLLOW_UP_FILES = 10;
const MAX_RERANK_CANDIDATES = 200;
const MAX_RERANK_CHUNK_CHARS = 1200;
const RERANK_CHUNKS_PER_FILE = 2;

const WORKER_FOCI: ExploreWorkerFocus[] = [
	{
		name: 'surface',
		focus: 'Identify likely entrypoints, user-facing commands, filenames, configuration, contribution files, and documentation evidence.',
	},
	{
		name: 'flow',
		focus: 'Trace implementation wiring, imports, call paths, registries, services, and data flow between the likely files.',
	},
	{
		name: 'validation',
		focus: 'Check tests, examples, edge cases, sibling settings, comments, dead ends, and contradictions in the shared evidence.',
	},
];

const TEXT_EXTENSIONS = new Set([
	'.c', '.cc', '.cpp', '.cs', '.css', '.dart', '.go', '.h', '.hpp', '.html', '.java',
	'.js', '.json', '.jsx', '.kt', '.less', '.lua', '.md', '.mjs', '.php', '.py',
	'.rb', '.rs', '.scss', '.sh', '.svelte', '.swift', '.toml', '.ts', '.tsx', '.vue',
	'.xml', '.yaml', '.yml',
]);

const TEXT_FILENAMES = new Set([
	'license', 'makefile', 'dockerfile', 'readme',
]);

const IGNORE_DIRS = new Set([
	'.git', '.hg', '.svn', 'node_modules', '.next', '.nuxt', 'dist', 'build', 'out',
	'.cache', 'coverage', 'target', '.turbo', '.parcel-cache',
]);

const INSTRUCTION_WORDS = new Set([
	'about', 'after', 'agent', 'also', 'and', 'applied', 'behavior', 'code', 'could',
	'dead', 'declared', 'evidence', 'file', 'files', 'find', 'from', 'give', 'identify',
	'implemented', 'into', 'investigation', 'likely', 'line', 'lines', 'local', 'modify',
	'next', 'only', 'path', 'paths', 'read', 'readonly', 'relevant', 'repository',
	'return', 'run', 'search', 'shell', 'source', 'steps', 'tree', 'where', 'with',
	'wired', 'without',
]);

export async function runParallelExplore(options: RunParallelExploreOptions): Promise<ParallelExploreResult> {
	const emit = (event: ExploreProgressEvent) => {
		options.onProgress?.(event);
	};
	const ledger: ExploreWorkerResult[] = [];
	if (options.skillContext && options.skillNames && options.skillNames.length > 0) {
		emit({ type: 'progress', phase: 'skills', skillsLoaded: options.skillNames });
	}
	const context = formatConversationContext(options.messages, options.skillContext);
	emit({ type: 'progress', phase: 'scanning', round: 0, totalRounds: EXPLORE_ROUNDS });
	const exploreOptions = resolveExploreOptions();
	const scanResult = await collectSourceFiles(process.cwd(), exploreOptions.scanConfig);
	const sourceFiles = scanResult.files;
	emit({
		type: 'progress',
		phase: 'scanning',
		round: 0,
		totalRounds: EXPLORE_ROUNDS,
		fileCount: sourceFiles.length,
		scanStrategy: scanResult.scanStrategy,
		reposScanned: scanResult.reposScanned,
	});
	const evidenceHistory: SharedEvidence[] = [];
	const searchInput = stripSearchMetadataLines(options.userInput);
	const rootNoiseTerms = extractRootNoiseTerms(process.cwd());
	const authoritativeTerms = filterNoiseTerms(extractAuthoritativeTerms(searchInput), rootNoiseTerms);
	let terms = filterNoiseTerms(extractInitialSearchTerms(searchInput), rootNoiseTerms);
	const broadArchitectureRequest = isBroadArchitectureRequest(searchInput);
	const requiredBuckets = deriveRequiredBuckets(searchInput);

	let rounds = EXPLORE_ROUNDS;
	for (let round = 1; round <= rounds; round++) {
		if (options.shouldStop?.()) {
			break;
		}

		emit({ type: 'progress', phase: 'scanning', round, totalRounds: rounds });
		let evidence = await collectSharedEvidence(sourceFiles, terms, round, authoritativeTerms, !broadArchitectureRequest);
		if (exploreOptions.rerankPlan) {
			emit({ type: 'progress', phase: 'reranking', round, rerankCandidates: Math.min(MAX_RERANK_CANDIDATES, evidence.files.length) });
			evidence = await applyRerankToEvidence(evidence, exploreOptions.rerankPlan, options);
		}
		evidenceHistory.push(evidence);
		emit({ type: 'progress', phase: 'scanning', round, totalRounds: rounds, evidenceCount: evidence.files.length });

		if (shouldUseDeterministicFastPath(searchInput, evidenceHistory)) {
			emit({ type: 'progress', phase: 'fast-path', round });
			const followUpTerms = filterNoiseTerms(extractDeterministicFollowUpSearchTerms(searchInput, evidenceHistory), rootNoiseTerms);
			if (followUpTerms.length > 0 && round < EXPLORE_ROUNDS) {
				let followUpEvidence = await collectSharedEvidence(sourceFiles, followUpTerms, round + 1, authoritativeTerms, !broadArchitectureRequest);
				if (exploreOptions.rerankPlan) {
					followUpEvidence = await applyRerankToEvidence(followUpEvidence, exploreOptions.rerankPlan, options);
				}
				evidenceHistory.push(followUpEvidence);
			}

			const fastContent = formatDeterministicExploreResult(searchInput, evidenceHistory);
			emit({ type: 'progress', phase: 'validation' });
			return {
				content: fastContent,
				ledger,
			};
		}

		const ledgerSummary = formatLedgerForPrompt(ledger);
		const evidenceSummary = formatEvidenceForPrompt(evidence);
		emit({ type: 'progress', phase: 'workers', round, totalRounds: rounds, totalWorkers: WORKER_FOCI.length, workersCompleted: 0 });

		// Run workers individually so we can emit progress as each completes.
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
			emit({ type: 'progress', phase: 'workers', round, totalRounds: rounds, totalWorkers: WORKER_FOCI.length, workersCompleted });
			return result;
		}));
		const results = await Promise.all(workerPromises);
		roundResults.push(...results);
		ledger.push(...roundResults);

		// Adaptive one-round mode: after round 1, check if coverage is strong enough to skip round 2.
		if (round === 1 && rounds > 1) {
			emit({ type: 'progress', phase: 'adaptive-check', round, totalRounds: rounds });
			if (shouldSkipRound2(evidenceHistory, ledger, requiredBuckets, exploreOptions.adaptiveConfig)) {
				debugLog('Adaptive: skipping round 2 — coverage gates met after round 1.');
				emit({ type: 'progress', phase: 'adaptive-check', round, totalRounds: rounds, adaptiveSkipped: true });
				rounds = 1;
				break;
			}
			emit({ type: 'progress', phase: 'adaptive-check', round, totalRounds: rounds, adaptiveSkipped: false });
		}

		terms = filterNoiseTerms(extractFollowUpSearchTerms(searchInput, ledger, evidenceHistory), rootNoiseTerms);
		if (terms.length === 0) {
			break;
		}
	}

	const synthesisEvidenceHistory = exploreOptions.rerankPlan
		? await buildRerankedSynthesisHistory(evidenceHistory, exploreOptions.rerankPlan, options)
		: evidenceHistory;

	emit({ type: 'progress', phase: 'synthesis' });
	const synthesizedContent = await synthesizeExploreResult({
		...options,
		context,
		ledger,
		evidenceHistory: synthesisEvidenceHistory,
		thinkingPlan: exploreOptions.thinkingPlan,
	});
	const exactSummary = isBroadArchitectureRequest(searchInput) ? '' : formatExactSummary(evidenceHistory);
	const coverageSummary = broadArchitectureRequest ? formatCoverageHighlights(searchInput, evidenceHistory) : '';
	emit({ type: 'progress', phase: 'validation' });
	const validatedContent = validateCitedPaths(synthesizedContent, sourceFiles, evidenceHistory);
	const content = [coverageSummary, exactSummary, validatedContent].filter(Boolean).join('\n\n');

	return {
		content,
		ledger,
	};
}

interface CollectSourceFilesResult {
	files: SourceFile[];
	scanStrategy: 'single-repo' | 'multi-repo-recent-first';
	reposScanned?: string[];
}

interface VisitContext {
	root: string;
	files: SourceFile[];
	maxFiles: number;
	budget?: number;
}

async function collectSourceFiles(root: string, scanConfig: Required<ExploreScanConfig>): Promise<CollectSourceFilesResult> {
	const files: SourceFile[] = [];
	const topEntries = await readDirectoryEntries(root);
	const topDirs = topEntries.filter((entry) => entry.isDirectory() && !shouldSkipDirectory(entry.name));
	const useMultiRepoScan = scanConfig.recentFirst && topDirs.length >= scanConfig.multiRepoMinDirs;

	if (useMultiRepoScan) {
		const reposScanned: string[] = [];
		const sortedDirs = await sortDirectoryEntriesByMtime(root, topDirs);
		const perRepoCap = scanConfig.perRepoMaxFiles;

		const rootContext: VisitContext = { root, files, maxFiles: scanConfig.maxFiles };
		for (const entry of sortEntriesAlphabetically(topEntries.filter((item) => item.isFile()))) {
			await addSourceFileIfEligible(rootContext, path.join(root, entry.name));
		}

		for (const entry of sortedDirs) {
			if (files.length >= scanConfig.maxFiles) {
				break;
			}

			const beforeCount = files.length;
			const repoContext: VisitContext = {
				root,
				files,
				maxFiles: scanConfig.maxFiles,
				budget: perRepoCap,
			};
			await visitDirectory(path.join(root, entry.name), repoContext);
			if (files.length > beforeCount) {
				reposScanned.push(entry.name);
			}
		}

		return {
			files,
			scanStrategy: 'multi-repo-recent-first',
			reposScanned,
		};
	}

	const context: VisitContext = { root, files, maxFiles: scanConfig.maxFiles };
	await visitDirectory(root, context);
	return { files, scanStrategy: 'single-repo' };
}

async function readDirectoryEntries(directory: string): Promise<fs.Dirent[]> {
	try {
		return await fs.promises.readdir(directory, { withFileTypes: true });
	} catch {
		return [];
	}
}

function sortEntriesAlphabetically(entries: fs.Dirent[]): fs.Dirent[] {
	return [...entries].sort((left, right) => {
		if (left.isDirectory() !== right.isDirectory()) {
			return left.isDirectory() ? -1 : 1;
		}
		return left.name.localeCompare(right.name);
	});
}

async function sortDirectoryEntriesByMtime(parentDirectory: string, entries: fs.Dirent[]): Promise<fs.Dirent[]> {
	const entriesWithMtime = await Promise.all(entries.map(async (entry) => {
		let mtimeMs = 0;
		try {
			const stats = await fs.promises.stat(path.join(parentDirectory, entry.name));
			mtimeMs = stats.mtimeMs;
		} catch {
			mtimeMs = 0;
		}
		return { entry, mtimeMs };
	}));

	return entriesWithMtime
		.sort((left, right) => {
			if (right.mtimeMs !== left.mtimeMs) {
				return right.mtimeMs - left.mtimeMs;
			}
			return left.entry.name.localeCompare(right.entry.name);
		})
		.map((item) => item.entry);
}

async function addSourceFileIfEligible(context: VisitContext, absolutePath: string): Promise<boolean> {
	if (context.files.length >= context.maxFiles) {
		return false;
	}
	if (context.budget !== undefined && context.budget <= 0) {
		return false;
	}

	const fileName = path.basename(absolutePath);
	if (!isLikelyTextFile(fileName)) {
		return false;
	}

	let stats: fs.Stats;
	try {
		stats = await fs.promises.stat(absolutePath);
	} catch {
		return false;
	}

	if (!stats.isFile() || stats.size > MAX_SOURCE_FILE_BYTES) {
		return false;
	}

	context.files.push({
		absolutePath,
		relativePath: path.relative(context.root, absolutePath),
		size: stats.size,
	});
	if (context.budget !== undefined) {
		context.budget -= 1;
	}
	return true;
}

async function visitDirectory(directory: string, context: VisitContext): Promise<void> {
	if (context.files.length >= context.maxFiles) {
		return;
	}
	if (context.budget !== undefined && context.budget <= 0) {
		return;
	}

	const entries = sortEntriesAlphabetically(await readDirectoryEntries(directory));
	for (const entry of entries) {
		if (context.files.length >= context.maxFiles) {
			return;
		}
		if (context.budget !== undefined && context.budget <= 0) {
			return;
		}

		const absolutePath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			if (shouldSkipDirectory(entry.name)) {
				continue;
			}
			await visitDirectory(absolutePath, context);
			continue;
		}

		if (!entry.isFile()) {
			continue;
		}

		await addSourceFileIfEligible(context, absolutePath);
	}
}

async function collectSharedEvidence(sourceFiles: SourceFile[], terms: string[], round: number, authoritativeTerms: string[], includeExactFiles: boolean): Promise<SharedEvidence> {
	const normalizedTerms = uniqueTerms(terms).slice(0, MAX_TERMS_PER_ROUND);
	const authoritativeTermSet = new Set(authoritativeTerms.map((term) => term.toLowerCase()));
	const evidenceByFile = new Map<string, EvidenceFile>();
	const deadEnds: string[] = [];

	if (normalizedTerms.length === 0) {
		return {
			round,
			terms: [],
			filesScanned: sourceFiles.length,
			filesMatched: 0,
			files: [],
			exactFiles: [],
			deadEnds: ['No search terms were available for this round.'],
		};
	}

	for (const file of sourceFiles) {
		const pathScore = scorePath(file.relativePath, normalizedTerms);
		if (pathScore.score > 0) {
			upsertEvidenceFile(evidenceByFile, file.relativePath, pathScore.score, pathScore.reasons);
		}

		let content: string;
		try {
			content = await fs.promises.readFile(file.absolutePath, 'utf-8');
		} catch {
			continue;
		}

		const lines = content.split('\n');
		const termOccurrenceCounts = new Map<string, number>();
		for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
			const line = lines[lineIndex];
			for (const term of normalizedTerms) {
				if (!termMatchesLine(line, term)) {
					continue;
				}

				const existing = evidenceByFile.get(file.relativePath);
				const isAuthoritativeTerm = authoritativeTermSet.has(term.toLowerCase()) && termPriority(term) >= 120;
				const shouldKeepAfterMatchCap = isAuthoritativeTerm || isHighValueLineMatch(term, line);
				if (existing && existing.matches.length >= MAX_MATCHES_PER_FILE && !shouldKeepAfterMatchCap) {
					continue;
				}
				if (existing && existing.matches.length >= MAX_MATCHES_PER_FILE + 24 && !shouldKeepAfterMatchCap) {
					continue;
				}

				const termKey = term.toLowerCase();
				const termOccurrenceIndex = termOccurrenceCounts.get(termKey) ?? 0;
				termOccurrenceCounts.set(termKey, termOccurrenceIndex + 1);
				const evidence = upsertEvidenceFile(
					evidenceByFile,
					file.relativePath,
					scoreLineMatch(file.relativePath, term, line, termOccurrenceIndex),
					[`matched "${term}"`],
				);
				evidence.matches.push({
					term,
					lineNumber: lineIndex + 1,
					lineContent: trimLine(line),
				});
				break;
			}
		}
	}

	for (const term of normalizedTerms) {
		const hasMatch = [...evidenceByFile.values()].some((file) => file.matches.some((match) => match.term === term) || file.reasons.some((reason) => reason.includes(term)));
		if (!hasMatch) {
			deadEnds.push(`No direct matches for "${term}"`);
		}
	}

	const rankedFiles = [...evidenceByFile.values()].sort(compareEvidenceFiles);
	const topFilesByTerm = selectTopFilesByTerm(rankedFiles, normalizedTerms);
	const files = uniqueEvidenceFiles([
		...topFilesByTerm,
		...rankedFiles.slice(0, Math.max(8, Math.floor(MAX_EVIDENCE_FILES * 0.65))),
		...rankedFiles,
	]).slice(0, MAX_EVIDENCE_FILES);
	const exactFiles = includeExactFiles ? [...evidenceByFile.values()]
		.filter((file) => file.matches.some((match) => authoritativeTermSet.has(match.term.toLowerCase()) && termPriority(match.term) >= 120))
		.sort(compareEvidenceFiles)
		.slice(0, 16)
		.map((file) => ({
			...file,
			matches: file.matches.filter((match) => authoritativeTermSet.has(match.term.toLowerCase()) && termPriority(match.term) >= 120),
			excerpts: [],
		})) : [];

	await Promise.all([...new Set([...exactFiles, ...files])].map((file) => addExcerpts(file, sourceFiles)));

	return {
		round,
		terms: normalizedTerms,
		filesScanned: sourceFiles.length,
		filesMatched: evidenceByFile.size,
		files,
		exactFiles,
		deadEnds: deadEnds.slice(0, 12),
	};
}

function selectTopFilesByTerm(files: EvidenceFile[], terms: string[]): EvidenceFile[] {
	const selected: EvidenceFile[] = [];

	for (const term of terms.filter((item) => termPriority(item) >= 120).slice(0, 10)) {
		const termFiles = files
			.filter((file) => file.matches.some((match) => match.term === term))
			.sort(compareEvidenceFiles)
			.slice(0, 3);
		selected.push(...termFiles);
	}

	return uniqueEvidenceFiles(selected);
}

function resolveExploreOptions(searchInput?: string): ExploreOptions {
	let rerankConfig: ExploreRerankConfig | null = null;
	let thinkingConfig: ExploreThinkingConfig = { worker: 'default', synthesis: 'default' };
	let adaptiveConfig: ExploreAdaptiveConfig = {};
	let scanConfig: Required<ExploreScanConfig> = {
		maxFiles: 60000,
		recentFirst: true,
		multiRepoMinDirs: 8,
		perRepoMaxFiles: 1500,
	};

	try {
		const manager = new ConfigManager();
		rerankConfig = manager.getExploreRerankConfig();
		thinkingConfig = manager.getExploreThinkingConfig();
		adaptiveConfig = manager.getExploreAdaptiveConfig();
		scanConfig = manager.getExploreScanConfig();
	} catch (error) {
		debugLog('Failed to load explore config:', error);
	}

	const rerankPlan = rerankConfig && rerankConfig.model && rerankConfig.apiKey && searchInput
		? { config: rerankConfig, query: truncate(searchInput.replace(/\s+/g, ' '), 4000) }
		: null;

	return {
		rerankPlan,
		thinkingPlan: {
			worker: thinkingConfig.worker ?? 'default',
			synthesis: thinkingConfig.synthesis ?? 'default',
		},
		adaptiveConfig,
		scanConfig,
	};
}

function thinkingExtraBody(mode: ExploreThinkingConfig['worker'] | ExploreThinkingConfig['synthesis'] | undefined): Record<string, unknown> | undefined {
	if (mode === 'disabled') {
		return { thinking: { type: 'disabled' } };
	}
	return undefined;
}

function deriveRequiredBuckets(userInput: string): string[] {
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

function shouldSkipRound2(evidenceHistory: SharedEvidence[], ledger: ExploreWorkerResult[], requiredBuckets: string[], adaptiveConfig: ExploreAdaptiveConfig): boolean {
	if (evidenceHistory.length === 0) {
		return false;
	}

	const minHighPriorityFiles = adaptiveConfig.minHighPriorityFiles ?? 4;
	const minDeclarationEvidence = adaptiveConfig.minDeclarationEvidence ?? 1;
	const maxLowSignalRatio = adaptiveConfig.maxLowSignalRatio ?? 0.5;

	const evidence = evidenceHistory[evidenceHistory.length - 1];
	const allFiles = [...evidence.exactFiles, ...evidence.files];

	// Gate 1: enough high-priority files.
	const highPriorityFiles = allFiles.filter((file) => file.score >= 200 || hasExactFilenameMatch(file) || hasFilenameMatch(file));
	if (highPriorityFiles.length < minHighPriorityFiles) {
		debugLog(`Adaptive: keeping round 2 — only ${highPriorityFiles.length} high-priority files (need ${minHighPriorityFiles}).`);
		return false;
	}

	// Gate 2: at least one bucket has concrete declaration/method evidence.
	const declarationEvidence = allFiles.filter((file) => file.matches.some((match) => /\b(class|interface|enum|type|function|const|record|struct|register|configuration|config|setting|command|provider|service|default|factory|resolver|loader|startup|context|container|profile|definition|dispatch|create|launch|initialize|initialise)\b/i.test(match.lineContent)));
	if (declarationEvidence.length < minDeclarationEvidence) {
		debugLog(`Adaptive: keeping round 2 — no declaration/method evidence found.`);
		return false;
	}

	// Gate 3: top files are not mostly low-signal.
	const topFiles = evidence.files.slice(0, Math.min(8, evidence.files.length));
	const lowSignalCount = topFiles.filter((file) => isLowSignalPath(file.filePath)).length;
	if (topFiles.length > 0 && lowSignalCount / topFiles.length > maxLowSignalRatio) {
		debugLog(`Adaptive: keeping round 2 — top files are mostly low-signal (${lowSignalCount}/${topFiles.length}).`);
		return false;
	}

	// Gate 4: required buckets have coverage.
	const coveredBuckets = new Set<string>();
	for (const file of allFiles) {
		coveredBuckets.add(roleForFile(file.filePath));
	}
	const missingBuckets = requiredBuckets.filter((bucket) => !coveredBuckets.has(bucket));
	if (missingBuckets.length > 0) {
		debugLog(`Adaptive: keeping round 2 — missing required buckets: ${missingBuckets.join(', ')}.`);
		return false;
	}

	// Gate 5: no worker reports missing critical roles.
	for (const entry of ledger.slice(-WORKER_FOCI.length)) {
		if (entry.parsed && typeof entry.parsed === 'object') {
			const parsed = entry.parsed as Record<string, unknown>;
			const deadEnds = stringArrayField(parsed.dead_ends);
			if (deadEnds.some((deadEnd) => /missing|not found|absent|no\s+\w+\s+(file|evidence|declaration)/i.test(deadEnd))) {
				debugLog(`Adaptive: keeping round 2 — worker ${entry.worker} reports missing evidence.`);
				return false;
			}
			const confidence = parsed.confidence;
			if (confidence === 'low') {
				debugLog(`Adaptive: keeping round 2 — worker ${entry.worker} reports low confidence.`);
				return false;
			}
		}
	}

	return true;
}

function validateCitedPaths(content: string, sourceFiles: SourceFile[], evidenceHistory: SharedEvidence[]): string {
	if (!content.trim()) {
		return content;
	}

	const knownPaths = new Set(sourceFiles.map((file) => file.relativePath));
	const evidencePaths = new Set<string>();
	for (const evidence of evidenceHistory) {
		for (const file of evidence.files) {
			evidencePaths.add(file.filePath);
		}
		for (const file of evidence.exactFiles) {
			evidencePaths.add(file.filePath);
		}
	}

	const citedPaths = extractCitedPaths(content);
	if (citedPaths.length === 0) {
		return content;
	}

	const unverifiedPaths: string[] = [];
	for (const citedPath of citedPaths) {
		if (knownPaths.has(citedPath) || evidencePaths.has(citedPath)) {
			continue;
		}
		// Try matching by basename — synthesis may have slightly wrong path prefix.
		const basename = path.basename(citedPath);
		const basenameMatch = sourceFiles.find((file) => path.basename(file.relativePath) === basename);
		if (basenameMatch) {
			continue;
		}
		unverifiedPaths.push(citedPath);
	}

	if (unverifiedPaths.length === 0) {
		return content;
	}

	debugLog(`Cited-path validation: ${unverifiedPaths.length} unverified path(s):`, unverifiedPaths);
	const warning = [
		'',
		'> **Note**: The following cited paths could not be verified against the local file list and may be hallucinated:',
		...unverifiedPaths.map((p) => `> - \`${p}\``),
		'> Prefer the deterministic coverage highlights above for authoritative paths.',
	].join('\n');

	return `${content}\n${warning}`;
}

function extractCitedPaths(content: string): string[] {
	const paths: string[] = [];
	const seen = new Set<string>();

	// Match paths in backticks. Require either a path separator (/) or a known source
	// extension to avoid matching function calls like `mongoose.connect`.
	const sourceExtensions = /\.(?:ts|tsx|js|jsx|py|java|go|rs|rb|php|cs|kt|swift|c|cc|cpp|h|hpp|json|ya?ml|xml|toml|md|sh|svelte|vue|css|scss|less|html)$/;
	const patterns = [
		/`([^`\n]+\/[^`\n]+\.[A-Za-z0-9]+)`/g, // paths with separators
		/`([^`\n]+\.(?:ts|tsx|js|jsx|py|java|go|rs|rb|php|cs|kt|swift|c|cc|cpp|h|hpp|json|ya?ml|xml|toml|sh|svelte|vue|css|scss|less|html))`/g, // bare filenames with known extensions
	];

	for (const pattern of patterns) {
		for (const match of content.matchAll(pattern)) {
			const candidate = match[1].trim();
			if (candidate.includes(' ') || candidate.length < 5) {
				continue;
			}
			if (!sourceExtensions.test(candidate)) {
				continue;
			}
			// Skip URLs.
			if (/^https?:\/\//.test(candidate)) {
				continue;
			}
			// Skip function calls (contain dots that aren't part of the extension).
			const withoutExt = candidate.replace(sourceExtensions, '');
			if (withoutExt.includes('.') && !withoutExt.includes('/')) {
				continue;
			}
			const normalized = candidate.replace(/^\.?\//, '');
			if (seen.has(normalized)) {
				continue;
			}
			seen.add(normalized);
			paths.push(normalized);
		}
	}

	return paths;
}

async function applyRerankToEvidence(
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

async function buildRerankedSynthesisHistory(
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

function mergeEvidenceHistoryForSynthesis(evidenceHistory: SharedEvidence[]): SharedEvidence {
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

function buildRerankChunks(evidence: SharedEvidence): RerankChunk[] {
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

function roleForFile(filePath: string): string {
	const lowerPath = filePath.toLowerCase();
	if (/(?:^|\/)(?:config|configuration|settings?|schemas?|env|environment)\b|\.ya?ml$|\.xml$|\.toml$|\.ini$/i.test(lowerPath)) {
		return 'config';
	}
	if (/(?:definition|definitions|declarations?|interface|enum|struct|types?|d\.ts)$/i.test(lowerPath)) {
		return 'declaration';
	}
	if (/resolv|provider/i.test(lowerPath)) {
		return 'resolver';
	}
	if (/factor(?:y|ies)|create|launch|spawn|start/i.test(lowerPath)) {
		return 'creation';
	}
	if (/load|loader|reader|parser|parse/i.test(lowerPath)) {
		return 'loader';
	}
	if (/context|container|startup|wiring|dispatch/i.test(lowerPath)) {
		return 'context';
	}
	return 'usage';
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

	// Append any files that rerank did not return (e.g., truncated top_n) in deterministic order.
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

	// First pass: take files in rerank order, counting roles.
	for (const file of orderedFiles) {
		const role = chunkByFilePath.get(file.filePath)?.role ?? 'usage';
		result.push(file);
		included.add(file.filePath);
		roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
	}

	// Second pass: if any role is below the minimum, inject top deterministic files for that role
	// from the original ordered list (which is already rerank-then-deterministic ordered).
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

function shouldUseDeterministicFastPath(userInput: string, evidenceHistory: SharedEvidence[]): boolean {
	if (isBroadArchitectureRequest(userInput)) {
		return false;
	}

	const exactFilePaths = new Set<string>();
	let exactMatches = 0;

	for (const evidence of evidenceHistory) {
		for (const file of evidence.exactFiles) {
			const matches = file.matches.filter((match) => termPriority(match.term) >= 120);
			if (matches.length === 0) {
				continue;
			}
			exactFilePaths.add(file.filePath);
			exactMatches += matches.length;
		}
	}

	return exactFilePaths.size >= FAST_PATH_MIN_EXACT_FILES && exactMatches >= FAST_PATH_MIN_EXACT_MATCHES;
}

function isBroadArchitectureRequest(value: string): boolean {
	const lowerValue = value.toLowerCase();
	const asksForFlow = /\b(trace|flow|path|wiring|startup|lifecycle|call\s+chain|control\s+flow|data\s+flow)\b/.test(lowerValue);
	const asksForResolution = /\b(resolve|resolves|resolved|resolver|loads?|loader|creates?|creation|launch(?:es|ed)?|factory|factories|construct(?:s|ed|ion)?|initiali[sz](?:e|es|ed|ation))\b/.test(lowerValue);
	const asksForArchitecturePieces = /\b(config(?:uration)?|setting|settings|service|services|registry|registries|provider|providers|context|container|dispatcher|profile|profiles|declaration|definitions?)\b/.test(lowerValue);
	const asksForMultipleEvidenceKinds = /\bidentify\b/.test(lowerValue)
		&& /(?:\band\b.+\band\b|\bclasses\b|\bfiles\b|\bpath and line evidence\b)/.test(lowerValue);

	return (asksForFlow && (asksForResolution || asksForArchitecturePieces))
		|| (asksForResolution && asksForArchitecturePieces)
		|| asksForMultipleEvidenceKinds;
}

function extractDeterministicFollowUpSearchTerms(userInput: string, evidenceHistory: SharedEvidence[]): string[] {
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

function formatDeterministicExploreResult(userInput: string, evidenceHistory: SharedEvidence[]): string {
	const topFiles = selectDisplayEvidenceFiles(uniqueEvidenceFiles([
		...mergePrimaryEvidenceFiles(evidenceHistory, 24),
		...mergeEvidenceFiles(evidenceHistory, 30),
	]), userInput, 16);
	const exactSummary = formatExactSummary(evidenceHistory);
	const deadEnds = uniqueStrings(evidenceHistory.flatMap((evidence) => evidence.deadEnds)).slice(0, 8);
	const lines: string[] = [];

	if (exactSummary) {
		lines.push(exactSummary);
		lines.push('');
	}

	lines.push('## Likely Files');
	if (topFiles.length === 0) {
		lines.push('- No likely files were found from the local evidence scan.');
	} else {
		for (const file of topFiles) {
			const reasons = file.reasons.slice(0, 3).join('; ') || 'local evidence match';
			lines.push(`- ${file.filePath} - ${reasons}`);
			const matches = dedupeMatches(file.matches).slice(0, 3);
			if (matches.length === 0) {
				lines.push(`  path evidence: ${reasons}`);
			}
			for (const match of matches) {
				lines.push(`  line ${match.lineNumber}: ${match.lineContent}`);
			}
		}
	}

	lines.push('');
	lines.push('## Evidence');
	lines.push('High-confidence exact matches were found, so this answer is based on deterministic local scanning rather than model synthesis.');
	for (const file of topFiles.slice(0, 8)) {
		lines.push('');
		lines.push(`- ${file.filePath}`);
		const matches = dedupeMatches(file.matches).slice(0, 6);
		if (matches.length === 0) {
			lines.push(`  path evidence: ${file.reasons.slice(0, 3).join('; ') || 'path match'}`);
		}
		for (const match of matches) {
			lines.push(`  line ${match.lineNumber} (${match.term}): ${match.lineContent}`);
		}
	}

	lines.push('');
	lines.push('## Dead Ends');
	if (deadEnds.length === 0) {
		lines.push('- No direct-search dead ends were found in the deterministic scan.');
	} else {
		lines.push(...deadEnds.map((deadEnd) => `- ${deadEnd}`));
	}

	lines.push('');
	lines.push('## Recommended Next Steps');
	lines.push('- Inspect the top files above first; they contain the strongest exact and path evidence for the request.');
	lines.push('- Re-run explore with a narrower identifier, command id, setting key, class name, or file path if deeper call-chain detail is needed.');
	lines.push(`- Original request searched: ${truncate(userInput.replace(/\s+/g, ' '), 180)}`);

	return lines.join('\n');
}

function formatCoverageHighlights(userInput: string, evidenceHistory: SharedEvidence[]): string {
	const files = selectDisplayEvidenceFiles(uniqueEvidenceFiles([
		...mergePrimaryEvidenceFiles(evidenceHistory, 24),
		...mergeEvidenceFiles(evidenceHistory, 48),
	]), userInput, 20);
	if (files.length === 0) {
		return '';
	}

	const lines = [
		'## Deterministic Coverage Highlights',
		'High-priority local matches from the shared scan:',
	];

	for (const file of files) {
		const matches = [...dedupeMatches(file.matches)]
			.sort((left, right) => compareMatchesForEvidence(file.filePath, left, right))
			.slice(0, 4);
		if (matches.length === 0) {
			continue;
		}

		lines.push(`- ${file.filePath}`);
		for (const match of matches) {
			lines.push(`  line ${match.lineNumber} (${match.term}): ${match.lineContent}`);
		}
	}

	return lines.length > 2 ? lines.join('\n') : '';
}

function selectDisplayEvidenceFiles(files: EvidenceFile[], userInput: string, limit: number): EvidenceFile[] {
	if (isTestFocusedRequest(userInput)) {
		return files.slice(0, limit);
	}

	const implementationFiles = files.filter((file) => !isTestPath(file.filePath, file.filePath.split('/')) && !isLowSignalPath(file.filePath));
	const preferredFiles = implementationFiles.length >= Math.min(6, limit) ? implementationFiles : files;
	return uniqueEvidenceFiles(preferredFiles).slice(0, limit);
}

function mergeEvidenceFiles(evidenceHistory: SharedEvidence[], limit: number): EvidenceFile[] {
	const byPath = new Map<string, EvidenceFile>();

	for (const evidence of evidenceHistory) {
		for (const file of evidence.files) {
			mergeEvidenceFile(byPath, file);
		}
		for (const file of evidence.exactFiles) {
			if (!byPath.has(file.filePath)) {
				mergeEvidenceFile(byPath, file);
			}
		}
	}

	return [...byPath.values()]
		.sort(compareEvidenceFiles)
		.slice(0, limit);
}

function mergePrimaryEvidenceFiles(evidenceHistory: SharedEvidence[], limit: number): EvidenceFile[] {
	const dottedExactPathByPath = new Map<string, EvidenceFile>();
	const exactByPath = new Map<string, EvidenceFile>();
	const pathByPath = new Map<string, EvidenceFile>();

	for (const evidence of evidenceHistory) {
		for (const file of evidence.exactFiles) {
			mergeEvidenceFile(exactByPath, file);
		}
		for (const file of evidence.files) {
			if (hasDottedExactFilenameMatch(file)) {
				mergeEvidenceFile(dottedExactPathByPath, file);
				continue;
			}
			if (hasStrongPathMatch(file)) {
				mergeEvidenceFile(pathByPath, file);
			}
		}
	}

	return uniqueEvidenceFiles([
		...[...dottedExactPathByPath.values()].sort(compareEvidenceFiles),
		...[...exactByPath.values()].sort(compareEvidenceFiles),
		...[...pathByPath.values()].sort(compareEvidenceFiles),
	])
		.slice(0, limit);
}

function mergeEvidenceFile(files: Map<string, EvidenceFile>, file: EvidenceFile): void {
	const existing = files.get(file.filePath);
	if (!existing) {
		files.set(file.filePath, {
			filePath: file.filePath,
			score: file.score,
			reasons: [...file.reasons],
			matches: dedupeMatches(file.matches),
			excerpts: uniqueStrings(file.excerpts),
		});
		return;
	}

	existing.score += file.score;
	existing.reasons = uniqueStrings([...existing.reasons, ...file.reasons]);
	existing.matches = dedupeMatches([...existing.matches, ...file.matches]);
	existing.excerpts = uniqueStrings([...existing.excerpts, ...file.excerpts]);
}

function uniqueEvidenceFiles(files: EvidenceFile[]): EvidenceFile[] {
	const seen = new Set<string>();
	const result: EvidenceFile[] = [];
	for (const file of files) {
		if (seen.has(file.filePath)) {
			continue;
		}
		seen.add(file.filePath);
		result.push(file);
	}
	return result;
}

function hasStrongPathMatch(file: EvidenceFile): boolean {
	return hasExactFilenameMatch(file) || hasFilenameMatch(file);
}

function hasExactFilenameMatch(file: EvidenceFile): boolean {
	return file.reasons.some((reason) => {
		const term = pathMatchReasonTerm(reason, 'exact filename match');
		return term !== undefined && isStrongPathTerm(term);
	});
}

function hasDottedExactFilenameMatch(file: EvidenceFile): boolean {
	return file.reasons.some((reason) => {
		const term = pathMatchReasonTerm(reason, 'exact filename match');
		return term !== undefined && term.includes('.');
	});
}

function hasFilenameMatch(file: EvidenceFile): boolean {
	return file.reasons.some((reason) => {
		const term = pathMatchReasonTerm(reason, 'filename match');
		return term !== undefined && isStrongPathTerm(term);
	});
}

function pathMatchReasonTerm(reason: string, prefix: string): string | undefined {
	const match = reason.match(new RegExp(`^${prefix} "(.+)"$`));
	return match?.[1];
}

function isStrongPathTerm(term: string): boolean {
	return termPriority(term) >= 120;
}

function dedupeMatches(matches: EvidenceMatch[]): EvidenceMatch[] {
	const seen = new Set<string>();
	const result: EvidenceMatch[] = [];
	for (const match of matches) {
		const key = `${match.term.toLowerCase()}:${match.lineNumber}:${match.lineContent}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		result.push(match);
	}
	return result.sort((left, right) => left.lineNumber - right.lineNumber || left.term.localeCompare(right.term));
}

function filePathTermVariants(filePath: string): string[] {
	const basename = path.basename(filePath, path.extname(filePath));
	const parts = splitIdentifierParts(basename);
	const terms = [basename];

	for (let index = 0; index < parts.length - 1; index++) {
		const left = parts[index];
		const right = parts[index + 1];
		terms.push(`${left} ${right}`);
		terms.push(`${lowerFirst(left)}${capitalize(right)}`);
		terms.push(`${capitalize(left)}${capitalize(right)}`);
	}

	if (parts.length > 2) {
		terms.push(parts.map((part, index) => (index === 0 ? lowerFirst(part) : capitalize(part))).join(''));
		terms.push(parts.map(capitalize).join(''));
	}

	return terms;
}

function splitIdentifierParts(value: string): string[] {
	return value
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
		.split(/[^A-Za-z0-9]+/)
		.map((part) => part.trim())
		.filter((part) => part.length >= 3);
}

function uniqueStrings(values: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		if (seen.has(value)) {
			continue;
		}
		seen.add(value);
		result.push(value);
	}
	return result;
}

function upsertEvidenceFile(files: Map<string, EvidenceFile>, filePath: string, score: number, reasons: string[]): EvidenceFile {
	const existing = files.get(filePath);
	if (existing) {
		existing.score += score;
		for (const reason of reasons) {
			if (!existing.reasons.includes(reason)) {
				existing.reasons.push(reason);
			}
		}
		return existing;
	}

	const file: EvidenceFile = {
		filePath,
		score,
		reasons: [...reasons],
		matches: [],
		excerpts: [],
	};
	files.set(filePath, file);
	return file;
}

async function addExcerpts(evidenceFile: EvidenceFile, sourceFiles: SourceFile[]): Promise<void> {
	const sourceFile = sourceFiles.find((file) => file.relativePath === evidenceFile.filePath);
	if (!sourceFile || evidenceFile.matches.length === 0) {
		return;
	}

	let content: string;
	try {
		content = await fs.promises.readFile(sourceFile.absolutePath, 'utf-8');
	} catch {
		return;
	}

	const lines = content.split('\n');
	const excerptMatches = [...evidenceFile.matches]
		.sort((left, right) => compareMatchesForEvidence(evidenceFile.filePath, left, right))
		.slice(0, 10);
	const ranges = selectPriorityLineRanges(excerptMatches, lines.length);
	const excerptLines: string[] = [];

	for (const range of ranges) {
		if (excerptLines.length >= MAX_EXCERPT_LINES_PER_FILE) {
			break;
		}
		excerptLines.push(`-- lines ${range.start}-${range.end} --`);
		for (let line = range.start; line <= range.end && excerptLines.length < MAX_EXCERPT_LINES_PER_FILE; line++) {
			excerptLines.push(`${line}: ${trimLine(lines[line - 1])}`);
		}
	}

	evidenceFile.excerpts = excerptLines;
}

function selectPriorityLineRanges(matches: EvidenceMatch[], lineCount: number): Array<{ start: number; end: number }> {
	const ranges: Array<{ start: number; end: number }> = [];

	for (const match of matches) {
		const range = {
			start: Math.max(1, match.lineNumber - 3),
			end: Math.min(lineCount, match.lineNumber + 3),
		};
		const overlappingRange = ranges.find((existing) => range.start <= existing.end + 1 && existing.start <= range.end + 1);
		if (overlappingRange) {
			overlappingRange.start = Math.min(overlappingRange.start, range.start);
			overlappingRange.end = Math.max(overlappingRange.end, range.end);
			continue;
		}
		ranges.push(range);
	}

	return ranges;
}

async function runExploreWorker(options: RunParallelExploreOptions & {
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

async function synthesizeExploreResult(options: RunParallelExploreOptions & {
	context: string;
	ledger: ExploreWorkerResult[];
	evidenceHistory: SharedEvidence[];
	thinkingPlan: ThinkingPlan;
}): Promise<string> {
	if (options.shouldStop?.()) {
		return '';
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
	return content || fallbackSynthesis(options.ledger);
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

function extractInitialSearchTerms(userInput: string): string[] {
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

function extractAuthoritativeTerms(userInput: string): string[] {
	const structuredTerms = uniqueTerms([
		...extractFileLikeTerms(userInput),
		...extractStructuredTerms(userInput),
	]);
	if (structuredTerms.length > 0) {
		return structuredTerms.slice(0, MAX_TERMS_PER_ROUND);
	}

	return uniqueTerms(extractDomainHints(userInput)).slice(0, MAX_TERMS_PER_ROUND);
}

function stripSearchMetadataLines(value: string): string {
	return value
		.split('\n')
		.map((line) => line.replace(/\s*(?:cache[-_ ]?buster|nonce)\s*:\s*[^\n]*/gi, ''))
		.filter((line) => line.trim().length > 0)
		.join('\n')
		.trim();
}

function extractFollowUpSearchTerms(userInput: string, ledger: ExploreWorkerResult[], evidenceHistory: SharedEvidence[]): string[] {
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

function extractStructuredTerms(value: string): string[] {
	const terms: string[] = [];
	const patterns = [
		/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$-]*)+/g,
		/[A-Za-z_$][\w$]*(?:[A-Z][A-Za-z0-9_$]+)+/g,
	];

	for (const pattern of patterns) {
		for (const match of value.matchAll(pattern)) {
			terms.push(match[0]);
		}
	}

	return terms;
}

function extractFileLikeTerms(value: string): string[] {
	const terms: string[] = [];
	for (const match of value.matchAll(/\b[A-Za-z0-9][A-Za-z0-9_.-]*\.(?:[A-Za-z0-9]{1,8})\b/g)) {
		terms.push(match[0]);
	}
	return terms;
}

function extractQuotedTerms(value: string): string[] {
	const terms: string[] = [];
	for (const match of value.matchAll(/["'`]([^"'`]{3,80})["'`]/g)) {
		terms.push(match[1]);
	}
	return terms;
}

function extractWordVariants(value: string): string[] {
	const rawWords = value
		.replace(/[^A-Za-z0-9_+#.-]+/g, ' ')
		.split(/\s+/)
		.filter((word) => word.length >= 3);
	const words = rawWords.filter((word) => word.length >= 4 && !INSTRUCTION_WORDS.has(word.toLowerCase()));
	const terms: string[] = [];

	terms.push(...words.slice(0, 12));
	for (let index = 0; index < rawWords.length - 1; index++) {
		const left = rawWords[index];
		const right = rawWords[index + 1];
		if (left.length < 3 || right.length < 3) {
			continue;
		}
		if (INSTRUCTION_WORDS.has(left.toLowerCase()) && INSTRUCTION_WORDS.has(right.toLowerCase())) {
			continue;
		}
		terms.push(`${left} ${right}`);
		terms.push(`${capitalize(left)}${capitalize(right)}`);
		terms.push(`${lowerFirst(left)}${capitalize(right)}`);
	}

	return terms;
}

function extractKeyboardTerms(value: string): string[] {
	const terms: string[] = [];
	for (const match of value.matchAll(/\b(?:Ctrl|Cmd|Command|Alt|Shift|Meta)\+([A-Za-z0-9])\b/gi)) {
		const key = match[1].toUpperCase();
		terms.push(match[0]);
		terms.push(`Key${key}`);
		terms.push('CtrlCmd');
	}
	return terms;
}

function extractDomainHints(value: string): string[] {
	return extractNounPhraseVariants(value);
}

function extractRoleObjectTerms(value: string): string[] {
	const roles = roleSuffixesForRequest(value);
	if (roles.length === 0) {
		return [];
	}

	const rawWords = value
		.replace(/[^A-Za-z0-9_$+#.-]+/g, ' ')
		.split(/\s+/)
		.map((word) => word.trim())
		.filter((word) => word.length >= 3);
	const objects: string[][] = [];

	for (const word of rawWords) {
		if (isNounPhraseWord(word) || isRoleWord(word)) {
			objects.push([singularizeRoleObject(word)]);
		}
	}

	for (const term of extractStructuredTerms(value)) {
		const parts = splitIdentifierParts(term);
		if (parts.length > 0) {
			objects.push(parts);
		}
	}

	const primaryTerms: string[] = [];
	const secondaryTerms: string[] = [];
	for (const objectParts of uniqueCandidateParts(objects).slice(0, 10)) {
		const objectName = objectParts.map((part) => capitalizeIdentifierPart(singularizeRoleObject(part))).join('');
		if (objectName.length < 4 || objectName.length > 64) {
			continue;
		}
		for (const role of roles) {
			if (objectName.toLowerCase().endsWith(role.toLowerCase())) {
				continue;
			}
			if (objectAlreadyHasRoleSuffix(objectName) && !['Factory', 'Context', 'Container', 'Config'].includes(role)) {
				continue;
			}
			primaryTerms.push(`${objectName}${role}`);
			secondaryTerms.push(`${lowerFirst(objectName)}${role}`);
		}
	}

	return uniqueTerms([...primaryTerms, ...secondaryTerms]).slice(0, 24);
}

function roleSuffixesForRequest(value: string): string[] {
	const lowerValue = value.toLowerCase();
	const roles: string[] = [];
	const rolePatterns: Array<[RegExp, string]> = [
		[/\bservices?\b/, 'Service'],
		[/\bresolvers?\b|\bresolve[sd]?\b/, 'Resolver'],
		[/\bfactory|factories\b/, 'Factory'],
		[/\bloaders?\b|\bloads?\b/, 'Loader'],
		[/\bcontexts?\b/, 'Context'],
		[/\bcontainers?\b|\bstartup\b|\bstartups\b/, 'Container'],
		[/\bconfig(?:uration)?s?\b|\bsettings?\b/, 'Config'],
		[/\bregistr(?:y|ies)\b/, 'Registry'],
		[/\bproviders?\b/, 'Provider'],
		[/\bcontrollers?\b/, 'Controller'],
		[/\bmodels?\b/, 'Model'],
		[/\breaders?\b|\breads?\b/, 'Reader'],
		[/\bdispatchers?\b|\bdispatch\b/, 'Dispatcher'],
		[/\bprofiles?\b/, 'Profile'],
	];

	for (const [pattern, role] of rolePatterns) {
		if (pattern.test(lowerValue)) {
			roles.push(role);
		}
	}

	return uniqueStrings(roles).slice(0, 8);
}

function isRoleWord(word: string): boolean {
	return /^(?:service|services|resolver|resolvers|factory|factories|loader|loaders|context|contexts|container|containers|config|configs|configuration|configurations|setting|settings|registry|registries|provider|providers|controller|controllers|model|models|reader|readers|dispatcher|dispatchers|profile|profiles)$/i.test(word);
}

function objectAlreadyHasRoleSuffix(value: string): boolean {
	return /(?:Service|Resolver|Factory|Loader|Context|Container|Config|Registry|Provider|Controller|Model|Reader|Dispatcher|Profile)$/i.test(value);
}

function singularizeRoleObject(word: string): string {
	if (/ies$/i.test(word) && word.length > 4) {
		return `${word.slice(0, -3)}y`;
	}
	if (/s$/i.test(word) && !/ss$/i.test(word) && word.length > 4) {
		return word.slice(0, -1);
	}
	return word;
}

function extractActionObjectTerms(value: string): string[] {
	const actions = actionPrefixesForRequest(value);
	if (actions.length === 0) {
		return [];
	}

	const rawWords = value
		.replace(/[^A-Za-z0-9_$+#.-]+/g, ' ')
		.split(/\s+/)
		.map((word) => word.trim())
		.filter((word) => word.length >= 3);
	const candidates: string[][] = [];
	const structuredTerms = extractStructuredTerms(value);

	for (const term of structuredTerms) {
		const parts = splitIdentifierParts(term);
		if (parts.length > 0) {
			candidates.push(parts);
		}
	}

	const significantWords = rawWords.filter((word) => isActionObjectWord(word));

	for (let index = 0; index < rawWords.length - 1; index++) {
		const left = rawWords[index];
		const right = rawWords[index + 1];
		if (isActionObjectWord(left) && isActionNominalization(right)) {
			candidates.push([left]);
		}
	}

	for (let index = 0; index < rawWords.length - 2; index++) {
		const parts = rawWords.slice(index, index + 3);
		if (parts.every(isActionObjectWord)) {
			candidates.push(parts);
		}
	}

	for (let index = 0; index < rawWords.length - 1; index++) {
		const left = rawWords[index];
		const right = rawWords[index + 1];
		if (isActionObjectWord(left) && isActionObjectWord(right)) {
			candidates.push([left, right]);
		}
	}

	for (const word of significantWords) {
		candidates.push([word]);
	}

	const terms: string[] = [];
	for (const parts of uniqueCandidateParts(candidates).slice(0, 8)) {
		const suffix = parts.map((part) => capitalizeIdentifierPart(part)).join('');
		if (suffix.length < 4 || suffix.length > 80) {
			continue;
		}
		for (const action of actions) {
			terms.push(`${action}${suffix}`);
		}
	}

	return uniqueTerms(terms).slice(0, 10);
}

function uniqueCandidateParts(candidates: string[][]): string[][] {
	const seen = new Set<string>();
	const result: string[][] = [];

	for (const candidate of candidates) {
		const normalized = candidate
			.map((part) => part.toLowerCase().replace(/[^a-z0-9_$]/g, ''))
			.filter(Boolean);
		if (normalized.length === 0) {
			continue;
		}

		const key = normalized.join(' ');
		if (seen.has(key)) {
			continue;
		}

		seen.add(key);
		result.push(candidate);
	}

	return result;
}

function actionPrefixesForRequest(value: string): string[] {
	const lowerValue = value.toLowerCase();
	const actions: string[] = [];

	if (/\b(resolve|resolves|resolved|resolver|default)\b/.test(lowerValue)) {
		actions.push('resolve', 'get');
	}
	if (/\b(create|creates|created|creation|launch|launches|launched|spawn|spawns|start|starts|open|opens)\b/.test(lowerValue)) {
		actions.push('create');
	}
	if (/\b(load|loads|loaded|loader|read|reads|reader|definition|definitions)\b/.test(lowerValue)) {
		actions.push('load', 'read');
	}
	if (/\b(factory|factories|context|container|dispatcher|service|services)\b/.test(lowerValue)) {
		actions.push('get', 'create');
	}

	return uniqueStrings(actions).slice(0, 6);
}

function isActionObjectWord(word: string): boolean {
	const lowerWord = word.toLowerCase();
	return word.length >= 4
		&& !INSTRUCTION_WORDS.has(lowerWord)
		&& !isActionVerbWord(lowerWord)
		&& !isActionNominalization(lowerWord)
		&& !/^(?:code|using|used|user|users|this|that|those|these|same|better|answer|answers|case|cases|repository|local|only|path|line|evidence)$/i.test(word);
}

function isActionVerbWord(word: string): boolean {
	return /^(?:find|identify|resolve|resolves|resolved|resolver|load|loads|loaded|loader|read|reads|reader|create|creates|created|launch|launches|launched|spawn|spawns|start|starts|open|opens|run|runs|used|using)$/i.test(word);
}

function isActionNominalization(word: string): boolean {
	return /^(?:creation|resolution|loading|loader|launch|startup|wiring|configuration|config|declaration|definition|definitions|path)$/i.test(word);
}

function extractNounPhraseVariants(value: string): string[] {
	const words = value
		.replace(/[^A-Za-z0-9_+#.-]+/g, ' ')
		.split(/\s+/)
		.filter((word) => word.length >= 3);
	const phrases: Array<{ left: string; right: string }> = [];

	for (let index = 0; index < words.length - 1; index++) {
		const left = words[index];
		const right = words[index + 1];
		if (!isNounPhraseWord(left) || !isNounPhraseWord(right)) {
			continue;
		}

		const phrase = `${left} ${right}`;
		if (phrase.length > 80) {
			continue;
		}

		phrases.push({ left, right });
	}

	const terms: string[] = [];
	for (const { left, right } of phrases) {
		terms.push(`${capitalize(left)}${capitalize(right)}`);
	}
	for (const { left, right } of phrases) {
		terms.push(`${lowerFirst(left)}${capitalize(right)}`);
	}
	for (const { left, right } of phrases) {
		terms.push(`${left} ${right}`);
	}
	for (const { left, right } of phrases) {
		terms.push(`${lowerFirst(left)}_${lowerFirst(right)}`);
		terms.push(`${lowerFirst(left)}-${lowerFirst(right)}`);
	}
	return terms;
}

function isNounPhraseWord(word: string): boolean {
	const lowerWord = word.toLowerCase();
	return word.length >= 3
		&& !INSTRUCTION_WORDS.has(lowerWord)
		&& !/^(?:code|using|used|use|this|that|those|these|same|better|answer|answers|case|cases|repository|local|only|line|evidence)$/i.test(word)
		&& !/^(?:find|identify|resolve|resolves|resolved|load|loads|loaded|read|reads|create|creates|created|launch|launches|launched|spawn|spawns|start|starts|open|opens|run|runs)$/i.test(word);
}

function uniqueTerms(terms: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const rawTerm of terms) {
		const term = rawTerm.trim().replace(/\s+/g, ' ').replace(/^[^\w$]+|[^\w$]+$/g, '');
		const lowerTerm = term.toLowerCase();
		if (term.length < 3 || seen.has(lowerTerm) || INSTRUCTION_WORDS.has(lowerTerm) || isLowValueSearchTerm(term)) {
			continue;
		}
		seen.add(lowerTerm);
		result.push(term);
	}
	return result;
}

function isLowValueSearchTerm(term: string): boolean {
	return /^(?:debug\.log|console\.|logger\.|log\.|system\.out)/i.test(term)
		|| /^(?:get|set|has|is)[A-Z]?[A-Za-z0-9_]*$/.test(term);
}

function extractRootNoiseTerms(root: string): Set<string> {
	const basename = path.basename(root);
	const parts = splitIdentifierParts(basename);
	const values = [
		basename,
		...parts,
		...basename.split(/[^A-Za-z0-9]+/),
	]
		.map(normalizeNoiseTerm)
		.filter((term) => term.length >= 3 && term !== 'main' && term !== 'trunk');

	return new Set(values);
}

function filterNoiseTerms(terms: string[], rootNoiseTerms: Set<string>): string[] {
	if (rootNoiseTerms.size === 0) {
		return terms;
	}

	return terms.filter((term) => {
		const normalizedTerm = normalizeNoiseTerm(term);
		if (rootNoiseTerms.has(normalizedTerm)) {
			return false;
		}

		const parts = splitIdentifierParts(term).map(normalizeNoiseTerm).filter(Boolean);
		return !(parts.length > 0 && parts.every((part) => rootNoiseTerms.has(part)));
	});
}

function normalizeNoiseTerm(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function scorePath(filePath: string, terms: string[]): { score: number; reasons: string[] } {
	const normalizedPath = filePath.toLowerCase();
	const normalizedBasename = path.basename(filePath).toLowerCase();
	const normalizedStem = path.basename(filePath, path.extname(filePath)).toLowerCase();
	const compactPath = normalizedPath.replace(/[^a-z0-9]/g, '');
	let score = 0;
	const reasons: string[] = [];

	for (const term of terms) {
		const termLower = term.toLowerCase();
		const normalizedTerm = termLower.replace(/\s+/g, '');
		const priority = termPriority(term);
		const exactFilenameBoost = priority >= 120 ? 1800 : 80;
		const filenameBoost = priority >= 120 ? 320 : 24;
		if (normalizedBasename === termLower || normalizedStem === termLower) {
			score += priority + exactFilenameBoost;
			reasons.push(`exact filename match "${term}"`);
		} else if (normalizedBasename.includes(normalizedTerm)) {
			score += priority + filenameBoost;
			reasons.push(`filename match "${term}"`);
		} else if (normalizedPath.includes(termLower)) {
			score += priority + 16;
			reasons.push(`path match "${term}"`);
		} else if (normalizedTerm.length > 4 && compactPath.includes(normalizedTerm)) {
			score += priority + 8;
			reasons.push(`compact path match "${term}"`);
		}
	}

	score += filePathPriority(filePath);
	if (filePath.includes('/test/') || filePath.includes('.test.')) {
		score -= 80;
	}
	return { score, reasons: reasons.length ? reasons : ['path match'] };
}

function scoreLineMatch(filePath: string, term: string, line: string, termOccurrenceIndex = 0): number {
	let score = 10 + termPriority(term) + filePathPriority(filePath);
	if (line.includes(term)) {
		score += 14;
	}
	if (/\b(class|interface|enum|type|function|const|let|var|record|struct)\b/i.test(line)) {
		score += 10;
	}
	if (/\b(register|configuration|config|setting|command|provider|service|default|factory|resolver|loader|startup|context|container|profile|definition|dispatch|create|launch|initialize|initialise)\b/i.test(line)) {
		score += 12;
	}
	if (/^\s*(?:import|using|include|require)\b/i.test(line)) {
		score -= 12;
	}
	if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
		score += 4;
	}
	if (filePath.includes('/test/') || filePath.includes('.test.')) {
		score -= 80;
	}
	if (termOccurrenceIndex >= 8) {
		score = Math.max(1, Math.round(score * 0.08));
	} else if (termOccurrenceIndex >= 4) {
		score = Math.max(2, Math.round(score * 0.18));
	} else if (termOccurrenceIndex >= 2) {
		score = Math.max(4, Math.round(score * 0.4));
	}
	return score;
}

function isHighValueLineMatch(term: string, line: string): boolean {
	return termPriority(term) >= 120 && (
		new RegExp(`\\b${escapeRegExp(term)}\\s*\\(`, 'i').test(line)
		|| /\b(class|interface|enum|type|function|const|record|struct)\b/i.test(line)
		|| /\b(register|configuration|config|setting|service|default|factory|resolver|loader|startup|context|container|profile|definition|dispatch|create|launch|initialize|initialise)\b/i.test(line)
	);
}

function compareEvidenceFiles(left: EvidenceFile, right: EvidenceFile): number {
	return evidenceSortScore(right) - evidenceSortScore(left) || left.filePath.localeCompare(right.filePath);
}

function evidenceSortScore(file: EvidenceFile): number {
	const segments = file.filePath.split('/');
	const lowerPath = file.filePath.toLowerCase();
	let score = file.score;

	if (isSourcePath(segments)) {
		score += 120;
	}
	if (isTestPath(file.filePath, segments)) {
		score -= 600;
	}
	if (isGeneratedOrVendorPath(segments)) {
		score -= 120;
	}
	if (isLowSignalPath(file.filePath)) {
		score -= 700;
	}
	if (hasExactFilenameMatch(file)) {
		score += 2200;
	} else if (hasFilenameMatch(file)) {
		score += 500;
	}
	if (/(action|contribution|controller|provider|registry)/i.test(lowerPath)) {
		score += 220;
	}
	if (/(config|configuration|factory|startup|wiring|resolver|loader|context|container|profile|definition|definitions|model|reader|dispatch|dispatcher)/i.test(lowerPath)) {
		score += 180;
	}
	if (/service/i.test(lowerPath)) {
		score += 60;
	}

	return score;
}

function termPriority(term: string): number {
	if (isFileLikeTerm(term)) {
		return 260;
	}
	if (isDottedIdentifier(term)) {
		return 240;
	}
	if (isKeyboardTerm(term)) {
		return 180;
	}
	if (isCompoundIdentifier(term)) {
		return 120;
	}
	if (term.length >= 12 && !/\s/.test(term)) {
		return 40;
	}
	return 0;
}

function isFileLikeTerm(term: string): boolean {
	return /(?:^|\/)[^/\s]+\.[A-Za-z0-9]{1,8}$/.test(term);
}

function isDottedIdentifier(term: string): boolean {
	return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$-]*)+$/.test(term);
}

function isKeyboardTerm(term: string): boolean {
	return /\b(?:Ctrl|Cmd|Command|Alt|Shift|Meta)\+[A-Za-z0-9]\b/i.test(term)
		|| /^Key[A-Z0-9]$/.test(term)
		|| term === 'CtrlCmd';
}

function isCompoundIdentifier(term: string): boolean {
	return /^[A-Za-z_$][\w$]*(?:[A-Z][A-Za-z0-9_$]+)+$/.test(term)
		|| /^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)+$/.test(term);
}

function filePathPriority(filePath: string): number {
	let score = 0;
	const segments = filePath.split('/');
	if (isSourcePath(segments)) {
		score += 18;
	}
	if (isGeneratedOrVendorPath(segments)) {
		score -= 28;
	}
	if (isTestPath(filePath, segments)) {
		score -= 12;
	}

	return score;
}

function isSourcePath(segments: string[]): boolean {
	return segments.some((segment) => (
		segment === 'src'
		|| segment === 'lib'
		|| segment === 'app'
		|| segment === 'core'
		|| segment === 'packages'
		|| segment === 'services'
		|| segment === 'components'
		|| segment === 'modules'
	));
}

function isGeneratedOrVendorPath(segments: string[]): boolean {
	return segments.some((segment) => (
		segment === 'vendor'
		|| segment === 'third_party'
		|| segment === 'third-party'
		|| segment === 'generated'
		|| segment === '__generated__'
		|| segment === 'fixtures'
		|| segment === 'fixture'
		|| segment === 'snapshots'
		|| segment === '__snapshots__'
	));
}

function isLowSignalPath(filePath: string): boolean {
	const lowerPath = filePath.toLowerCase();
	return /(^|\/)(i18n|l10n|locale|locales|translation|translations)\//.test(lowerPath)
		|| /(?:ui)?labels\.(?:xml|properties|json|ya?ml)$/i.test(lowerPath)
		|| /(?:^|\/)(?:messages|strings)\.(?:xml|properties|json|ya?ml)$/i.test(lowerPath);
}

function isTestPath(filePath: string, segments: string[]): boolean {
	return segments.some((segment) => (
		segment === 'test'
		|| segment === 'tests'
		|| segment === '__tests__'
		|| segment === 'spec'
		|| segment === 'specs'
	)) || /\.(test|spec)\.[^.]+$/i.test(filePath);
}

function isTestFocusedRequest(value: string): boolean {
	return /\b(test|tests|testing|spec|specs|coverage|fixture|fixtures|snapshot|snapshots)\b/i.test(value);
}

function termMatchesLine(line: string, term: string): boolean {
	if (term.length <= 6 && /[A-Z]/.test(term)) {
		return line.includes(term);
	}
	return line.toLowerCase().includes(term.toLowerCase());
}

function formatConversationContext(messages: Message[], skillContext?: string): string {
	const systemMessages = messages
		.filter((message) => message.role === 'system')
		.map((message) => `system: ${message.content}`);
	const recentMessages = messages
		.filter((message) => message.role !== 'system' && message.role !== 'tool')
		.slice(-8)
		.map((message) => `${message.role}: ${message.content}`);

	const parts = [...systemMessages, ...recentMessages];
	if (skillContext) {
		parts.unshift(`skill_context:\n${skillContext}`);
	}

	return truncate(parts.join('\n\n'), MAX_CONTEXT_CHARS);
}

function formatEvidenceForPrompt(evidence: SharedEvidence): string {
	const lines: string[] = [
		`round: ${evidence.round}`,
		`terms: ${evidence.terms.join(', ') || '(none)'}`,
		`files_scanned: ${evidence.filesScanned}`,
		`files_matched: ${evidence.filesMatched}`,
	];
	const termCoverage = formatTermCoverage(evidence);
	if (termCoverage.length) {
		lines.push('');
		lines.push('term_coverage:');
		lines.push(...termCoverage);
	}

	if (evidence.exactFiles.length) {
		lines.push('');
		lines.push('authoritative_exact_matches:');
		for (const file of evidence.exactFiles) {
			lines.push(`file: ${file.filePath}`);
			for (const match of file.matches.filter((item) => evidence.terms.includes(item.term) && termPriority(item.term) >= 120).slice(0, 8)) {
				lines.push(`exact: ${match.term} @ ${match.lineNumber}: ${match.lineContent}`);
			}
			if (file.excerpts.length) {
				lines.push('excerpt:');
				lines.push(...file.excerpts);
			}
		}
	}

	for (const file of evidence.files) {
		lines.push('');
		lines.push(`file: ${file.filePath}`);
		lines.push(`score: ${file.score}`);
		lines.push(`reasons: ${file.reasons.slice(0, 5).join('; ')}`);
		for (const match of file.matches.slice(0, 5)) {
			lines.push(`match: ${match.term} @ ${match.lineNumber}: ${match.lineContent}`);
		}
		if (file.excerpts.length) {
			lines.push('excerpt:');
			lines.push(...file.excerpts);
		}
	}

	if (evidence.deadEnds.length) {
		lines.push('');
		lines.push('dead_ends:');
		lines.push(...evidence.deadEnds.map((deadEnd) => `- ${deadEnd}`));
	}

	return truncate(lines.join('\n'), MAX_EVIDENCE_CHARS);
}

function formatTermCoverage(evidence: SharedEvidence): string[] {
	const lines: string[] = [];

	for (const term of evidence.terms.filter((item) => termPriority(item) >= 120).slice(0, 10)) {
		const matches = evidence.files
			.flatMap((file) => file.matches
				.filter((match) => match.term === term)
				.sort((left, right) => compareMatchesForEvidence(file.filePath, left, right))
				.slice(0, 2)
				.map((match) => ({ file, match })))
			.slice(0, 5);
		if (matches.length === 0) {
			continue;
		}

		lines.push(`term: ${term}`);
		for (const { file, match } of matches) {
			lines.push(`coverage: ${file.filePath}:${match.lineNumber}: ${match.lineContent}`);
		}
	}

	return lines;
}

function compareMatchesForEvidence(filePath: string, left: EvidenceMatch, right: EvidenceMatch): number {
	return matchEvidencePriority(filePath, right) - matchEvidencePriority(filePath, left)
		|| left.lineNumber - right.lineNumber
		|| left.lineContent.localeCompare(right.lineContent);
}

function matchEvidencePriority(filePath: string, match: EvidenceMatch): number {
	const line = match.lineContent;
	const lowerLine = line.toLowerCase();
	const term = match.term;
	const termLower = term.toLowerCase();
	let score = termPriority(term);

	if (new RegExp(`\\b${escapeRegExp(term)}\\s*\\(`, 'i').test(line)) {
		score += 80;
	}
	if (/\b(class|interface|enum|type|function|const|let|var|record|struct)\b/i.test(line)) {
		score += 40;
	}
	if (/\b(async|private|public|protected|static|abstract|override)\b/i.test(line) && lowerLine.includes(`${termLower}(`)) {
		score += 40;
	}
	if (/\b(register|configuration|config|setting|command|provider|service|default|factory|resolver|loader|startup|context|container|profile|definition|dispatch|create|launch|initialize|initialise)\b/i.test(line)) {
		score += 30;
	}
	if (path.basename(filePath, path.extname(filePath)).toLowerCase().includes(termLower)) {
		score += 30;
	}
	if (/^\s*(?:import|using|include|require)\b/i.test(line)) {
		score -= 50;
	}

	return score;
}

function formatEvidenceHistoryForPrompt(evidenceHistory: SharedEvidence[]): string {
	return truncate(evidenceHistory.map(formatEvidenceForPrompt).join('\n\n---\n\n'), MAX_EVIDENCE_CHARS);
}

function formatExactSummary(evidenceHistory: SharedEvidence[]): string {
	const byFile = new Map<string, EvidenceFile>();
	for (const evidence of evidenceHistory) {
		for (const file of evidence.exactFiles) {
			const existing = byFile.get(file.filePath);
			if (!existing || file.score > existing.score) {
				byFile.set(file.filePath, file);
			}
		}
	}

	const files = [...byFile.values()]
		.sort(compareEvidenceFiles)
		.slice(0, 12);
	if (files.length === 0) {
		return '';
	}

	const lines = [
		'## Deterministic Exact Matches',
		'These matches come from the shared local evidence scan before model synthesis.',
	];
	for (const file of files) {
		lines.push('');
		lines.push(`- ${file.filePath}`);
		for (const match of file.matches.filter((item) => termPriority(item.term) >= 120).slice(0, 5)) {
			lines.push(`  line ${match.lineNumber}: ${match.lineContent}`);
		}
	}

	return lines.join('\n');
}

function formatLedgerForPrompt(ledger: ExploreWorkerResult[]): string {
	if (ledger.length === 0) {
		return '';
	}

	const formatted = ledger.map((entry) => [
		`worker=${entry.worker} round=${entry.round}`,
		typeof entry.parsed === 'undefined'
			? entry.content
			: JSON.stringify(entry.parsed, null, 2),
	].join('\n')).join('\n\n---\n\n');

	return truncate(formatted, MAX_LEDGER_CHARS);
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

function parseJsonObject(content: string): unknown {
	const trimmed = content.trim();
	if (!trimmed) {
		return undefined;
	}

	try {
		return JSON.parse(trimmed);
	} catch {
		const match = trimmed.match(/\{[\s\S]*\}/);
		if (!match) {
			return undefined;
		}
		try {
			return JSON.parse(match[0]);
		} catch {
			return undefined;
		}
	}
}

function stringArrayField(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function shouldSkipDirectory(name: string): boolean {
	return IGNORE_DIRS.has(name) || (name.startsWith('.') && name !== '.github');
}

function isLikelyTextFile(name: string): boolean {
	const lowerName = name.toLowerCase();
	if (TEXT_FILENAMES.has(lowerName)) {
		return true;
	}
	return TEXT_EXTENSIONS.has(path.extname(lowerName));
}

function mergeLineRanges(ranges: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
	const sorted = ranges.sort((left, right) => left.start - right.start);
	const merged: Array<{ start: number; end: number }> = [];
	for (const range of sorted) {
		const previous = merged[merged.length - 1];
		if (previous && range.start <= previous.end + 1) {
			previous.end = Math.max(previous.end, range.end);
		} else {
			merged.push({ ...range });
		}
	}
	return merged;
}

function trimLine(line: string): string {
	const trimmed = line.trim();
	return trimmed.length > 240 ? `${trimmed.slice(0, 240)}...` : trimmed;
}

function capitalize(value: string): string {
	return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function capitalizeIdentifierPart(value: string): string {
	const cleaned = value.replace(/^[^A-Za-z0-9_$]+|[^A-Za-z0-9_$]+$/g, '');
	return cleaned ? `${cleaned[0].toUpperCase()}${cleaned.slice(1)}` : cleaned;
}

function lowerFirst(value: string): string {
	return value ? `${value[0].toLowerCase()}${value.slice(1)}` : value;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function truncate(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value;
	}

	return `${value.slice(0, maxLength)}\n... [truncated]`;
}
