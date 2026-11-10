import { spawn } from 'node:child_process';
import { ToolResult, createToolResponse } from './files.js';
import { getWorkspaceRoot } from './workspace-path.js';

const MAX_OUTPUT = 256 * 1024;

/**
 * Run the pod's `podapp` client with argv (no shell). Available only to the
 * pod-app agent inside published app requests, where the gateway scopes access.
 */
export async function podApp(args: unknown, stdin?: unknown): Promise<ToolResult> {
  if (!Array.isArray(args) || !args.length || args.length > 32 || args.some(arg => typeof arg !== 'string' || arg.length > 16000 || arg.includes('\0'))) {
    return createToolResponse(false, undefined, '', 'Error: args must be 1–32 strings, for example ["data", "query", "tasks"]');
  }
  if (stdin !== undefined && (typeof stdin !== 'string' || stdin.length > MAX_OUTPUT)) {
    return createToolResponse(false, undefined, '', 'Error: stdin must be a string of at most 256 KB');
  }
  return new Promise((resolve) => {
    const child = spawn('podapp', args as string[], { cwd: getWorkspaceRoot(), stdio: ['pipe', 'pipe', 'pipe'], timeout: 30_000 });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { if (stdout.length < MAX_OUTPUT) stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { if (stderr.length < 8192) stderr += chunk.toString(); });
    child.stdin.on('error', () => {});
    child.stdin.end(typeof stdin === 'string' ? stdin : '');
    child.once('error', (error) => resolve(createToolResponse(false, undefined, '', `Error: podapp is unavailable (${error.message})`)));
    child.once('close', (code) => {
      if (code === 0) resolve(createToolResponse(true, stdout.slice(0, MAX_OUTPUT), 'podapp succeeded'));
      else resolve(createToolResponse(false, undefined, stdout.slice(0, 4096), `Error: podapp exited with code ${code}: ${stderr.trim().slice(0, 4000)}`));
    });
  });
}
