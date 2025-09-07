import * as fs from 'fs';
import * as path from 'path';
import { shouldFileOrDirectoryBeIgnored } from './file-ops.js';

export interface ProjectContextJson {
  generated_at: string;
  root: string;
  summary: {
    total_files: number;
    total_directories: number;
    languages: Array<{ extension: string; files: number }>;
  };
  package?: {
    name?: string;
    version?: string;
    description?: string;
    scripts?: string[];
    dependencies_count?: number;
    dev_dependencies_count?: number;
  };
  config_files: string[];
  notable_files: string[];
  tree: string[]; // directory tree lines
}

export interface GenerateContextOptions {
  maxDepth?: number; // max directory depth to traverse
  maxEntries?: number; // max number of files/dirs to include in tree
}

const DEFAULT_OPTIONS: Required<GenerateContextOptions> = {
  maxDepth: 3,
  maxEntries: 1500,
};

export function generateProjectContext(rootDir: string = process.cwd(), options: GenerateContextOptions = {}): { json: ProjectContextJson; markdown: string } {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const root = path.resolve(rootDir);
  // Validate root directory exists and is accessible
  let rootStat: fs.Stats;
  try {
    rootStat = fs.statSync(root);
  } catch {
    throw new Error(`Root directory does not exist or is not accessible: ${root}`);
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`Root path is not a directory: ${root}`);
  }

  const stats = walkDirectory(root, opts.maxDepth, opts.maxEntries);

  const languages = Object.entries(stats.extensionCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([ext, count]) => ({ extension: ext || '(none)', files: count }));

  const packageData = readPackageJson(root);

  const configFiles = stats.allFiles
    .filter((fp) => isConfigFile(fp))
    .map((fp) => path.relative(root, fp))
    .sort();

  const notableFiles = stats.allFiles
    .filter((fp) => isNotableFile(fp))
    .map((fp) => path.relative(root, fp))
    .sort();

  const treeLines = renderTree(stats.treeNodes);

  const json: ProjectContextJson = {
    generated_at: new Date().toISOString(),
    root,
    summary: {
      total_files: stats.fileCount,
      total_directories: stats.dirCount,
      languages,
    },
    package: packageData || undefined,
    config_files: configFiles,
    notable_files: notableFiles,
    tree: treeLines,
  };

  const markdown = buildMarkdown(json);

  return { json, markdown };
}

export function writeProjectContext(rootDir: string = process.cwd(), options: GenerateContextOptions = {}): { mdPath: string; jsonPath: string } {
  const { json, markdown } = generateProjectContext(rootDir, options);

  const outputDir = path.join(rootDir, '.cobot');
  fs.mkdirSync(outputDir, { recursive: true });

  const mdPath = path.join(outputDir, 'context.md');
  const jsonPath = path.join(outputDir, 'context.json');

  fs.writeFileSync(mdPath, markdown, 'utf-8');
  fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2), 'utf-8');

  return { mdPath, jsonPath };
}

function readPackageJson(rootDir: string): ProjectContextJson['package'] | null {
  const pkgPath = path.join(rootDir, 'package.json');
  try {
    if (!fs.existsSync(pkgPath)) return null;
    const raw = fs.readFileSync(pkgPath, 'utf-8');
    const packageJson = JSON.parse(raw);
    return {
      name: packageJson.name,
      version: packageJson.version,
      description: packageJson.description,
      scripts: packageJson.scripts ? Object.keys(packageJson.scripts) : [],
      dependencies_count: packageJson.dependencies ? Object.keys(packageJson.dependencies).length : 0,
      dev_dependencies_count: packageJson.devDependencies ? Object.keys(packageJson.devDependencies).length : 0,
    };
  } catch {
    return null;
  }
}

function isConfigFile(filePath: string): boolean {
  const fileName = path.basename(filePath).toLowerCase();
  const configNames = new Set([
    'package.json', 'tsconfig.json', 'jsconfig.json', 'pyproject.toml', 'poetry.lock', 'requirements.txt',
    'go.mod', 'go.sum', 'cargo.toml', 'cargo.lock', 'composer.json', 'composer.lock', 'gemfile', 'gemfile.lock',
    'pipfile', 'pipfile.lock', 'dockerfile', 'docker-compose.yml', '.dockerignore', '.gitignore', '.env', '.editorconfig',
    '.eslintrc', '.eslintrc.js', '.prettierrc', '.prettierrc.js', 'makefile', 'justfile',
  ]);
  return configNames.has(fileName);
}

function isNotableFile(filePath: string): boolean {
  const fileName = path.basename(filePath).toLowerCase();
  return fileName.startsWith('readme') || fileName === 'license' || fileName === 'license.md' || fileName.endsWith('.md');
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

function walkDirectory(root: string, maxDepth: number, maxEntries: number): {
  treeNodes: TreeNode[];
  fileCount: number;
  dirCount: number;
  extensionCounts: Record<string, number>;
  allFiles: string[];
} {
  let fileCount = 0;
  let dirCount = 0;
  let totalEntries = 0;
  const extensionCounts: Record<string, number> = {};
  const allFiles: string[] = [];

  function isDirectorySafe(p: string): boolean {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  }

  function walk(current: string, depth: number): TreeNode | null {
    if (depth > maxDepth) return null;
    if (totalEntries >= maxEntries) return null;

    const name = path.basename(current);
    let isDir = false;
    try {
      const stat = fs.statSync(current);
      isDir = stat.isDirectory();
    } catch {
      // File might have been deleted or is inaccessible
      return null;
    }

    if (depth === 0 && shouldFileOrDirectoryBeIgnored(current)) {
      // Do not ignore the root itself; only skip if ignore would exclude it intentionally.
    }

    if (depth > 0 && shouldFileOrDirectoryBeIgnored(current)) {
      return null;
    }

    const node: TreeNode = {
      name, path: current, isDir, children: [],
    };
    totalEntries++;

    if (isDir) {
      dirCount++;
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(current).map((e) => path.join(current, e));
      } catch {
        entries = [];
      }
      // Sort: dirs first then files alphabetically
      entries.sort((a, b) => {
        const aDir = isDirectorySafe(a);
        const bDir = isDirectorySafe(b);
        if (aDir !== bDir) return aDir ? -1 : 1;
        return path.basename(a).toLowerCase().localeCompare(path.basename(b).toLowerCase());
      });

      for (const entry of entries) {
        if (totalEntries >= maxEntries) break;
        const child = walk(entry, depth + 1);
        if (child) node.children.push(child);
      }
    } else {
      fileCount++;
      allFiles.push(current);
      const ext = path.extname(name).replace(/^\./, '');
      extensionCounts[ext] = (extensionCounts[ext] || 0) + 1;
    }

    return node;
  }

  const rootEntries = fs.readdirSync(root).map((e) => path.join(root, e));
  const nodes: TreeNode[] = [];
  for (const entry of rootEntries) {
    if (totalEntries >= maxEntries) break;
    const child = walk(entry, 1);
    if (child) nodes.push(child);
  }

  return {
    treeNodes: nodes, fileCount, dirCount, extensionCounts, allFiles,
  };
}

function renderTree(nodes: TreeNode[]): string[] {
  const lines: string[] = [];

  function renderTreeNode(node: TreeNode, prefix: string, isLast: boolean) {
    const connector = prefix ? (isLast ? '└── ' : '├── ') : '';
    const name = node.isDir ? `${node.name}/` : node.name;
    lines.push(`${prefix}${connector}${name}`);

    const childPrefix = prefix + (prefix ? (isLast ? '    ' : '│   ') : '');
    node.children.forEach((child, index) => {
      const last = index === node.children.length - 1;
      renderTreeNode(child, childPrefix, last);
    });
  }

  nodes.forEach((n, idx) => renderTreeNode(n, '', idx === nodes.length - 1));
  return lines;
}

function buildMarkdown(projectContext: ProjectContextJson): string {
  const markdownLines: string[] = [];
  markdownLines.push('# Project Context');
  markdownLines.push('');
  markdownLines.push(`Generated: ${projectContext.generated_at}`);
  markdownLines.push('');
  markdownLines.push(`Root: ${projectContext.root}`);
  markdownLines.push('');
  markdownLines.push('## Summary');
  markdownLines.push(`- Files: ${projectContext.summary.total_files}`);
  markdownLines.push(`- Directories: ${projectContext.summary.total_directories}`);
  if (projectContext.package) {
    markdownLines.push(`- Package: ${projectContext.package.name || ''} ${projectContext.package.version ? `v${projectContext.package.version}` : ''}`.trim());
    if (projectContext.package.description) markdownLines.push(`- Description: ${projectContext.package.description}`);
    markdownLines.push(`- Scripts: ${projectContext.package.scripts?.length || 0}`);
    markdownLines.push(`- Dependencies: ${projectContext.package.dependencies_count || 0}`);
    markdownLines.push(`- Dev Dependencies: ${projectContext.package.dev_dependencies_count || 0}`);
  }
  markdownLines.push('');
  markdownLines.push('## Languages (by file count)');
  const languageLines = projectContext.summary.languages.slice(0, 12).map((l) => (l.extension === '(none)'
    ? `- ${l.extension}: ${l.files}`
    : `- .${l.extension}: ${l.files}`));
  markdownLines.push(...(languageLines.length ? languageLines : ['- (no code files detected)']));

  if (projectContext.config_files.length) {
    markdownLines.push('');
    markdownLines.push('## Configuration Files');
    projectContext.config_files.forEach((f) => markdownLines.push(`- ${f}`));
  }

  if (projectContext.notable_files.length) {
    markdownLines.push('');
    markdownLines.push('## Notable Files');
    projectContext.notable_files.forEach((f) => markdownLines.push(`- ${f}`));
  }

  if (projectContext.tree.length) {
    markdownLines.push('');
    markdownLines.push('## Directory Tree');
    markdownLines.push('```');
    projectContext.tree.forEach((l) => markdownLines.push(l));
    markdownLines.push('```');
  }

  markdownLines.push('');
  markdownLines.push('---');
  markdownLines.push('This file is auto-generated. Re-run the init command to refresh.');
  return markdownLines.join('\n');
}
