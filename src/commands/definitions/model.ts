import { CommandDefinition, CommandContext } from '../base.js';

const modelCommand: CommandDefinition = {
  command: 'model',
  description: 'Select your OpenAI model',
  handler: ({ setShowModelSelector }: CommandContext) => {
    if (setShowModelSelector) {
      setShowModelSelector(true);
    }
  },
};

export default modelCommand;
