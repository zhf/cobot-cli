import { CommandDefinition, CommandContext } from '../base.js';

const apikeyCommand: CommandDefinition = {
  command: 'apikey',
  description: 'Set your OpenAI API key',
  handler: ({ setShowLogin }: CommandContext) => {
    if (setShowLogin) {
      setShowLogin(true);
    }
  },
};

export default apikeyCommand;