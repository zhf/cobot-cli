import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { setReadFilesTracker } from './validators.js';
import { ToolResult } from './files.js';

// Re-export ToolResult for external use
export { ToolResult };

const execAsync = promisify(exec);

// Track which files have been read in the current session
const sessionReadFiles = new Set<string>();

// Export sessionReadFiles for validator access
export function getReadFilesTracker(): Set<string> {
  return sessionReadFiles;
}

// Initialize validator with sessionReadFiles tracker
setReadFilesTracker(sessionReadFiles);

// Import all tool functions
import { readFile } from './files.js';
import { createFile } from './files.js';
import { editFile } from './files.js';
import { deleteFile } from './files.js';
import { listFiles } from './files.js';
import { openFile } from './files.js';
import { searchFiles } from './search.js';
import { executeCommand } from './exec.js';
import { createTasks } from './tasks.js';
import { updateTasks } from './tasks.js';
import { convertDocument, processImage, batchProcessImages, processMedia } from './media.js';
import { createWebPage } from './web.js';
import { getClickHouseSchema, executeClickHouseQuery } from './database.js';

// Tool Registry: maps tool names to functions
export const TOOL_REGISTRY = {
  read_file: readFile,
  create_file: createFile,
  edit_file: editFile,
  delete_file: deleteFile,
  list_files: listFiles,
  open_file: openFile,
  create_web_page: createWebPage,
  search_files: searchFiles,
  execute_command: executeCommand,
  create_tasks: createTasks,
  update_tasks: updateTasks,
  convert_document: convertDocument,
  process_image: processImage,
  batch_process_images: batchProcessImages,
  process_media: processMedia,
  get_clickhouse_schema: getClickHouseSchema,
  execute_clickhouse_query: executeClickHouseQuery,
};

/**
 * Execute a tool by name with given arguments
 */
export async function executeTool(toolName: string, toolArgs: Record<string, any>): Promise<any> {
  if (!(toolName in TOOL_REGISTRY)) {
    return {
      success: false,
      error: 'Error: Unknown tool'
    };
  }

  try {
    const toolFunction = (TOOL_REGISTRY as any)[toolName];

    // Call the function with the appropriate arguments based on the tool
    switch (toolName) {
      case 'read_file':
        return await toolFunction(toolArgs.file_path, toolArgs.start_line, toolArgs.end_line);
      case 'create_file':
        return await toolFunction(toolArgs.file_path, toolArgs.content, toolArgs.file_type, toolArgs.overwrite);
      case 'edit_file':
        return await toolFunction(toolArgs.file_path, toolArgs.old_text, toolArgs.new_text, toolArgs.replace_all);
      case 'delete_file':
        return await toolFunction(toolArgs.file_path, toolArgs.recursive);
      case 'list_files':
        return await toolFunction(toolArgs.directory, toolArgs.pattern, toolArgs.recursive, toolArgs.show_hidden);
      case 'open_file':
        return await toolFunction(toolArgs.file_path, toolArgs.with_app);
      case 'create_web_page':
        return await toolFunction(toolArgs.prompt, toolArgs.file_path, toolArgs.style, toolArgs.color_scheme, toolArgs.overwrite);
      case 'search_files':
        return await toolFunction(
          toolArgs.pattern,
          toolArgs.file_pattern,
          toolArgs.directory,
          toolArgs.case_sensitive,
          toolArgs.pattern_type,
          toolArgs.file_types,
          toolArgs.exclude_dirs,
          toolArgs.exclude_files,
          toolArgs.max_results,
          toolArgs.context_lines,
          toolArgs.group_by_file,
        );
      case 'execute_command':
        return await toolFunction(toolArgs.command, toolArgs.command_type, toolArgs.working_directory, toolArgs.timeout);
      case 'create_tasks':
        return await toolFunction(toolArgs.user_query, toolArgs.tasks);
      case 'update_tasks':
        return await toolFunction(toolArgs.task_updates);
      case 'convert_document':
        return await toolFunction(toolArgs.command_string);
      case 'process_image':
        return await toolFunction(toolArgs.command_string);
      case 'batch_process_images':
        return await toolFunction(toolArgs.command_string);
      case 'process_media':
        return await toolFunction(toolArgs.command_string);
      case 'get_clickhouse_schema':
        return await toolFunction(
          toolArgs.host,
          toolArgs.port,
          toolArgs.database,
          toolArgs.user,
          toolArgs.password,
          toolArgs.table,
          toolArgs.include_sample_data,
          toolArgs.sample_limit
        );
      case 'execute_clickhouse_query':
        return await toolFunction(
          toolArgs.query,
          toolArgs.host,
          toolArgs.port,
          toolArgs.database,
          toolArgs.user,
          toolArgs.password,
          toolArgs.format,
          toolArgs.max_rows,
          toolArgs.timeout
        );
      default:
        return {
          success: false,
          error: 'Error: Tool not implemented'
        };
    }
  } catch (error) {
    if (error instanceof TypeError) {
      return {
        success: false,
        error: 'Error: Invalid tool arguments'
      };
    }
    return {
      success: false,
      error: 'Error: Unexpected tool error'
    };
  }
}