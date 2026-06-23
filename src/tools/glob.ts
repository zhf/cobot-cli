import * as path from 'path';
import { glob as globFiles } from 'glob';
import { getGitignoreFilter } from '../utils/gitignore.js';
import { ToolResult, createToolResponse } from './files.js';

const MAX_RESULTS = 100;

export async function glob(pattern: string, searchPath: string = '.'): Promise<ToolResult> {
  try {
    if (!pattern) {
      return createToolResponse(false, undefined, '', 'Error: pattern is required');
    }

    const cwd = path.resolve(searchPath || '.');
    const gitignore = getGitignoreFilter(cwd);
    const matches = await globFiles(pattern, {
      cwd,
      dot: true,
      nodir: true,
      absolute: false,
      ignore: {
        ignored: (entry) => gitignore.isIgnored(path.join(cwd, entry.name), entry.isDirectory()),
      },
    });

    const sortedMatches = matches.sort((a, b) => a.localeCompare(b));
    const truncated = sortedMatches.length > MAX_RESULTS;
    const results = sortedMatches.slice(0, MAX_RESULTS);
    const message = truncated
      ? `Found ${sortedMatches.length} files, showing first ${MAX_RESULTS}`
      : `Found ${sortedMatches.length} files`;

    return createToolResponse(true, results, message);
  } catch (error) {
    return createToolResponse(false, undefined, '', `Error: Failed to match files - ${error instanceof Error ? error.message : String(error)}`);
  }
}
