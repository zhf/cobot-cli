#!/usr/bin/env node
import { Command } from 'commander';
import { startChat } from '../cli/startChat.js';
import { runPrompt } from '../cli/runPrompt.js';

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
  .action(async (options) => {
    if (options.prompt) {
      // Read stdin if available
      let stdinInput = '';
      if (!process.stdin.isTTY) {
        stdinInput = await new Promise((resolve) => {
          process.stdin.setEncoding('utf8');
          let data = '';
          process.stdin.on('data', (chunk) => {
            data += chunk;
          });
          process.stdin.on('end', () => {
            resolve(data);
          });
          // Handle the case where stdin is not piped but we're still waiting
          process.stdin.on('error', () => {
            resolve(data);
          });
          // Resume stdin to start reading
          process.stdin.resume();
        });
      }
      
      // Combine stdin input with the prompt if stdin is available
      const fullPrompt = stdinInput ? `${options.prompt}\n\n${stdinInput}` : options.prompt;
      
      await runPrompt(
        fullPrompt,
        options.model,
        options.temperature,
        options.system || null,
        options.debug,
      );
    } else {
      await startChat(
        options.model,
        options.temperature,
        options.system || null,
        options.debug,
      );
    }
  });

program.parse();