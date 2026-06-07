import { CommandDefinition, CommandContext } from '../base.js';
import { YOLO_AGENT_NAME } from '../../core/coding-agents.js';

const BUILD_AGENT_NAME = 'build';

const yoloCommand: CommandDefinition = {
  command: 'yolo',
  description: 'Switch yolo mode on or off',
  handler: (context: CommandContext) => {
    const args = context.commandArgs?.trim().toLowerCase();
    const disableYolo = args === 'off' || args === 'false' || args === 'disable';
    const nextAgentName = disableYolo ? BUILD_AGENT_NAME : YOLO_AGENT_NAME;

    try {
      context.switchCodingAgent?.(nextAgentName);
      context.addMessage({
        role: 'system',
        content: disableYolo
          ? 'YOLO mode disabled. Switched to build agent and cleared chat history.'
          : 'YOLO mode enabled. Tool approval prompts are disabled for this session.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.addMessage({
        role: 'system',
        content: `Failed to switch yolo mode: ${message}`,
      });
    }
  },
};

export default yoloCommand;
