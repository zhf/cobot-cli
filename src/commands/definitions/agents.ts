import { CommandDefinition, CommandContext } from '../base.js';
import { formatCodingAgentList } from '../../core/coding-agents.js';

const agentsCommand: CommandDefinition = {
  command: 'agents',
  description: 'List available coding agents',
  handler: (context: CommandContext) => {
    const agents = context.listCodingAgents?.() || [];
    context.addMessage({
      role: 'system',
      content: agents.length > 0
        ? `Coding agents:\n${formatCodingAgentList(agents, context.activeCodingAgentName)}`
        : 'No coding agents are configured.',
    });
  },
};

export default agentsCommand;
