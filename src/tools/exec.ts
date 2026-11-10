import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ToolResult, createToolResponse } from './files.js';
import { getWorkspaceRoot, resolveWorkspaceFile, WorkspacePathError } from './workspace-path.js';

const execAsync = promisify(exec);

/**
 * Execute a shell command or run code
 */
export async function executeCommand(command: string, executionType: string, workingDirectory?: string, timeout: number = 30): Promise<ToolResult> {
  try {
    // The public tool schema specifies seconds; child_process expects milliseconds.
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 300) {
      return createToolResponse(false, undefined, '', 'Error: timeout must be an integer between 1 and 300 seconds');
    }

    // Validate command type
    if (!['bash', 'python', 'setup', 'run'].includes(executionType)) {
      return createToolResponse(false, undefined, '', 'Error: Invalid command_type');
    }

    let cwd: string;
    try {
      cwd = workingDirectory ? resolveWorkspaceFile(workingDirectory) : getWorkspaceRoot();
    } catch (error) {
      const message = error instanceof WorkspacePathError ? error.message : 'Invalid working directory';
      return createToolResponse(false, undefined, '', `Error: ${message}`);
    }

    if (workingDirectory) {
      try {
        await fs.promises.access(cwd);
      } catch {
        return createToolResponse(false, undefined, '', 'Error: Working directory not found');
      }
    }

    let commandToExecute: string;
    if (executionType === 'python') {
      commandToExecute = `python -c "${command.replace(/"/g, '\\"')}"`;
    } else {
      commandToExecute = command;
    }

    const { stdout, stderr } = await execAsync(commandToExecute, { timeout: timeout * 1000, cwd });
    const success = true; // If no error was thrown, consider it successful

    return createToolResponse(
      success,
      `stdout: ${stdout}\nstderr: ${stderr}`,
      'Command executed successfully',
    );
  } catch (error: any) {
    const isTimeout = error.killed && error.signal === 'SIGTERM';
    if (isTimeout) {
      return createToolResponse(false, undefined, '', 'Error: Command timed out');
    }
    return createToolResponse(false, undefined, '', 'Error: Failed to execute command');
  }
}