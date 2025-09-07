import { CommandDefinition, CommandContext } from '../base.js';
import ConfigManager from '../../config/ConfigManager.js';

const themeCommand: CommandDefinition = {
  command: 'theme',
  description: 'Toggle between light and dark themes',
  handler: ({ addMessage, toggleTheme, isDarkTheme }: CommandContext) => {
    if (toggleTheme) {
      toggleTheme();
      const newState = !isDarkTheme;
      
      // Save theme preference to config
      try {
        const configManager = new ConfigManager();
        configManager.setTheme(newState ? 'dark' : 'light');
      } catch (error) {
        addMessage({
          role: 'system',
          content: `Theme switched to ${newState ? 'dark' : 'light'} mode, but failed to save preference: ${error}`,
        });
        return;
      }
      
      addMessage({
        role: 'system',
        content: `Theme switched to ${newState ? 'dark' : 'light'} mode and saved.`,
      });
    } else {
      addMessage({
        role: 'system',
        content: 'Theme toggle functionality is not available.',
      });
    }
  },
};

export default themeCommand;