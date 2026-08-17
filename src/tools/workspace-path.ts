import { existsSync, lstatSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

let workspaceRoot = process.cwd();

export class WorkspacePathError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'WorkspacePathError';
	}
}

export function setWorkspaceRoot(cwd: string): void {
	workspaceRoot = resolve(cwd);
}

export function getWorkspaceRoot(): string {
	return workspaceRoot;
}

export function isInsideWorkspace(targetPath: string): boolean {
	const root = resolve(workspaceRoot);
	const target = resolve(targetPath);
	const relativePath = relative(root, target);
	return relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
}

export function resolveWorkspacePath(childPath = ''): string {
	const root = resolve(workspaceRoot);
	const target = resolve(root, childPath);
	if (!isInsideWorkspace(target)) {
		throw new WorkspacePathError(`Path is outside the workspace: ${childPath || target}`);
	}
	return target;
}

export function assertNoSymlinkComponents(targetPath: string): void {
	const root = resolve(workspaceRoot);
	const contained = resolveWorkspacePath(targetPath);
	const relativePath = relative(root, contained);
	const candidates = [root];
	let currentPath = root;
	for (const segment of relativePath.split(sep).filter(Boolean)) {
		currentPath = join(currentPath, segment);
		candidates.push(currentPath);
	}

	for (const candidate of candidates) {
		if (!existsSync(candidate)) {
			continue;
		}
		if (lstatSync(candidate).isSymbolicLink()) {
			throw new WorkspacePathError('Symbolic links are not allowed in workspace paths');
		}
	}
}

export function resolveWorkspaceFile(childPath: string): string {
	const resolved = resolveWorkspacePath(childPath);
	assertNoSymlinkComponents(resolved);
	return resolved;
}
