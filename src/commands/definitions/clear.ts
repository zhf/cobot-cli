import { CommandDefinition, CommandContext } from '../base.js';

const clearCommand: CommandDefinition = {
  command: 'clear',
  description: 'Clear chat history and context',
  handler: ({ addMessage, clearHistory }: CommandContext) => {
    clearHistory();
    addMessage({
      role: 'system',
      content: 'Chat history and context cleared.',
    });
  },
};

export default clearCommand;
