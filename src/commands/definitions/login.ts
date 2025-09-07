import { CommandDefinition, CommandContext } from '../base.js';

const loginCommand: CommandDefinition = {
  command: 'login',
  description: 'Login with your credentials',
  handler: ({ addMessage }: CommandContext) => {
    addMessage({
      role: 'system',
      content: 'Login feature not implemented yet. Use /apikey to set your OpenAI API key.',
    });
  },
};

export default loginCommand;
