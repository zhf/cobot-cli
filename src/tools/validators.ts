import * as path from 'path';

// Track which files have been read in the current session
let sessionReadFilesTracker: Set<string> | null = null;

export function setReadFilesTracker(tracker: Set<string>) {
  sessionReadFilesTracker = tracker;
}

// Check if a file has been read before allowing edits
export function hasFileBeenReadBeforeEdit(filePath: string): boolean {
  if (!sessionReadFilesTracker) {
    return true; // No tracking enabled, allow edit
  }

  const resolvedPath = path.resolve(filePath);
  return sessionReadFilesTracker.has(resolvedPath);
}

export function getReadBeforeEditErrorMessage(filePath: string): string {
  return `File must be read before editing. Use read_file tool first: ${filePath}`;
}
