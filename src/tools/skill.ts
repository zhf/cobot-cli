import * as path from 'path';
import ConfigManager from '../config/ConfigManager.js';
import { findSkill, listSkills as listDiscoveredSkills, sampleSkillFiles, skillDescriptionSuffix as formatSkillDescriptionSuffix, type SkillInfo } from '../core/skills.js';
import { ToolResult, createToolResponse } from './files.js';

export function listSkills(): SkillInfo[] {
  return listDiscoveredSkills(new ConfigManager().getSkillsConfig());
}

export function skillDescriptionSuffix(): string {
  return formatSkillDescriptionSuffix(new ConfigManager().getSkillsConfig());
}

export async function skill(name: string): Promise<ToolResult> {
  const config = new ConfigManager().getSkillsConfig();
  const info = findSkill(name, config);
  if (!info) {
    const available = listDiscoveredSkills(config).map((item) => item.name).join(', ') || 'none';
    return createToolResponse(false, undefined, '', `Error: Unknown skill "${name}". Available skills: ${available}`);
  }

  const files = sampleSkillFiles(info).map((file) => `<file>${file}</file>`).join('\n');

  const output = [
    `<skill_content name="${info.name}">`,
    `# Skill: ${info.name}`,
    '',
    info.content.trim(),
    '',
    `Base directory for this skill: ${path.dirname(info.location)}`,
    'Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.',
    'Note: file list is sampled.',
    '',
    '<skill_files>',
    files,
    '</skill_files>',
    '</skill_content>',
  ].join('\n');

  return createToolResponse(true, output, `Loaded skill: ${info.name}`);
}
