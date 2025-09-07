import { CommandDefinition, CommandContext } from '../base.js';

const baseurlCommand: CommandDefinition = {
  command: 'baseurl',
  description: 'Set custom OpenAI API base URL',
  handler: ({ setShowBaseURLSelector }: CommandContext) => {
    if (setShowBaseURLSelector) {
      setShowBaseURLSelector(true);
    }
  },
};

export default baseurlCommand;