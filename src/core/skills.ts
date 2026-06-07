import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';

export interface SkillInfo {
  name: string;
  description?: string;
  location: string;
  content: string;
}

export interface SkillConfig {
  paths?: string[];
}

interface ParsedSkillFrontmatter {
  name?: string;
  description?: string;
}

const SKILL_FILE_NAME = 'SKILL.md';
const SAMPLE_FILE_LIMIT = 10;

function expandPath(value: string): string {
  if (value === '~') {
    return os.homedir();
  }
  if (value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return path.isAbsolute(value) ? value : path.join(process.cwd(), value);
}

function listSkillFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return listSkillFiles(entryPath);
      }
      return entry.isFile() && entry.name === SKILL_FILE_NAME ? [entryPath] : [];
    });
}

function parseScalar(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

function parseFrontmatter(content: string): { data: ParsedSkillFrontmatter; body: string } {
  if (!content.startsWith('---\n')) {
    return { data: {}, body: content.trim() };
  }

  const endIndex = content.indexOf('\n---', 4);
  if (endIndex === -1) {
    return { data: {}, body: content.trim() };
  }

  const data: ParsedSkillFrontmatter = {};
  const frontmatter = content.slice(4, endIndex);
  for (const rawLine of frontmatter.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    if (key === 'name') {
      data.name = parseScalar(rawValue);
    } else if (key === 'description') {
      data.description = parseScalar(rawValue);
    }
  }

  return { data, body: content.slice(endIndex + 4).trim() };
}

function fallbackName(root: string, skillFilePath: string): string {
  const relativePath = path.relative(root, path.dirname(skillFilePath));
  if (!relativePath || relativePath === '.') {
    return path.basename(path.dirname(skillFilePath));
  }
  return relativePath.split(path.sep).join('/');
}

function configuredSkillRoots(config?: SkillConfig): string[] {
  return (config?.paths || []).map(expandPath);
}

function defaultSkillRoots(): string[] {
  return [
    path.join(os.homedir(), '.cobot', 'skills'),
    path.join(os.homedir(), '.agents', 'skills'),
    path.join(process.cwd(), '.cobot', 'skills'),
    path.join(process.cwd(), '.agents', 'skills'),
  ];
}

function addSkill(skills: Map<string, SkillInfo>, root: string, skillFilePath: string): void {
  const content = fs.readFileSync(skillFilePath, 'utf-8');
  const parsed = parseFrontmatter(content);
  const name = parsed.data.name || fallbackName(root, skillFilePath);
  if (!name) {
    return;
  }

  skills.set(name, {
    name,
    description: parsed.data.description,
    location: skillFilePath,
    content: parsed.body,
  });
}

export function listSkills(config?: SkillConfig): SkillInfo[] {
  const skills = new Map<string, SkillInfo>();
  for (const root of [...defaultSkillRoots(), ...configuredSkillRoots(config)]) {
    for (const skillFilePath of listSkillFiles(root)) {
      addSkill(skills, root, skillFilePath);
    }
  }

  return [...skills.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function findSkill(name: string, config?: SkillConfig): SkillInfo | undefined {
  return listSkills(config).find((skill) => skill.name === name);
}

export function formatAvailableSkills(skills: SkillInfo[], options: { verbose: boolean }): string {
  const describedSkills = skills.filter((skill) => skill.description);
  if (describedSkills.length === 0) {
    return 'No skills are currently available.';
  }

  if (options.verbose) {
    return [
      '<available_skills>',
      ...describedSkills.flatMap((skill) => [
        '  <skill>',
        `    <name>${skill.name}</name>`,
        `    <description>${skill.description}</description>`,
        `    <location>${pathToFileURL(skill.location).href}</location>`,
        '  </skill>',
      ]),
      '</available_skills>',
    ].join('\n');
  }

  return [
    '## Available Skills',
    ...describedSkills.map((skill) => `- **${skill.name}**: ${skill.description}`),
  ].join('\n');
}

export function skillDescriptionSuffix(config?: SkillConfig): string {
  return formatAvailableSkills(listSkills(config), { verbose: false });
}

export function skillSystemPrompt(config?: SkillConfig): string | undefined {
  const availableSkills = formatAvailableSkills(listSkills(config), { verbose: true });
  if (availableSkills === 'No skills are currently available.') {
    return undefined;
  }

  return [
    'Skills provide specialized instructions and workflows for specific tasks.',
    'Use the skill tool to load a skill when a task matches its description.',
    availableSkills,
  ].join('\n');
}

export function sampleSkillFiles(skill: SkillInfo): string[] {
  const skillDir = path.dirname(skill.location);
  const files: string[] = [];

  function visit(directory: string): void {
    if (files.length >= SAMPLE_FILE_LIMIT || !fs.existsSync(directory)) {
      return;
    }

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (files.length >= SAMPLE_FILE_LIMIT) {
        return;
      }

      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile() && path.resolve(entryPath) !== path.resolve(skill.location)) {
        files.push(entryPath);
      }
    }
  }

  visit(skillDir);
  return files;
}
