#!/usr/bin/env node
import { Command } from 'commander';
import { startChat } from '../cli/startChat.js';
import { runPrompt } from '../cli/runPrompt.js';
import { buildPromptWithStdin } from '../cli/promptInput.js';
import ConfigManager from '../config/ConfigManager.js';
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
    default:
      exitWithError(`Cannot clear config key: ${key}`);
  }
}

const program = new Command();

program
  .name('cobot')
  .description('Cobot CLI')
  .version('1.0.0')
  .option('-t, --temperature <temperature>', 'Temperature for generation', parseFloat, 1.0)
  .option('-m, --model <model>', 'AI model to use for generation', 'gpt-4o-mini')
  .option('-s, --system <message>', 'Custom system message')
  .option('-d, --debug', 'Enable debug logging to debug-agent.log in current directory')
  .option('-p, --prompt <prompt>', 'Run in non-interactive mode with a predefined prompt')
  .showHelpAfterError()
  .showSuggestionAfterError()
  .action(async (options) => {
    if (options.prompt) {
      const fullPrompt = await buildPromptWithStdin(options.prompt);

      await runPromptCommand(fullPrompt);
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
  .description('Set a config value: apikey, baseurl, model, theme, or extraRequest')
  .action((key: string, value: string) => {
    setConfigValue(key, value);
  });

configCommand
  .command('clear <key>')
  .description('Clear a config value: apikey, baseurl, or extraRequest')
  .action((key: string) => {
    clearConfigValue(key);
  });

program.parse();
