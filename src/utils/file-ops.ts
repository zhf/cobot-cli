import * as fs from 'fs';
import * as path from 'path';
import IGNORE_PATTERNS from './ignorePatterns.js';

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
      await fs.promises.rmdir(filePath, { recursive: true });
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

    const items = await fs.promises.readdir(directoryPath, { withFileTypes: true });
    const validItems = items
      .filter((item) => !shouldFileOrDirectoryBeIgnored(path.join(directoryPath, item.name)))
      .filter((item) => showHidden || !item.name.startsWith('.'))
      .sort((a, b) => {
        // Directories first, then alphabetical
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      });

    let output = `${path.basename(directoryPath)}/\n`;

    validItems.forEach((item, index) => {
      const isLast = index === validItems.length - 1;
      const prefix = isLast ? '└── ' : '├── ';

      if (item.isDirectory()) {
        output += `${prefix}${item.name}/\n`;
      } else {
        output += `${prefix}${item.name}\n`;
      }
    });

    return output.trim();
  } catch (error) {
    return `Error reading directory: ${error}`;
  }
}

/**
 * Check if a file or directory should be ignored
 */
export function shouldFileOrDirectoryBeIgnored(filePath: string): boolean {
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
  if (name.startsWith('.') && !allowedHiddenFiles.has(name)) {
    return true;
  }

  return false;
}
