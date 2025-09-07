import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFileContent, createDirectoryWithParents, generateDirectoryTreeDisplay, deleteFileOrDirectory, shouldFileOrDirectoryBeIgnored } from '../utils/file-ops.js';
import { getReadFilesTracker } from './registry.js';

const execAsync = promisify(exec);

export interface ToolResult {
  success: boolean;
  content?: any;
  data?: any;
  message?: string;
  error?: string;
}

/**
 * Create a standardized tool response format
 */
export function createToolResponse(success: boolean, data?: any, message: string = '', error: string = ''): ToolResult {
  const response: ToolResult = { success };

  if (success) {
    if (data !== undefined) {
      response.content = data;
    }
    if (message) {
      response.message = message;
    }
  } else {
    response.error = error;
    if (message) {
      response.message = message;
    }
  }

  return response;
}

/**
 * Read the contents of a file, optionally specifying line range
 */
export async function readFile(filePath: string, startLine?: number, endLine?: number): Promise<ToolResult> {
  try {
    const resolvedPath = path.resolve(filePath);
    const sessionReadFiles = getReadFilesTracker();

    // Check if file exists
    try {
      await fs.promises.access(resolvedPath);
    } catch {
      return createToolResponse(false, undefined, '', 'Error: File not found');
    }

    const stats = await fs.promises.stat(resolvedPath);
    if (!stats.isFile()) {
      return createToolResponse(false, undefined, '', 'Error: Path is not a file');
    }

    // Check file size (50MB limit)
    if (stats.size > 50 * 1024 * 1024) {
      return createToolResponse(false, undefined, '', 'Error: File too large (max 50MB)');
    }

    const content = await fs.promises.readFile(resolvedPath, 'utf-8');
    const lines = content.split('\n');

    // Handle line range if specified
    if (startLine !== undefined) {
      const startIndex = Math.max(0, startLine - 1); // Convert to 0-indexed
      let endIndex = lines.length;

      if (endLine !== undefined) {
        endIndex = Math.min(lines.length, endLine);
      }

      if (startIndex >= lines.length) {
        return createToolResponse(false, undefined, '', 'Error: Start line exceeds file length');
      }

      const selectedLines = lines.slice(startIndex, endIndex);
      const selectedContent = selectedLines.join('\n');
      // Add file to read tracking for partial reads too
      sessionReadFiles.add(resolvedPath);
      const message = `Read lines ${startLine}-${endIndex} from ${filePath}`;

      return createToolResponse(true, selectedContent, message);
    }
    // Add file to read tracking
    sessionReadFiles.add(resolvedPath);
    const message = `Read ${lines.length} lines from ${filePath}`;
    return createToolResponse(true, content, message);
  } catch (error) {
    if ((error as any).code === 'ENOENT') {
      return createToolResponse(false, undefined, '', 'Error: File not found');
    }
    return createToolResponse(false, undefined, '', 'Error: Failed to read file');
  }
}

/**
 * Create a new file or directory with specified content
 */
export async function createFile(filePath: string, content: string, targetType: string = 'file', overwrite: boolean = false): Promise<ToolResult> {
  try {
    const targetPath = path.resolve(filePath);

    // Check if file exists and handle overwrite
    const exists = await fs.promises.access(targetPath).then(() => true).catch(() => false);
    if (exists && !overwrite) {
      return createToolResponse(false, undefined, '', 'Error: File already exists, use overwrite=true');
    }

    if (targetType === 'directory') {
      const result = await createDirectoryWithParents(targetPath);
      if (result) {
        return createToolResponse(true, { path: targetPath, type: 'directory' }, `Directory created: ${filePath}`);
      }
      return createToolResponse(false, undefined, '', 'Error: Failed to create directory');
    } if (targetType === 'file') {
      const result = await writeFileContent(targetPath, content, overwrite, true);
      if (result) {
        return createToolResponse(true, undefined, `File created: ${filePath}`);
      }
      return createToolResponse(false, undefined, '', 'Error: Failed to create file');
    }
    return createToolResponse(false, undefined, '', "Error: Invalid targetType, must be 'file' or 'directory'");
  } catch (error) {
    return createToolResponse(false, undefined, '', 'Error: Failed to create file or directory');
  }
}

/**
 * Edit a file by replacing exact text strings
 * Note: Arguments are pre-validated by the validation system before this function is called
 */
export async function editFile(filePath: string, targetText: string, replacementText: string, replaceAll: boolean = false): Promise<ToolResult> {
  try {
    const resolvedPath = path.resolve(filePath);

    // Read current content (validation already confirmed file exists and was read)
    const originalContent = await fs.promises.readFile(resolvedPath, 'utf-8');

    // Perform the replacement (validation already confirmed targetText exists and is unambiguous)
    let updatedContent: string;
    if (replaceAll) {
      updatedContent = originalContent.split(targetText).join(replacementText);
    } else {
      updatedContent = originalContent.replace(targetText, replacementText);
    }

    // Write the updated content
    const result = await writeFileContent(filePath, updatedContent, true, true);
    if (result) {
      const replacementCount = replaceAll
        ? (originalContent.split(targetText).length - 1) : 1;
      return createToolResponse(true, undefined, `Replaced ${replacementCount} occurrence(s) in ${filePath}`);
    }
    return createToolResponse(false, undefined, '', 'Error: Failed to write changes to file');
  } catch (error) {
    return createToolResponse(false, undefined, '', `Error: Failed to edit file - ${error}`);
  }
}

/**
 * Delete a file or directory with safety checks
 */
export async function deleteFile(filePath: string, recursive: boolean = false): Promise<ToolResult> {
  try {
    const targetPath = path.resolve(filePath);
    const currentWorkingDir = path.resolve(process.cwd());

    // Safety check 1: Never delete the root directory itself
    if (targetPath === currentWorkingDir) {
      return createToolResponse(false, undefined, '', 'Error: Cannot delete the root project directory');
    }

    // Safety check 2: Never delete anything outside the current working directory
    if (!targetPath.startsWith(currentWorkingDir)) {
      return createToolResponse(false, undefined, '', 'Error: Cannot delete files outside the project directory');
    }

    const exists = await fs.promises.access(targetPath).then(() => true).catch(() => false);
    if (!exists) {
      return createToolResponse(false, undefined, '', 'Error: Path not found');
    }

    const stats = await fs.promises.stat(targetPath);
    if (stats.isDirectory() && !recursive) {
      // Check if directory is empty
      const items = await fs.promises.readdir(targetPath);
      if (items.length > 0) {
        return createToolResponse(false, undefined, '', 'Error: Directory not empty, use recursive=true');
      }
    }

    // Perform deletion
    if (stats.isDirectory()) {
      await fs.promises.rmdir(targetPath, { recursive });
    } else {
      await fs.promises.unlink(targetPath);
    }

    const fileType = stats.isDirectory() ? 'directory' : 'file';
    return createToolResponse(true, undefined, `Deleted ${fileType}: ${filePath}`);
  } catch (error) {
    return createToolResponse(false, undefined, '', 'Error: Failed to delete');
  }
}

/**
 * List files and directories in a path with tree-style display
 */
export async function listFiles(directory: string = '.', pattern: string = '*', recursive: boolean = false, showHidden: boolean = false): Promise<ToolResult> {
  try {
    const dirPath = path.resolve(directory);

    const exists = await fs.promises.access(dirPath).then(() => true).catch(() => false);
    if (!exists) {
      return createToolResponse(false, undefined, '', 'Error: Directory not found');
    }

    const stats = await fs.promises.stat(dirPath);
    if (!stats.isDirectory()) {
      return createToolResponse(false, undefined, '', 'Error: Path is not a directory');
    }

    // Get tree display output
    const treeOutput = await generateDirectoryTreeDisplay(directory, pattern, recursive, showHidden);

    return createToolResponse(true, treeOutput, `Listed ${directory}`);
  } catch (error) {
    return createToolResponse(false, undefined, '', 'Error: Failed to list files');
  }
}

/**
 * Open file or directory with the OS default application
 */
export async function openFile(filePath: string, withApp?: string): Promise<ToolResult> {
  try {
    const resolvedPath = path.resolve(filePath);

    // Check if file/directory exists
    const exists = await fs.promises.access(resolvedPath).then(() => true).catch(() => false);
    if (!exists) {
      return createToolResponse(false, undefined, '', 'Error: File or directory not found');
    }

    // Determine the command based on platform
    let command: string;
    const platform = process.platform;

    if (withApp) {
      // Use specific application if provided
      if (platform === 'darwin') {
        command = `open -a "${withApp}" "${resolvedPath}"`;
      } else if (platform === 'win32') {
        command = `start "" "${withApp}" "${resolvedPath}"`;
      } else {
        command = `${withApp} "${resolvedPath}"`;
      }
    } else {
      // Use default application for the file type
      if (platform === 'darwin') {
        command = `open "${resolvedPath}"`;
      } else if (platform === 'win32') {
        command = `start "" "${resolvedPath}"`;
      } else {
        command = `xdg-open "${resolvedPath}"`;
      }
    }

    // Execute the command
    await execAsync(command);

    const stats = await fs.promises.stat(resolvedPath);
    const fileType = stats.isDirectory() ? 'directory' : 'file';
    const message = `Opened ${fileType}: ${filePath}${withApp ? ` with ${withApp}` : ''}`;

    return createToolResponse(true, undefined, message);
  } catch (error) {
    return createToolResponse(false, undefined, '', `Error: Failed to open file - ${error}`);
  }
}