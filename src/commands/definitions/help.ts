import { CommandDefinition, CommandContext } from '../base.js';
import { getAvailableCommands } from '../index.js';

const helpCommand: CommandDefinition = {
  command: 'help',
  description: 'Show help and available commands',
  handler: ({ addMessage }: CommandContext) => {
    const commands = getAvailableCommands();
    const commandList = commands.map((cmd) => `/${cmd.command} - ${cmd.description}`).join('\n');

    addMessage({
      role: 'system',
      content: `Available Commands:
${commandList}

Navigation:
- Use the arrow keys to browse chat history.
- Type '/' to view available slash commands.
- Use the arrow keys to navigate slash command suggestions.
- Press Enter to execute the selected command.

Keyboard Shortcuts:
- Esc: Clear the input box, interrupt processing, or reject tool approval.
- Shift+Tab: Toggle auto-approval for editing tools.
- Ctrl+C: Exit the application.

This is a highly customizable, lightweight, and open-source coding CLI powered by OpenAI. You can ask for help with coding tasks or everyday office challenges.`,
    });
  },
};

export default helpCommand;
