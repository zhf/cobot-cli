import { CommandDefinition, CommandContext } from '../base.js';
import { shortSessionId } from '../../core/session-store.js';

function formatUpdatedAt(value: string): string {
	const updatedAt = new Date(value);

	if (Number.isNaN(updatedAt.getTime())) {
		return value;
	}

	return updatedAt.toLocaleString();
}

const sessionsCommand: CommandDefinition = {
	command: 'sessions',
	description: 'List saved chat sessions',
	handler: ({ addMessage, listSessions, activeSessionId }: CommandContext) => {
		if (!listSessions) {
			addMessage({
				role: 'system',
				content: 'Session storage is not available.',
			});
			return;
		}

		const sessions = listSessions();

		if (sessions.length === 0) {
			addMessage({
				role: 'system',
				content: 'No saved sessions.',
			});
			return;
		}

		const sessionLines = sessions.map((session) => {
			const currentMarker = session.id === activeSessionId ? ' (current)' : '';
			return [
				`${shortSessionId(session.id)}${currentMarker}: ${session.title}`,
				`  ${session.model} | ${session.messageCount} messages | updated ${formatUpdatedAt(session.updatedAt)}`,
			].join('\n');
		});

		addMessage({
			role: 'system',
			content: `Saved sessions:\n${sessionLines.join('\n')}`,
		});
	},
};

export default sessionsCommand;
