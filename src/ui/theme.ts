export interface ThemeColors {
  // Primary action colors (WCAG AA compliant)
  primary: string;
  secondary: string;
  
  // Status colors (high contrast)
  success: string;
  warning: string;
  error: string;
  info: string;
  
  // Text colors (accessible contrast)
  muted: string;
  background: string;
  foreground: string;
  
  // Interactive elements
  highlight: string;
  inverse: string;
  border: string;
  
  // Message types (clear visual hierarchy)
  userMessage: string;
  assistantMessage: string;
  systemMessage: string;
  
  // Tool outputs (distinguishable)
  toolOutput: string;
  toolError: string;
  
  // Code blocks (readable syntax)
  codeBackground: string;
  codeForeground: string;
  
  // Input elements (clear focus)
  inputPrompt: string;
  inputCursor: string;
  statusBar: string;
  selectionBackground: string;
  selectionForeground: string;
}

export const darkTheme: ThemeColors = {
  primary: 'brightCyan',
  secondary: 'brightBlue',
  success: 'brightGreen',
  warning: 'brightYellow',
  error: 'brightRed',
  info: 'brightMagenta',
  muted: 'gray',
  background: 'black',
  foreground: 'white',
  highlight: 'brightCyan',
  inverse: 'black',
  border: 'white',
  userMessage: 'brightCyan',
  assistantMessage: 'white',
  systemMessage: 'brightYellow',
  toolOutput: 'white',
  toolError: 'brightRed',
  codeBackground: 'rgb(30, 30, 30)',
  codeForeground: 'white',
  inputPrompt: 'brightCyan',
  inputCursor: 'white',
  statusBar: 'white',
  selectionBackground: 'brightCyan',
  selectionForeground: 'black',
};

export const lightTheme: ThemeColors = {
  primary: 'blue',
  secondary: 'cyan',
  success: 'green',
  warning: 'yellow',
  error: 'red',
  info: 'magenta',
  muted: 'black',
  background: 'white',
  foreground: 'black',
  highlight: 'blue',
  inverse: 'white',
  border: 'black',
  userMessage: 'blue',
  assistantMessage: 'black',
  systemMessage: 'yellow',
  toolOutput: 'black',
  toolError: 'red',
  codeBackground: 'rgb(240, 240, 240)',
  codeForeground: 'black',
  inputPrompt: 'blue',
  inputCursor: 'blue',
  statusBar: 'black',
  selectionBackground: 'blue',
  selectionForeground: 'white',
};

export function getTheme(isDark: boolean): ThemeColors {
  return isDark ? darkTheme : lightTheme;
}