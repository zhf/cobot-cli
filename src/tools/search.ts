import * as fs from 'fs';
import * as path from 'path';
import { ToolResult, createToolResponse } from './files.js';

// Helper interfaces for search results
interface SearchMatch {
  lineNumber: number;
  lineContent: string;
  contextLines?: string[];
  matchPositions: Array<{
    start: number;
    end: number;
    text: string;
  }>;
}

interface SearchResult {
  filePath: string;
  matches: SearchMatch[];
  totalMatches: number;
}

/**
 * Search for text patterns in files with advanced filtering and matching options
 */
export async function searchFiles(
  searchPattern: string,
  fileNamePattern: string = '*',
  directory: string = '.',
  isCaseSensitive: boolean = false,
  patternType: 'substring' | 'regex' | 'exact' | 'fuzzy' = 'substring',
  fileTypes?: string[],
  excludeDirs?: string[],
  excludeFiles?: string[],
  maxResults: number = 100,
  contextLines: number = 0,
  groupByFile: boolean = false,
): Promise<ToolResult> {
  try {
    const searchDir = path.resolve(directory);

    // Check if directory exists
    const exists = await fs.promises.access(searchDir).then(() => true).catch(() => false);
    if (!exists) {
      return createToolResponse(false, undefined, '', 'Error: Directory not found');
    }

    const stats = await fs.promises.stat(searchDir);
    if (!stats.isDirectory()) {
      return createToolResponse(false, undefined, '', 'Error: Path is not a directory');
    }

    // Default exclusions
    const defaultExcludeDirs = ['.git', 'node_modules', '.next', 'dist', 'build', '.cache'];
    const defaultExcludeFiles = ['*.log', '*.tmp', '*.cache', '*.lock'];

    const finalExcludeDirs = [...defaultExcludeDirs, ...(excludeDirs || [])];
    const finalExcludeFiles = [...defaultExcludeFiles, ...(excludeFiles || [])];

    // Prepare search regex
    let searchPatternRegex: RegExp;
    try {
      switch (patternType) {
        case 'exact':
          searchPatternRegex = new RegExp(escapeRegex(searchPattern), isCaseSensitive ? 'g' : 'gi');
          break;
        case 'regex':
          searchPatternRegex = new RegExp(searchPattern, isCaseSensitive ? 'g' : 'gi');
          break;
        case 'fuzzy':
          // Simple fuzzy search, insert .* between characters
          const fuzzyPattern = searchPattern.split('').map(escapeRegex).join('.*');
          searchPatternRegex = new RegExp(fuzzyPattern, isCaseSensitive ? 'g' : 'gi');
          break;
        case 'substring':
        default:
          searchPatternRegex = new RegExp(escapeRegex(searchPattern), isCaseSensitive ? 'g' : 'gi');
          break;
      }
    } catch (error) {
      return createToolResponse(false, undefined, '', 'Error: Invalid regex pattern');
    }

    // Collect all files to search
    const filesToSearch = await collectFiles(searchDir, fileNamePattern, fileTypes, finalExcludeDirs, finalExcludeFiles);

    if (filesToSearch.length === 0) {
      return createToolResponse(true, [], 'No files found matching criteria');
    }

    // Search through files
    const searchResults: SearchResult[] = [];
    let totalMatches = 0;

    for (const filePath of filesToSearch) {
      if (totalMatches >= maxResults) {
        break;
      }

      try {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const lines = content.split('\n');
        const fileMatches: SearchMatch[] = [];

        for (let i = 0; i < lines.length && totalMatches < maxResults; i++) {
          const line = lines[i];
          const matches = Array.from(line.matchAll(searchPatternRegex));

          if (matches.length > 0) {
            const contextStart = Math.max(0, i - contextLines);
            const contextEnd = Math.min(lines.length - 1, i + contextLines);

            const contextLinesArray: string[] = [];
            for (let j = contextStart; j <= contextEnd; j++) {
              contextLinesArray.push(lines[j]);
            }

            fileMatches.push({
              lineNumber: i + 1,
              lineContent: line,
              contextLines: contextLines > 0 ? contextLinesArray : undefined,
              matchPositions: matches.map((match) => ({
                start: match.index || 0,
                end: (match.index || 0) + match[0].length,
                text: match[0],
              })),
            });

            totalMatches++;
          }
        }

        if (fileMatches.length > 0) {
          searchResults.push({
            filePath: path.relative(process.cwd(), filePath),
            matches: fileMatches,
            totalMatches: fileMatches.length,
          });
        }
      } catch (error) {
        // Skip files that can't be read (binary files, permission issues, etc.)
        continue;
      }
    }

    // Format results
    let formattedResults: any;
    if (groupByFile) {
      formattedResults = searchResults;
    } else {
      // Flatten results
      formattedResults = searchResults.flatMap((fileResult) => fileResult.matches.map((match) => ({
        filePath: fileResult.filePath,
        lineNumber: match.lineNumber,
        lineContent: match.lineContent,
        contextLines: match.contextLines,
        matchPositions: match.matchPositions,
      })));
    }

    const message = `Found ${totalMatches} match(es) in ${searchResults.length} file(s)`;
    return createToolResponse(true, formattedResults, message);
  } catch (error) {
    return createToolResponse(false, undefined, '', 'Error: Failed to search files');
  }
}

// Helper function to escape regex special characters
function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Helper function to collect files based on patterns and filters
async function collectFiles(
  directory: string,
  fileNamePattern: string,
  fileTypes?: string[],
  excludeDirs?: string[],
  excludeFiles?: string[],
): Promise<string[]> {
  const files: string[] = [];

  async function walkDirectory(dir: string): Promise<void> {
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Check if directory should be excluded
          if (excludeDirs && excludeDirs.some((pattern) => matchesPattern(entry.name, pattern))) {
            continue;
          }
          // Skip hidden directories unless explicitly included
          if (entry.name.startsWith('.') && !entry.name.match(/^\.(config|env)$/)) {
            continue;
          }
          await walkDirectory(fullPath);
        } else if (entry.isFile()) {
          // Check file type filters
          if (fileTypes && fileTypes.length > 0) {
            const ext = path.extname(entry.name).slice(1);
            if (!fileTypes.includes(ext)) {
              continue;
            }
          }

          // Check file pattern
          if (!matchesPattern(entry.name, fileNamePattern)) {
            continue;
          }

          // Check exclusions
          if (excludeFiles && excludeFiles.some((pattern) => matchesPattern(entry.name, pattern))) {
            continue;
          }

          // Skip obviously binary files
          if (isBinaryFile(entry.name)) {
            continue;
          }

          files.push(fullPath);
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }
  }

  await walkDirectory(directory);
  return files;
}

// Helper function to match glob-like patterns
function matchesPattern(filename: string, pattern: string): boolean {
  if (pattern === '*') return true;

  // Simple glob matching, convert * to .* and ? to .
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');

  return new RegExp(`^${regexPattern}$`, 'i').test(filename);
}

// Helper function to detect binary files
function isBinaryFile(filename: string): boolean {
  const binaryExtensions = [
    '.exe', '.dll', '.so', '.dylib', '.bin', '.obj', '.o', '.a', '.lib',
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.ico', '.svg', '.webp',
    '.mp3', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm',
    '.zip', '.tar', '.gz', '.bz2', '.rar', '.7z',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  ];

  const ext = path.extname(filename).toLowerCase();
  return binaryExtensions.includes(ext);
}