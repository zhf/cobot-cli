import chalk from 'chalk';
import { render } from 'ink';
import React from 'react';
import { Agent } from '../core/agent.js';
import { SessionRecord, SessionStore } from '../core/session-store.js';
import App from '../ui/App.js';

function printBanner(): void {
  console.log(chalk.hex('#3f8097')(`
┏━╸┏━┓┏┓ ┏━┓╺┳╸
┃  ┃ ┃┣┻┓┃ ┃ ┃
┗━╸┗━┛┗━┛┗━┛ ╹
`));
}

async function renderChatSession(
  sessionStore: SessionStore,
  initialSession: SessionRecord,
  debug?: boolean,
): Promise<void> {
  const agent = await Agent.create(
    initialSession.model,
    initialSession.temperature,
    null,
    debug,
  );

  agent.loadSessionState(
    initialSession.model,
    initialSession.temperature,
    initialSession.agentMessages,
    initialSession.baseAgentMessages,
  );

  render(React.createElement(App, { agent, sessionStore, initialSession }));
}

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
  printBanner();

  try {
    // Create agent (API key will be checked on first message)
    const agent = await Agent.create(model, temperature, system, debug);
    const sessionStore = new SessionStore();
    const initialSession = sessionStore.createSession({
      model: agent.getCurrentModel(),
      temperature: agent.getTemperature(),
      agentMessages: agent.exportMessages(),
      baseAgentMessages: agent.exportBaseMessages(),
    });

    render(React.createElement(App, { agent, sessionStore, initialSession }));
  } catch (error) {
    console.log(chalk.red(`Error initializing agent: ${error}`));
    process.exit(1);
  }
}

export async function resumeChat(
  sessionReference?: string,
  debug?: boolean,
): Promise<void> {
  printBanner();

  try {
    const sessionStore = new SessionStore();
    const latestSession = sessionStore.listSessions(1)[0];
    const initialSession = sessionReference?.trim()
      ? sessionStore.loadSession(sessionReference)
      : latestSession
				? sessionStore.loadSession(latestSession.id)
				: null;

    if (!initialSession) {
      console.log(chalk.red('No saved sessions to resume.'));
      process.exit(1);
    }

    await renderChatSession(sessionStore, initialSession, debug);
  } catch (error) {
    console.log(chalk.red(`Error resuming session: ${error}`));
    process.exit(1);
  }
}
