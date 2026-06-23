import * as fs from 'fs';
import * as path from 'path';
import {
	MAX_EVIDENCE_FILES,
	MAX_EXCERPT_LINES_PER_FILE,
	MAX_MATCHES_PER_FILE,
	MAX_TERMS_PER_ROUND,
} from './constants.js';
import type { EvidenceFile, EvidenceMatch, SharedEvidence, SourceFile } from './types.js';
import { compareEvidenceFiles, hasDottedExactFilenameMatch, hasExactFilenameMatch, hasFilenameMatch, hasStrongPathMatch, scoreLineMatch, scorePath } from './paths.js';
import { escapeRegExp, trimLine, uniqueStrings } from './text-utils.js';
import { isStrongExactMatchTerm, termMatchesLine, termPriority, uniqueTerms } from './terms.js';

export function collectSharedEvidence(sourceFiles: SourceFile[], terms: string[], round: number, authoritativeTerms: string[], includeExactFiles: boolean): Promise<SharedEvidence> {
	return collectSharedEvidenceImpl(sourceFiles, terms, round, authoritativeTerms, includeExactFiles);
}

async function collectSharedEvidenceImpl(sourceFiles: SourceFile[], terms: string[], round: number, authoritativeTerms: string[], includeExactFiles: boolean): Promise<SharedEvidence> {
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
		.filter((file) => file.matches.some((match) => authoritativeTermSet.has(match.term.toLowerCase()) && isStrongExactMatchTerm(match.term)))
		.sort(compareEvidenceFiles)
		.slice(0, 16)
		.map((file) => ({
			...file,
			matches: file.matches.filter((match) => authoritativeTermSet.has(match.term.toLowerCase()) && isStrongExactMatchTerm(match.term)),
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

export function selectTopFilesByTerm(files: EvidenceFile[], terms: string[]): EvidenceFile[] {
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

export function mergeEvidenceFiles(evidenceHistory: SharedEvidence[], limit: number): EvidenceFile[] {
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

export function mergePrimaryEvidenceFiles(evidenceHistory: SharedEvidence[], limit: number): EvidenceFile[] {
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

export function mergeEvidenceFile(files: Map<string, EvidenceFile>, file: EvidenceFile): void {
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

export function uniqueEvidenceFiles(files: EvidenceFile[]): EvidenceFile[] {
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

export function dedupeMatches(matches: EvidenceMatch[]): EvidenceMatch[] {
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

export function upsertEvidenceFile(files: Map<string, EvidenceFile>, filePath: string, score: number, reasons: string[]): EvidenceFile {
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

export async function addExcerpts(evidenceFile: EvidenceFile, sourceFiles: SourceFile[]): Promise<void> {
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

export function isHighValueLineMatch(term: string, line: string): boolean {
	return termPriority(term) >= 120 && (
		new RegExp(`\\b${escapeRegExp(term)}\\s*\\(`, 'i').test(line)
		|| /\b(class|interface|enum|type|function|const|record|struct)\b/i.test(line)
		|| /\b(register|configuration|config|setting|service|default|factory|resolver|loader|startup|context|container|profile|definition|dispatch|create|launch|initialize|initialise)\b/i.test(line)
	);
}

export function compareMatchesForEvidence(filePath: string, left: EvidenceMatch, right: EvidenceMatch): number {
	return matchEvidencePriority(filePath, right) - matchEvidencePriority(filePath, left)
		|| left.lineNumber - right.lineNumber
		|| left.lineContent.localeCompare(right.lineContent);
}

export function matchEvidencePriority(filePath: string, match: EvidenceMatch): number {
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