import * as fs from 'fs';
import * as path from 'path';

// Debug logging to file
const AGENT_DEBUG_LOG_FILE = path.join(process.cwd(), 'debug-agent.log');
let hasDebugLogBeenCleared = false;
let isDebugLoggingEnabled = false;

export function setDebugLoggingEnabled(enabled: boolean) {
  isDebugLoggingEnabled = enabled;
  hasDebugLogBeenCleared = false;
}

export function debugLog(message: string, data?: unknown) {
  if (!isDebugLoggingEnabled) return;

  // Clear log file on first debug log of each session
  if (!hasDebugLogBeenCleared) {
    fs.writeFileSync(AGENT_DEBUG_LOG_FILE, '');
    hasDebugLogBeenCleared = true;
  }

  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}${data ? `\n${JSON.stringify(data, null, 2)}` : ''}\n`;
  fs.appendFileSync(AGENT_DEBUG_LOG_FILE, logEntry);
}
