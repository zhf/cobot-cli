import { CommandDefinition, CommandContext } from '../base.js';

const loginCommand: CommandDefinition = {
  command: 'login',
  description: 'Login with your credentials',
  handler: ({ setShowLogin }: CommandContext) => {
    setShowLogin(true);
  },
};

export default loginCommand;
