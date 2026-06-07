import { CommandDefinition, CommandContext } from '../base.js';

const cobotCommand: CommandDefinition = {
  command: 'cobot',
  description: 'Run a Seeyon Chat agent',
  handler: ({ setShowSeeyonAgentRunner }: CommandContext) => {
    if (setShowSeeyonAgentRunner) {
      setShowSeeyonAgentRunner(true);
    }
  },
};

export default cobotCommand;
