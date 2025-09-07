import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ToolResult, createToolResponse } from './files.js';

const execAsync = promisify(exec);

/**
 * Execute a shell command or run code
 */
export async function executeCommand(command: string, executionType: string, workingDirectory?: string, timeout: number = 30000): Promise<ToolResult> {
  try {
    // Validate command type
    if (!['bash', 'python', 'setup', 'run'].includes(executionType)) {
      return createToolResponse(false, undefined, '', 'Error: Invalid command_type');
    }

    let originalWorkingDirectory: string | undefined;
    if (workingDirectory) {
      const wdPath = path.resolve(workingDirectory);
      const exists = await fs.promises.access(wdPath).then(() => true).catch(() => false);
      if (!exists) {
        return createToolResponse(false, undefined, '', 'Error: Working directory not found');
      }
      originalWorkingDirectory = process.cwd();
      process.chdir(workingDirectory);
    }

    try {
      let commandToExecute: string;
      if (executionType === 'python') {
        commandToExecute = `python -c "${command.replace(/"/g, '\\"')}"`;
      } else {
        commandToExecute = command;
      }

      const { stdout, stderr } = await execAsync(commandToExecute, { timeout });
      const success = true; // If no error was thrown, consider it successful

      return createToolResponse(
        success,
        `stdout: ${stdout}\nstderr: ${stderr}`,
        'Command executed successfully',
      );
    } finally {
      // Restore original working directory
      if (originalWorkingDirectory) {
        process.chdir(originalWorkingDirectory);
      }
    }
  } catch (error: any) {
    const isTimeout = error.killed && error.signal === 'SIGTERM';
    if (isTimeout) {
      return createToolResponse(false, undefined, '', 'Error: Command timed out');
    }
    return createToolResponse(false, undefined, '', 'Error: Failed to execute command');
  }
}