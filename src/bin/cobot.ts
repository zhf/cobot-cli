#!/usr/bin/env bun
import { Command } from 'commander';
import { resumeChat, startChat } from '../cli/startChat.js';
import { runPrompt } from '../cli/runPrompt.js';
import { buildPromptWithStdin } from '../cli/promptInput.js';
import ConfigManager, { ExploreThinkingMode, ExploreAdaptiveConfig } from '../config/ConfigManager.js';
import { SeeyonChatClient, SeeyonChatError } from '../core/seeyon-chat.js';
import { writeProjectContext } from '../utils/context/projectContext.js';
import { formatCodingAgentList, loadCodingAgents, resolveCodingAgent, YOLO_AGENT_NAME } from '../core/coding-agents.js';

interface GlobalOptions {
  temperature: number;
  model: string;
  system?: string;
  debug?: boolean;
  prompt?: string;
  agent?: string;
  yolo?: boolean;
}

interface RunOptions {
  agent?: string;
  yolo?: boolean;
  model?: string;
  temperature?: number;
  system?: string;
  debug?: boolean;
  output?: 'text' | 'ndjson';
}

function getGlobalOptions(): GlobalOptions {
  return program.opts() as GlobalOptions;
}

function maskSecret(secret: string | null): string {
  if (!secret) {
    return 'not set';
  }

  if (secret.length <= 8) {
    return 'set';
  }

  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

function exitWithError(message: string): never {
  console.error(message);
  process.exit(1);
}

function resolveAgentOption(options: GlobalOptions, commandAgent?: string, commandYolo?: boolean): string | null {
  if (commandYolo || options.yolo) {
    return YOLO_AGENT_NAME;
  }

  return commandAgent || options.agent || null;
}

async function runPromptCommand(prompt: string): Promise<void> {
  const options = getGlobalOptions();

  await runPrompt(
    prompt,
    options.model,
    options.temperature,
    options.system || null,
    options.debug,
    resolveAgentOption(options),
    'text',
  );
}

async function runPromptCommandWithRunOptions(prompt: string, runOptions: RunOptions): Promise<void> {
  const globalOptions = getGlobalOptions();
  const model = runOptions.model || globalOptions.model;
  const temperature = runOptions.temperature ?? globalOptions.temperature;
  const system = runOptions.system || globalOptions.system || null;
  const debug = runOptions.debug || globalOptions.debug;
  const outputMode = runOptions.output || 'text';
  const agent = runOptions.agent || globalOptions.agent;
  const yolo = runOptions.yolo || globalOptions.yolo;

  await runPrompt(
    prompt,
    model,
    temperature,
    system,
    debug,
    resolveAgentOption({ ...globalOptions, agent, yolo }, agent, yolo),
    outputMode,
  );
}

function printConfig(): void {
  const configManager = new ConfigManager();

  console.log(`apikey: ${maskSecret(configManager.getApiKey())}`);
  console.log(`baseurl: ${configManager.getBaseURL() || 'not set'}`);
  console.log(`model: ${configManager.getDefaultModel() || 'not set'}`);
  console.log(`defaultAgent: ${configManager.getDefaultAgent() || 'not set'}`);
  console.log(`theme: ${configManager.getTheme()}`);
  console.log(`skills.paths: ${configManager.getSkillsConfig().paths?.join(', ') || 'not set'}`);
  console.log(`extraRequest: ${configManager.getExtraRequestString() || 'not set'}`);
  console.log(`seeyonChatApiKey: ${maskSecret(configManager.getSeeyonChatApiKey())}`);
  console.log(`seeyonChatEndpoint: ${configManager.getSeeyonChatEndpoint()}`);
  const rerankConfig = configManager.getExploreRerankConfig();
  if (rerankConfig) {
    console.log(`explore.rerank.model: ${rerankConfig.model}`);
    console.log(`explore.rerank.apiKey: ${maskSecret(rerankConfig.apiKey || null)}`);
    console.log(`explore.rerank.baseURL: ${rerankConfig.baseURL}`);
    console.log(`explore.rerank.topN: ${rerankConfig.topN}`);
    console.log(`explore.rerank.perRole: ${rerankConfig.perRole}`);
    console.log(`explore.rerank.timeoutMs: ${rerankConfig.timeoutMs}`);
    console.log(`explore.rerank.instruct: ${rerankConfig.instruct}`);
  } else {
    console.log('explore.rerank: not set');
  }
  const thinkingConfig = configManager.getExploreThinkingConfig();
  console.log(`explore.thinking.worker: ${thinkingConfig.worker}`);
  console.log(`explore.thinking.synthesis: ${thinkingConfig.synthesis}`);
  const adaptiveConfig = configManager.getExploreAdaptiveConfig();
  console.log(`explore.adaptive.minHighPriorityFiles: ${adaptiveConfig.minHighPriorityFiles}`);
  console.log(`explore.adaptive.minDeclarationEvidence: ${adaptiveConfig.minDeclarationEvidence}`);
  console.log(`explore.adaptive.maxLowSignalRatio: ${adaptiveConfig.maxLowSignalRatio}`);
  const scanConfig = configManager.getExploreScanConfig();
  console.log(`explore.scan.maxFiles: ${scanConfig.maxFiles}`);
  console.log(`explore.scan.recentFirst: ${scanConfig.recentFirst}`);
  console.log(`explore.scan.multiRepoMinDirs: ${scanConfig.multiRepoMinDirs}`);
  console.log(`explore.scan.perRepoMaxFiles: ${scanConfig.perRepoMaxFiles}`);
  console.log(`explore.scan.ignoreDirs: ${scanConfig.ignoreDirs.join(', ')}`);
  console.log(`explore.scan.honorGitignore: ${scanConfig.honorGitignore}`);
}

function setConfigValue(key: string, value: string): void {
  const configManager = new ConfigManager();

  switch (key.toLowerCase()) {
    case 'apikey':
    case 'api-key':
      configManager.setApiKey(value);
      console.log('API key saved.');
      break;
    case 'baseurl':
    case 'base-url':
      configManager.setBaseURL(value);
      console.log('Base URL saved.');
      break;
    case 'model':
      configManager.setDefaultModel(value);
      console.log('Default model saved.');
      break;
    case 'defaultagent':
    case 'default-agent':
      resolveCodingAgent(value, null, configManager.getCodingAgents());
      configManager.setDefaultAgent(value);
      console.log('Default coding agent saved.');
      break;
    case 'theme':
      if (value !== 'dark' && value !== 'light') {
        exitWithError('Theme must be "dark" or "light".');
      }
      configManager.setTheme(value);
      console.log('Theme saved.');
      break;
    case 'extrarequest':
    case 'extra-request':
      configManager.setExtraRequest(value);
      console.log('Extra request payload saved.');
      break;
    case 'seeyonchatapikey':
    case 'seeyon-chat-api-key':
      configManager.setSeeyonChatApiKey(value);
      console.log('Seeyon Chat API key saved.');
      break;
    case 'seeyonchatendpoint':
    case 'seeyon-chat-endpoint':
      configManager.setSeeyonChatEndpoint(value);
      console.log('Seeyon Chat endpoint saved.');
      break;
    case 'explore.rerank.model':
    case 'explorererankmodel':
    case 'explore-rerank-model':
      configManager.setExploreRerankConfig({ model: value });
      console.log('Explore rerank model saved.');
      break;
    case 'explore.rerank.apikey':
    case 'explore.rerank.api-key':
    case 'explorererankapikey':
    case 'explore-rerank-api-key':
      configManager.setExploreRerankConfig({ apiKey: value });
      console.log('Explore rerank API key saved.');
      break;
    case 'explore.rerank.baseurl':
    case 'explore.rerank.base-url':
    case 'explorererankbaseurl':
    case 'explore-rerank-base-url':
      configManager.setExploreRerankConfig({ baseURL: value });
      console.log('Explore rerank base URL saved.');
      break;
    case 'explore.rerank.topn':
    case 'explorereranktopn':
    case 'explore-rerank-top-n': {
      const parsedTopN = Number(value);
      if (!Number.isFinite(parsedTopN) || parsedTopN <= 0) {
        exitWithError('explore.rerank.topN must be a positive number.');
      }
      configManager.setExploreRerankConfig({ topN: Math.floor(parsedTopN) });
      console.log('Explore rerank topN saved.');
      break;
    }
    case 'explore.rerank.perrole':
    case 'explorererankperrole':
    case 'explore-rerank-per-role': {
      const parsedPerRole = Number(value);
      if (!Number.isFinite(parsedPerRole) || parsedPerRole <= 0) {
        exitWithError('explore.rerank.perRole must be a positive number.');
      }
      configManager.setExploreRerankConfig({ perRole: Math.floor(parsedPerRole) });
      console.log('Explore rerank perRole saved.');
      break;
    }
    case 'explore.rerank.timeoutms':
    case 'explorereranktimeoutms':
    case 'explore-rerank-timeout-ms': {
      const parsedTimeout = Number(value);
      if (!Number.isFinite(parsedTimeout) || parsedTimeout <= 0) {
        exitWithError('explore.rerank.timeoutMs must be a positive number.');
      }
      configManager.setExploreRerankConfig({ timeoutMs: Math.floor(parsedTimeout) });
      console.log('Explore rerank timeoutMs saved.');
      break;
    }
    case 'explore.rerank.instruct':
    case 'explorererankinstruct':
    case 'explore-rerank-instruct':
      configManager.setExploreRerankConfig({ instruct: value });
      console.log('Explore rerank instruct saved.');
      break;
    case 'explore.thinking.worker':
    case 'explorethinkingworker':
    case 'explore-thinking-worker':
      if (!isExploreThinkingMode(value)) {
        exitWithError('explore.thinking.worker must be "default" or "disabled".');
      }
      configManager.setExploreThinkingConfig({ worker: value as ExploreThinkingMode });
      console.log('Explore thinking worker mode saved.');
      break;
    case 'explore.thinking.synthesis':
    case 'explorethinkingsynthesis':
    case 'explore-thinking-synthesis':
      if (!isExploreThinkingMode(value)) {
        exitWithError('explore.thinking.synthesis must be "default" or "disabled".');
      }
      configManager.setExploreThinkingConfig({ synthesis: value as ExploreThinkingMode });
      console.log('Explore thinking synthesis mode saved.');
      break;
    case 'explore.adaptive.minHighPriorityFiles':
    case 'exploreadaptive.minhighpriorityfiles':
    case 'explore-adaptive-min-high-priority-files':
    case 'explore.adaptive.minhighpriorityfiles': {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        exitWithError('explore.adaptive.minHighPriorityFiles must be a non-negative number.');
      }
      configManager.setExploreAdaptiveConfig({ minHighPriorityFiles: Math.floor(parsed) });
      console.log('Explore adaptive minHighPriorityFiles saved.');
      break;
    }
    case 'explore.adaptive.minDeclarationEvidence':
    case 'exploreadaptive.mindeclarationevidence':
    case 'explore-adaptive-min-declaration-evidence':
    case 'explore.adaptive.mindeclarationevidence': {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        exitWithError('explore.adaptive.minDeclarationEvidence must be a non-negative number.');
      }
      configManager.setExploreAdaptiveConfig({ minDeclarationEvidence: Math.floor(parsed) });
      console.log('Explore adaptive minDeclarationEvidence saved.');
      break;
    }
    case 'explore.adaptive.maxLowSignalRatio':
    case 'exploreadaptive.maxlowsignalratio':
    case 'explore-adaptive-max-low-signal-ratio':
    case 'explore.adaptive.maxlowsignalratio': {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
        exitWithError('explore.adaptive.maxLowSignalRatio must be a number between 0 and 1.');
      }
      configManager.setExploreAdaptiveConfig({ maxLowSignalRatio: parsed });
      console.log('Explore adaptive maxLowSignalRatio saved.');
      break;
    }
    case 'explore.scan.maxfiles':
    case 'explore.scan.max-files':
    case 'explorescanmaxfiles':
    case 'explore-scan-max-files': {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        exitWithError('explore.scan.maxFiles must be a positive number.');
      }
      configManager.setExploreScanConfig({ maxFiles: Math.floor(parsed) });
      console.log('Explore scan maxFiles saved.');
      break;
    }
    case 'explore.scan.recentfirst':
    case 'explore.scan.recent-first':
    case 'explorescanrecentfirst':
    case 'explore-scan-recent-first': {
      const normalized = value.trim().toLowerCase();
      if (normalized !== 'true' && normalized !== 'false') {
        exitWithError('explore.scan.recentFirst must be "true" or "false".');
      }
      configManager.setExploreScanConfig({ recentFirst: normalized === 'true' });
      console.log('Explore scan recentFirst saved.');
      break;
    }
    case 'explore.scan.multirepomindirs':
    case 'explore.scan.multi-repo-min-dirs':
    case 'explorescanmultirepomindirs':
    case 'explore-scan-multi-repo-min-dirs': {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        exitWithError('explore.scan.multiRepoMinDirs must be a positive number.');
      }
      configManager.setExploreScanConfig({ multiRepoMinDirs: Math.floor(parsed) });
      console.log('Explore scan multiRepoMinDirs saved.');
      break;
    }
    case 'explore.scan.perrepomaxfiles':
    case 'explore.scan.per-repo-max-files':
    case 'explorescanperrepomaxfiles':
    case 'explore-scan-per-repo-max-files': {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        exitWithError('explore.scan.perRepoMaxFiles must be a positive number.');
      }
      configManager.setExploreScanConfig({ perRepoMaxFiles: Math.floor(parsed) });
      console.log('Explore scan perRepoMaxFiles saved.');
      break;
    }
    case 'explore.scan.ignoredirs':
    case 'explore.scan.ignore-dirs':
    case 'explorescanignoredirs':
    case 'explore-scan-ignore-dirs': {
      let ignoreDirs: string[];
      const trimmed = value.trim();
      if (trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
            exitWithError('explore.scan.ignoreDirs must be a JSON array of strings.');
          }
          ignoreDirs = parsed.map((item: string) => item.trim()).filter((item: string) => item.length > 0);
        } catch {
          exitWithError('explore.scan.ignoreDirs must be valid JSON array or comma-separated directory names.');
        }
      } else {
        ignoreDirs = trimmed.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
      }
      if (ignoreDirs.length === 0) {
        exitWithError('explore.scan.ignoreDirs must include at least one directory name.');
      }
      configManager.setExploreScanConfig({ ignoreDirs });
      console.log('Explore scan ignoreDirs saved.');
      break;
    }
    case 'explore.scan.honorgitignore':
    case 'explore.scan.honor-gitignore':
    case 'explorescanhonorgitignore':
    case 'explore-scan-honor-gitignore': {
      const normalized = value.trim().toLowerCase();
      if (normalized !== 'true' && normalized !== 'false') {
        exitWithError('explore.scan.honorGitignore must be "true" or "false".');
      }
      configManager.setExploreScanConfig({ honorGitignore: normalized === 'true' });
      console.log('Explore scan honorGitignore saved.');
      break;
    }
    default:
      exitWithError(`Unknown config key: ${key}`);
  }
}

function isExploreThinkingMode(value: string): value is ExploreThinkingMode {
  return value === 'default' || value === 'disabled';
}

function clearConfigValue(key: string): void {
  const configManager = new ConfigManager();

  switch (key.toLowerCase()) {
    case 'apikey':
    case 'api-key':
      configManager.clearApiKey();
      console.log('API key cleared.');
      break;
    case 'baseurl':
    case 'base-url':
      configManager.clearBaseURL();
      console.log('Base URL cleared.');
      break;
    case 'defaultagent':
    case 'default-agent':
      configManager.clearDefaultAgent();
      console.log('Default coding agent cleared.');
      break;
    case 'extrarequest':
    case 'extra-request':
      configManager.clearExtraRequest();
      console.log('Extra request payload cleared.');
      break;
    case 'seeyonchatapikey':
    case 'seeyon-chat-api-key':
      configManager.clearSeeyonChatApiKey();
      console.log('Seeyon Chat API key cleared.');
      break;
    case 'seeyonchatendpoint':
    case 'seeyon-chat-endpoint':
      configManager.clearSeeyonChatEndpoint();
      console.log('Seeyon Chat endpoint cleared.');
      break;
    case 'explore.rerank':
    case 'explore-rerank':
    case 'explorererank':
      configManager.clearExploreRerankConfig();
      console.log('Explore rerank config cleared.');
      break;
    case 'explore.thinking':
    case 'explore-thinking':
    case 'explorethinking':
      configManager.clearExploreThinkingConfig();
      console.log('Explore thinking config cleared.');
      break;
    case 'explore.adaptive':
    case 'explore-adaptive':
    case 'exploreadaptive':
      configManager.clearExploreAdaptiveConfig();
      console.log('Explore adaptive config cleared.');
      break;
    case 'explore.scan':
    case 'explore-scan':
    case 'explorescan':
      configManager.clearExploreScanConfig();
      console.log('Explore scan config cleared.');
      break;
    default:
      exitWithError(`Cannot clear config key: ${key}`);
  }
}

async function listSeeyonAgents(): Promise<void> {
  try {
    const client = SeeyonChatClient.fromConfig();
    const agents = await client.listAgents();

    if (agents.length === 0) {
      console.log('No Seeyon Chat agents are accessible for this account.');
      return;
    }

    agents.forEach((agent) => {
      const visibility = agent.public ? 'public' : 'private';
      const description = agent.description ? ` - ${agent.description}` : '';
      console.log(`${agent.name} (${visibility})${description}`);
    });
  } catch (error) {
    handleSeeyonError(error);
  }
}

function listCodingAgents(): void {
  const configManager = new ConfigManager();
  const agents = loadCodingAgents(configManager.getCodingAgents());
  const activeAgent = configManager.getDefaultAgent();
  console.log(formatCodingAgentList(agents, activeAgent || undefined));
}

function setDefaultCodingAgent(agentName: string): void {
  const configManager = new ConfigManager();
  resolveCodingAgent(agentName, null, configManager.getCodingAgents());
  configManager.setDefaultAgent(agentName);
  console.log(`Default coding agent saved: ${agentName}`);
}

async function runSeeyonAgent(agentReference: string, prompt: string): Promise<void> {
  if (!prompt.trim()) {
    exitWithError('Provide a prompt argument or pipe input to stdin.');
  }

  try {
    const client = SeeyonChatClient.fromConfig();
    const agent = await client.resolveAgent(agentReference);
    const result = await client.runAgent(agent._id, { input: prompt });

    console.log(result.content);
  } catch (error) {
    handleSeeyonError(error);
  }
}

function handleSeeyonError(error: unknown): never {
  if (error instanceof SeeyonChatError) {
    exitWithError(`Seeyon Chat error: ${error.message}`);
  }

  const message = error instanceof Error ? error.message : String(error);
  exitWithError(`Seeyon Chat error: ${message}`);
}

const program = new Command();

program
  .name('cobot')
  .usage('[options]')
  .description('Cobot CLI')
  .version('1.0.0')
  .option('-t, --temperature <temperature>', 'Temperature for generation', parseFloat, 1.0)
  .option('-m, --model <model>', 'AI model to use for generation', 'gpt-4o-mini')
  .option('-a, --agent <agent>', 'Coding agent to use')
  .option('--yolo', 'Use the approval-free yolo coding agent')
  .option('-s, --system <message>', 'Custom system message')
  .option('-d, --debug', 'Enable debug logging to debug-agent.log in current directory')
  .option('-p, --prompt <prompt>', 'Run in non-interactive mode with a predefined prompt')
  .showHelpAfterError()
  .showSuggestionAfterError()
  .action(async (options: GlobalOptions) => {
    if (options.prompt) {
      const fullPrompt = await buildPromptWithStdin(options.prompt);

      await runPromptCommand(fullPrompt);
    } else {
      await startChat(
        options.model,
        options.temperature,
        options.system || null,
        options.debug,
        resolveAgentOption(options),
      );
    }
  });

program
  .command('agents')
  .description('List configured coding agents')
  .action(() => {
    listCodingAgents();
  });

program
  .command('agent [agentName]')
  .description('Show or set the default coding agent')
  .action((agentName: string | undefined) => {
    if (agentName) {
      setDefaultCodingAgent(agentName);
    } else {
      listCodingAgents();
    }
  });

program
  .command('bots')
  .description('List Seeyon Chat bots accessible to the configured account')
  .action(async () => {
    await listSeeyonAgents();
  });

program
  .command('bot <botName> [prompt...]')
  .description('Run a Seeyon Chat bot by name or chatbot id in non-interactive mode')
  .action(async (botName: string, promptParts: string[]) => {
    const prompt = await buildPromptWithStdin(promptParts.join(' '));

    await runSeeyonAgent(botName, prompt);
  });

program
  .command('run [prompt...]')
  .description('Run in non-interactive mode with a prompt')
  .option('-a, --agent <agent>', 'Coding agent to use')
  .option('--yolo', 'Use the approval-free yolo coding agent')
  .option('-m, --model <model>', 'AI model to use for generation')
  .option('-t, --temperature <temperature>', 'Temperature for generation', parseFloat)
  .option('-s, --system <message>', 'Custom system message')
  .option('-d, --debug', 'Enable debug logging to debug-agent.log in current directory')
  .option('-o, --output <mode>', 'Output format: text (default) or ndjson (structured machine-readable output for piping)')
  .action(async (promptParts: string[], commandOptions: RunOptions) => {
    const prompt = await buildPromptWithStdin(promptParts.join(' '));

    if (!prompt.trim()) {
      exitWithError('Provide a prompt argument or pipe input to stdin.');
    }

    if (commandOptions.output && commandOptions.output !== 'text' && commandOptions.output !== 'ndjson') {
      exitWithError(`Invalid output mode: ${commandOptions.output}. Use "text" or "ndjson".`);
    }

    await runPromptCommandWithRunOptions(prompt, commandOptions);
  });

program
  .command('resume [sessionRef]')
  .description('Resume the latest saved chat session, or a specific session by id/prefix')
  .option('-d, --debug', 'Enable debug logging to debug-agent.log in current directory')
  .action(async (sessionRef: string | undefined) => {
    const options = getGlobalOptions();

    await resumeChat(sessionRef, options.debug);
  });

program
  .command('init')
  .description('Generate project context files in .cobot/')
  .action(() => {
    try {
      const rootDir = process.env.OPENAI_CONTEXT_DIR || process.cwd();
      const { mdPath, jsonPath } = writeProjectContext(rootDir);

      console.log('Project context generated.');
      console.log(`Markdown: ${mdPath}`);
      console.log(`JSON: ${jsonPath}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      exitWithError(`Failed to generate project context: ${message}`);
    }
  });

const configCommand = program
  .command('config')
  .description('Manage stored Cobot configuration');

configCommand
  .command('get')
  .description('Show stored configuration')
  .action(() => {
    printConfig();
  });

configCommand
  .command('set <key> <value>')
  .description('Set a config value: apikey, baseurl, model, theme, extraRequest, seeyonChatApiKey, seeyonChatEndpoint, explore.rerank.* (model, apikey, baseurl, topN, perRole, timeoutMs, instruct), explore.thinking.* (worker, synthesis), explore.adaptive.* (minHighPriorityFiles, minDeclarationEvidence, maxLowSignalRatio), or explore.scan.* (maxFiles, recentFirst, multiRepoMinDirs, perRepoMaxFiles, ignoreDirs, honorGitignore)')
  .action((key: string, value: string) => {
    setConfigValue(key, value);
  });

configCommand
  .command('clear <key>')
  .description('Clear a config value: apikey, baseurl, extraRequest, seeyonChatApiKey, seeyonChatEndpoint, explore.rerank, explore.thinking, explore.adaptive, or explore.scan')
  .action((key: string) => {
    clearConfigValue(key);
  });

program.parse();
