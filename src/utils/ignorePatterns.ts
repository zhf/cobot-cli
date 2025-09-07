// Files and directories to ignore
const IGNORE_PATTERNS = new Set([
  'node_modules', '.git', '__pycache__', 'venv', '.venv', 'build', 'dist',
  '.idea', '.vscode', '.DS_Store', '*.pyc', '*.log', '*.tmp',
]);

export default IGNORE_PATTERNS;
