import OpenAI from 'openai';
import type { ClientOptions } from 'openai';
import fs from 'fs';
import path from 'path';
import { executeTool, ToolResult } from '../tools/registry.js';
import { hasFileBeenReadBeforeEdit, getReadBeforeEditErrorMessage } from '../tools/validators.js';
import { ALL_TOOL_SCHEMAS } from '../tools/schemas/index.js';
import ConfigManager from '../config/ConfigManager.js';
import { Message, ToolCall, ApiError } from './messages.js';
import { debugLog } from './logger.js';
import { executeToolCall, ToolExecutorCallbacks, ToolExecutorOptions } from './tool-executor.js';



export class Agent {
  private client: OpenAI | null = null;

  private messages: Message[] = [];

  private apiKey: string | null = null;

  private model: string;

  private temperature: number;

  private sessionAutoApprove: boolean = false;

  private systemMessage: string;

  private configManager: ConfigManager;

  private onToolStart?: (name: string, args: Record<string, unknown>) => void;

  private onToolEnd?: (name: string, result: unknown) => void;

  private onToolApproval?: (toolName: string, toolArgs: Record<string, unknown>) => Promise<{
    approved: boolean;
    autoApproveSession?: boolean;
  }>;

  private onThinkingText?: (content: string, reasoning?: string) => void;

  private onFinalMessage?: (content: string, reasoning?: string) => void;

  private onMaxIterations?: (maxIterations: number) => Promise<boolean>;

  private onApiUsage?: (usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    total_time?: number;
  }) => void;

  private onError?: (error: string) => Promise<boolean>;

  private requestCount: number = 0;

  private currentAbortController: AbortController | null = null;

  private isInterrupted: boolean = false;

  private constructor(
    model: string,
    temperature: number,
    systemMessage: string | null,
    debug?: boolean,
  ) {
    this.model = model;
    this.temperature = temperature;
    this.configManager = new ConfigManager();

    // Set debug mode
    const isDebugEnabled = debug || false;

    // Build system message
    if (systemMessage) {
      this.systemMessage = systemMessage;
    } else {
      this.systemMessage = this.buildDefaultSystemMessage();
    }

    // Add system message to conversation
    this.messages.push({ role: 'system', content: this.systemMessage });

    // Load project context if available
    try {
      const customContextFilePath = process.env.OPENAI_CONTEXT_FILE;
      const baseDir = process.env.OPENAI_CONTEXT_DIR || process.cwd();
      const contextPath = customContextFilePath || path.join(baseDir, '.openai', 'context.md');
      const contextLimit = parseInt(process.env.OPENAI_CONTEXT_LIMIT || '20000', 10);
      if (fs.existsSync(contextPath)) {
        const contextContent = fs.readFileSync(contextPath, 'utf-8');
        const trimmedContext = contextContent.length > contextLimit
          ? `${contextContent.slice(0, contextLimit)}\n... [truncated]`
          : contextContent;
        const contextSource = customContextFilePath ? contextPath : '.cobot/context.md';
        this.messages.push({
          role: 'system',
          content: [
            `Project context loaded from ${contextSource}. Use this as high-level reference when reasoning about the repository.`,
            '',
            trimmedContext,
          ].join('\n'),
        });
      }
    } catch (error) {
      if (isDebugEnabled) {
        debugLog('Failed to load project context:', error);
      }
    }
  }

  static async create(
    model: string,
    temperature: number,
    systemMessage: string | null,
    debug?: boolean,
  ): Promise<Agent> {
    // Check for default model in config if model not explicitly provided
    const configManager = new ConfigManager();
    const defaultModel = configManager.getDefaultModel();
    const selectedModel = defaultModel || model;

    const agent = new Agent(
      selectedModel,
      temperature,
      systemMessage,
      debug,
    );
    return agent;
  }

  private buildDefaultSystemMessage(): string {
    const cwd = process.cwd();
    return `You are a coding and everyday office work assistant powered by ${this.model}. You have access to various tools for coding tasks. Always use these tools for any implementation requests—never reply with text-only responses or code snippets when the task requires actual files.

Current working directory: ${cwd}

For tasks like building, creating, or implementing:
- Start with create_file or list_files—don't give explanations first.
- Use the tools to generate real, working code files (not examples).
- Build step-by-step: create essential files, then expand with features.

File Operations:
- Always check if a file exists with list_files or read_file before acting.
- If editing, read_file before using edit_file (never use create_file for editing).
- To create new files, confirm with list_files, then call create_file.
- To replace an existing file, use create_file with overwrite=true.
- Unsure? Use list_files or read_file to check.
- Always read_file before editing any file.

Tool Usage:
- Use the "file_path" parameter for file operations—avoid "path".
- Double-check required parameters in tool schemas.
- Matches in edit_file must be exact, including whitespace.
- Do NOT prefix tool names with "repo_browser.".

Commands:
- Only use execute_command for short, quick operations (tests, build, simple scripts).
- Don't run long-lasting processes like servers or daemons.
- Safe: "python test_script.py", "npm test", "ls -la", "git status"
- Avoid: "flask app.py", "npm start", "python -m http.server"
- If a long-running command is needed, provide it to the user at the end, as instruction—not as an execution request.

Creating Files:
- Keep files focused and easy to manage. For larger projects, start minimal and expand, creating separate files as you go.

Never generate markdown tables. Be brief and efficient.
`;
  }

  public setToolCallbacks(callbacks: {
    onToolStart?: (name: string, args: Record<string, unknown>) => void;
    onToolEnd?: (name: string, result: unknown) => void;
    onToolApproval?: (toolName: string, toolArgs: Record<string, unknown>) => Promise<{ approved: boolean; autoApproveSession?: boolean }>;
    onThinkingText?: (content: string) => void;
    onFinalMessage?: (content: string) => void;
    onMaxIterations?: (maxIterations: number) => Promise<boolean>;
    onApiUsage?: (usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; total_time?: number }) => void;
    onError?: (error: string) => Promise<boolean>;
  }) {
    this.onToolStart = callbacks.onToolStart;
    this.onToolEnd = callbacks.onToolEnd;
    this.onToolApproval = callbacks.onToolApproval;
    this.onThinkingText = callbacks.onThinkingText;
    this.onFinalMessage = callbacks.onFinalMessage;
    this.onMaxIterations = callbacks.onMaxIterations;
    this.onApiUsage = callbacks.onApiUsage;
    this.onError = callbacks.onError;
  }

  public setApiKey(apiKey: string): void {
    debugLog('Setting API key in agent...');
    debugLog('API key provided:', apiKey ? `${apiKey.substring(0, 8)}...` : 'empty');
    this.apiKey = apiKey;

    // Initialize OpenAI client
    const clientOptions: ClientOptions = { apiKey };
    this.client = new OpenAI(clientOptions);
    debugLog('OpenAI client initialized with provided API key');
  }

  public saveApiKey(apiKey: string): void {
    this.configManager.setApiKey(apiKey);
    this.setApiKey(apiKey);
  }

  public clearApiKey(): void {
    this.configManager.clearApiKey();
    this.apiKey = null;
    this.client = null;
  }

  public clearHistory(): void {
    // Reset messages to only contain system messages
    this.messages = this.messages.filter((msg) => msg.role === 'system');
  }

  public setModel(model: string): void {
    this.model = model;
    // Save as default model
    this.configManager.setDefaultModel(model);
    // Update system message to reflect new model
    const newSystemMessage = this.buildDefaultSystemMessage();
    this.systemMessage = newSystemMessage;
    // Update the system message in the conversation
    const systemMsgIndex = this.messages.findIndex((msg) => msg.role === 'system' && msg.content.includes('coding assistant'));
    if (systemMsgIndex >= 0) {
      this.messages[systemMsgIndex].content = newSystemMessage;
    }
  }

  public getCurrentModel(): string {
    return this.model;
  }

  public setSessionAutoApprove(enabled: boolean): void {
    this.sessionAutoApprove = enabled;
  }

  public interrupt(): void {
    debugLog('Interrupting current request');
    this.isInterrupted = true;

    if (this.currentAbortController) {
      debugLog('Aborting current API request');
      this.currentAbortController.abort();
    }

    // Add interruption message to conversation
    this.messages.push({
      role: 'system',
      content: 'User has interrupted the request.',
    });
  }

  async chat(userInput: string): Promise<void> {
    // Reset interrupt flag at the start of a new chat
    this.isInterrupted = false;

    // Check API key on first message send
    if (!this.client) {
      debugLog('Initializing OpenAI client...');
      // Try environment variable first
      const envApiKey = process.env.OPENAI_API_KEY;
      if (envApiKey) {
        debugLog('Using API key from environment variable');
        this.setApiKey(envApiKey);
      } else {
        // Try config file
        debugLog('Environment variable OPENAI_API_KEY not found, checking config file');
        const configApiKey = this.configManager.getApiKey();
        if (configApiKey) {
          debugLog('Using API key from config file');
          this.setApiKey(configApiKey);
        } else {
          debugLog('No API key found anywhere');
          throw new Error('No API key available. Please use /login to set your OpenAI API key.');
        }
      }
      debugLog('OpenAI client initialized successfully');
    }

    // Add user message
    this.messages.push({ role: 'user', content: userInput });

    const maxToolIterations = 50;
    let currentIteration = 0;

    while (true) { // Outer loop for iteration reset
      while (currentIteration < maxToolIterations) {
        // Check for interruption before each iteration
        if (this.isInterrupted) {
          debugLog('Chat loop interrupted by user');
          this.currentAbortController = null;
          return;
        }

        try {
          // Check client exists
          if (!this.client) {
            throw new Error('OpenAI client not initialized');
          }

          debugLog('Making API call to OpenAI with model:', this.model);
          debugLog('Messages count:', this.messages.length);
          debugLog('Last few messages:', this.messages.slice(-3));

          // Prepare API request payload for curl logging
          const apiRequestPayload = {
            model: this.model,
            messages: this.messages,
            tools: ALL_TOOL_SCHEMAS,
            tool_choice: 'auto' as const,
            temperature: this.temperature,
            max_tokens: 8000,
            stream: false as const,
          };

          // Log equivalent curl command
          this.requestCount++;
          const curlCommand = generateDebugCurlCommand(this.apiKey!, apiRequestPayload, this.requestCount);
          if (curlCommand) {
            debugLog('Equivalent curl command:', curlCommand);
          }

          // Create AbortController for this request
          this.currentAbortController = new AbortController();

          const response = await this.client.chat.completions.create({
            model: this.model,
            messages: this.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
            tools: ALL_TOOL_SCHEMAS,
            tool_choice: 'auto',
            temperature: this.temperature,
            max_tokens: 8000,
            stream: false,
          }, {
            signal: this.currentAbortController.signal,
          });

          debugLog('Full API response received:', response);
          debugLog('Response usage:', response.usage);
          debugLog('Response finish_reason:', response.choices[0].finish_reason);
          debugLog('Response choices length:', response.choices.length);

          const { message } = response.choices[0];

          // Extract model reasoning if present
          const modelReasoning = (message as any).reasoning;

          // Pass usage data to callback if available
          if (response.usage && this.onApiUsage) {
            this.onApiUsage({
              prompt_tokens: response.usage.prompt_tokens,
              completion_tokens: response.usage.completion_tokens,
              total_tokens: response.usage.total_tokens,
            });
          }
          debugLog('Message content length:', message.content?.length || 0);
          debugLog('Message has tool_calls:', !!message.tool_calls);
          debugLog('Message tool_calls count:', message.tool_calls?.length || 0);

          if (response.choices[0].finish_reason !== 'stop' && response.choices[0].finish_reason !== 'tool_calls') {
            debugLog('WARNING - Unexpected finish_reason:', response.choices[0].finish_reason);
          }

          // Handle tool calls if present
          if (message.tool_calls) {
            // Show thinking text or model reasoning if present
            if (message.content || modelReasoning) {
              if (this.onThinkingText) {
                this.onThinkingText(message.content || '', modelReasoning);
              }
            }

            // Add assistant message to history
            const assistantMsg: Message = {
              role: 'assistant',
              content: message.content || '',
            };
            assistantMsg.tool_calls = message.tool_calls?.map(tc => ({
              id: tc.id,
              type: tc.type,
              function: {
                name: (tc as any).function.name,
                arguments: (tc as any).function.arguments
              }
            }));
            this.messages.push(assistantMsg);

            // Execute tool calls
            for (const toolCallRequest of message.tool_calls || []) {
              // Check for interruption before each tool execution
              if (this.isInterrupted) {
                debugLog('Tool execution interrupted by user');
                this.currentAbortController = null;
                return;
              }

              const toolCall = {
                id: toolCallRequest.id,
                type: toolCallRequest.type,
                function: {
                  name: (toolCallRequest as any).function.name,
                  arguments: (toolCallRequest as any).function.arguments
                }
              };
              const callbacks: ToolExecutorCallbacks = {
                onToolStart: this.onToolStart,
                onToolEnd: this.onToolEnd,
                onToolApproval: this.onToolApproval,
              };
              
              const options: ToolExecutorOptions = {
                sessionAutoApprove: this.sessionAutoApprove,
                isInterrupted: this.isInterrupted,
              };
              
              const result = await executeToolCall(toolCall, callbacks, options);

              // Add tool result to conversation (including rejected ones)
              this.messages.push({
                role: 'tool',
                tool_call_id: toolCallRequest.id,
                content: JSON.stringify(result),
              });

              // Check if user rejected the tool, if so, stop processing
              if ((result as any).userRejected) {
                // Add a note to the conversation that the user rejected the tool
                const toolName = ('function' in toolCallRequest && toolCallRequest.function) ? toolCallRequest.function.name
                  : ('custom' in toolCallRequest && toolCallRequest.custom) ? toolCallRequest.custom.name : 'unknown tool';
                this.messages.push({
                  role: 'system',
                  content: `The user rejected the ${toolName} tool execution. The response has been terminated. Please wait for the user's next instruction.`,
                });
                return;
              }
            }

            // Continue loop to get model response to tool results
            currentIteration++;
            continue;
          }

          // No tool calls, this is the final response
          const content = message.content || '';
          debugLog('Final response - no tool calls detected');
          debugLog('Final content length:', content.length);
          debugLog('Final content preview:', content.substring(0, 200));

          if (this.onFinalMessage) {
            debugLog('Calling onFinalMessage callback');
            this.onFinalMessage(content, modelReasoning);
          } else {
            debugLog('No onFinalMessage callback set');
          }

          // Add final response to conversation history
          this.messages.push({
            role: 'assistant',
            content,
          });

          debugLog('Final response added to conversation history, exiting chat loop');
          this.currentAbortController = null; // Clear abort controller
          return; // Successfully completed, exit both loops
        } catch (error) {
          this.currentAbortController = null; // Clear abort controller

          // Check if this is an abort error due to user interruption
          if (error instanceof Error && (
            error.message.includes('Request was aborted')
            || error.message.includes('The operation was aborted')
            || error.name === 'AbortError'
          )) {
            debugLog('API request aborted due to user interruption');
            // Don't add error message if it's an interruption - the interrupt message was already added
            return;
          }

          debugLog('Error occurred during API call:', error);
          debugLog('Error details:', {
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : 'No stack available',
          });

          // Add API error as context message instead of terminating chat
          let errorMessage = 'Unknown error occurred';
          let is401Error = false;

          if (error instanceof Error) {
            // Check if it's an API error with more details
            if ('status' in error && 'error' in error) {
              const apiError = error as ApiError;
              is401Error = apiError.status === 401;
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

          // For 401 errors (invalid API key), don't retry - terminate immediately
          if (is401Error) {
            throw new Error(`${errorMessage}. Please check your API key and use /login to set a valid key.`);
          }

          // Ask user if they want to retry via callback
          if (this.onError) {
            const shouldRetry = await this.onError(errorMessage);
            if (shouldRetry) {
              // User wants to retry - continue the loop without adding error to conversation
              currentIteration++;
              continue;
            } else {
              // User chose not to retry - add error message and return
              this.messages.push({
                role: 'system',
                content: `Request failed with error: ${errorMessage}. User chose not to retry.`,
              });
              return;
            }
          } else {
            // No error callback available - use old behavior
            // Add error context to conversation for model to see and potentially recover
            this.messages.push({
              role: 'system',
              content: `Previous API request failed with error: ${errorMessage}. Please try a different approach or ask the user for clarification.`,
            });

            // Continue conversation loop to let model attempt recovery
            currentIteration++;
            continue;
          }
        }
      }

      // Hit max tool iterations, ask user if they want to continue
      if (currentIteration >= maxToolIterations) {
        let shouldContinue = false;
        if (this.onMaxIterations) {
          shouldContinue = await this.onMaxIterations(maxToolIterations);
        }
        if (shouldContinue) {
          currentIteration = 0; // Reset iteration counter
          continue; // Continue the outer loop
        } else {
          return; // Exit both loops
        }
      }
    }
  }

}

function generateDebugCurlCommand(apiKey: string, apiRequestPayload: Record<string, unknown>, requestCount: number): string {
  // Debug logging is handled in logger.ts
  return '';
}
