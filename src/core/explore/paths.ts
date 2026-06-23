import * as path from 'path';
import type { EvidenceFile } from './types.js';
import { capitalize, lowerFirst } from './text-utils.js';
import { isStrongPathTerm, splitIdentifierParts, termPriority } from './terms.js';

export function roleForFile(filePath: string): string {
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

export function isSourcePath(segments: string[]): boolean {
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

export function isGeneratedOrVendorPath(segments: string[]): boolean {
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

export function isLowSignalPath(filePath: string): boolean {
	const lowerPath = filePath.toLowerCase();
	return /(^|\/)(i18n|l10n|locale|locales|translation|translations)\//.test(lowerPath)
		|| /(?:ui)?labels\.(?:xml|properties|json|ya?ml)$/i.test(lowerPath)
		|| /(?:^|\/)(?:messages|strings)\.(?:xml|properties|json|ya?ml)$/i.test(lowerPath);
}

export function isTestPath(filePath: string, segments: string[]): boolean {
	return segments.some((segment) => (
		segment === 'test'
		|| segment === 'tests'
		|| segment === '__tests__'
		|| segment === 'spec'
		|| segment === 'specs'
	)) || /\.(test|spec)\.[^.]+$/i.test(filePath);
}

export function isTestFocusedRequest(value: string): boolean {
	return /\b(test|tests|testing|spec|specs|coverage|fixture|fixtures|snapshot|snapshots)\b/i.test(value);
}

export function filePathPriority(filePath: string): number {
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

export function filePathTermVariants(filePath: string): string[] {
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

	if (parts.length >= 2) {
		terms.push(parts.map((part) => part.toLowerCase()).join('_'));
		terms.push(parts.map((part) => part.toLowerCase()).join('-'));
	}

	return terms;
}

export function pathMatchReasonTerm(reason: string, prefix: string): string | undefined {
	const match = reason.match(new RegExp(`^${prefix} "(.+)"$`));
	return match?.[1];
}

export function hasExactFilenameMatch(file: EvidenceFile): boolean {
	return file.reasons.some((reason) => {
		const term = pathMatchReasonTerm(reason, 'exact filename match');
		return term !== undefined && isStrongPathTerm(term);
	});
}

export function hasDottedExactFilenameMatch(file: EvidenceFile): boolean {
	return file.reasons.some((reason) => {
		const term = pathMatchReasonTerm(reason, 'exact filename match');
		return term !== undefined && term.includes('.');
	});
}

export function hasFilenameMatch(file: EvidenceFile): boolean {
	return file.reasons.some((reason) => {
		const term = pathMatchReasonTerm(reason, 'filename match');
		return term !== undefined && isStrongPathTerm(term);
	});
}

export function hasStrongPathMatch(file: EvidenceFile): boolean {
	return hasExactFilenameMatch(file) || hasFilenameMatch(file);
}

export function scorePath(filePath: string, terms: string[]): { score: number; reasons: string[] } {
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

export function scoreLineMatch(filePath: string, term: string, line: string, termOccurrenceIndex = 0): number {
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

export function evidenceSortScore(file: EvidenceFile): number {
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
		score += 100;
	}
	if (/(config|configuration|factory|startup|wiring|resolver|loader|context|container|profile|definition|definitions|model|reader|dispatch|dispatcher)/i.test(lowerPath)) {
		score += 120;
	}
	if (/service/i.test(lowerPath)) {
		score += 60;
	}

	return score;
}

export function compareEvidenceFiles(left: EvidenceFile, right: EvidenceFile): number {
	return evidenceSortScore(right) - evidenceSortScore(left) || left.filePath.localeCompare(right.filePath);
}