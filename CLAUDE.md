# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cobot CLI is a lightweight, terminal-based coding assistant CLI powered by OpenAI models. It provides an interactive chat interface with built-in tools for file operations, code execution, and project analysis.

## Development Commands

```bash
npm run build      # Build TypeScript to dist/
npm run dev        # Build in watch mode for development
```

## Architecture

### Core Components

- **Agent** (`src/core/agent.ts`): Main AI agent that handles OpenAI API communication, tool execution, and conversation management
- **CLI** (`src/core/cli.ts`): Entry point that handles command-line arguments and renders the React/Ink UI
- **Commands** (`src/commands/`): Slash command system for user interactions (/login, /model, /clear, etc.)
- **Tools** (`src/tools/`): Built-in tool system for file operations, code execution, and project analysis
- **UI** (`src/ui/`): React components for the terminal-based user interface using Ink

### Key Architecture Patterns

1. **Tool System**: Centralized tool registry with validation and approval workflows
2. **Command System**: Extensible slash command framework for user interactions
3. **State Management**: Conversation history, task tracking, and session state
4. **Safety Features**: Tool approval system, read-before-edit validation, and command execution limits

### Tool System

The application includes 9 built-in tools:
- `read_file` - Read file contents with optional line range
- `create_file` - Create new files or directories
- `edit_file` - Modify existing files by exact text replacement
- `delete_file` - Remove files or directories
- `execute_command` - Run shell commands with safety limits
- `search_files` - Find text patterns in files across the codebase
- `list_files` - Browse directory contents with tree-style display
- `create_tasks` - Break down complex requests into organized task lists
- `update_tasks` - Update task progress and status

### Command System

Available slash commands:
- `/help` - Show help and available commands
- `/login` - Login with OpenAI API key
- `/model` - Select OpenAI model
- `/clear` - Clear chat history and context
- `/reasoning` - Toggle display of reasoning content
- `/stats` - Display session statistics and token usage

## Development Guidelines

### Adding New Tools

1. Define schema in `src/tools/tool-schemas.ts`
2. Implement function in `src/tools/tools.ts`
3. Register in `TOOL_REGISTRY` and `executeTool` function
4. Add schema to `ALL_TOOL_SCHEMAS` array

### Adding New Commands

1. Create command definition in `src/commands/definitions/`
2. Register in `src/commands/index.ts`
3. Implement handler following the `CommandDefinition` interface

### Code Style

- Uses TypeScript with strict type checking
- Follows ESLint configuration with React rules
- Uses Prettier for code formatting
- Functional React components with hooks
- Error handling with standardized response formats
- **Self-documenting code**: Write code that explains itself through clear naming and structure
- **Descriptive naming**: Use meaningful, context-specific names for variables, functions, and components

## Testing and Quality

- Uses XO linter with React-specific rules
- TypeScript strict mode enabled
- No automated test framework currently configured
- Manual testing via CLI interface

## Configuration

- API keys stored in `~/.openai/` directory
- Project context can be loaded from `.openai/context.md`
- Debug logging available with `--debug` flag

## Important Notes

- The application uses OpenAI's function calling API for tool execution
- Tool execution requires user approval for dangerous operations
- File operations include safety checks (read-before-edit validation)
- Commands have timeout limits to prevent long-running processes
- The UI is built with React and Ink for terminal rendering