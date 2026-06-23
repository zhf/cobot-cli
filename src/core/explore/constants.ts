import type { ExploreWorkerFocus } from './types.js';

export const EXPLORE_ROUNDS = 2;
export const FINAL_SYNTHESIS_MAX_TOKENS = 5000;
export const WORKER_MAX_TOKENS = 3000;
export const MAX_CONTEXT_CHARS = 14000;
export const MAX_LEDGER_CHARS = 24000;
export const MAX_EVIDENCE_CHARS = 42000;
export const MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_TERMS_PER_ROUND = 24;
export const MAX_MATCHES_PER_FILE = 20;
export const MAX_EVIDENCE_FILES = 32;
export const MAX_EXCERPT_LINES_PER_FILE = 60;
export const FAST_PATH_MIN_EXACT_MATCHES = 2;
export const FAST_PATH_MIN_EXACT_FILES = 1;
export const DETERMINISTIC_FOLLOW_UP_FILES = 10;
export const MAX_RERANK_CANDIDATES = 200;
export const MAX_RERANK_CHUNK_CHARS = 1200;
export const RERANK_CHUNKS_PER_FILE = 2;

export const WORKER_FOCI: ExploreWorkerFocus[] = [
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

export const TEXT_EXTENSIONS = new Set([
	'.c', '.cc', '.cpp', '.cs', '.css', '.dart', '.go', '.h', '.hpp', '.html', '.java',
	'.js', '.json', '.jsx', '.kt', '.less', '.lua', '.md', '.mjs', '.php', '.py',
	'.rb', '.rs', '.scss', '.sh', '.svelte', '.swift', '.toml', '.ts', '.tsx', '.vue',
	'.xml', '.yaml', '.yml',
]);

export const TEXT_FILENAMES = new Set([
	'license', 'makefile', 'dockerfile', 'readme',
]);

export const DEFAULT_IGNORE_DIRS = [
	'.git', '.hg', '.svn', 'node_modules', '.next', '.nuxt', 'dist', 'build', 'out',
	'.cache', 'coverage', 'target', '.turbo', '.parcel-cache',
];

export const BIGRAM_GLUE_WORDS = new Set([
	'and', 'or', 'with', 'line', 'how', 'identify', 'implemented', 'evidence',
	'for', 'the', 'from', 'into', 'that', 'this', 'when', 'where', 'what', 'which',
	'about', 'after', 'before', 'between', 'through', 'during', 'without', 'within',
]);

export const INSTRUCTION_WORDS = new Set([
	'about', 'after', 'agent', 'also', 'and', 'applied', 'behavior', 'code', 'could',
	'dead', 'declared', 'evidence', 'file', 'files', 'find', 'from', 'give', 'identify',
	'implemented', 'into', 'investigation', 'likely', 'line', 'lines', 'local', 'modify',
	'next', 'only', 'path', 'paths', 'read', 'readonly', 'relevant', 'repository',
	'return', 'run', 'search', 'shell', 'source', 'steps', 'tree', 'where', 'with',
	'wired', 'without',
]);