#!/usr/bin/env bun
import { Command } from 'commander';
import { resumeChat, startChat } from '../cli/startChat.js';
import { runPrompt } from '../cli/runPrompt.js';
import { buildPromptWithStdin } from '../cli/promptInput.js';
import ConfigManager from '../config/ConfigManager.js';
import { SeeyonChatClient, SeeyonChatError } from '../core/seeyon-chat.js';
import { writeProjectContext } from '../utils/context/projectContext.js';

interface GlobalOptions {
  temperature: number;
  model: string;
  system?: string;
  debug?: boolean;
  prompt?: string;
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

async function runPromptCommand(prompt: string): Promise<void> {
  const options = getGlobalOptions();

  await runPrompt(
    prompt,
    options.model,
    options.temperature,
    options.system || null,
    options.debug,
  );
}

function printConfig(): void {
  const configManager = new ConfigManager();

  console.log(`apikey: ${maskSecret(configManager.getApiKey())}`);
  console.log(`baseurl: ${configManager.getBaseURL() || 'not set'}`);
  console.log(`model: ${configManager.getDefaultModel() || 'not set'}`);
  console.log(`theme: ${configManager.getTheme()}`);
  console.log(`extraRequest: ${configManager.getExtraRequestString() || 'not set'}`);
  console.log(`seeyonChatApiKey: ${maskSecret(configManager.getSeeyonChatApiKey())}`);
  console.log(`seeyonChatEndpoint: ${configManager.getSeeyonChatEndpoint()}`);
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
    default:
      exitWithError(`Unknown config key: ${key}`);
  }
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
  .usage('[options] [agentName] [agentPrompt...]')
  .description('Cobot CLI')
  .version('1.0.0')
  .argument('[agentName]', 'Seeyon Chat agent name or chatbot id to run')
  .argument('[agentPrompt...]', 'Prompt for the Seeyon Chat agent')
  .option('-t, --temperature <temperature>', 'Temperature for generation', parseFloat, 1.0)
  .option('-m, --model <model>', 'AI model to use for generation', 'gpt-4o-mini')
  .option('-s, --system <message>', 'Custom system message')
  .option('-d, --debug', 'Enable debug logging to debug-agent.log in current directory')
  .option('-p, --prompt <prompt>', 'Run in non-interactive mode with a predefined prompt')
  .showHelpAfterError()
  .showSuggestionAfterError()
  .action(async (agentName: string | undefined, agentPrompt: string[] | undefined, options: GlobalOptions) => {
    if (options.prompt) {
      const fullPrompt = await buildPromptWithStdin(options.prompt);

      await runPromptCommand(fullPrompt);
    } else if (agentName) {
      const prompt = await buildPromptWithStdin((agentPrompt || []).join(' '));

      await runSeeyonAgent(agentName, prompt);
    } else {
      await startChat(
        options.model,
        options.temperature,
        options.system || null,
        options.debug,
      );
    }
  });

program
  .command('agents')
  .description('List Seeyon Chat agents accessible to the configured account')
  .action(async () => {
    await listSeeyonAgents();
  });

program
  .command('agent <agentName> [prompt...]')
  .description('Run a Seeyon Chat agent by name or chatbot id in non-interactive mode')
  .action(async (agentName: string, promptParts: string[]) => {
    const prompt = await buildPromptWithStdin(promptParts.join(' '));

    await runSeeyonAgent(agentName, prompt);
  });

program
  .command('run [prompt...]')
  .description('Run in non-interactive mode with a prompt')
  .action(async (promptParts: string[]) => {
    const prompt = await buildPromptWithStdin(promptParts.join(' '));

    if (!prompt.trim()) {
      exitWithError('Provide a prompt argument or pipe input to stdin.');
    }

    await runPromptCommand(prompt);
  });

program
  .command('resume [sessionRef]')
  .description('Resume the latest saved chat session, or a specific session by id/prefix')
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
  .description('Set a config value: apikey, baseurl, model, theme, extraRequest, seeyonChatApiKey, or seeyonChatEndpoint')
  .action((key: string, value: string) => {
    setConfigValue(key, value);
  });

configCommand
  .command('clear <key>')
  .description('Clear a config value: apikey, baseurl, extraRequest, seeyonChatApiKey, or seeyonChatEndpoint')
  .action((key: string) => {
    clearConfigValue(key);
  });

program.parse();
