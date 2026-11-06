import * as fs from 'fs';
import * as path from 'path';
import { matchesFilePattern } from './file-pattern.js';
import IGNORE_PATTERNS from './ignorePatterns.js';
import { GitignoreFilter, isGitignored } from './gitignore.js';

/**
 * Write content to a file with safety checks
 */
export async function writeFileContent(filepath: string, content: string, force: boolean = false, backup: boolean = false): Promise<boolean> {
  const filePath = path.resolve(filepath);

  try {
    // Create parent directories if they don't exist
    const parentDir = path.dirname(filePath);
    await fs.promises.mkdir(parentDir, { recursive: true });

    await fs.promises.writeFile(filePath, content, 'utf-8');
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Create a directory with parent directories
 */
export async function createDirectoryWithParents(directoryPath: string): Promise<boolean> {
  try {
    await fs.promises.mkdir(directoryPath, { recursive: true });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Delete a file with safety checks
 */
export async function deleteFileOrDirectory(filepath: string, force: boolean = false): Promise<boolean> {
  const filePath = path.resolve(filepath);

  try {
    const stats = await fs.promises.stat(filePath);

    if (!force) {
      return false;
    }

    if (stats.isFile()) {
      await fs.promises.unlink(filePath);
    } else if (stats.isDirectory()) {
      await fs.promises.rm(filePath, { recursive: true });
    }
    return true;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return false;
    }
    return false;
  }
}

/**
 * Simple tree display for list_files tool
 */
export async function generateDirectoryTreeDisplay(
  directory: string = '.',
  pattern: string = '*',
  recursive: boolean = false,
  showHidden: boolean = false,
): Promise<string> {
  const directoryPath = path.resolve(directory);

  try {
    const exists = await fs.promises.access(directoryPath).then(() => true).catch(() => false);
    if (!exists) {
      return `Directory not found: ${directory}`;
    }

    const output = ['./'];
    const gitignore = new GitignoreFilter(directoryPath);
    const maxEntries = 2000;
    let count = 0;
    let truncated = false;
    async function walk(dir: string, indent: string): Promise<void> {
      const items = (await fs.promises.readdir(dir, { withFileTypes: true }))
	.filter(item => !item.isSymbolicLink())
	.filter(item => !gitignore.isIgnored(path.join(dir, item.name), item.isDirectory()))
	.filter(item => !shouldFileOrDirectoryBeIgnored(path.join(dir, item.name), showHidden))
	.filter(item => showHidden || !item.name.startsWith('.'))
	.filter(item => item.isDirectory() || matchesFilePattern(
	  pattern.includes('/') ? path.relative(directoryPath, path.join(dir, item.name)).split(path.sep).join('/') : item.name,
	  pattern.replace(/^\.\//, ''),
	))
	.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
      for (let i = 0; i < items.length; i++) {
	if (count >= maxEntries) { truncated = true; return; }
	const item = items[i]!;
	const last = i === items.length - 1;
	count++;
	output.push(`${indent}${last ? '└── ' : '├── '}${item.name}${item.isDirectory() ? '/' : ''}`);
	if (recursive && item.isDirectory()) {
	  await walk(path.join(dir, item.name), `${indent}${last ? '    ' : '│   '}`);
	  if (truncated) return;
	}
      }
    }
    await walk(directoryPath, '');
    if (truncated) output.push(`Listing truncated at ${maxEntries} entries; narrow the directory or pattern.`);
    return output.join('\n');
  } catch (error) {
    return `Error reading directory: ${error}`;
  }
}

/**
 * Check if a file or directory should be ignored
 */
export function shouldFileOrDirectoryBeIgnored(filePath: string, showHidden = false): boolean {
  const pathStr = path.resolve(filePath);
  const name = path.basename(pathStr);

  // Check ignore patterns
  for (const pattern of IGNORE_PATTERNS) {
    if (pattern.includes('*')) {
      // Simple glob matching, convert * to regex
      const regexPattern = pattern.replace(/\*/g, '.*');
      const regex = new RegExp(regexPattern);
      if (regex.test(name)) {
        return true;
      }
    } else if (pathStr.includes(pattern) || name === pattern) {
      return true;
    }
  }

  // Ignore hidden files and directories (starting with .)
  const allowedHiddenFiles = new Set(['.env', '.gitignore', '.dockerfile']);
  if (!showHidden && name.startsWith('.') && !allowedHiddenFiles.has(name)) {
    return true;
  }

  if (isGitignored(pathStr)) {
    return true;
  }

  return false;
}
