import type { Message } from '../messages.js';
import {
	MAX_CONTEXT_CHARS,
	MAX_EVIDENCE_CHARS,
	MAX_LEDGER_CHARS,
} from './constants.js';
import type { EvidenceFile, ExploreWorkerResult, SharedEvidence } from './types.js';
import {
	compareMatchesForEvidence,
	dedupeMatches,
	mergeEvidenceFiles,
	mergePrimaryEvidenceFiles,
	uniqueEvidenceFiles,
} from './evidence.js';
import { compareEvidenceFiles, isLowSignalPath, isTestFocusedRequest, isTestPath } from './paths.js';
import { termPriority } from './terms.js';
import { truncate, uniqueStrings } from './text-utils.js';

export function formatDeterministicExploreResult(userInput: string, evidenceHistory: SharedEvidence[]): string {
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

export function formatCoverageHighlights(userInput: string, evidenceHistory: SharedEvidence[]): string {
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

export function selectDisplayEvidenceFiles(files: EvidenceFile[], userInput: string, limit: number): EvidenceFile[] {
	if (isTestFocusedRequest(userInput)) {
		return files.slice(0, limit);
	}

	const implementationFiles = files.filter((file) => !isTestPath(file.filePath, file.filePath.split('/')) && !isLowSignalPath(file.filePath));
	const preferredFiles = implementationFiles.length >= Math.min(6, limit) ? implementationFiles : files;
	return uniqueEvidenceFiles(preferredFiles).slice(0, limit);
}

export function formatConversationContext(messages: Message[], skillContext?: string): string {
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

export function formatEvidenceForPrompt(evidence: SharedEvidence): string {
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

export function formatEvidenceHistoryForPrompt(evidenceHistory: SharedEvidence[]): string {
	return truncate(evidenceHistory.map(formatEvidenceForPrompt).join('\n\n---\n\n'), MAX_EVIDENCE_CHARS);
}

export function formatExactSummary(evidenceHistory: SharedEvidence[]): string {
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

export function formatLedgerForPrompt(ledger: ExploreWorkerResult[]): string {
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