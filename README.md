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

Cobot CLI requires Bun 1.2.22 or newer.

### Run Instantly (Recommended)
```bash
bunx cobot-cli@latest
```

### Install Globally
```bash
bun add -g cobot-cli@latest
```

### For Development
```bash
git clone https://github.com/zhf/cobot-cli.git
cd cobot-cli
bun install
bun run build
bun link        # Enables the `cobot` command in any directory
```

During development, you can run this in the background to automatically apply changes:
```bash
bun run dev
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

Run a one-off non-interactive prompt:
```bash
cobot run "summarize this project"
```

Run without tool approval prompts:
```bash
cobot --yolo
cobot run --yolo "fix the build"
```

Resume the latest saved interactive session:
```bash
cobot resume
cobot resume a1b2c3d4
```

Run a Seeyon Chat agent by name:
```bash
cobot bots
cobot bot "Agent Name" "summarize this project"
cobot bot 665f1c1234567890abcdef12 "summarize this project"
```

You can also pipe context into either `run` or the legacy `--prompt` option:
```bash
git diff | cobot run "review these changes"
git diff | cobot --prompt "review these changes"
```

Generate project context files for the current workspace:
```bash
cobot init
```

### Command Line Options

```bash
cobot [options] [command]

Commands:
  agents                      List configured coding agents
  agent [agentName]           Show or set the default coding agent
  bots                        List Seeyon Chat bots accessible to the configured account
  bot <botName> [prompt...]   Run a Seeyon Chat bot by name or chatbot id
  run [prompt...]             Run in non-interactive mode with a prompt
  resume [sessionRef]         Resume the latest saved chat session, or one by id/prefix
  init                        Generate project context files in .cobot/
  config                      Manage stored Cobot configuration

Options:
  -V, --version                    output the version number
  -t, --temperature <temperature>  Temperature for generation (default: 1)
  -m, --model <model>              AI model to use for generation (default: "gpt-4o-mini")
  -a, --agent <agent>              Coding agent to use
  --yolo                           Use the approval-free yolo coding agent
  -s, --system <message>           Custom system message
  -d, --debug                      Enable debug logging to debug-agent.log in current directory
  -p, --prompt <prompt>            Run in non-interactive mode with a predefined prompt
  -h, --help                       display help for command
```

### Configuration Commands

```bash
cobot config get
cobot config set apikey <key>
cobot config set baseurl <url>
cobot config set model <model>
cobot config set theme <dark|light>
cobot config set extraRequest '{"reasoning_effort":"low"}'
cobot config set seeyonChatApiKey <key>
cobot config set seeyonChatEndpoint https://seeyon.chat
cobot config clear apikey
cobot config clear baseurl
cobot config clear extraRequest
cobot config clear seeyonChatApiKey
cobot config clear seeyonChatEndpoint
```

### Getting Started

On first use, we recommend setting up your API configuration in this order:

1. **Set your API key**:
```bash
cobot config set apikey your_api_key_here
```
You can also run `cobot` and use the `/apikey` command interactively.

2. **Set your base URL** (if using a custom API endpoint):
```bash
cobot config set baseurl https://api.openai.com/v1
```
You can also use `/baseurl` inside interactive chat. This allows you to use custom OpenAI-compatible APIs like BigModel, Groq, etc.

3. **Select your model**:
```bash
cobot config set model gpt-4o-mini
```
You can also use `/model` inside interactive chat to choose from available models or enter a custom model name.

4. **Customize your theme** (optional):
```bash
/theme
```
Toggle between light and dark themes. Your preference is automatically saved.

5. **Configure Seeyon Chat agents** (optional):
```bash
cobot config set seeyonChatApiKey your_seeyon_api_key_here
cobot config set seeyonChatEndpoint https://seeyon.chat
```
Use `/cobot` inside interactive chat to pick a Seeyon Chat agent and send a prompt. The request and response are added to the local assistant context.

This creates a `.cobot/` folder in your home directory to store your configuration, including your theme preference.

#### Environment Variables

Cobot CLI supports environment variables with a priority system:

**Priority Order (Highest to Lowest):**
1. **Config File** (`~/.cobot/config.json`) - Highest priority
2. **COBOT_* Environment Variables**:
   - `COBOT_OPENAI_API_KEY`
   - `COBOT_OPENAI_BASE_URL` 
   - `COBOT_DEFAULT_MODEL`
   - `COBOT_SEEYON_CHAT_API_KEY`
   - `COBOT_SEEYON_CHAT_ENDPOINT`
3. **SEEYON_* Environment Variables**:
   - `SEEYON_CHAT_API_KEY`
   - `SEEYON_CHAT_ENDPOINT`
4. **OPENAI_* Environment Variables** (fallback):
   - `OPENAI_API_KEY`
   - `OPENAI_BASE_URL`

**Usage Examples:**

```bash
# COBOT_* variables (higher priority)
export COBOT_OPENAI_API_KEY=your_api_key_here
export COBOT_OPENAI_BASE_URL=https://api.openai.com/v1
export COBOT_DEFAULT_MODEL=gpt-4o
export COBOT_SEEYON_CHAT_API_KEY=your_seeyon_api_key_here
export COBOT_SEEYON_CHAT_ENDPOINT=https://seeyon.chat

# SEEYON_* aliases
export SEEYON_CHAT_API_KEY=your_seeyon_api_key_here
export SEEYON_CHAT_ENDPOINT=http://localhost:3001

# OPENAI_* variables (fallback, lower priority)
export OPENAI_API_KEY=your_api_key_here
export OPENAI_BASE_URL=https://api.openai.com/v1
```

**How it works:**
- If a value exists in the config file, it will always be used first
- Config file string values may reference environment variables with `$VAR` or `${VAR}` syntax, and Cobot expands them when reading config
- `extraRequest` is a JSON object serialized as a string; it is merged into every model request as default request body fields before code-controlled fields like `model`, `messages`, `tools`, and token limits are applied
- `seeyonChatEndpoint` defaults to `http://localhost:3001` when `NODE_ENV=development`; otherwise it defaults to `https://seeyon.chat`
- If no config file value exists, COBOT_* variables are checked
- If no COBOT_* variables are set, SEEYON_* and OPENAI_* variables are used as fallbacks
- This allows for flexible configuration in different environments

### Available Commands

#### Configuration Commands
- `/apikey` - Set your OpenAI API key
- `/baseurl` - Set custom OpenAI API base URL (for using alternate providers)
- `/cobot` - Pick and run a Seeyon Chat agent, then add its request/response to the local context
- `/init` - Generate project context files in `.cobot/`
- `/model` - Select your AI model from available options or enter custom model name

#### Session Commands
- `/help` - Show help and available commands
- `/login` - Login with your Cobot account (feature not implemented yet)
- `/clear` - Clear chat history and context
- `/new [title]` - Start a fresh saved chat session
- `/sessions` - List saved chat sessions
- `/resume [id-or-prefix]` - Resume a saved chat session, or the previous session if no id is provided
- `/delete-session <id-or-prefix>` - Delete a saved chat session
- `/reasoning` - Toggle display of reasoning content in messages
- `/stats` - Display session statistics and token usage
- `/theme` - Toggle between light and dark themes (preference is automatically saved)
- `/yolo` - Switch to approval-free yolo mode; use `/yolo off` to return to build mode

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
- Session auto-approval toggle (Tab on empty input)
- YOLO mode (`--yolo` or `/yolo`) for approval-free tool execution
- Coding agent cycling with Shift+Tab
- Command execution safety limits (no long-running processes)
- Secure storage of API keys with restrictive file permissions

### Session Storage

Interactive chat sessions are stored locally in `~/.cobot/sessions.sqlite` using Bun SQLite. Starting `cobot` always creates a fresh session by default. Use `cobot resume` to open the latest saved session, `cobot resume <id-or-prefix>` to open a specific saved session, or `/resume` from inside chat to continue the most recent previous session.

Saved sessions include the assistant context, visible transcript, input history, model, temperature, and token statistics. The first user message automatically becomes the session title unless you provide one with `/new [title]`.

### Configuration Storage

Preferences are stored in `~/.cobot/config.json` with secure file permissions (`0o600`):

```json
{
  "openaiApiKey": "$OPENAI_API_KEY",
  "defaultModel": "gpt-4o-mini",
  "openaiBaseURL": "$OPENAI_BASE_URL",
  "extraRequest": "{\"reasoning_effort\":\"low\"}",
  "seeyonChatApiKey": "$SEEYON_CHAT_API_KEY",
  "seeyonChatEndpoint": "$SEEYON_CHAT_ENDPOINT",
  "theme": "dark"
}
```

- **API Configuration**: API keys, base URLs, Seeyon Chat endpoint, model preferences, and optional extra request defaults
- **Theme Settings**: Light/dark theme preference (automatically persisted)
- **Security**: Owner-only read/write permissions for sensitive data
- **Migration**: Existing configurations remain compatible

## Development

This repository is Bun-first and uses a root Bun workspace. The CLI package remains at the repository root, and `packages/*` is reserved for future workspace packages.

Requirements:
- Bun 1.2.22 or newer

### Project Structure

```
cobot-cli/
├── bun.lock
├── packages/                  # Future Bun workspace packages
├── src/
│   ├── bin/
│   │   └── cobot.ts            # CLI executable entry point
│   ├── cli/
│   │   ├── runPrompt.ts        # Non-interactive prompt mode
│   │   └── startChat.ts        # Interactive Ink UI startup
│   ├── commands/           
│   │   ├── definitions/        # Individual command implementations
│   │   │   ├── apikey.ts       # API key configuration command
│   │   │   ├── baseurl.ts      # Base URL configuration command
│   │   │   ├── clear.ts        # Clear chat history command
│   │   │   ├── delete-session.ts # Delete saved session command
│   │   │   ├── help.ts         # Help command
│   │   │   ├── init.ts         # Project context initialization command
│   │   │   ├── login.ts        # Authentication command
│   │   │   ├── model.ts        # Model selection command
│   │   │   ├── new.ts          # New saved session command
│   │   │   ├── reasoning.ts    # Reasoning toggle command
│   │   │   ├── resume.ts       # Resume saved session command
│   │   │   ├── sessions.ts     # List saved sessions command
│   │   │   ├── stats.ts        # Statistics command
│   │   │   └── theme.ts        # Theme toggle command
│   │   ├── base.ts             # Base command interface
│   │   └── index.ts            # Command exports
│   ├── core/               
│   │   ├── agent.ts            # AI agent implementation
│   │   ├── logger.ts           # Debug logging
│   │   ├── messages.ts         # Message and API error types
│   │   ├── openai-helper.ts    # OpenAI-compatible API helper
│   │   ├── session-store.ts    # SQLite session persistence
│   │   └── tool-executor.ts    # Tool execution orchestration
│   ├── config/
│   │   └── ConfigManager.ts    # Configuration management
│   ├── tools/              
│   │   ├── schemas/            # Tool schema definitions
│   │   ├── database.ts         # ClickHouse tools
│   │   ├── exec.ts             # Shell command execution tool
│   │   ├── files.ts            # File operation tools
│   │   ├── formatters.ts       # Tool output formatting
│   │   ├── media.ts            # Pandoc, ImageMagick, and FFmpeg tools
│   │   ├── registry.ts         # Tool registry and dispatcher
│   │   ├── search.ts           # File search tool
│   │   ├── tasks.ts            # Task management tools
│   │   ├── validators.ts       # Input validation utilities
│   │   └── web.ts              # HTML generation tool
│   ├── ui/                 
│   │   ├── App.tsx             # Main application component
│   │   ├── chat/               # Chat view and input components
│   │   ├── display/            # Auxiliary display components
│   │   ├── hooks/              # Custom React hooks
│   │   ├── overlays/           # Modal overlays for configuration commands
│   │   │   ├── BaseURLSelector.tsx  # Base URL selection modal
│   │   │   ├── ErrorRetry.tsx       # Error retry modal
│   │   │   ├── Login.tsx           # API key input modal
│   │   │   ├── MaxIterationsContinue.tsx  # Iteration limit continuation modal
│   │   │   ├── ModelSelector.tsx   # Model selection modal
│   │   │   ├── PendingToolApproval.tsx  # Tool approval modal
│   │   │   └── SlashCommandSuggestions.tsx  # Slash command suggestions
│   │   └── theme.ts           # Theme color definitions
│   └── utils/              
│       ├── context/            # Project context generation
│       ├── context.ts          # Project context utilities
│       ├── file-ops.ts         # File system operations
│       └── ignorePatterns.ts   # Ignore pattern defaults
├── docs/                   
├── package.json    
├── tsconfig.json        
└── LICENSE          
```

### Available Scripts

```bash
bun run build      # Build TypeScript to dist/
bun run dev        # Build in watch mode
bun run start      # Run the built CLI with Bun
bun run typecheck  # Type-check without emitting files
```

### Customization

#### Adding New Tools

1. Define the tool schema in `src/tools/schemas/index.ts`:
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

2. Implement the tool function in the relevant file under `src/tools/`:
```typescript
export async function yourToolName(param1: string): Promise<ToolResult> {
  // Your implementation here
  return createToolResponse(true, result, 'Success message');
}
```

3. Register the tool in `TOOL_REGISTRY` in `src/tools/registry.ts`.

4. Add the schema to `ALL_TOOL_SCHEMAS` in `src/tools/schemas/index.ts`.

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
    "your-command": "dist/bin/cobot.js"
  }
}
```

Then re-run `bun run build` and `bun link`.

## Contributing

Improvements through PRs are welcome! For issues and feature requests, please open an issue on GitHub.

## License

This project is licensed under the MIT License.
