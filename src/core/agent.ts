import OpenAI from 'openai';
import type { ClientOptions } from 'openai';
import fs from 'fs';
import path from 'path';
import { ALL_TOOL_SCHEMAS, type ToolSchema } from '../tools/schemas/index.js';
import ConfigManager from '../config/ConfigManager.js';
import { Message, ToolCall, ApiError, messageContentToString } from './messages.js';
import { debugLog, setDebugLoggingEnabled } from './logger.js';
import { buildModelRequestPayload, createStreamingChatCompletion, type ChatCompletionOptions } from './openai-helper.js';
import { executeToolCall, ToolExecutorCallbacks, ToolExecutorOptions } from './tool-executor.js';
import type { ToolResult } from '../tools/files.js';
import type { ToolBackend } from '../tools/backend.js';
import { LocalToolBackend } from '../tools/backend.js';
import { getWorkspaceRoot, isInsideWorkspace, setWorkspaceRoot } from '../tools/workspace-path.js';
import { QuestionAnswer, QuestionPrompt } from '../tools/question.js';
import { buildSkillContextForExplore, findMatchingSkillsForPrompt, listSkills, skillDescriptionSuffix, skillSystemPrompt } from './skills.js';
import {
  CodingAgentInfo,
  EXPLORE_LEGACY_AGENT_NAME,
  getToolPermissionAction,
  getToolPermissionKey,
  loadCodingAgents,
  resolveCodingAgent,
} from './coding-agents.js';
import { RESEARCH_LOOP_AGENTS, applyResearchToolDefaults, buildResearchOrientation, isResearchToolAllowed, renderToolResultForModel } from './research.js';
import { runParallelExplore, type ExploreProgressEvent } from './explore-runner.js';
import { getMCPToolSchemas } from '../mcp/tools.js';
import { getMCPManager, initializeMCPServers } from '../mcp/client.js';
import { buildUserMessageContent } from './image-attachments.js';



export interface AgentCreateOptions {
  cwd?: string;
  toolBackend?: ToolBackend;
  configDir?: string;
  skipMcp?: boolean;
}

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

  private toolBackend: ToolBackend = new LocalToolBackend();

  private mcpSchemas: ToolSchema[] = [];

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
    cached_prompt_tokens?: number;
    total_time?: number;
  }) => void;

  private onExploreProgress?: (event: ExploreProgressEvent) => void;

  private onError?: (error: string) => Promise<boolean>;

  private requestCount: number = 0;
  private readonly customSystemMessage: string | null;

  private currentAbortController: AbortController | null = null;

  private isInterrupted: boolean = false;

  private constructor(
    model: string,
    temperature: number,
    systemMessage: string | null,
    codingAgent: CodingAgentInfo,
    debug?: boolean,
    configDir?: string,
  ) {
    this.customSystemMessage = systemMessage;
    this.model = model;
    this.temperature = temperature;
    this.codingAgent = codingAgent;
    this.configManager = new ConfigManager(configDir);

    // Set debug mode
    setDebugLoggingEnabled(debug || false);

    this.systemMessage = this.composeSystemMessage();

    // Add system message to conversation
    this.messages.push({ role: 'system', content: this.systemMessage });
    this.loadProjectContextMessages();

    this.baseMessages = cloneMessages(this.messages);
  }

  private isResearchAgent(): boolean {
    return RESEARCH_LOOP_AGENTS.has(this.codingAgent.name);
  }

  /** Research keeps its method even when a caller supplies operator instructions; other agents are replaced by them. */
  private composeSystemMessage(): string {
    const agentPrompt = this.codingAgent.prompt
      ? this.buildAgentSystemMessage(this.codingAgent.prompt)
      : this.buildDefaultSystemMessage();
    if (!this.customSystemMessage) return agentPrompt;
    if (!this.isResearchAgent()) return this.customSystemMessage;
    return `${agentPrompt}\nOperator instructions (apply together with the research method above):\n${this.customSystemMessage.trim()}\n`;
  }

  static async create(
    model: string,
    temperature: number,
    systemMessage: string | null,
    debug?: boolean,
    codingAgentName?: string | null,
    options?: AgentCreateOptions,
  ): Promise<Agent> {
    if (options?.cwd) {
      setWorkspaceRoot(options.cwd);
    }

    // Check for default model in config if model not explicitly provided
    const configManager = new ConfigManager(options?.configDir);
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
      options?.configDir,
    );
    agent.toolBackend = options?.toolBackend ?? new LocalToolBackend();

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

    try {
      if (!options?.skipMcp) {
        await initializeMCPServers();
        debugLog('MCP servers initialized');
      }
      if (agent.toolBackend.listMcpSchemas) {
        agent.mcpSchemas = await agent.toolBackend.listMcpSchemas();
      }
    } catch (error) {
      debugLog('MCP initialization failed:', error);
    }

    return agent;
  }

  private buildDefaultSystemMessage(): string {
    const skills = skillSystemPrompt(this.configManager.getSkillsConfig());
    const chromaTools = getMCPToolSchemas().some((tool) => tool.function.name.startsWith('mcp__chroma__'));
    const chromaGuidance = chromaTools
      ? `
Chroma image editing (mcp__chroma__*):
- Only call Chroma tools the user asked for. "Open in Chroma" → open_image only, then stop. Do not get_snapshot, set_params, set_geometry, or export unless the user requested inspect/edit/export.
- When the user does ask to edit: open if needed → get_snapshot once if you need vision → one set_geometry and/or set_params → optional one verify snapshot → export only if asked.
- Crop is ALWAYS absolute on the full oriented source (0...1 top-left) and replaces any previous crop. Snapshots of a cropped image are NOT a new crop coordinate space. One crop attempt; if wrong, crop:null then one absolute redo, then stop and ask.
- Param neutrals: highlights=1, shadows=0, contrast=1, saturation=1, exposure=0, blackPoint=0, whitePoint=1, midtone=1. Never invent an "auto enhance" unless the user asked. If crushed/black after an edit, reset_params.
`
      : '';
    return `You are a coding and everyday office work assistant powered by ${this.model}. You have access to various tools for coding tasks. Always use these tools for any implementation requests—never reply with text-only responses or code snippets when the task requires actual files.

Tool workspace root: . (use repository-relative paths; do not prepend a displayed directory name).

Treat the current working directory as the default scope for local file work. For vague requests like "find a photo", "open the image", or "what's in here", search or list the current working directory first (glob/list_files) before asking where to look.
${skills ? `\n${skills}\n` : ''}${chromaGuidance}
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
- Local image paths in the user message are attached as vision input automatically. Describe them from the attached image; do not call open_file or read_file just to "see" an image.

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
    const skills = skillSystemPrompt(this.configManager.getSkillsConfig());
    return `${prompt.trim()}

Tool workspace root: . (use repository-relative paths; do not prepend a displayed directory name).

Treat the current working directory as the default scope for local file work. For vague requests like "find a photo", "open the image", or "what's in here", search or list the current working directory first (glob/list_files) before asking where to look.
${skills ? `\n${skills}\n` : ''}
`;
  }

  private loadProjectContextMessages(): void {
    if (this.isResearchAgent()) {
      const orientation = buildResearchOrientation(getWorkspaceRoot());
      if (orientation) this.messages.push({ role: 'system', content: orientation });
    }
    try {
      const customContextFilePath = process.env.OPENAI_CONTEXT_FILE;
      const baseDir = process.env.OPENAI_CONTEXT_DIR || process.cwd();
      const contextPath = customContextFilePath || path.join(baseDir, '.cobot', 'context.md');
      if (!isInsideWorkspace(contextPath)) {
        return;
      }
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
    onApiUsage?: (usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cached_prompt_tokens?: number; total_time?: number }) => void;
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
    responseOutput?: Message['responseOutput'];
    reasoning?: string;
    toolCalls?: ToolCall[];
    streamedMessageId?: string;
    finishReason?: string | null;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      cached_prompt_tokens?: number;
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
    let responseOutput: Message['responseOutput'];
    let content = '';
    let reasoning = '';
    let streamedMessageId: string | undefined;
    let finishReason: string | null | undefined;
    let usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cached_prompt_tokens?: number } | undefined;

    for await (const chunk of stream) {
      if (chunk.responseOutput) responseOutput = chunk.responseOutput;
      if (chunk.usage) {
        usage = {
          prompt_tokens: chunk.usage.prompt_tokens,
          completion_tokens: chunk.usage.completion_tokens,
          total_tokens: chunk.usage.total_tokens,
          cached_prompt_tokens: chunk.usage.prompt_tokens_details?.cached_tokens,
        };
      }

      const choice = chunk.choices[0];
      if (!choice) {
        continue;
      }

      finishReason = choice.finish_reason ?? finishReason;
      const delta = choice.delta;
      if (!delta) {
        continue;
      }

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
      responseOutput,
      reasoning: reasoning || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      streamedMessageId,
      finishReason,
      usage,
    };
  }

  /** Normalizes a model tool call; research fills in discovery-friendly search defaults the model omitted. */
  private prepareToolCall(toolCallRequest: ToolCall): ToolCall {
    const name = toolCallRequest.function.name.startsWith('repo_browser.')
      ? toolCallRequest.function.name.slice('repo_browser.'.length)
      : toolCallRequest.function.name;
    let args = toolCallRequest.function.arguments;
    if (this.isResearchAgent()) {
      try {
        const parsed = args ? JSON.parse(args) as Record<string, unknown> : {};
        args = JSON.stringify(applyResearchToolDefaults(name, parsed));
      } catch {
        // Leave truncated arguments untouched so the executor reports the parse error.
      }
    }
    return { id: toolCallRequest.id, type: toolCallRequest.type, function: { name, arguments: args } };
  }

  private isParallelSafeTool(toolName: string): boolean {
    if (this.isResearchAgent() && !isResearchToolAllowed(toolName)) return false;
    return getToolPermissionKey(toolName) === 'read' && getToolPermissionAction(toolName, this.codingAgent) === 'allow';
  }

  private getToolSchemas(): OpenAI.Chat.Completions.ChatCompletionTool[] {
    const builtinSchemas: ToolSchema[] = ALL_TOOL_SCHEMAS.filter((toolSchema) => getToolPermissionAction(toolSchema.function.name, this.codingAgent) !== 'deny')
      .filter((toolSchema) => !this.isResearchAgent() || isResearchToolAllowed(toolSchema.function.name))
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

    const mcpSchemas = (this.mcpSchemas.length > 0 ? this.mcpSchemas : getMCPToolSchemas()).filter(
      (toolSchema) => getToolPermissionAction(toolSchema.function.name, this.codingAgent) !== 'deny',
    );

    return [...builtinSchemas, ...mcpSchemas] as OpenAI.Chat.Completions.ChatCompletionTool[];
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
    if (nextAgent.name === this.codingAgent.name) return;
    this.codingAgent = nextAgent;

    if (nextAgent.model) {
      this.model = nextAgent.model;
    }
    if (nextAgent.temperature !== undefined) {
      this.temperature = nextAgent.temperature;
    }

    this.systemMessage = this.composeSystemMessage();
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
      this.systemMessage = messageContentToString(firstSystemMessage.content);
    }
  }

  private updateDefaultSystemMessageForModel(): void {
    const previousSystemMessage = this.systemMessage;
    const newSystemMessage = this.composeSystemMessage();
    this.systemMessage = newSystemMessage;
    for (const messages of [this.baseMessages, this.messages]) {
      const systemMessage = messages.find(msg => msg.role === 'system' && messageContentToString(msg.content) === previousSystemMessage);
      if (systemMessage) systemMessage.content = newSystemMessage;
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
      config: this.configManager,
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

    // Add user message (local image paths become multimodal vision attachments)
    const { content: userContent, attachedImages } = await buildUserMessageContent(userInput);
    if (attachedImages.length > 0) {
      debugLog('Attached images for vision:', attachedImages.map((image) => ({
        filePath: image.filePath,
        mimeType: image.mimeType,
        byteLength: image.byteLength,
      })));
    }
    this.messages.push({ role: 'user', content: userContent });

    const maxToolIterations = 50;
    const maxConsecutiveApiFailures = 3;
    let currentIteration = 0;
    let consecutiveApiFailures = 0;

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

          if (this.codingAgent.name === EXPLORE_LEGACY_AGENT_NAME) {
            await this.chatWithParallelExplore(userInput);
            return;
          }

          debugLog('Making API call to OpenAI with model:', this.model);
          debugLog('Messages count:', this.messages.length);
          debugLog('Last few messages:', this.messages.slice(-3));

          // Create AbortController for this request
          this.currentAbortController = new AbortController();

	  const finalRound = currentIteration === maxToolIterations - 1;
	  // Request-only guidance: do not accumulate one budget message per round in history.
	  const budgetMessage: Message = {
	    role: 'system',
	    content: [
	      `Round ${currentIteration + 1} of ${maxToolIterations}; ${maxToolIterations - currentIteration - 1} rounds remain after this response. The last round is reserved for your answer.`,
	      'For codebase questions, identify the requested conclusions and the unresolved evidence needed for each. Before another search, identify which unresolved conclusion it will support.',
	      'For integration questions, trace the public entry point through authorization, input validation, response construction, and relevant state transitions. Verify exact status codes, field meanings, and completion semantics in implementation; documentation and analogous features alone are not sufficient.',
		      'Check each requested conclusion against that evidence before answering. A failed or narrowly scoped search does not prove a feature or test is absent; disclose uncertainty. Prefer the shortest supported integration path and avoid optional alternatives that the question does not need.',
		      'Once the requested conclusions have implementation evidence and relevant test coverage has been inspected, answer; do not audit adjacent features unless needed to resolve a remaining claim.',
	      'Use numbered read_file results directly for citations. Prefer focused queries and bounded file ranges.',
	      'search_files is literal by default; set pattern_type="regex" for alternatives like A|B. Treat the tool workspace root as "." and use relative paths.',
	      finalRound
		? 'No more tools are available. Answer now using the evidence gathered, explicitly disclose gaps, and distinguish inspected tests from executed tests.'
		: 'If the question is already supported, give the answer now.',
	    ].join('\n'),
	  };
          const options: ChatCompletionOptions = {
	    config: this.configManager,
            model: this.model,
	    messages: [...this.messages, budgetMessage] as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
            temperature: this.temperature,
            max_tokens: 8000,
            tools: this.getToolSchemas(),
	    tool_choice: finalRound ? 'none' : 'auto',
            stream: true,
            stream_options: { include_usage: true },
            signal: this.currentAbortController.signal,
          };

          // Prepare API request payload for debug logging
	  const apiRequestPayload = buildModelRequestPayload(options);

	  debugLog('OpenAI model request payload:', apiRequestPayload);

          // Log equivalent curl command
          this.requestCount++;
          const curlCommand = generateDebugCurlCommand(this.apiKey!, apiRequestPayload, this.requestCount);
          if (curlCommand) {
            debugLog('Equivalent curl command:', curlCommand);
          }

          const response = await this.createStreamingResponse(options);
          consecutiveApiFailures = 0;

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
              cached_prompt_tokens: response.usage.cached_prompt_tokens,
            });
          }
          debugLog('Message content length:', message.content?.length || 0);
          debugLog('Message has tool_calls:', !!message.tool_calls);
          debugLog('Message tool_calls count:', message.tool_calls?.length || 0);

          if (response.finishReason !== 'stop' && response.finishReason !== 'tool_calls') {
            debugLog('WARNING - Unexpected finish_reason:', response.finishReason);
          }

          // Handle tool calls if present
	  if (message.tool_calls?.length) {
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
	      responseOutput: response.responseOutput,
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

            // Execute tool calls — all tool role messages must follow the assistant
            // tool_calls message with no other roles in between (OpenAI/Azure requirement).
            const pendingVisionImages: Array<{ mimeType: string; base64: string }> = [];
            const toolCalls = message.tool_calls || [];
            const callbacks: ToolExecutorCallbacks = {
              onToolStart: this.onToolStart,
              onToolEnd: this.onToolEnd,
              onToolApproval: this.onToolApproval,
              onQuestion: this.onQuestion,
            };
            const executorOptions: ToolExecutorOptions = {
              sessionAutoApprove: this.sessionAutoApprove,
              isInterrupted: this.isInterrupted,
              codingAgent: this.codingAgent,
              toolBackend: this.toolBackend,
            };
            const prepared = toolCalls.map((toolCallRequest) => this.prepareToolCall(toolCallRequest));
            // Read-only calls that need no approval are independent: run them concurrently, keep result order.
            const parallelResults = prepared.length > 1 && prepared.every((toolCall) => this.isParallelSafeTool(toolCall.function.name))
              ? await Promise.all(prepared.map((toolCall) => executeToolCall(toolCall, callbacks, executorOptions)))
              : null;

            for (let toolIndex = 0; toolIndex < toolCalls.length; toolIndex++) {
              const toolCallRequest = toolCalls[toolIndex];

              // Check for interruption before each tool execution
              if (this.isInterrupted) {
                debugLog('Tool execution interrupted by user');
                for (let rest = toolIndex; rest < toolCalls.length; rest++) {
                  this.messages.push({
                    role: 'tool',
                    tool_call_id: toolCalls[rest].id,
                    content: JSON.stringify({
                      success: false,
                      error: 'Tool execution interrupted by user',
                      userRejected: true,
                    }),
                  });
                }
                this.currentAbortController = null;
                return;
              }

              const toolCall = prepared[toolIndex];
              const result: ToolResult = this.isResearchAgent() && !isResearchToolAllowed(toolCall.function.name)
                ? { success: false, error: `Tool ${toolCall.function.name} is not available to the research agent` }
                : parallelResults
                  ? parallelResults[toolIndex]
                  : await executeToolCall(toolCall, callbacks, { ...executorOptions, isInterrupted: this.isInterrupted });
              const visionImage = (result as { visionImage?: { mimeType: string; base64: string } }).visionImage;
              const { visionImage: _omitVision, ...toolPayload } = result as unknown as Record<string, unknown>;

              // Add tool result to conversation (including rejected ones)
              this.messages.push({
                role: 'tool',
                tool_call_id: toolCallRequest.id,
                content: this.isResearchAgent()
                  ? renderToolResultForModel(toolCall.function.name, toolPayload as unknown as ToolResult)
                  : JSON.stringify(toolPayload),
              });

              if (visionImage?.base64) {
                pendingVisionImages.push(visionImage);
              }

              // Check if user rejected the tool, if so, respond to remaining tool_calls then stop
              if (result.userRejected) {
                for (let rest = toolIndex + 1; rest < toolCalls.length; rest++) {
                  this.messages.push({
                    role: 'tool',
                    tool_call_id: toolCalls[rest].id,
                    content: JSON.stringify({
                      success: false,
                      error: 'Tool execution canceled because a prior tool was rejected',
                      userRejected: true,
                    }),
                  });
                }
                const toolName = toolCallRequest.function.name || 'unknown tool';
                this.messages.push({
                  role: 'system',
                  content: `The user rejected the ${toolName} tool execution. The response has been terminated. Please wait for the user's next instruction.`,
                });
                return;
              }
            }

            // Attach Chroma snapshots after the full tool-result block so message order stays valid.
            for (const visionImage of pendingVisionImages) {
              this.messages.push({
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: 'Chroma snapshot for vision (reference only). Do not edit unless the user asked for edits.',
                  },
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:${visionImage.mimeType};base64,${visionImage.base64}`,
                      detail: 'high',
                    },
                  },
                ],
              });
            }

            // Continue loop to get model response to tool results
            currentIteration++;
            continue;
          }

          // No tool calls, this is the final response
          const content = message.content || '';
	  if (!content.trim()) throw new Error('Model returned an empty final answer');
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
	    responseOutput: response.responseOutput,
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
            // Unattended: identical provider failures must not consume the whole round budget.
            consecutiveApiFailures++;
            if (consecutiveApiFailures >= maxConsecutiveApiFailures) {
              throw new Error(`${errorMessage} (${consecutiveApiFailures} consecutive failures)`);
            }
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
	  throw new Error(`Agent exhausted the ${maxToolIterations}-round limit without a final answer`);
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
