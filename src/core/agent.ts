import OpenAI from 'openai';
import type { ClientOptions } from 'openai';
import fs from 'fs';
import path from 'path';
import { executeTool, ToolResult } from '../tools/registry.js';
import { hasFileBeenReadBeforeEdit, getReadBeforeEditErrorMessage } from '../tools/validators.js';
import { ALL_TOOL_SCHEMAS, ToolSchema } from '../tools/schemas/index.js';
import ConfigManager from '../config/ConfigManager.js';
import { Message, ToolCall, ApiError } from './messages.js';
import { debugLog, setDebugLoggingEnabled } from './logger.js';
import { buildChatCompletionPayload, createStreamingChatCompletion, type ChatCompletionOptions } from './openai-helper.js';
import { executeToolCall, ToolExecutorCallbacks, ToolExecutorOptions } from './tool-executor.js';
import { QuestionAnswer, QuestionPrompt } from '../tools/question.js';
import { buildSkillContextForExplore, findMatchingSkillsForPrompt, listSkills, skillDescriptionSuffix, skillSystemPrompt } from './skills.js';
import {
  CodingAgentInfo,
  EXPLORE_AGENT_NAME,
  getToolPermissionAction,
  loadCodingAgents,
  resolveCodingAgent,
} from './coding-agents.js';
import { runParallelExplore, type ExploreProgressEvent } from './explore-runner.js';



export class Agent {
  private client: OpenAI | null = null;

  private messages: Message[] = [];

  private baseMessages: Message[] = [];

  private apiKey: string | null = null;

  private model: string;

  private temperature: number;

  private baseURL: string | null = null;

  private sessionAutoApprove: boolean = false;

  private systemMessage: string;

  private codingAgent: CodingAgentInfo;

  private configManager: ConfigManager;

  private onToolStart?: (name: string, args: Record<string, unknown>) => void;

  private onToolEnd?: (name: string, result: unknown) => void;

  private onToolApproval?: (toolName: string, toolArgs: Record<string, unknown>) => Promise<{
    approved: boolean;
    autoApproveSession?: boolean;
  }>;

  private onQuestion?: (questions: QuestionPrompt[]) => Promise<QuestionAnswer[]>;

  private onThinkingText?: (content: string, reasoning?: string) => void;

  private onFinalMessage?: (content: string, reasoning?: string) => void;

  private onStreamStart?: () => string;

  private onStreamUpdate?: (messageId: string, content: string, reasoning?: string) => void;

  private onMaxIterations?: (maxIterations: number) => Promise<boolean>;

  private onApiUsage?: (usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    total_time?: number;
  }) => void;

  private onExploreProgress?: (event: ExploreProgressEvent) => void;

  private onError?: (error: string) => Promise<boolean>;

  private requestCount: number = 0;

  private currentAbortController: AbortController | null = null;

  private isInterrupted: boolean = false;

  private constructor(
    model: string,
    temperature: number,
    systemMessage: string | null,
    codingAgent: CodingAgentInfo,
    debug?: boolean,
  ) {
    this.model = model;
    this.temperature = temperature;
    this.codingAgent = codingAgent;
    this.configManager = new ConfigManager();

    // Set debug mode
    setDebugLoggingEnabled(debug || false);

    // Build system message
    if (systemMessage) {
      this.systemMessage = systemMessage;
    } else if (codingAgent.prompt) {
      this.systemMessage = this.buildAgentSystemMessage(codingAgent.prompt);
    } else {
      this.systemMessage = this.buildDefaultSystemMessage();
    }

    // Add system message to conversation
    this.messages.push({ role: 'system', content: this.systemMessage });
    this.loadProjectContextMessages();

    this.baseMessages = cloneMessages(this.messages);
  }

  static async create(
    model: string,
    temperature: number,
    systemMessage: string | null,
    debug?: boolean,
    codingAgentName?: string | null,
  ): Promise<Agent> {
    // Check for default model in config if model not explicitly provided
    const configManager = new ConfigManager();
    const codingAgent = resolveCodingAgent(codingAgentName, configManager.getDefaultAgent(), configManager.getCodingAgents());
    const defaultModel = configManager.getDefaultModel();
    const selectedModel = codingAgent.model || defaultModel || model;
    const selectedTemperature = codingAgent.temperature ?? temperature;

    const agent = new Agent(
      selectedModel,
      selectedTemperature,
      systemMessage,
      codingAgent,
      debug,
    );

    // Load base URL from config if available
    const baseURL = configManager.getBaseURL();
    if (baseURL) {
      agent.baseURL = baseURL;
      debugLog('Loaded base URL from config:', baseURL);
    }

    // Load API key from config if available
    const apiKey = configManager.getApiKey();
    if (apiKey) {
      agent.apiKey = apiKey;
      debugLog('Loaded API key from config');
    }

    return agent;
  }

  private buildDefaultSystemMessage(): string {
    const cwd = process.cwd();
    const skills = skillSystemPrompt(this.configManager.getSkillsConfig());
    return `You are a coding and everyday office work assistant powered by ${this.model}. You have access to various tools for coding tasks. Always use these tools for any implementation requests—never reply with text-only responses or code snippets when the task requires actual files.

Current working directory: ${cwd}
${skills ? `\n${skills}\n` : ''}

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
- Prefer glob for finding files by filename pattern. Use search_files for searching file contents.
- Prefer apply_patch for multi-file edits, moves, and coordinated changes.

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

  private buildAgentSystemMessage(prompt: string): string {
    const cwd = process.cwd();
    const skills = skillSystemPrompt(this.configManager.getSkillsConfig());
    return `${prompt.trim()}

Current working directory: ${cwd}
${skills ? `\n${skills}\n` : ''}
`;
  }

  private loadProjectContextMessages(): void {
    try {
      const customContextFilePath = process.env.OPENAI_CONTEXT_FILE;
      const baseDir = process.env.OPENAI_CONTEXT_DIR || process.cwd();
      const contextPath = customContextFilePath || path.join(baseDir, '.cobot', 'context.md');
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
      debugLog('Failed to load project context:', error);
    }
  }

  public setToolCallbacks(callbacks: {
    onToolStart?: (name: string, args: Record<string, unknown>) => void;
    onToolEnd?: (name: string, result: unknown) => void;
    onToolApproval?: (toolName: string, toolArgs: Record<string, unknown>) => Promise<{ approved: boolean; autoApproveSession?: boolean }>;
    onQuestion?: (questions: QuestionPrompt[]) => Promise<QuestionAnswer[]>;
    onThinkingText?: (content: string, reasoning?: string) => void;
    onFinalMessage?: (content: string, reasoning?: string) => void;
    onStreamStart?: () => string;
    onStreamUpdate?: (messageId: string, content: string, reasoning?: string) => void;
    onMaxIterations?: (maxIterations: number) => Promise<boolean>;
    onApiUsage?: (usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; total_time?: number }) => void;
    onExploreProgress?: (event: ExploreProgressEvent) => void;
    onError?: (error: string) => Promise<boolean>;
  }) {
    this.onToolStart = callbacks.onToolStart;
    this.onToolEnd = callbacks.onToolEnd;
    this.onToolApproval = callbacks.onToolApproval;
    this.onQuestion = callbacks.onQuestion;
    this.onThinkingText = callbacks.onThinkingText;
    this.onFinalMessage = callbacks.onFinalMessage;
    this.onStreamStart = callbacks.onStreamStart;
    this.onStreamUpdate = callbacks.onStreamUpdate;
    this.onMaxIterations = callbacks.onMaxIterations;
    this.onApiUsage = callbacks.onApiUsage;
    this.onExploreProgress = callbacks.onExploreProgress;
    this.onError = callbacks.onError;
  }

  private async createStreamingResponse(options: ChatCompletionOptions): Promise<{
    content: string;
    reasoning?: string;
    toolCalls?: ToolCall[];
    streamedMessageId?: string;
    finishReason?: string | null;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
  }> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized');
    }

    const stream = await createStreamingChatCompletion(this.client, options);
    const toolCallAccumulators = new Map<number, {
      id?: string;
      type?: string;
      function: {
        name: string;
        arguments: string;
      };
    }>();
    let content = '';
    let reasoning = '';
    let streamedMessageId: string | undefined;
    let finishReason: string | null | undefined;
    let usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined;

    for await (const chunk of stream) {
      if (chunk.usage) {
        usage = {
          prompt_tokens: chunk.usage.prompt_tokens,
          completion_tokens: chunk.usage.completion_tokens,
          total_tokens: chunk.usage.total_tokens,
        };
      }

      const choice = chunk.choices[0];
      if (!choice) {
        continue;
      }

      finishReason = choice.finish_reason ?? finishReason;
      const { delta } = choice;
      const contentDelta = delta.content || '';
      const reasoningDelta = getStringField(delta, 'reasoning_content') || getStringField(delta, 'reasoning') || '';

      content += contentDelta;
      reasoning += reasoningDelta;

      if ((contentDelta || reasoningDelta) && this.onStreamStart && this.onStreamUpdate) {
        streamedMessageId ||= this.onStreamStart();
        this.onStreamUpdate(streamedMessageId, content, reasoning || undefined);
      }

      for (const toolCallDelta of delta.tool_calls || []) {
        const accumulator = toolCallAccumulators.get(toolCallDelta.index) || {
          function: {
            name: '',
            arguments: '',
          },
        };

        if (toolCallDelta.id) {
          accumulator.id = toolCallDelta.id;
        }
        if (toolCallDelta.type) {
          accumulator.type = toolCallDelta.type;
        }
        if (toolCallDelta.function?.name) {
          accumulator.function.name += toolCallDelta.function.name;
        }
        if (toolCallDelta.function?.arguments) {
          accumulator.function.arguments += toolCallDelta.function.arguments;
        }

        toolCallAccumulators.set(toolCallDelta.index, accumulator);
      }
    }

    const toolCalls = [...toolCallAccumulators.entries()]
      .sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
      .map(([index, toolCall]) => ({
        id: toolCall.id || `call_${index}`,
        type: toolCall.type || 'function',
        function: toolCall.function,
      }));

    return {
      content,
      reasoning: reasoning || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      streamedMessageId,
      finishReason,
      usage,
    };
  }

  private getToolSchemas(): OpenAI.Chat.Completions.ChatCompletionTool[] {
    const toolSchemas: ToolSchema[] = ALL_TOOL_SCHEMAS.filter((toolSchema) => getToolPermissionAction(toolSchema.function.name, this.codingAgent) !== 'deny')
      .map((toolSchema) => {
      if (toolSchema.function.name !== 'skill') {
        return toolSchema;
      }

      return {
        ...toolSchema,
        function: {
          ...toolSchema.function,
          description: `${toolSchema.function.description}\n\n${skillDescriptionSuffix(this.configManager.getSkillsConfig())}`,
        },
      };
    });

    return toolSchemas as OpenAI.Chat.Completions.ChatCompletionTool[];
  }

  public setApiKey(apiKey: string): void {
    debugLog('Setting API key in agent...');
    debugLog('API key provided:', apiKey ? `${apiKey.substring(0, 8)}...` : 'empty');
    this.apiKey = apiKey;

    // Initialize OpenAI client
    const clientOptions: ClientOptions = { apiKey };
    if (this.baseURL) {
      clientOptions.baseURL = this.baseURL;
    }
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

  public setBaseURL(baseURL: string): void {
    debugLog('Setting base URL in agent...');
    debugLog('Base URL provided:', baseURL);
    this.baseURL = baseURL;

    // Reinitialize OpenAI client if API key is already set
    if (this.apiKey && this.client) {
      const clientOptions: ClientOptions = { apiKey: this.apiKey };
      if (this.baseURL) {
        clientOptions.baseURL = this.baseURL;
      }
      this.client = new OpenAI(clientOptions);
      debugLog('OpenAI client reinitialized with new base URL');
    }
  }

  public saveBaseURL(baseURL: string): void {
    this.configManager.setBaseURL(baseURL);
    this.setBaseURL(baseURL);
  }

  public clearBaseURL(): void {
    this.configManager.clearBaseURL();
    this.baseURL = null;

    // Reinitialize OpenAI client if API key is already set
    if (this.apiKey && this.client) {
      const clientOptions: ClientOptions = { apiKey: this.apiKey };
      this.client = new OpenAI(clientOptions);
      debugLog('OpenAI client reinitialized without custom base URL');
    }
  }

  public getBaseURL(): string | null {
    return this.baseURL;
  }

  public getApiKey(): string | null {
    return this.apiKey;
  }

  public clearHistory(): void {
    this.messages = cloneMessages(this.baseMessages);
  }

  public addContextMessage(content: string): void {
    this.messages.push({ role: 'system', content });
  }

  public setModel(model: string): void {
    this.model = model;
    // Save as default model
    this.configManager.setDefaultModel(model);
    this.updateDefaultSystemMessageForModel();
  }

  public setRuntimeModel(model: string, temperature = this.temperature): void {
    this.model = model;
    this.temperature = temperature;
    this.updateDefaultSystemMessageForModel();
  }

  public getActiveCodingAgent(): CodingAgentInfo {
    return this.codingAgent;
  }

  public listCodingAgents(): CodingAgentInfo[] {
    return loadCodingAgents(this.configManager.getCodingAgents());
  }

  public switchCodingAgent(agentName: string): void {
    const nextAgent = resolveCodingAgent(agentName, this.configManager.getDefaultAgent(), this.configManager.getCodingAgents());
    this.codingAgent = nextAgent;

    if (nextAgent.model) {
      this.model = nextAgent.model;
    }
    if (nextAgent.temperature !== undefined) {
      this.temperature = nextAgent.temperature;
    }

    this.systemMessage = nextAgent.prompt
      ? this.buildAgentSystemMessage(nextAgent.prompt)
      : this.buildDefaultSystemMessage();
    this.messages = [{ role: 'system', content: this.systemMessage }];
    this.loadProjectContextMessages();
    this.baseMessages = cloneMessages(this.messages);
  }

  public getTemperature(): number {
    return this.temperature;
  }

  public exportMessages(): Message[] {
    return cloneMessages(this.messages);
  }

  public exportBaseMessages(): Message[] {
    return cloneMessages(this.baseMessages);
  }

  public loadSessionState(
    model: string,
    temperature: number,
    messages: Message[],
    baseMessages: Message[],
  ): void {
    this.model = model;
    this.temperature = temperature;
    this.baseMessages = baseMessages.length > 0
      ? cloneMessages(baseMessages)
      : cloneMessages(messages.filter((msg) => msg.role === 'system'));
    this.messages = messages.length > 0
      ? cloneMessages(messages)
      : cloneMessages(this.baseMessages);

    const firstSystemMessage = this.baseMessages.find((msg) => msg.role === 'system');
    if (firstSystemMessage) {
      this.systemMessage = firstSystemMessage.content;
    }
  }

  private updateDefaultSystemMessageForModel(): void {
    // Update system message to reflect new model
    const newSystemMessage = this.buildDefaultSystemMessage();
    this.systemMessage = newSystemMessage;

    const baseSystemMsgIndex = this.baseMessages.findIndex((msg) => msg.role === 'system' && msg.content.includes('coding assistant'));
    if (baseSystemMsgIndex >= 0) {
      this.baseMessages[baseSystemMsgIndex].content = newSystemMessage;
    }

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

  private async chatWithParallelExplore(userInput: string): Promise<void> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized');
    }

    this.currentAbortController = new AbortController();
    if (this.onThinkingText) {
      this.onThinkingText('Exploring with parallel read-only workers...');
    }

    // Harness-side skill activation: since the explore agent bypasses the tool loop,
    // the model cannot call the skill tool. Instead, find skills whose descriptions
    // match the user prompt and inject their instructions into the explore context.
    let skillContext: string | undefined;
    let skillNames: string[] | undefined;
    const allSkills = listSkills(this.configManager.getSkillsConfig());
    if (allSkills.length > 0) {
      const matchedSkills = findMatchingSkillsForPrompt(userInput, allSkills);
      if (matchedSkills.length > 0) {
        skillContext = buildSkillContextForExplore(matchedSkills);
        skillNames = matchedSkills.map((s) => s.name);
        debugLog(`Explore: auto-loaded ${matchedSkills.length} skill(s): ${skillNames.join(', ')}`);
      }
    }

    const result = await runParallelExplore({
      client: this.client,
      model: this.model,
      temperature: this.temperature,
      messages: this.messages,
      userInput,
      signal: this.currentAbortController.signal,
      shouldStop: () => this.isInterrupted,
      onApiUsage: this.onApiUsage,
      onProgress: this.onExploreProgress,
      skillContext,
      skillNames,
    });

    this.currentAbortController = null;

    if (this.isInterrupted) {
      return;
    }

    if (this.onFinalMessage) {
      this.onFinalMessage(result.content);
    }

    this.messages.push({
      role: 'assistant',
      content: result.content,
    });
  }

  async chat(userInput: string): Promise<void> {
    // Reset interrupt flag at the start of a new chat
    this.isInterrupted = false;

    // Check API key on first message send
    if (!this.client) {
      debugLog('Initializing OpenAI client...');
      
      // Use the API key that was already loaded during agent creation
      // This ensures we don't override a previously set session key with environment variables
      if (this.apiKey) {
        debugLog('Using API key from agent initialization');
        this.setApiKey(this.apiKey);
      } else {
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

          if (this.codingAgent.name === EXPLORE_AGENT_NAME) {
            await this.chatWithParallelExplore(userInput);
            return;
          }

          debugLog('Making API call to OpenAI with model:', this.model);
          debugLog('Messages count:', this.messages.length);
          debugLog('Last few messages:', this.messages.slice(-3));

          // Create AbortController for this request
          this.currentAbortController = new AbortController();

          const options: ChatCompletionOptions = {
            model: this.model,
            messages: this.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
            temperature: this.temperature,
            max_tokens: 8000,
            tools: this.getToolSchemas(),
            tool_choice: 'auto',
            stream: true,
            stream_options: { include_usage: true },
            signal: this.currentAbortController.signal,
          };

          // Prepare API request payload for debug logging
          const apiRequestPayload = buildChatCompletionPayload(options);

          debugLog('OpenAI chat completion request payload:', apiRequestPayload);

          // Log equivalent curl command
          this.requestCount++;
          const curlCommand = generateDebugCurlCommand(this.apiKey!, apiRequestPayload, this.requestCount);
          if (curlCommand) {
            debugLog('Equivalent curl command:', curlCommand);
          }

          const response = await this.createStreamingResponse(options);

          debugLog('Full streaming API response accumulated:', response);
          debugLog('Response usage:', response.usage);
          debugLog('Response finish_reason:', response.finishReason);

          const message = {
            content: response.content,
            tool_calls: response.toolCalls,
          };
          const modelReasoning = response.reasoning;

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

          if (response.finishReason !== 'stop' && response.finishReason !== 'tool_calls') {
            debugLog('WARNING - Unexpected finish_reason:', response.finishReason);
          }

          // Handle tool calls if present
          if (message.tool_calls) {
            // Show thinking text or model reasoning if present
            if ((message.content || modelReasoning) && !response.streamedMessageId) {
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
                name: tc.function.name,
                arguments: tc.function.arguments
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
                  name: toolCallRequest.function.name,
                  arguments: toolCallRequest.function.arguments
                }
              };
              const callbacks: ToolExecutorCallbacks = {
                onToolStart: this.onToolStart,
                onToolEnd: this.onToolEnd,
                onToolApproval: this.onToolApproval,
                onQuestion: this.onQuestion,
              };
              
              const options: ToolExecutorOptions = {
                sessionAutoApprove: this.sessionAutoApprove,
                isInterrupted: this.isInterrupted,
                codingAgent: this.codingAgent,
              };
              
              const result = await executeToolCall(toolCall, callbacks, options);

              // Add tool result to conversation (including rejected ones)
              this.messages.push({
                role: 'tool',
                tool_call_id: toolCallRequest.id,
                content: JSON.stringify(result),
              });

              // Check if user rejected the tool, if so, stop processing
              if (result.userRejected) {
                // Add a note to the conversation that the user rejected the tool
                const toolName = toolCallRequest.function.name || 'unknown tool';
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

          if (this.onFinalMessage && !response.streamedMessageId) {
            debugLog('Calling onFinalMessage callback');
            this.onFinalMessage(content, modelReasoning);
          } else if (response.streamedMessageId) {
            debugLog('Final message was already streamed to UI');
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

function cloneMessages(messages: Message[]): Message[] {
  return JSON.parse(JSON.stringify(messages)) as Message[];
}

function getStringField(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' ? field : undefined;
}
