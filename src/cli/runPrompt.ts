import chalk from 'chalk';
import { Agent } from '../core/agent.js';

/**
 * Run the agent in non-interactive mode with a predefined prompt.
 *
 * Initializes an AI agent with the given model, temperature, optional system prompt, and debug mode,
 * then runs it with the provided prompt and outputs the result to stdout.
 *
 * @param prompt - The prompt to run the agent with.
 * @param model - The AI model to use for generation.
 * @param temperature - Sampling temperature used for model generation.
 * @param system - Optional system message to seed the agent's context; pass `null` to use defaults.
 * @param debug - When true, enables debug logging for the agent.
 */
export async function runPrompt(
  prompt: string,
  model: string,
  temperature: number,
  system: string | null,
  debug?: boolean,
): Promise<void> {
  try {
    // Create agent (API key will be checked on first message)
    const agent = await Agent.create(model, temperature, system, debug);

    // Set up simple callbacks to handle the agent's responses
    agent.setToolCallbacks({
      onFinalMessage: (content: string) => {
        console.log(content);
        process.exit(0);
      },
      onThinkingText: (content: string) => {
        // In non-interactive mode, we don't show thinking text
      },
      onToolStart: (name: string) => {
        // In non-interactive mode, we don't show tool execution
      },
      onToolEnd: (name: string, result: any) => {
        // In non-interactive mode, we don't show tool results
      }
    });

    // Run the agent with the provided prompt
    await agent.chat(prompt);
  } catch (error) {
    console.log(chalk.red(`Error running agent: ${error}`));
    process.exit(1);
  }
}