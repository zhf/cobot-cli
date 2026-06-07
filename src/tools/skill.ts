import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ToolResult, createToolResponse } from './files.js';

export interface SkillInfo {
  name: string;
  description: string;
  location: string;
  content: string;
}

const SKILL_FILE_NAME = 'SKILL.md';

function skillDirectories(): string[] {
  return [
    path.join(os.homedir(), '.cobot', 'skills'),
    path.join(process.cwd(), '.cobot', 'skills'),
  ];
}

function extractDescription(content: string): string {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatterMatch) {
    const descriptionLine = frontmatterMatch[1].split('\n').find((line) => line.trim().startsWith('description:'));
    if (descriptionLine) {
      return descriptionLine.split(':').slice(1).join(':').trim().replace(/^['"]|['"]$/g, '');
    }
  }

  const paragraph = content
    .replace(/^---\n[\s\S]*?\n---/, '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#'));

  return paragraph || 'Custom Cobot skill.';
}

export function listSkills(): SkillInfo[] {
  const skills = new Map<string, SkillInfo>();

  for (const directory of skillDirectories()) {
    if (!fs.existsSync(directory)) {
      continue;
    }

    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const skillFilePath = path.join(directory, entry.name, SKILL_FILE_NAME);
      if (!fs.existsSync(skillFilePath)) {
        continue;
      }

      const content = fs.readFileSync(skillFilePath, 'utf-8');
      skills.set(entry.name, {
        name: entry.name,
        description: extractDescription(content),
        location: skillFilePath,
        content,
      });
    }
  }

  return [...skills.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function skillDescriptionSuffix(): string {
  const skills = listSkills();
  if (skills.length === 0) {
    return 'No skills are currently available.';
  }

  return [
    'Available skills:',
    ...skills.map((skill) => `- ${skill.name}: ${skill.description}`),
  ].join('\n');
}

export async function skill(name: string): Promise<ToolResult> {
  const info = listSkills().find((item) => item.name === name);
  if (!info) {
    return createToolResponse(false, undefined, '', `Error: Unknown skill "${name}"`);
  }

  const output = [
    `<skill_content name="${info.name}">`,
    `# Skill: ${info.name}`,
    '',
    info.content.trim(),
    '',
    `Base directory for this skill: ${path.dirname(info.location)}`,
    '</skill_content>',
  ].join('\n');

  return createToolResponse(true, output, `Loaded skill: ${info.name}`);
}
