import * as fs from 'fs';
import * as path from 'path';
import type { ExploreScanConfig } from '../../config/ConfigManager.js';
import { GitignoreFilter } from '../../utils/gitignore.js';
import { MAX_SOURCE_FILE_BYTES, TEXT_EXTENSIONS, TEXT_FILENAMES } from './constants.js';
import type { CollectSourceFilesResult, SourceFile, VisitContext } from './types.js';

export function shouldSkipDirectory(name: string, ignoreDirs: Set<string> | string[]): boolean {
	const ignoreSet = ignoreDirs instanceof Set ? ignoreDirs : new Set(ignoreDirs);
	return ignoreSet.has(name) || (name.startsWith('.') && name !== '.github');
}

export function isLikelyTextFile(name: string): boolean {
	const lowerName = name.toLowerCase();
	if (TEXT_FILENAMES.has(lowerName)) {
		return true;
	}
	return TEXT_EXTENSIONS.has(path.extname(lowerName));
}

export async function collectSourceFiles(root: string, scanConfig: Required<ExploreScanConfig>): Promise<CollectSourceFilesResult> {
	const files: SourceFile[] = [];
	const ignoreDirs = new Set(scanConfig.ignoreDirs);
	const gitignore = scanConfig.honorGitignore ? new GitignoreFilter(root) : null;
	const topEntries = await readDirectoryEntries(root);
	const topDirs = topEntries.filter((entry) => entry.isDirectory() && !shouldSkipDirectory(entry.name, ignoreDirs));
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
			await visitDirectory(path.join(root, entry.name), repoContext, ignoreDirs, gitignore);
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
	await visitDirectory(root, context, ignoreDirs, gitignore);
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

async function visitDirectory(
	directory: string,
	context: VisitContext,
	ignoreDirs: Set<string>,
	gitignore: GitignoreFilter | null,
): Promise<void> {
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
			if (shouldSkipDirectory(entry.name, ignoreDirs)) {
				continue;
			}
			if (gitignore?.isIgnored(absolutePath, true)) {
				continue;
			}
			await visitDirectory(absolutePath, context, ignoreDirs, gitignore);
			continue;
		}

		if (!entry.isFile()) {
			continue;
		}

		if (gitignore?.isIgnored(absolutePath, false)) {
			continue;
		}

		await addSourceFileIfEligible(context, absolutePath);
	}
}