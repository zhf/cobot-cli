import { CommandDefinition, CommandContext } from '../base.js';

const newCommand: CommandDefinition = {
	command: 'new',
	description: 'Start a new chat session',
	handler: ({ addMessage, commandArgs, startNewSession }: CommandContext) => {
		if (!startNewSession) {
			addMessage({
				role: 'system',
				content: 'Session storage is not available.',
			});
			return;
		}

		startNewSession(commandArgs?.trim() || undefined);
	},
};

export default newCommand;
