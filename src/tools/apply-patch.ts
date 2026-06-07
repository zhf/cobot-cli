import * as fs from 'fs';
import * as path from 'path';
import { ToolResult, createToolResponse } from './files.js';

type PatchOperation = 'add' | 'update' | 'delete';

interface PatchSection {
  operation: PatchOperation;
  filePath: string;
  moveTo?: string;
  lines: string[];
}

interface FileChange {
  operation: PatchOperation | 'move';
  filePath: string;
  moveTo?: string;
  additions: number;
  deletions: number;
}

function resolveProjectPath(filePath: string): string {
  const root = path.resolve(process.cwd());
  const target = path.resolve(root, filePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Cannot modify files outside the project directory: ${filePath}`);
  }
  return target;
}

function parsePatch(patchText: string): PatchSection[] {
  const normalized = patchText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.trimEnd().split('\n');
  if (lines[0] !== '*** Begin Patch' || lines[lines.length - 1] !== '*** End Patch') {
    throw new Error('Patch must start with *** Begin Patch and end with *** End Patch');
  }

  const sections: PatchSection[] = [];
  let current: PatchSection | null = null;

  for (let index = 1; index < lines.length - 1; index++) {
    const line = lines[index];
    const addMatch = line.match(/^\*\*\* Add File: (.+)$/);
    const updateMatch = line.match(/^\*\*\* Update File: (.+)$/);
    const deleteMatch = line.match(/^\*\*\* Delete File: (.+)$/);
    const moveMatch = line.match(/^\*\*\* Move to: (.+)$/);

    if (addMatch || updateMatch || deleteMatch) {
      if (current) {
        sections.push(current);
      }
      current = {
        operation: addMatch ? 'add' : updateMatch ? 'update' : 'delete',
        filePath: (addMatch || updateMatch || deleteMatch)?.[1].trim() || '',
        lines: [],
      };
      continue;
    }

    if (moveMatch && current?.operation === 'update') {
      current.moveTo = moveMatch[1].trim();
      continue;
    }

    if (!current) {
      if (line.trim()) {
        throw new Error(`Unexpected patch line before file section: ${line}`);
      }
      continue;
    }
    current.lines.push(line);
  }

  if (current) {
    sections.push(current);
  }
  if (sections.length === 0) {
    throw new Error('Patch contains no file sections');
  }
  return sections;
}

function applyUpdateHunks(original: string, lines: string[]): { content: string; additions: number; deletions: number } {
  let content = original;
  let additions = 0;
  let deletions = 0;
  let index = 0;

  while (index < lines.length) {
    while (index < lines.length && !lines[index].startsWith('@@')) {
      index++;
    }
    if (index >= lines.length) {
      break;
    }
    index++;

    const oldLines: string[] = [];
    const newLines: string[] = [];
    while (index < lines.length && !lines[index].startsWith('@@')) {
      const line = lines[index];
      if (line.startsWith('-')) {
        oldLines.push(line.slice(1));
        deletions++;
      } else if (line.startsWith('+')) {
        newLines.push(line.slice(1));
        additions++;
      } else if (line.startsWith(' ')) {
        oldLines.push(line.slice(1));
        newLines.push(line.slice(1));
      } else if (line === '') {
        oldLines.push('');
        newLines.push('');
      } else {
        throw new Error(`Invalid update hunk line: ${line}`);
      }
      index++;
    }

    const oldText = oldLines.join('\n');
    const newText = newLines.join('\n');
    if (!content.includes(oldText)) {
      throw new Error(`Update hunk did not match existing content: ${oldText.slice(0, 80)}`);
    }
    content = content.replace(oldText, newText);
  }

  return { content, additions, deletions };
}

async function applySection(section: PatchSection): Promise<FileChange> {
  const targetPath = resolveProjectPath(section.filePath);
  const relativePath = path.relative(process.cwd(), targetPath);

  if (section.operation === 'add') {
    const exists = fs.existsSync(targetPath);
    if (exists) {
      throw new Error(`File already exists: ${section.filePath}`);
    }
    const contentLines = section.lines.map((line) => {
      if (!line.startsWith('+')) {
        throw new Error(`Add file lines must start with +: ${line}`);
      }
      return line.slice(1);
    });
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.promises.writeFile(targetPath, `${contentLines.join('\n')}\n`, 'utf-8');
    return { operation: 'add', filePath: relativePath, additions: contentLines.length, deletions: 0 };
  }

  if (section.operation === 'delete') {
    if (!fs.existsSync(targetPath)) {
      throw new Error(`File not found: ${section.filePath}`);
    }
    const original = await fs.promises.readFile(targetPath, 'utf-8');
    await fs.promises.unlink(targetPath);
    return { operation: 'delete', filePath: relativePath, additions: 0, deletions: original.split('\n').length };
  }

  if (!fs.existsSync(targetPath)) {
    throw new Error(`File not found: ${section.filePath}`);
  }

  const original = await fs.promises.readFile(targetPath, 'utf-8');
  const result = applyUpdateHunks(original, section.lines);
  const finalPath = section.moveTo ? resolveProjectPath(section.moveTo) : targetPath;
  await fs.promises.mkdir(path.dirname(finalPath), { recursive: true });
  await fs.promises.writeFile(finalPath, result.content, 'utf-8');
  if (section.moveTo && finalPath !== targetPath) {
    await fs.promises.unlink(targetPath);
  }

  return {
    operation: section.moveTo ? 'move' : 'update',
    filePath: relativePath,
    moveTo: section.moveTo ? path.relative(process.cwd(), finalPath) : undefined,
    additions: result.additions,
    deletions: result.deletions,
  };
}

export async function applyPatch(patchText: string): Promise<ToolResult> {
  try {
    const sections = parsePatch(patchText);
    const changes: FileChange[] = [];
    for (const section of sections) {
      changes.push(await applySection(section));
    }

    const message = changes.map((change) => {
      const target = change.moveTo ? `${change.filePath} -> ${change.moveTo}` : change.filePath;
      return `${change.operation}: ${target} (+${change.additions}/-${change.deletions})`;
    }).join('\n');

    return createToolResponse(true, { changes }, message);
  } catch (error) {
    return createToolResponse(false, undefined, '', `Error: Failed to apply patch - ${error instanceof Error ? error.message : String(error)}`);
  }
}
