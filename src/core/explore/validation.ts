import * as path from 'path';
import { debugLog } from '../logger.js';
import type { SharedEvidence, SourceFile } from './types.js';

export interface CitedPathValidationResult {
	content: string;
	unverifiedPaths: string[];
	citedPathCount: number;
}

export function findUnverifiedCitedPaths(
	content: string,
	sourceFiles: SourceFile[],
	evidenceHistory: SharedEvidence[],
): string[] {
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
	const unverifiedPaths: string[] = [];
	for (const citedPath of citedPaths) {
		if (knownPaths.has(citedPath) || evidencePaths.has(citedPath)) {
			continue;
		}
		const basename = path.basename(citedPath);
		const basenameMatch = sourceFiles.find((file) => path.basename(file.relativePath) === basename);
		if (basenameMatch) {
			continue;
		}
		unverifiedPaths.push(citedPath);
	}

	return unverifiedPaths;
}

export function validateCitedPathsWithMeta(
	content: string,
	sourceFiles: SourceFile[],
	evidenceHistory: SharedEvidence[],
): CitedPathValidationResult {
	if (!content.trim()) {
		return { content, unverifiedPaths: [], citedPathCount: 0 };
	}

	const citedPathCount = extractCitedPaths(content).length;
	const unverifiedPaths = findUnverifiedCitedPaths(content, sourceFiles, evidenceHistory);
	if (unverifiedPaths.length === 0) {
		return { content, unverifiedPaths, citedPathCount };
	}

	debugLog(`Cited-path validation: ${unverifiedPaths.length} unverified path(s):`, unverifiedPaths);
	const warning = [
		'',
		'> **Note**: The following cited paths could not be verified against the local file list and may be hallucinated:',
		...unverifiedPaths.map((p) => `> - \`${p}\``),
		'> Prefer the deterministic coverage highlights above for authoritative paths.',
	].join('\n');

	return {
		content: `${content}\n${warning}`,
		unverifiedPaths,
		citedPathCount,
	};
}

export function validateCitedPaths(content: string, sourceFiles: SourceFile[], evidenceHistory: SharedEvidence[]): string {
	return validateCitedPathsWithMeta(content, sourceFiles, evidenceHistory).content;
}

export function extractCitedPaths(content: string): string[] {
	const paths: string[] = [];
	const seen = new Set<string>();

	const sourceExtensions = /\.(?:ts|tsx|js|jsx|py|java|go|rs|rb|php|cs|kt|swift|c|cc|cpp|h|hpp|json|ya?ml|xml|toml|md|sh|svelte|vue|css|scss|less|html)$/;
	const patterns = [
		/`([^`\n]+\/[^`\n]+\.[A-Za-z0-9]+)`/g,
		/`([^`\n]+\.(?:ts|tsx|js|jsx|py|java|go|rs|rb|php|cs|kt|swift|c|cc|cpp|h|hpp|json|ya?ml|xml|toml|sh|svelte|vue|css|scss|less|html))`/g,
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
			if (/^https?:\/\//.test(candidate)) {
				continue;
			}
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