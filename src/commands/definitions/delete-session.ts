import { CommandDefinition, CommandContext } from '../base.js';

const deleteSessionCommand: CommandDefinition = {
	command: 'delete-session',
	description: 'Delete a saved chat session',
	handler: ({ addMessage, commandArgs, deleteSession }: CommandContext) => {
		const sessionReference = commandArgs?.trim() || '';

		if (!deleteSession) {
			addMessage({
				role: 'system',
				content: 'Session storage is not available.',
			});
			return;
		}

		if (!sessionReference) {
			addMessage({
				role: 'system',
				content: 'Usage: /delete-session <session-id-or-prefix>',
			});
			return;
		}

		deleteSession(sessionReference);
	},
};

export default deleteSessionCommand;
