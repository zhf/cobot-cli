/**
 * Tool schemas for function calling API.
 * These define the available tools that the LLM can call.
 */

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required: string[];
    };
  };
}

// File Operation Tools

export const OPEN_FILE_SCHEMA: ToolSchema = {
  type: 'function',
  function: {
    name: 'open_file',
    description: 'Open file or directory with the OS default application. On macOS uses `open` command, on Windows uses `start`, on Linux uses `xdg-open`. Example: {"file_path": "document.pdf"} or {"file_path": "src"}',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to file or directory to open. For files in current directory use just filename (e.g. "app.js"). For subdirectories use "src/app.js". DO NOT use absolute paths or leading slashes.',
        },
        with_app: {
          type: 'string',
          description: 'Specific application to open the file with (optional, e.g. "code", "sublime", "chrome")',
        },
      },
      required: ['file_path'],
    },
  },
};

export const READ_FILE_SCHEMA: ToolSchema = {
  type: 'function',
  function: {
    name: 'read_file',
    description: 'Read file contents with optional line range. REQUIRED before edit_file. Use to check if files exist and examine current code before making changes. Example: {"file_path": "src/app.js", "start_line": 10, "end_line": 20}',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to file. For files in current directory use just filename (e.g. "app.js"). For subdirectories use "src/app.js". DO NOT use absolute paths or leading slashes.',
        },
        start_line: {
          type: 'integer',
          description: 'Starting line number (1-indexed, optional)',
          minimum: 1,
        },
        end_line: {
          type: 'integer',
          description: 'Ending line number (1-indexed, optional)',
          minimum: 1,
        },
      },
      required: ['file_path'],
    },
  },
};

export const CREATE_FILE_SCHEMA: ToolSchema = {
  type: 'function',
  function: {
    name: 'create_file',
    description: 'Create NEW files or directories that DO NOT EXIST. CRITICAL: Always check if file exists first using list_files or read_file before creating. If file exists, use edit_file instead. Set overwrite=true only if you explicitly need to replace existing content. Example: {"file_path": "src/utils/new-helper.js", "content": "function helper() { return true; }", "file_type": "file"}',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path for new file/directory. For files in current directory use just filename (e.g. "app.js"). For subdirectories use "src/app.js". DO NOT use absolute paths or leading slashes.',
        },
        content: {
          type: 'string',
          description: 'File content (use empty string "" for directories)',
        },
        file_type: {
          type: 'string',
          enum: ['file', 'directory'],
          description: 'Create file or directory',
          default: 'file',
        },
        overwrite: {
          type: 'boolean',
          description: 'Overwrite existing file',
          default: false,
        },
      },
      required: ['file_path', 'content'],
    },
  },
};

export const EDIT_FILE_SCHEMA: ToolSchema = {
  type: 'function',
  function: {
    name: 'edit_file',
    description: 'Modify EXISTING files by exact text replacement. Use this for files that already exist. MANDATORY: Always read_file first to see current content before editing. Text must match exactly including whitespace. Example: {"file_path": "src/app.js", "old_text": "const x = 1;", "new_text": "const x = 2;"}',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to file to edit. For files in current directory use just filename (e.g. "app.js"). For subdirectories use "src/app.js". DO NOT use absolute paths or leading slashes.',
        },
        old_text: {
          type: 'string',
          description: 'Exact text to replace (must match perfectly including spaces/newlines)',
        },
        new_text: {
          type: 'string',
          description: 'Replacement text',
        },
        replace_all: {
          type: 'boolean',
          description: 'Replace all occurrences (default: false)',
          default: false,
        },
      },
      required: ['file_path', 'old_text', 'new_text'],
    },
  },
};

export const DELETE_FILE_SCHEMA: ToolSchema = {
  type: 'function',
  function: {
    name: 'delete_file',
    description: 'Remove files or directories. Use with caution. Example: {"file_path": "temp/old_file.txt"} or {"file_path": "temp_dir", "recursive": true}',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to file/directory to delete. For files in current directory use just filename (e.g. "app.js"). For subdirectories use "src/app.js". DO NOT use absolute paths or leading slashes.',
        },
        recursive: {
          type: 'boolean',
          description: 'Delete directories and their contents',
          default: false,
        },
      },
      required: ['file_path'],
    },
  },
};

// Code Execution Tools

export const EXECUTE_COMMAND_SCHEMA: ToolSchema = {
  type: 'function',
  function: {
    name: 'execute_command',
    description: 'Run shell commands, scripts, or code. SAFETY WARNING: Only use for commands that COMPLETE and EXIT (test scripts, build commands, short-running scripts). NEVER use for commands that run indefinitely (flask server, node app starting, python -m http.server, etc.). Always prefer short-running commands that exit. Example: {"command": "npm test", "command_type": "bash"}',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Shell command to execute. Only use commands that exit/stop automatically. Examples: "python my_script.py", "npm test", "ls -la". Avoid: long-running commands, "npm start" (starts servers), etc.',
        },
        command_type: {
          type: 'string',
          enum: ['bash', 'python', 'setup', 'run'],
          description: 'Command type: bash (shell), python (script), setup (auto-run), run (needs approval)',
        },
        working_directory: {
          type: 'string',
          description: 'Directory to run command in (optional)',
        },
        timeout: {
          type: 'integer',
          description: 'Max execution time in seconds (1-300)',
          minimum: 1,
          maximum: 300,
        },
      },
      required: ['command', 'command_type'],
    },
  },
};

// Information Tools

export const SEARCH_FILES_SCHEMA: ToolSchema = {
  type: 'function',
  function: {
    name: 'search_files',
    description: 'Find text patterns in files across the codebase. Perfect for locating functions, classes, or specific code. Example: {"pattern": "function handleClick", "file_pattern": "*.js", "context_lines": 3}',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Text to search for (can be function names, classes, strings, etc.)',
        },
        file_pattern: {
          type: 'string',
          description: 'File pattern filter (e.g., "*.py", "*.js", "src/*.ts")',
          default: '*',
        },
        directory: {
          type: 'string',
          description: 'Directory to search in. Use "." or "" for current directory, "src" for subdirectory. DO NOT include leading slash.',
          default: '.',
        },
        case_sensitive: {
          type: 'boolean',
          description: 'Case-sensitive search',
          default: false,
        },
        pattern_type: {
          type: 'string',
          enum: ['substring', 'regex', 'exact', 'fuzzy'],
          description: 'Match type: substring (partial), regex (patterns), exact (whole), fuzzy (similar)',
          default: 'substring',
        },
        file_types: {
          type: 'array',
          items: { type: 'string' },
          description: 'File extensions to include (["py", "js", "ts"])',
        },
        exclude_dirs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Directories to skip (["node_modules", ".git", "dist"])',
        },
        exclude_files: {
          type: 'array',
          items: { type: 'string' },
          description: 'File patterns to skip (["*.min.js", "*.log"])',
        },
        max_results: {
          type: 'integer',
          description: 'Maximum results to return (1-1000)',
          default: 100,
          minimum: 1,
          maximum: 1000,
        },
        context_lines: {
          type: 'integer',
          description: 'Lines of context around matches (0-10)',
          default: 0,
          minimum: 0,
          maximum: 10,
        },
        group_by_file: {
          type: 'boolean',
          description: 'Group results by filename',
          default: false,
        },
      },
      required: ['pattern'],
    },
  },
};

export const LIST_FILES_SCHEMA: ToolSchema = {
  type: 'function',
  function: {
    name: 'list_files',
    description: 'Browse directory contents and file structure. Use to explore project layout and CHECK IF FILES EXIST before deciding between create_file vs edit_file. Example: {"directory": "src", "pattern": "*.js", "recursive": true}',
    parameters: {
      type: 'object',
      properties: {
        directory: {
          type: 'string',
          description: 'Directory path to list. Use "." or "" for current directory, "src" for subdirectory. DO NOT include leading slash.',
          default: '.',
        },
        pattern: {
          type: 'string',
          description: 'File pattern filter ("*.py", "test_*", etc.)',
          default: '*',
        },
        recursive: {
          type: 'boolean',
          description: 'List subdirectories recursively',
          default: false,
        },
        show_hidden: {
          type: 'boolean',
          description: 'Include hidden files (.gitignore, .env, etc.)',
          default: false,
        },
      },
      required: [],
    },
  },
};

// Task Management Tools

export const CREATE_WEB_PAGE_SCHEMA: ToolSchema = {
  type: 'function',
  function: {
    name: 'create_web_page',
    description: 'Generate a complete HTML file with embedded CSS and JavaScript based on a text prompt. Creates a single standalone HTML file that includes all necessary styles and scripts. Example: {"prompt": "Create a portfolio website with a dark theme and smooth animations", "file_path": "portfolio.html"}',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Detailed description of the web page you want to create (e.g., "Create a landing page for a coffee shop with menu and contact form")',
        },
        file_path: {
          type: 'string',
          description: 'Path where the HTML file should be saved (e.g., "index.html", "pages/about.html")',
        },
        style: {
          type: 'string',
          enum: ['modern', 'classic', 'minimal', 'bold', 'playful', 'professional'],
          description: 'Visual style preference for the web page',
          default: 'modern',
        },
        color_scheme: {
          type: 'string',
          enum: ['light', 'dark', 'auto'],
          description: 'Color scheme preference',
          default: 'light',
        },
        overwrite: {
          type: 'boolean',
          description: 'Overwrite existing file',
          default: false,
        },
      },
      required: ['prompt', 'file_path'],
    },
  },
};

export const CREATE_TASKS_SCHEMA: ToolSchema = {
  type: 'function',
  function: {
    name: 'create_tasks',
    description: 'Break down complex requests into organized task lists. Use for multi-step projects. Example: {"user_query": "Build login system", "tasks": [{"id": "1", "description": "Create user model", "status": "pending"}]}',
    parameters: {
      type: 'object',
      properties: {
        user_query: {
          type: 'string',
          description: 'Original user request being broken down',
        },
        tasks: {
          type: 'array',
          description: 'List of actionable subtasks',
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Unique task identifier string (e.g., "1", "2", "3")',
              },
              description: {
                type: 'string',
                description: 'Clear, actionable task description',
              },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed'],
                description: 'Task status: pending, in_progress, or completed',
                default: 'pending',
              },
            },
            required: ['id', 'description'],
          },
        },
      },
      required: ['user_query', 'tasks'],
    },
  },
};

export const UPDATE_TASKS_SCHEMA: ToolSchema = {
  type: 'function',
  function: {
    name: 'update_tasks',
    description: 'Update task progress and status. Use to mark tasks as started or completed. Example: {"task_updates": [{"id": "1", "status": "completed", "notes": "Successfully implemented"}]}',
    parameters: {
      type: 'object',
      properties: {
        task_updates: {
          type: 'array',
          description: 'Array of status updates for specific tasks',
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'ID string of task to update (must match existing task ID)',
              },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed'],
                description: 'New status: pending, in_progress, or completed',
              },
              notes: {
                type: 'string',
                description: 'Optional progress notes or completion details',
              },
            },
            required: ['id', 'status'],
          },
        },
      },
      required: ['task_updates'],
    },
  },
};

// Document Processing Tools

export const CONVERT_DOCUMENT_SCHEMA: ToolSchema = {
  type: 'function',
  function: {
    name: 'convert_document',
    description: 'Convert documents between formats using pandoc. Supports Markdown, HTML, PDF, DOCX, LaTeX, etc. Use this tool to convert .docx and other binary documents to markdown or plain text before using `open_file` tool. Syntax: {"command_string": "[options] [input file] -o [output file]"}',
    parameters: {
      type: 'object',
      properties: {
        command_string: {
          type: 'string',
          description: 'Complete pandoc command string with input file, output file, and options. Check pandoc usage with `pandoc --help`',
        },
      },
      required: ['command_string'],
    },
  },
};

// Image Processing Tools

export const PROCESS_IMAGE_SCHEMA: ToolSchema = {
  type: 'function',
  function: {
    name: 'process_image',
    description: 'Process images using ImageMagick. Resize, convert formats, apply filters, etc. Example: {"command_string": "input.jpg output.png -resize 800x600 -quality 90"}',
    parameters: {
      type: 'object',
      properties: {
        command_string: {
          type: 'string',
          description: 'Complete ImageMagick command string with input file, output file, and options. Check ImageMagick usage with `magick --help`',
        },
      },
      required: ['command_string'],
    },
  },
};

export const BATCH_PROCESS_IMAGES_SCHEMA: ToolSchema = {
  type: 'function',
  function: {
    name: 'batch_process_images',
    description: 'Process multiple images with the same operation using ImageMagick. Example: {"command_string": "images/*.jpg thumbnails -resize 200x200 -quality 85"}',
    parameters: {
      type: 'object',
      properties: {
        command_string: {
          type: 'string',
          description: 'Complete ImageMagick batch command string with input pattern, output directory, and options. Check ImageMagick usage with `magick --help`',
        },
      },
      required: ['command_string'],
    },
  },
};

// Media Processing Tools

export const PROCESS_MEDIA_SCHEMA: ToolSchema = {
  type: 'function',
  function: {
    name: 'process_media',
    description: 'Process video and audio files using FFmpeg. Convert formats, extract audio, trim, resize, change quality, etc. Example: {"command_string": "-i input.mp4 -vn -acodec copy output.mp3"}',
    parameters: {
      type: 'object',
      properties: {
        command_string: {
          type: 'string',
          description: 'Complete FFmpeg command string with options, input file, and output file. Check FFmpeg usage with `ffmpeg -h`',
        },
      },
      required: ['command_string'],
    },
  },
};

// Database Tools

export const GET_CLICKHOUSE_SCHEMA_SCHEMA: ToolSchema = {
  type: 'function',
  function: {
    name: 'get_clickhouse_schema',
    description: 'Retrieve ClickHouse database schema including databases, tables, columns, and data types. Use this tool first to understand data structure before writing queries. Try to connect with these default settings without any parameters first before asking user to provide more info: {"host": "localhost", "port": 8123, "database": "default", "user": "default"}',
    parameters: {
      type: 'object',
      properties: {
        host: {
          type: 'string',
          description: 'ClickHouse server host',
          default: 'localhost',
        },
        port: {
          type: 'integer',
          description: 'ClickHouse server port',
          default: 8123,
        },
        database: {
          type: 'string',
          description: 'Database name to explore (optional, will show all databases if not specified)',
        },
        user: {
          type: 'string',
          description: 'Username for authentication',
          default: 'default',
        },
        password: {
          type: 'string',
          description: 'Password for authentication (optional)',
        },
        table: {
          type: 'string',
          description: 'Specific table to get detailed schema for (optional)',
        },
        include_sample_data: {
          type: 'boolean',
          description: 'Include sample data rows for each table',
          default: false,
        },
        sample_limit: {
          type: 'integer',
          description: 'Number of sample rows to return per table',
          default: 5,
          minimum: 1,
          maximum: 100,
        },
      },
      required: [],
    },
  },
};

export const EXECUTE_CLICKHOUSE_QUERY_SCHEMA: ToolSchema = {
  type: 'function',
  function: {
    name: 'execute_clickhouse_query',
    description: 'Execute ClickHouse SQL queries. Use get_clickhouse_schema first to understand data structure. Supports SELECT, INSERT, CREATE, etc. Try to connect with these default settings first before asking user to provide more info: {"query": "SELECT count() FROM table WHERE date >= \'2024-01-01\'", "host": "localhost", "port": 8123}',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'SQL query to execute',
        },
        host: {
          type: 'string',
          description: 'ClickHouse server host',
          default: 'localhost',
        },
        port: {
          type: 'integer',
          description: 'ClickHouse server port',
          default: 8123,
        },
        database: {
          type: 'string',
          description: 'Database to query against',
          default: 'default',
        },
        user: {
          type: 'string',
          description: 'Username for authentication',
          default: 'default',
        },
        password: {
          type: 'string',
          description: 'Password for authentication (optional)',
        },
        format: {
          type: 'string',
          description: 'Output format for results',
          enum: ['JSON', 'CSV', 'TabSeparated', 'JSONCompact'],
          default: 'JSON',
        },
        max_rows: {
          type: 'integer',
          description: 'Maximum number of rows to return',
          default: 1000,
          minimum: 1,
          maximum: 10000,
        },
        timeout: {
          type: 'integer',
          description: 'Query timeout in seconds',
          default: 30,
          minimum: 1,
          maximum: 300,
        },
      },
      required: ['query'],
    },
  },
};

// All tools combined
export const ALL_TOOL_SCHEMAS = [
  OPEN_FILE_SCHEMA,
  READ_FILE_SCHEMA,
  CREATE_FILE_SCHEMA,
  EDIT_FILE_SCHEMA,
  DELETE_FILE_SCHEMA,
  SEARCH_FILES_SCHEMA,
  LIST_FILES_SCHEMA,
  CREATE_WEB_PAGE_SCHEMA,
  CREATE_TASKS_SCHEMA,
  UPDATE_TASKS_SCHEMA,
  EXECUTE_COMMAND_SCHEMA,
  CONVERT_DOCUMENT_SCHEMA,
  PROCESS_IMAGE_SCHEMA,
  BATCH_PROCESS_IMAGES_SCHEMA,
  PROCESS_MEDIA_SCHEMA,
  GET_CLICKHOUSE_SCHEMA_SCHEMA,
  EXECUTE_CLICKHOUSE_QUERY_SCHEMA,
];

// Safe tools that can be auto-executed without approval
export const SAFE_TOOLS = [
  'read_file',
  'list_files',
  'search_files',
  'create_tasks',
  'update_tasks',
  'open_file',
];

// Tools that require approval, unless auto-approval is enabled
export const APPROVAL_REQUIRED_TOOLS = [
  'create_file',
  'edit_file',
  'create_web_page',
  'convert_document',
  'process_image',
  'batch_process_images',
  'process_media',
  'get_clickhouse_schema',
  'execute_clickhouse_query',
];

// Dangerous tools that always require approval
export const DANGEROUS_TOOLS = [
  'delete_file',
  'execute_command',
];
