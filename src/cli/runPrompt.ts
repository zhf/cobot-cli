import chalk from 'chalk';
import { Agent } from '../core/agent.js';
import { QuestionPrompt } from '../tools/question.js';
import type { ExploreProgressEvent } from '../core/explore-runner.js';

function answerQuestion(question: QuestionPrompt): string[] {
  const firstOption = question.options[0]?.label;
  if (firstOption) {
    return [firstOption];
  }

  return question.custom === false ? [] : ['No preference'];
}

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
 * @param codingAgentName - Optional coding agent name to use.
 * @param outputMode - Output format: 'text' (default) or 'ndjson' for structured machine-readable output.
 */
export async function runPrompt(
  prompt: string,
  model: string,
  temperature: number,
  system: string | null,
  debug?: boolean,
  codingAgentName?: string | null,
  outputMode?: 'text' | 'ndjson',
): Promise<void> {
  const useNdjson = outputMode === 'ndjson';

  try {
    // Create agent (API key will be checked on first message)
    const agent = await Agent.create(model, temperature, system, debug, codingAgentName);

    // Set up simple callbacks to handle the agent's responses
    agent.setToolCallbacks({
      onFinalMessage: (content: string) => {
        if (useNdjson) {
          // In ndjson mode, the explore progress events were already emitted.
          // For non-explore agents, emit a single result event.
          // The explore agent calls onFinalMessage directly, so we need to
          // check if we already emitted result events via onExploreProgress.
          // We use a flag to avoid double-emitting.
          if (!ndjsonResultEmitted) {
            emitNdjson({ type: 'result', content });
            ndjsonResultEmitted = true;
          }
        } else {
          console.log(content);
        }
      },
      onThinkingText: (content: string) => {
        // In non-interactive mode, we don't show thinking text
      },
      onToolStart: (name: string) => {
        if (useNdjson) {
          emitNdjson({ type: 'tool', name, status: 'started' });
        }
      },
      onToolEnd: (name: string, result: unknown) => {
        if (useNdjson) {
          emitNdjson({ type: 'tool', name, status: 'completed' });
        }
      },
      onToolApproval: async () => ({ approved: true }),
      onQuestion: async (questions: QuestionPrompt[]) => questions.map(answerQuestion),
      onExploreProgress: (event: ExploreProgressEvent) => {
        if (useNdjson) {
          emitNdjson(event as unknown as Record<string, unknown>);
        }
      },
    });

    // Run the agent with the provided prompt
    await agent.chat(prompt);

    // For ndjson mode, if no onFinalMessage was called (shouldn't happen, but safety net)
    if (useNdjson && !ndjsonResultEmitted) {
      process.exit(0);
    }
  } catch (error) {
    if (useNdjson) {
      emitNdjson({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    } else {
      console.log(chalk.red(`Error running agent: ${error}`));
    }
    process.exit(1);
  }
}

let ndjsonResultEmitted = false;

function emitNdjson(data: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(data) + '\n');
}
