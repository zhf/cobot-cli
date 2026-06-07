import { CommandDefinition, CommandContext } from '../base.js';
import { formatCodingAgentList } from '../../core/coding-agents.js';

function listAgents(context: CommandContext): void {
  const agents = context.listCodingAgents?.() || [];
  context.addMessage({
    role: 'system',
    content: agents.length > 0
      ? `Coding agents:\n${formatCodingAgentList(agents, context.activeCodingAgentName)}`
      : 'No coding agents are configured.',
  });
}

const agentCommand: CommandDefinition = {
  command: 'agent',
  description: 'Switch coding agent or list available agents',
  handler: (context: CommandContext) => {
    const agentName = context.commandArgs?.trim();
    if (!agentName) {
      listAgents(context);
      return;
    }

    try {
      context.switchCodingAgent?.(agentName);
      context.addMessage({
        role: 'system',
        content: `Switched to coding agent: ${agentName}. Chat history has been cleared.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.addMessage({
        role: 'system',
        content: `Failed to switch coding agent: ${message}`,
      });
    }
  },
};

export default agentCommand;
