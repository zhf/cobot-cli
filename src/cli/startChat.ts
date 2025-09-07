import chalk from 'chalk';
import { render } from 'ink';
import React from 'react';
import { Agent } from '../core/agent.js';
import App from '../ui/App.js';

/**
 * Start the interactive terminal chat UI by creating an Agent and rendering the Ink App.
 *
 * Initializes an AI agent with the given model, temperature, optional system prompt, and debug mode,
 * prints the CLI banner, then renders the React/Ink UI. On initialization errors the process exits with code 1.
 *
 * @param model - The AI model to use for generation.
 * @param temperature - Sampling temperature used for model generation.
 * @param system - Optional system message to seed the agent's context; pass `null` to use defaults.
 * @param debug - When true, enables debug logging for the agent.
 */
export async function startChat(
  model: string,
  temperature: number,
  system: string | null,
  debug?: boolean,
): Promise<void> {
//   console.log(chalk.hex('#3f8097')(`
//   ▄▖  ▌   ▗ 
//   ▌ ▛▌▛▌▛▌▜▘
//   ▙▖▙▌▙▌▙▌▐▖
// `));
  console.log(chalk.hex('#3f8097')(`
┏━╸┏━┓┏┓ ┏━┓╺┳╸
┃  ┃ ┃┣┻┓┃ ┃ ┃ 
┗━╸┗━┛┗━┛┗━┛ ╹ 
`));

  try {
    // Create agent (API key will be checked on first message)
    const agent = await Agent.create(model, temperature, system, debug);

    render(React.createElement(App, { agent }));
  } catch (error) {
    console.log(chalk.red(`Error initializing agent: ${error}`));
    process.exit(1);
  }
}