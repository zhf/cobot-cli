/**
 * Format key parameters for tool call display
 */
export function formatToolParametersForDisplay(toolName: string, toolArgs: Record<string, any>, options: { includePrefix?: boolean; separator?: string } = {}): string {
  const { includePrefix = true, separator = '=' } = options;

  const toolParameterDisplayMappings: Record<string, string[]> = {
    read_file: ['file_path'],
    create_file: ['file_path'],
    edit_file: ['file_path'],
    delete_file: ['file_path'],
    list_files: ['directory'],
    search_files: ['pattern'],
    execute_command: ['command'],
    create_tasks: [],
    update_tasks: [],
  };

  const keyParams = toolParameterDisplayMappings[toolName] || [];

  if (keyParams.length === 0) {
    return '';
  }

  const paramParts = keyParams
    .filter((param) => param in toolArgs)
    .map((param) => {
      let value = toolArgs[param];
      // Truncate long values
      if (typeof value === 'string' && value.length > 50) {
        value = `${value.substring(0, 47)}...`;
      } else if (Array.isArray(value) && value.length > 3) {
        value = `[${value.length} items]`;
      }
      return `${param}${separator}${JSON.stringify(value)}`;
    });

  if (paramParts.length === 0) {
    return includePrefix ? `Arguments: ${JSON.stringify(toolArgs)}` : JSON.stringify(toolArgs);
  }

  const formattedParams = paramParts.join(', ');
  return includePrefix ? `Parameters: ${formattedParams}` : formattedParams;
}