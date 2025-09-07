import { ToolCall } from './messages.js';
import { ToolResult } from '../tools/registry.js';
import { hasFileBeenReadBeforeEdit, getReadBeforeEditErrorMessage } from '../tools/validators.js';
import { DANGEROUS_TOOLS, APPROVAL_REQUIRED_TOOLS } from '../tools/schemas/index.js';
import { executeTool } from '../tools/registry.js';

export interface ToolExecutorCallbacks {
  onToolStart?: (name: string, args: Record<string, unknown>) => void;
  onToolEnd?: (name: string, result: unknown) => void;
  onToolApproval?: (toolName: string, toolArgs: Record<string, unknown>) => Promise<{
    approved: boolean;
    autoApproveSession?: boolean;
  }>;
}

export interface ToolExecutorOptions {
  sessionAutoApprove: boolean;
  isInterrupted: boolean;
}

export async function executeToolCall(
  toolCallRequest: ToolCall,
  callbacks: ToolExecutorCallbacks,
  options: ToolExecutorOptions
): Promise<ToolResult> {
  try {
    // Strip 'repo_browser.' prefix if present (some models hallucinate this)
    let toolName = toolCallRequest.function.name;
    if (toolName.startsWith('repo_browser.')) {
      toolName = toolName.substring('repo_browser.'.length);
    }

    // Handle truncated tool calls
    let toolArguments: Record<string, unknown>;
    try {
      const argsStr = toolCallRequest.function.arguments;
      toolArguments = argsStr ? JSON.parse(argsStr) : {};
    } catch (error) {
      return {
        error: `Tool arguments truncated: ${error}. Please break this into smaller pieces or use shorter content.`,
        success: false,
      };
    }

    // Notify UI about tool start
    if (callbacks.onToolStart) {
      callbacks.onToolStart(toolName, toolArguments);
    }

    // Check read-before-edit for edit tools
    if (toolName === 'edit_file' && toolArguments.file_path) {
      if (!hasFileBeenReadBeforeEdit(toolArguments.file_path as string)) {
        const errorMessage = getReadBeforeEditErrorMessage(toolArguments.file_path as string);
        const result = { error: errorMessage, success: false };
        if (callbacks.onToolEnd) {
          callbacks.onToolEnd(toolName, result);
        }
        return result;
      }
    }

    // Check if tool needs approval (only after validation passes)
    const isDangerous = DANGEROUS_TOOLS.includes(toolName);
    const requiresApproval = APPROVAL_REQUIRED_TOOLS.includes(toolName);
    const needsApproval = isDangerous || requiresApproval;

    // For APPROVAL_REQUIRED_TOOLS, check if session auto-approval is enabled
    const canAutoApprove = requiresApproval && !isDangerous && options.sessionAutoApprove;

    if (needsApproval && !canAutoApprove) {
      let approvalResult: { approved: boolean; autoApproveSession?: boolean };

      if (callbacks.onToolApproval) {
        // Check for interruption before waiting for approval
        if (options.isInterrupted) {
          const result = { error: 'Tool execution interrupted by user', success: false, userRejected: true };
          if (callbacks.onToolEnd) {
            callbacks.onToolEnd(toolName, result);
          }
          return result;
        }

        approvalResult = await callbacks.onToolApproval(toolName, toolArguments);

        // Check for interruption after approval process
        if (options.isInterrupted) {
          const result = { error: 'Tool execution interrupted by user', success: false, userRejected: true };
          if (callbacks.onToolEnd) {
            callbacks.onToolEnd(toolName, result);
          }
          return result;
        }
      } else {
        // No approval callback available, reject by default
        approvalResult = { approved: false };
      }

      // Enable session auto-approval if requested (only for APPROVAL_REQUIRED_TOOLS)
      if (approvalResult.autoApproveSession && requiresApproval && !isDangerous) {
        options.sessionAutoApprove = true;
      }

      if (!approvalResult.approved) {
        const result = { error: 'Tool execution canceled by user', success: false, userRejected: true };
        if (callbacks.onToolEnd) {
          callbacks.onToolEnd(toolName, result);
        }
        return result;
      }
    }

    // Execute tool
    const result = await executeTool(toolName, toolArguments);

    // Notify UI about tool completion
    if (callbacks.onToolEnd) {
      callbacks.onToolEnd(toolName, result);
    }

    return result;
  } catch (error) {
    const errorMsg = `Tool execution error: ${error}`;
    return { error: errorMsg, success: false };
  }
}