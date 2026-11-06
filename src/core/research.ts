import * as fs from 'fs';
import * as path from 'path';
import type { ToolResult } from '../tools/files.js';
import { getGitignoreFilter } from '../utils/gitignore.js';

export const RESEARCH_AGENT_NAME = 'research';
/** Agents that run the research loop; `explore` keeps its name for existing integrations. */
export const RESEARCH_LOOP_AGENTS = new Set([RESEARCH_AGENT_NAME, 'explore']);
export const RESEARCH_DESCRIPTION = 'Read-only codebase research agent: evidence-backed answers with file:line citations.';

/** Tools that are read-permission but useless or unsafe for unattended research. */
const RESEARCH_EXCLUDED_TOOLS = new Set(['open_file']);
const ORIENTATION_FILES = ['AGENTS.md', 'CLAUDE.md', 'README.md'];
const ORIENTATION_LIMIT = 6000;
const LINE_LIMIT = 240;
const LIST_LIMIT = 300;

export const RESEARCH_PROMPT = [
	'You are a codebase research agent. Answer questions about the repository in the current working directory from evidence in its files. You are read-only: you cannot edit files, run commands, access the network, or ask the user questions, so never propose doing so.',
	'',
	'Method:',
	'1. Orient from the repository map below and go straight to the likely directories; search before reading. Use search_files with a focused literal or regex plus a directory or file_pattern; glob for file names; read_file whole when a file is under about 400 lines, otherwise the window around the matches you found.',
	'2. Batch work: in every turn request everything you expect to need next (typically 4-8 searches and reads); they run in parallel. Do not re-read ranges you already have. Omit optional tool parameters you do not need.',
	'3. Find the implementation, not only documentation or tests: trace public entry points (routes, commands, exports) through validation, authorization, state changes and response construction. Verify exact values (status codes, field names, defaults, limits, orderings, error codes) in code before stating them. Documentation can guide the search but is not evidence.',
	'4. Decide what each requested conclusion needs; stop researching a conclusion once implementation evidence supports it. Do not audit adjacent features the question does not need.',
	'5. When evidence is missing or ambiguous, say so instead of guessing. A failed or narrow search does not prove absence.',
	'6. For integration or behaviour questions, recommend the most direct mechanism for the stated use case (mention heavier alternatives in one sentence at most) and cover what an integrator would otherwise get wrong: the entry point and its method/mode constraints; required credentials, scopes or permissions; the request shape; the exact meaning of response fields (identifiers, counts, status values, continuation fields); error, empty-result, limit and retry behaviour; concurrency, duplicate-work and idempotency guarantees; configuration or deployment modes that change the behaviour; and the follow-up operations the stated use case needs (for example reading full content after a search) with their own requirements. Keep each point to a sentence and only when backed by code.',
	'',
	'Answer:',
	'- Lead with the direct answer, then supporting detail. Be concise and precise: aim for 300-500 words, more only when the question has many parts. Prefer short sections and bullets over prose, tables only when comparing several items. Omit preamble, restatement of the question, and generic advice; one example request is enough.',
	'- Cite evidence inline as repository-relative `path:line` or `path:start-end` using the line numbers returned by read_file or search_files; one range per citation, repeating the path for several ranges. Cite every non-obvious claim; quote exact identifiers, values and messages from the code.',
	'- Distinguish what you verified in code from inference, and note that no code was executed.',
	'- Answer in the language of the question.',
].join('\n');

export function isResearchToolAllowed(toolName: string): boolean {
	return !RESEARCH_EXCLUDED_TOOLS.has(toolName);
}

/** Defaults that keep discovery searches broad across files instead of exhausting the budget in one file. */
export function applyResearchToolDefaults(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
	if (toolName !== 'search_files') return args;
	return { max_matches_per_file: 20, max_results: 120, ...args };
}

const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'vendor', 'target', '__pycache__']);
const MAP_DEPTH = 5;
const MAP_LIMIT = 320;
const MAP_FAN_OUT = 40;

function readDir(dir: string): fs.Dirent[] {
	try {
		return fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
}

function listTopLevel(root: string): string[] {
	return readDir(root)
		.filter((entry) => !entry.name.startsWith('.') && !SKIPPED_DIRS.has(entry.name))
		.sort((left, right) => Number(right.isDirectory()) - Number(left.isDirectory()) || left.name.localeCompare(right.name))
		.map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
}

/** Directories to a bounded depth with direct file counts, so the first searches can be targeted. */
function directoryMap(root: string, depth: number): string[] {
	const lines: string[] = [];
	const gitignore = getGitignoreFilter(root);
	const walk = (dir: string, relative: string, level: number) => {
		const entries = readDir(dir).filter((entry) => !entry.name.startsWith('.') && !SKIPPED_DIRS.has(entry.name)
			&& !gitignore.isIgnored(path.join(dir, entry.name), entry.isDirectory()));
		const files = entries.filter((entry) => entry.isFile()).length;
		const dirs = entries.filter((entry) => entry.isDirectory()).sort((left, right) => left.name.localeCompare(right.name));
		// Data/content trees with many sibling directories are summarized, not expanded.
		const fanOut = dirs.length > MAP_FAN_OUT;
		if (relative) lines.push(`${relative}/ (${files} files${fanOut ? `, ${dirs.length} dirs` : ''})`);
		if (level >= depth || fanOut) return;
		for (const entry of dirs) walk(path.join(dir, entry.name), relative ? `${relative}/${entry.name}` : entry.name, level + 1);
	};
	walk(root, '', 0);
	return lines;
}

/** One system message of orientation: layout, directory map, and the first project instructions file found. */
export function buildResearchOrientation(root: string): string | null {
	const entries = listTopLevel(root);
	if (entries.length === 0) return null;
	const sections = [`Repository orientation (generated). Top-level entries:\n${entries.join('  ')}`];
	for (let depth = MAP_DEPTH; depth >= 1; depth--) {
		const map = directoryMap(root, depth);
		if (map.length <= MAP_LIMIT || depth === 1) {
			sections.push(`Directories to depth ${depth} (direct file counts):\n${map.slice(0, MAP_LIMIT).join('\n')}`);
			break;
		}
	}
	for (const name of ORIENTATION_FILES) {
		const filePath = path.join(root, name);
		if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) continue;
		const text = fs.readFileSync(filePath, 'utf8').trim();
		if (!text) continue;
		const excerpt = text.length > ORIENTATION_LIMIT ? `${text.slice(0, ORIENTATION_LIMIT)}\n... [truncated; read_file ${name} for the rest]` : text;
		sections.push(`--- ${name} ---\n${excerpt}`);
		break;
	}
	return sections.join('\n\n');
}

function trimLine(line: string): string {
	const text = line.trim();
	return text.length > LINE_LIMIT ? `${text.slice(0, LINE_LIMIT)}…` : text;
}

interface FlatMatch { filePath: string; lineNumber: number; lineContent: string }
interface GroupedMatch { filePath: string; matches: Array<{ lineNumber: number; lineContent: string }> }

function flattenSearchContent(content: unknown): FlatMatch[] {
	if (!Array.isArray(content)) return [];
	return content.flatMap((item) => {
		if (item && typeof item === 'object' && Array.isArray((item as GroupedMatch).matches)) {
			const group = item as GroupedMatch;
			return group.matches.map((match) => ({ filePath: group.filePath, lineNumber: match.lineNumber, lineContent: match.lineContent }));
		}
		return [item as FlatMatch];
	});
}

function renderSearch(result: ToolResult): string {
	const byFile = new Map<string, FlatMatch[]>();
	for (const match of flattenSearchContent(result.content)) {
		if (!match || typeof match.filePath !== 'string') continue;
		const list = byFile.get(match.filePath) ?? [];
		list.push(match);
		byFile.set(match.filePath, list);
	}
	const lines = [result.message || `Found ${byFile.size} file(s).`];
	for (const [filePath, matches] of byFile) {
		lines.push(filePath);
		for (const match of matches) lines.push(`  ${match.lineNumber}: ${trimLine(String(match.lineContent ?? ''))}`);
	}
	return lines.join('\n');
}

function renderList(result: ToolResult): string {
	const items = Array.isArray(result.content) ? result.content.map(String) : [String(result.content ?? '')];
	const shown = items.slice(0, LIST_LIMIT);
	const rest = items.length - shown.length;
	return [result.message, ...shown, ...(rest > 0 ? [`... (+${rest} more; narrow the pattern)`] : [])].filter(Boolean).join('\n');
}

/** Compact, line-oriented tool output for the model; UI callbacks still receive the structured result. */
export function renderToolResultForModel(toolName: string, result: ToolResult): string {
	if (!result.success) return [`Error: ${result.error || 'tool failed'}`, result.message].filter(Boolean).join(' ');
	switch (toolName) {
		case 'search_files':
			return renderSearch(result);
		case 'glob':
			return renderList(result);
		case 'read_file':
		case 'list_files':
			return [result.message, typeof result.content === 'string' ? result.content : JSON.stringify(result.content)].filter(Boolean).join('\n');
		default:
			return JSON.stringify(result);
	}
}
