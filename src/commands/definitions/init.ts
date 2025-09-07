import { CommandDefinition, CommandContext } from '../base.js';
import { writeProjectContext } from '../../utils/context/projectContext.js';

const initCommand: CommandDefinition = {
  command: 'init',
  description: 'Generate project context files in .cobot/',
  handler: ({ addMessage }: CommandContext) => {
    try {
      const rootDir = process.env.OPENAI_CONTEXT_DIR || process.cwd();
      const { mdPath, jsonPath } = writeProjectContext(rootDir);
      addMessage({
        role: 'system',
        content: `Project context generated.
- Markdown: ${mdPath}
- JSON: ${jsonPath}
The assistant will automatically load this context on startup. Re-run /init to refresh.`,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      addMessage({
        role: 'system',
        content: `Failed to generate project context: ${message}`,
      });
    }
  },
};

export default initCommand;
