# Cobot CLI - Project Context for Qwen Code

## Project Overview

Cobot CLI is a terminal-based coding assistant that helps with programming tasks directly from the command line. It's built with TypeScript, React (via Ink for terminal UI), and powered by OpenAI models. The CLI focuses on being lightweight and extensible, making it easy to understand, modify, and enhance.

Key features:
- Ask coding questions and get intelligent responses
- Create, edit, and manage files in your project
- Execute shell commands for testing and building
- Search through your codebase for specific patterns
- List directory contents to understand project structure

## Self-Documenting Code and Descriptive Naming Best Practices

This project follows the principle of self-documenting code with descriptive naming. This means:

1. Variable and function names should clearly describe their purpose and usage
2. Code structure and organization should be intuitive
3. Comments should be minimal and only used to explain complex logic or non-obvious decisions
4. Type definitions should be explicit and meaningful
5. File and directory names should clearly indicate their contents and purpose

When refactoring code, we prioritize renaming variables and functions to be more descriptive over adding comments, while preserving all existing logic and functionality.

## Project Structure

```
cobot-cli/
├── src/
│   ├── commands/           
│   │   ├── definitions/        # Individual command implementations
│   │   │   ├── clear.ts        # Clear chat history command
│   │   │   ├── help.ts         # Help command
│   │   │   ├── init.ts         # Project initialization command
│   │   │   ├── login.ts        # Authentication command
│   │   │   ├── model.ts        # Model selection command
│   │   │   ├── reasoning.ts    # Reasoning toggle command
│   │   │   └── stats.ts        # Statistics command
│   │   ├── base.ts             # Base command interface
│   │   └── index.ts            # Command exports and handler
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
│   │   └── hooks/          
│   └── utils/              
│       ├── constants.ts        # Application constants
│       ├── file-ops.ts         # File system operations
│       ├── local-settings.ts   # Local configuration management
│       └── proxy-config.ts     # Proxy configuration utilities
├── docs/                   
├── package.json    
├── tsconfig.json        
└── LICENSE          
```

## Building and Running

### Available Scripts

```bash
npm run build      # Build TypeScript to dist/
npm run dev        # Build in watch mode
```

### Installation

#### Run Instantly (Recommended)
```bash
npx cobot-cli@latest
```

#### Install Globally
```bash
npm install -g cobot-cli@latest
```

#### For Development
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

### Usage

Start the CLI by running:
```bash
cobot
```

Command Line Options:
```bash
cobot [options]

Options:
  -t, --temperature <temp>      Temperature for generation (default: 1.0)
  -s, --system <message>        Custom system message
  -d, --debug                   Enable debug logging to debug-agent.log in current directory
  -p, --proxy <url>             Proxy URL (e.g. http://proxy:8080 or socks5://proxy:1080)
  -h, --help                    Display help
  -V, --version                 Display version number
```

## Available Commands

- `/help` - Show help and available commands
- `/login` - Login with your OpenAI API key
- `/model` - Select your OpenAI model
- `/clear` - Clear chat history and context
- `/init` - Initialize a new project with common files
- `/reasoning` - Toggle display of reasoning content in messages
- `/stats` - Display session statistics and token usage

## Built-in Tools

Cobot CLI comes with several built-in tools that allow the assistant to interact with your file system:

1. `read_file` - Read file contents with optional line range
2. `create_file` - Create new files or directories
3. `edit_file` - Modify existing files by exact text replacement
4. `delete_file` - Remove files or directories
5. `execute_command` - Run shell commands (safety-limited)
6. `search_files` - Find text patterns in files across the codebase
7. `list_files` - Browse directory contents and file structure
8. `create_tasks` - Break down complex requests into organized task lists
9. `update_tasks` - Update task progress and status

## Development Conventions

### Adding New Tools

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

### Adding New Slash Commands

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

### Changing Start Command

To change the start command from `cobot`, modify the `"bin"` section in `package.json`:
```json
{
  "bin": {
    "your-command": "dist/core/cli.js"
  }
}
```

Then re-run `npm run build` and `npm link`.

## Model Selection

Choose from various OpenAI models:
- `gpt-5-chat` - Latest high-intelligence model
- `gpt-4o` - High-intelligence flagship model for complex tasks
- `gpt-4o-mini` - Affordable small model for fast, lightweight tasks

## Safety Features

- Tool execution approval system for potentially dangerous operations
- Session auto-approval toggle (Shift+Tab) for repetitive file operations
- Command execution safety limits (no long-running processes)
- Secure storage of API keys with restrictive file permissions
- File read tracking to ensure files are read before being edited

## Configuration

The CLI stores configuration in a `.openai` directory in the user's home directory:
- API keys are stored in `local-settings.json` with restrictive permissions (0o600)
- Default model selection is persisted in the same file
- Proxy settings can also be stored in the configuration file

## Proxy Configuration

Supports HTTP/HTTPS/SOCKS proxies via CLI flag or environment variables:

```bash
# CLI flag (highest priority)
cobot --proxy http://proxy:8080
cobot --proxy socks5://proxy:1080

# Environment variables
export HTTP_PROXY=http://proxy:8080
export HTTPS_PROXY=socks5://proxy:1080
export OPENAI_PROXY=http://proxy:8080
```

Priority: `--proxy` > `OPENAI_PROXY` > `HTTPS_PROXY` > `HTTP_PROXY`

## Testing

To test the CLI during development:
1. Run `npm run build` to compile TypeScript to JavaScript
2. Use `npm link` to make the `cobot` command available globally
3. Run `cobot` from any directory to start the assistant

## Contributing

Improvements through PRs are welcome! For issues and feature requests, please open an issue on GitHub.