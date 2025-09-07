# Cobot CLI

A highly customizable, lightweight coding and office assistant CLI powered by AI models. Inspired by Claude Code, Gemini CLI and Groq Code.

![License](https://img.shields.io/badge/License-MIT-green.svg)

## Overview

Cobot CLI is a terminal-based coding assistant that helps you with programming tasks directly from your command line. Unlike bloated coding tools, Cobot CLI focuses on being lightweight and extensible, making it easy to understand, modify, and enhance.

With Cobot CLI, you can:
- Ask coding questions and get intelligent responses
- Create, edit, and manage files in your project
- Execute shell commands for testing and building
- Search through your codebase for specific patterns
- List directory contents to understand project structure

The assistant is powered by OpenAI's advanced models and comes with a built-in tool system that allows it to interact with your file system and execute commands.

## Installation

### Run Instantly (Recommended)
```bash
npx cobot-cli@latest
```

### Install Globally
```bash
npm install -g cobot-cli@latest
```

### For Development
```bash
git clone https://github.com/zhf/cobot-cli.git
cd cobot-cli
npm install
npm run build
npm link        # Enables the `cobot` command in any directory
```

During development, you can run this in the background to automatically apply changes:
```bash
npm run dev
```

## Usage

Start the CLI by running:
```bash
cobot
```

Or specify a model directly:
```bash
cobot --model gpt-4o-mini
```

### Command Line Options

```bash
cobot [options]

Options:
  -t, --temperature <temp>      Temperature for generation (default: 1.0)
  -m, --model <model>           AI model to use for generation (default: gpt-4o)
  -s, --system <message>        Custom system message
  -d, --debug                   Enable debug logging to debug-agent.log in current directory
  -p, --prompt <prompt>         Run in non-interactive mode with a predefined prompt
  -h, --help                    Display help
  -V, --version                 Display version number
```

### Getting Started

On first use, we recommend setting up your API configuration in this order:

1. **Set your API key**:
```bash
cobot
```
Then use the `/apikey` command to set your OpenAI API key.

2. **Set your base URL** (if using a custom API endpoint):
```bash
/baseurl
```
This allows you to use custom OpenAI-compatible APIs like BigModel, Groq, etc.

3. **Select your model**:
```bash
/model
```
Choose from available models or enter a custom model name.

4. **Customize your theme** (optional):
```bash
/theme
```
Toggle between light and dark themes. Your preference is automatically saved.

This creates a `.cobot/` folder in your home directory to store your configuration, including your theme preference.

#### Environment Variables

You can also set configuration via environment variables:

```bash
export COBOT_OPENAI_API_KEY=your_api_key_here
export COBOT_OPENAI_BASE_URL=https://api.openai.com/v1
```

or cobot will use the following environment variables as defaults:

```bash
export OPENAI_API_KEY=your_api_key_here
export OPENAI_BASE_URL=https://api.openai.com/v1
```

### Available Commands

#### Configuration Commands
- `/apikey` - Set your OpenAI API key
- `/baseurl` - Set custom OpenAI API base URL (for using alternate providers)
- `/model` - Select your AI model from available options or enter custom model name

#### Session Commands
- `/help` - Show help and available commands
- `/login` - Login with your Cobot account (feature not implemented yet)
- `/clear` - Clear chat history and context
- `/reasoning` - Toggle display of reasoning content in messages
- `/stats` - Display session statistics and token usage
- `/theme` - Toggle between light and dark themes (preference is automatically saved)

## Features

### Theme System

Cobot CLI includes a built-in theme system with accessibility improvements and persistent preferences:

- **Light and Dark Themes**: Toggle between light and dark color schemes
- **Accessibility Optimized**: High contrast colors that meet WCAG standards
- **Persistent Preferences**: Theme choice is automatically saved and restored across sessions
- **Cursor Visibility**: Enhanced cursor visibility in both themes
- **Real-time Switching**: Instant theme changes without restarting the application

Use `/theme` to switch between themes - your preference is automatically saved to `~/.cobot/config.json`.

### Built-in Tools

Cobot CLI comes with 17 built-in tools that allow the assistant to interact with your file system, databases, and multimedia:

#### File Operations
- `open_file` - Open files or directories with the OS default application
- `read_file` - Read file contents with optional line range
- `create_file` - Create new files or directories
- `edit_file` - Modify existing files by exact text replacement
- `delete_file` - Remove files or directories
- `list_files` - Browse directory contents and file structure
- `search_files` - Find text patterns in files across the codebase

#### Code Execution & System
- `execute_command` - Run shell commands (safety-limited)

#### Task Management
- `create_tasks` - Break down complex requests into organized task lists
- `update_tasks` - Update task progress and status

#### Web & Document Processing
- `create_web_page` - Generate complete HTML files with embedded CSS and JavaScript
- `convert_document` - Convert documents between formats using pandoc (Markdown, HTML, PDF, DOCX, LaTeX)

#### Media Processing
- `process_image` - Process images using ImageMagick (resize, convert formats, apply filters)
- `batch_process_images` - Process multiple images with the same operation
- `process_media` - Process video and audio files using FFmpeg (convert formats, extract audio, trim)

#### Database Operations
- `get_clickhouse_schema` - Retrieve ClickHouse database schema and structure
- `execute_clickhouse_query` - Execute ClickHouse SQL queries

### Model Selection

The `/model` command dynamically fetches available models from your configured API endpoint:

- **OpenAI API**: Shows GPT models (gpt-4o, gpt-4o-mini, etc.)
- **Custom APIs**: Shows provider-specific models (e.g., glm-4.5, glm-4.5-air for BigModel)
- **Fallback Options**: Common models if API fetch fails
- **Custom Entry**: Option to manually enter any model name

You can specify the model to use either through the `/model` command during chat or via the `--model` command line option when starting the CLI.

### Safety Features

- Tool execution approval system for potentially dangerous operations
- Session auto-approval toggle (Shift+Tab) for repetitive file operations
- Command execution safety limits (no long-running processes)
- Secure storage of API keys with restrictive file permissions

### Configuration Storage

All preferences are stored in `~/.cobot/config.json` with secure file permissions (`0o600`):

```json
{
  "openaiApiKey": "sk-...",
  "defaultModel": "gpt-4o",
  "openaiBaseURL": "https://api.openai.com/v1",
  "theme": "dark"
}
```

- **API Configuration**: API keys, base URLs, and model preferences
- **Theme Settings**: Light/dark theme preference (automatically persisted)
- **Security**: Owner-only read/write permissions for sensitive data
- **Migration**: Existing configurations remain compatible

## Development

### Project Structure

```
cobot-cli/
├── src/
│   ├── commands/           
│   │   ├── definitions/        # Individual command implementations
│   │   │   ├── apikey.ts       # API key configuration command
│   │   │   ├── baseurl.ts      # Base URL configuration command
│   │   │   ├── clear.ts        # Clear chat history command
│   │   │   ├── help.ts         # Help command
│   │   │   ├── login.ts        # Authentication command
│   │   │   ├── model.ts        # Model selection command
│   │   │   ├── reasoning.ts    # Reasoning toggle command
│   │   │   ├── stats.ts        # Statistics command
│   │   │   └── theme.ts        # Theme toggle command
│   │   ├── base.ts             # Base command interface
│   │   └── index.ts            # Command exports
│   ├── core/               
│   │   ├── agent.ts            # AI agent implementation
│   │   └── cli.ts              # CLI entry point and setup
│   ├── tools/              
│   │   ├── tool-schemas.ts     # Tool schema definitions
│   │   ├── tools.ts            # Tool implementations
│   │   └── validators.ts       # Input validation utilities
│   ├── ui/                 
│   │   ├── App.tsx             # Main application component
│   │   ├── components/     
│   │   │   ├── core/           # Core chat TUI components
│   │   │   ├── display/        # Auxiliary components for TUI display
│   │   │   └── input-overlays/ # Input overlays and modals that occupy the MessageInput box
│   │   ├── overlays/           # Modal overlays for configuration commands
│   │   │   ├── BaseURLSelector.tsx  # Base URL selection modal
│   │   │   ├── Login.tsx           # API key input modal
│   │   │   └── ModelSelector.tsx   # Model selection modal
│   │   ├── hooks/             # Custom React hooks
│   │   │   └── useTheme.ts      # Theme management hook
│   │   └── theme.ts           # Theme color definitions
│   └── utils/              
│       ├── constants.ts        # Application constants
│       ├── config/             # Configuration management
│       │   └── ConfigManager.ts    # Handles API key, base URL, model, and theme configuration
│       ├── file-ops.ts         # File system operations
│       ├── local-settings.ts   # Local configuration management
│       └── markdown.ts         # Markdown processing utilities
├── docs/                   
├── package.json    
├── tsconfig.json        
└── LICENSE          
```

### Available Scripts

```bash
npm run build      # Build TypeScript to dist/
npm run dev        # Build in watch mode
```

### Customization

#### Adding New Tools

1. Define the tool schema in `src/tools/tool-schemas.ts`:
```typescript
export const YOUR_TOOL_SCHEMA: ToolSchema = {
  type: 'function',
  function: {
    name: 'your_tool_name',
    description: 'What your tool does',
    parameters: {
      type: 'object',
      properties: {
        param1: { type: 'string', description: 'Parameter description' }
      },
      required: ['param1']
    }
  }
};
```

2. Implement the tool function in `src/tools/tools.ts`:
```typescript
export async function yourToolName(param1: string): Promise<ToolResult> {
  // Your implementation here
  return createToolResponse(true, result, 'Success message');
}
```

3. Register the tool in the `TOOL_REGISTRY` object and `executeTool` switch statement in `src/tools/tools.ts`.

4. Add the schema to `ALL_TOOL_SCHEMAS` array in `src/tools/tool-schemas.ts`.

#### Adding New Slash Commands

1. Create command definition in `src/commands/definitions/your-command.ts`:
```typescript
import { CommandDefinition, CommandContext } from '../base.js';

export const yourCommand: CommandDefinition = {
  command: 'yourcommand',
  description: 'What your command does',
  handler: ({ addMessage }: CommandContext) => {
    // Your command logic here
    addMessage({
      role: 'system',
      content: 'Command response'
    });
  }
};
```

2. Register the command in `src/commands/index.ts` by importing it and adding to the `availableCommands` array.

#### Changing Start Command

To change the start command from `cobot`, modify the `"bin"` section in `package.json`:
```json
{
  "bin": {
    "your-command": "dist/core/cli.js"
  }
}
```

Then re-run `npm run build` and `npm link`.

## Contributing

Improvements through PRs are welcome! For issues and feature requests, please open an issue on GitHub.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.