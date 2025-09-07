import { useState, useCallback, useRef } from 'react';
import { Agent } from '../../core/agent.js';
import { DANGEROUS_TOOLS, APPROVAL_REQUIRED_TOOLS } from '../../tools/schemas/index.js';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool' | 'tool_execution';
  content: string;
  reasoning?: string;
  timestamp: Date;
  toolExecution?: ToolExecution;
  type?: string;
  usageSnapshot?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    total_requests: number;
    total_time: number;
    queue_time: number;
    prompt_time: number;
    completion_time: number;
  };
}

export interface ToolExecution {
  id: string;
  name: string;
  args: Record<string, any>;
  status: 'pending' | 'approved' | 'executing' | 'completed' | 'failed' | 'canceled';
  result?: any;
  needsApproval?: boolean;
}

export function useAgent(
  agent: Agent,
  onStartRequest?: () => void,
  onAddApiTokens?: (usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; total_time?: number }) => void,
  onPauseRequest?: () => void,
  onResumeRequest?: () => void,
  onCompleteRequest?: () => void,
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [userMessageHistory, setUserMessageHistory] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentToolExecution, setCurrentToolExecution] = useState<ToolExecution | null>(null);
  const [isSessionAutoApprovalEnabled, setSessionAutoApprove] = useState(false);
  const [shouldShowReasoningContent, setShowReasoning] = useState(true);
  const currentToolExecutionIdRef = useRef<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<{
    toolName: string;
    toolArgs: Record<string, any>;
    resolve:(approvalResult: { approved: boolean; autoApproveSession?: boolean }) => void;
      } | null>(null);
  const [pendingMaxIterations, setPendingMaxIterations] = useState<{
    maxIterations: number;
    resolve:(shouldContinue: boolean) => void;
      } | null>(null);
  const [pendingError, setPendingError] = useState<{
    error: string;
    resolve:(shouldRetry: boolean) => void;
      } | null>(null);

  const addMessageToHistory = useCallback((message: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    const newMessage: ChatMessage = {
      ...message,
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, newMessage]);
    return newMessage.id;
  }, []);

  const updateMessageInHistory = useCallback((id: string, updates: Partial<ChatMessage>) => {
    setMessages((prev) => prev.map((msg) => (msg.id === id ? { ...msg, ...updates } : msg)));
  }, []);

  const sendMessageToAgent = useCallback(async (userInput: string) => {
    if (isProcessing) return;

    // Start tracking metrics for new agent request
    if (onStartRequest) {
      onStartRequest();
    }

    // Add user message to history
    setUserMessageHistory((prev) => [...prev, userInput]);

    // Add user message
    addMessageToHistory({
      role: 'user',
      content: userInput,
    });

    setIsProcessing(true);

    try {
      // Set up tool execution callbacks
      agent.setToolCallbacks({
        onThinkingText: (content: string, reasoning?: string) => {
          // Add thinking text as assistant message when model uses tools
          addMessageToHistory({
            role: 'assistant',
            content,
            reasoning,
          });
        },
        onFinalMessage: (content: string, reasoning?: string) => {
          // Add final assistant message when no tools are used
          addMessageToHistory({
            role: 'assistant',
            content,
            reasoning,
          });
        },
        onToolStart: (name: string, args: Record<string, any>) => {
          const toolExecution: ToolExecution = {
            id: Math.random().toString(36).substr(2, 9),
            name,
            args,
            status: 'pending',
            needsApproval: DANGEROUS_TOOLS.includes(name) || APPROVAL_REQUIRED_TOOLS.includes(name),
          };

          // Store the ID in ref for reliable matching across callbacks
          currentToolExecutionIdRef.current = toolExecution.id;

          // Always add tool execution message; approval is handled separately
          addMessageToHistory({
            role: 'tool_execution',
            content: `Executing ${name}...`,
            toolExecution,
          });

          setCurrentToolExecution(toolExecution);
        },
        onToolEnd: (name: string, result: any) => {
          const executionId = currentToolExecutionIdRef.current;

          // Only update the specific tool execution that just finished
          setMessages((prev) => prev.map((msg) => {
            // Match by the execution ID stored in ref (reliable across callbacks)
            if (msg.toolExecution?.id === executionId && msg.role === 'tool_execution') {
              return {
                ...msg,
                content: result.userRejected
                  ? `🚫 ${name} rejected by user`
                  : result.success
                    ? `✓ ${name} completed successfully`
                    : `🔴 ${name} failed: ${result.error || 'Unknown error'}`,
                toolExecution: {
                  ...msg.toolExecution!,
                  status: result.userRejected
                    ? 'canceled'
                    : result.success
                      ? 'completed'
                      : 'failed',
                  result,
                },
              };
            }
            return msg;
          }));
          setCurrentToolExecution(null);
          currentToolExecutionIdRef.current = null;
        },
        onApiUsage: (usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; total_time?: number }) => {
          // Pass API usage data to token metrics
          if (onAddApiTokens) {
            onAddApiTokens(usage);
          }
        },
        onToolApproval: async (toolName: string, toolArgs: Record<string, any>) => {
          // Pause metrics while waiting for approval
          if (onPauseRequest) {
            onPauseRequest();
          }

          return new Promise<{ approved: boolean; autoApproveSession?: boolean }>((resolve) => {
            setPendingApproval({
              toolName,
              toolArgs,
              resolve: (approvalResult: { approved: boolean; autoApproveSession?: boolean }) => {
                // Resume metrics after approval decision
                if (onResumeRequest) {
                  onResumeRequest();
                }

                // Update the existing tool execution message with approval result
                setMessages((prev) => prev.map((msg) => {
                  if (msg.toolExecution?.id === currentToolExecutionIdRef.current && msg.role === 'tool_execution') {
                    const messageContent = approvalResult.approved
                      ? `Executing ${toolName}...${approvalResult.autoApproveSession ? ' (Auto-approval enabled for session)' : ''}`
                      : `Tool ${toolName} rejected by user`;

                    return {
                      ...msg,
                      content: messageContent,
                      toolExecution: {
                        ...msg.toolExecution!,
                        status: approvalResult.approved ? 'approved' : 'canceled',
                      },
                    };
                  }
                  return msg;
                }));

                if (approvalResult.autoApproveSession) {
                  setSessionAutoApprove(true);
                }
                resolve(approvalResult);
              },
            });
          });
        },
        onMaxIterations: async (maxIterations: number) => {
          // Pause metrics while waiting for continuation decision
          if (onPauseRequest) {
            onPauseRequest();
          }

          return new Promise<boolean>((resolve) => {
            setPendingMaxIterations({
              maxIterations,
              resolve: (shouldContinue: boolean) => {
                // Resume metrics after decision
                if (onResumeRequest) {
                  onResumeRequest();
                }

                resolve(shouldContinue);
              },
            });
          });
        },
        onError: async (error: string) => {
          // Pause metrics while waiting for retry decision
          if (onPauseRequest) {
            onPauseRequest();
          }

          return new Promise<boolean>((resolve) => {
            setPendingError({
              error,
              resolve: (shouldRetry: boolean) => {
                // Resume metrics after decision
                if (onResumeRequest) {
                  onResumeRequest();
                }

                resolve(shouldRetry);
              },
            });
          });
        },
      });

      await agent.chat(userInput);
    } catch (error) {
      // Don't show abort errors - user interruption message is already shown
      if (error instanceof Error && (
        error.message.includes('Request was aborted')
        || error.message.includes('The operation was aborted')
        || error.name === 'AbortError'
      )) {
        // Skip showing abort errors since user already sees "User has interrupted the request"
        return;
      }

      let errorMessage = 'Unknown error occurred';

      if (error instanceof Error) {
        // Check if it's an API error with more details
        if ('status' in error && 'error' in error) {
          const apiError = error as any;
          if (apiError.error?.error?.message) {
            errorMessage = `API Error (${apiError.status}): ${apiError.error.error.message}`;
            if (apiError.error.error.code) {
              errorMessage += ` (Code: ${apiError.error.error.code})`;
            }
          } else {
            errorMessage = `API Error (${apiError.status}): ${error.message}`;
          }
        } else {
          errorMessage = `Error: ${error.message}`;
        }
      } else {
        errorMessage = `Error: ${String(error)}`;
      }

      addMessageToHistory({
        role: 'system',
        content: errorMessage,
      });
    } finally {
      setIsProcessing(false);
      setCurrentToolExecution(null);

      // Complete the request tracking
      if (onCompleteRequest) {
        onCompleteRequest();
      }
    }
  }, [agent, isProcessing, addMessageToHistory, updateMessageInHistory, onStartRequest, onAddApiTokens, onPauseRequest, onResumeRequest, onCompleteRequest]);

  const approveToolExecution = useCallback((approved: boolean, autoApproveSession?: boolean) => {
    if (pendingApproval) {
      pendingApproval.resolve({ approved, autoApproveSession });
      setPendingApproval(null);
    }
  }, [pendingApproval]);

  const respondToMaxIterations = useCallback((shouldContinue: boolean) => {
    if (pendingMaxIterations) {
      pendingMaxIterations.resolve(shouldContinue);
      setPendingMaxIterations(null);
    }
  }, [pendingMaxIterations]);

  const respondToError = useCallback((shouldRetry: boolean) => {
    if (pendingError) {
      pendingError.resolve(shouldRetry);
      setPendingError(null);
    }
  }, [pendingError]);

  const setApiKey = useCallback((apiKey: string) => {
    agent.setApiKey(apiKey);
  }, [agent]);

  const toggleAutoApprove = useCallback(() => {
    const newAutoApproveState = !isSessionAutoApprovalEnabled;
    setSessionAutoApprove(newAutoApproveState);
    agent.setSessionAutoApprove(newAutoApproveState);
  }, [isSessionAutoApprovalEnabled, agent]);

  const clearHistory = useCallback(() => {
    setMessages([]);
    setUserMessageHistory([]);
    // Don't reset isSessionAutoApprovalEnabled, it should persist across /clear
    agent.clearHistory();
  }, [agent]);

  const interruptRequest = useCallback(() => {
    agent.interrupt();
    setIsProcessing(false);
    setCurrentToolExecution(null);

    // Add the interruption message to the UI
    addMessageToHistory({
      role: 'system',
      content: 'User has interrupted the request.',
    });
  }, [agent, addMessageToHistory]);

  const toggleReasoning = useCallback(() => {
    setShowReasoning((prev) => !prev);
  }, []);

  return {
    messages,
    userMessageHistory,
    isProcessing,
    currentToolExecution,
    pendingApproval,
    pendingMaxIterations,
    pendingError,
    sessionAutoApprove: isSessionAutoApprovalEnabled,
    showReasoning: shouldShowReasoningContent,
    sendMessage: sendMessageToAgent,
    approveToolExecution,
    respondToMaxIterations,
    respondToError,
    addMessage: addMessageToHistory,
    setApiKey,
    clearHistory,
    toggleAutoApprove,
    toggleReasoning,
    interruptRequest,
    agent,
  };
}
