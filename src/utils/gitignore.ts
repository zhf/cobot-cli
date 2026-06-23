import ignore, { type Ignore } from 'ignore';
import * as fs from 'fs';
import * as path from 'path';

export class GitignoreFilter {
	private readonly root: string;
	private readonly cache = new Map<string, Ignore | null>();

	constructor(root: string) {
		this.root = path.resolve(root);
	}

	isIgnored(absolutePath: string, isDirectory: boolean): boolean {
		const resolved = path.resolve(absolutePath);
		if (resolved !== this.root && !resolved.startsWith(`${this.root}${path.sep}`)) {
			return false;
		}

		let rel = path.relative(this.root, resolved);
		if (!rel || rel === '.') {
			return false;
		}
		rel = rel.split(path.sep).join('/');

		const parts = rel.split('/');
		const ancestorDepth = isDirectory ? parts.length : Math.max(0, parts.length - 1);

		for (let depth = 0; depth <= ancestorDepth; depth++) {
			const ancestorAbs = depth === 0
				? this.root
				: path.join(this.root, ...parts.slice(0, depth));
			const matcher = this.loadIgnoreForDir(ancestorAbs);
			if (!matcher) {
				continue;
			}

			const pathFromAncestor = parts.slice(depth).join('/');
			if (!pathFromAncestor) {
				continue;
			}

			const candidates = isDirectory
				? [pathFromAncestor, `${pathFromAncestor}/`]
				: [pathFromAncestor];

			for (const candidate of candidates) {
				if (matcher.ignores(candidate)) {
					return true;
				}
			}
		}

		return false;
	}

	private loadIgnoreForDir(dirAbs: string): Ignore | null {
		const cached = this.cache.get(dirAbs);
		if (cached !== undefined) {
			return cached;
		}

		const matcher = ignore();
		let hasRules = false;

		try {
			const content = fs.readFileSync(path.join(dirAbs, '.gitignore'), 'utf-8');
			matcher.add(content);
			hasRules = true;
		} catch {
			// No .gitignore in this directory.
		}

		if (dirAbs === this.root) {
			try {
				const exclude = fs.readFileSync(path.join(this.root, '.git', 'info', 'exclude'), 'utf-8');
				matcher.add(exclude);
				hasRules = true;
			} catch {
				// No local exclude file.
			}
		}

		const result = hasRules ? matcher : null;
		this.cache.set(dirAbs, result);
		return result;
	}
}

const filterCache = new Map<string, GitignoreFilter>();

export function getGitignoreFilter(root: string = process.cwd()): GitignoreFilter {
	const resolved = path.resolve(root);
	let filter = filterCache.get(resolved);
	if (!filter) {
		filter = new GitignoreFilter(resolved);
		filterCache.set(resolved, filter);
	}
	return filter;
}

export function clearGitignoreFilterCache(): void {
	filterCache.clear();
}

export function isGitignored(filePath: string, isDirectory?: boolean, root?: string): boolean {
	const resolved = path.resolve(filePath);
	const projectRoot = path.resolve(root ?? process.cwd());

	let isDir = isDirectory;
	if (isDir === undefined) {
		try {
			isDir = fs.statSync(resolved).isDirectory();
		} catch {
			isDir = false;
		}
	}

	return getGitignoreFilter(projectRoot).isIgnored(resolved, isDir);
}