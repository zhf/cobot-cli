import { CommandDefinition, CommandContext } from '../base.js';

const resumeCommand: CommandDefinition = {
	command: 'resume',
	description: 'Resume a saved chat session, or the previous session if no id is provided',
	handler: ({ addMessage, commandArgs, resumeSession }: CommandContext) => {
		const sessionReference = commandArgs?.trim() || '';

		if (!resumeSession) {
			addMessage({
				role: 'system',
				content: 'Session storage is not available.',
			});
			return;
		}

		resumeSession(sessionReference || undefined);
	},
};

export default resumeCommand;
