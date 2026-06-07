import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type OpenAI from 'openai';
import type { ToolSchema } from '../tools/schemas/index.js';

export type AgentMode = 'primary' | 'subagent' | 'all';
export type PermissionAction = 'allow' | 'ask' | 'deny';
export type PermissionKey = 'read' | 'edit' | 'bash' | 'task' | 'database' | 'media';

export type PermissionConfig = Partial<Record<PermissionKey, PermissionAction>>;

export interface CodingAgentConfig {
  description?: string;
  mode?: AgentMode;
  model?: string;
  temperature?: number;
  prompt?: string;
  permission?: PermissionConfig;
  disable?: boolean;
  disabled?: boolean;
}

export interface CodingAgentInfo {
  name: string;
  description: string;
  mode: AgentMode;
  model?: string;
  temperature?: number;
  prompt?: string;
  permission: Required<PermissionConfig>;
  native: boolean;
}

interface MarkdownAgentData extends CodingAgentConfig {
  name?: string;
}

const DEFAULT_BUILD_DESCRIPTION = 'Default coding agent with normal tool access and approval prompts.';
const DEFAULT_PLAN_DESCRIPTION = 'Read-only planning agent for analysis without file or command changes.';
const AGENT_DIRECTORY_NAME = 'agents';

const TOOL_PERMISSIONS: Record<string, PermissionKey> = {
  open_file: 'read',
  read_file: 'read',
  search_files: 'read',
  list_files: 'read',
  create_file: 'edit',
  edit_file: 'edit',
  delete_file: 'edit',
  create_web_page: 'edit',
  execute_command: 'bash',
  create_tasks: 'task',
  update_tasks: 'task',
  convert_document: 'media',
  process_image: 'media',
  batch_process_images: 'media',
  process_media: 'media',
  get_clickhouse_schema: 'database',
  execute_clickhouse_query: 'database',
};

const DEFAULT_PERMISSIONS: Required<PermissionConfig> = {
  read: 'allow',
  edit: 'ask',
  bash: 'ask',
  task: 'allow',
  database: 'ask',
  media: 'ask',
};

const PLAN_PERMISSIONS: Required<PermissionConfig> = {
  read: 'allow',
  edit: 'deny',
  bash: 'deny',
  task: 'allow',
  database: 'deny',
  media: 'deny',
};

function clonePermissions(permission: Required<PermissionConfig>): Required<PermissionConfig> {
  return { ...permission };
}

function mergePermission(base: Required<PermissionConfig>, override?: PermissionConfig): Required<PermissionConfig> {
  return {
    ...base,
    ...Object.fromEntries(
      Object.entries(override || {}).filter((entry): entry is [PermissionKey, PermissionAction] => isPermissionKey(entry[0]) && isPermissionAction(entry[1])),
    ),
  };
}

function isPermissionAction(value: unknown): value is PermissionAction {
  return value === 'allow' || value === 'ask' || value === 'deny';
}

function isAgentMode(value: unknown): value is AgentMode {
  return value === 'primary' || value === 'subagent' || value === 'all';
}

function isPermissionKey(value: string): value is PermissionKey {
  return value === 'read' || value === 'edit' || value === 'bash' || value === 'task' || value === 'database' || value === 'media';
}

function normalizeAgentConfig(value: unknown): CodingAgentConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const input = value as Record<string, unknown>;
  const permission = normalizePermissionConfig(input.permission);
  return {
    description: typeof input.description === 'string' ? input.description : undefined,
    mode: isAgentMode(input.mode) ? input.mode : undefined,
    model: typeof input.model === 'string' ? input.model : undefined,
    temperature: typeof input.temperature === 'number' ? input.temperature : undefined,
    prompt: typeof input.prompt === 'string' ? input.prompt : undefined,
    permission,
    disable: typeof input.disable === 'boolean' ? input.disable : undefined,
    disabled: typeof input.disabled === 'boolean' ? input.disabled : undefined,
  };
}

function normalizePermissionConfig(value: unknown): PermissionConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const permission: PermissionConfig = {};
  for (const [key, action] of Object.entries(value)) {
    if (isPermissionKey(key) && isPermissionAction(action)) {
      permission[key] = action;
    }
  }
  return permission;
}

function applyConfig(agent: CodingAgentInfo, config: CodingAgentConfig): CodingAgentInfo | undefined {
  if (config.disable || config.disabled) {
    return undefined;
  }

  return {
    ...agent,
    description: config.description ?? agent.description,
    mode: config.mode ?? agent.mode,
    model: config.model ?? agent.model,
    temperature: config.temperature ?? agent.temperature,
    prompt: config.prompt ?? agent.prompt,
    permission: mergePermission(agent.permission, config.permission),
  };
}

function createCustomAgent(name: string, config: CodingAgentConfig): CodingAgentInfo | undefined {
  if (config.disable || config.disabled) {
    return undefined;
  }

  return {
    name,
    description: config.description || 'Custom coding agent.',
    mode: config.mode || 'all',
    model: config.model,
    temperature: config.temperature,
    prompt: config.prompt,
    permission: mergePermission(clonePermissions(DEFAULT_PERMISSIONS), config.permission),
    native: false,
  };
}

function builtInAgents(): Record<string, CodingAgentInfo> {
  return {
    build: {
      name: 'build',
      description: DEFAULT_BUILD_DESCRIPTION,
      mode: 'primary',
      permission: clonePermissions(DEFAULT_PERMISSIONS),
      native: true,
    },
    plan: {
      name: 'plan',
      description: DEFAULT_PLAN_DESCRIPTION,
      mode: 'primary',
      prompt: [
        'You are in plan mode. Analyze, explain, and propose changes, but do not modify files or run commands that change the system.',
        'If implementation is needed, provide a concise plan and ask the user to switch to a build-capable agent.',
      ].join('\n'),
      permission: clonePermissions(PLAN_PERMISSIONS),
      native: true,
    },
  };
}

function getAgentDirectories(): string[] {
  return [
    path.join(os.homedir(), '.cobot', AGENT_DIRECTORY_NAME),
    path.join(process.cwd(), '.cobot', AGENT_DIRECTORY_NAME),
  ];
}

function listMarkdownFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return listMarkdownFiles(entryPath);
      }
      return entry.isFile() && entry.name.endsWith('.md') ? [entryPath] : [];
    });
}

function agentNameFromPath(directory: string, filePath: string): string {
  const relativePath = path.relative(directory, filePath);
  return relativePath.replace(/\.md$/i, '').split(path.sep).join('/');
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed.replace(/^['"]|['"]$/g, '');
}

function parseFrontmatter(content: string): { data: MarkdownAgentData; body: string } {
  if (!content.startsWith('---\n')) {
    return { data: {}, body: content.trim() };
  }

  const endIndex = content.indexOf('\n---', 4);
  if (endIndex === -1) {
    return { data: {}, body: content.trim() };
  }

  const frontmatter = content.slice(4, endIndex);
  const body = content.slice(endIndex + 4).trim();
  const data: MarkdownAgentData = {};
  let section: 'permission' | undefined;

  for (const rawLine of frontmatter.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim() || line.trimStart().startsWith('#')) {
      continue;
    }

    const nestedMatch = line.match(/^\s{2,}([A-Za-z_][A-Za-z0-9_-]*):\s*(.+)$/);
    if (nestedMatch && section === 'permission') {
      const [, key, rawValue] = nestedMatch;
      const value = parseScalar(rawValue);
      if (isPermissionKey(key) && isPermissionAction(value)) {
        data.permission = { ...(data.permission || {}), [key]: value };
      }
      continue;
    }

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    if (key === 'permission' && !rawValue.trim()) {
      section = 'permission';
      data.permission = data.permission || {};
      continue;
    }

    section = undefined;
    const value = parseScalar(rawValue);
    if (key === 'name' && typeof value === 'string') data.name = value;
    if (key === 'description' && typeof value === 'string') data.description = value;
    if (key === 'mode' && isAgentMode(value)) data.mode = value;
    if (key === 'model' && typeof value === 'string') data.model = value;
    if (key === 'temperature' && typeof value === 'number') data.temperature = value;
    if (key === 'disable' && typeof value === 'boolean') data.disable = value;
    if (key === 'disabled' && typeof value === 'boolean') data.disabled = value;
  }

  return { data, body };
}

function loadMarkdownAgents(): Record<string, CodingAgentConfig> {
  const agents: Record<string, CodingAgentConfig> = {};
  for (const directory of getAgentDirectories()) {
    for (const filePath of listMarkdownFiles(directory)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = parseFrontmatter(content);
      const name = parsed.data.name || agentNameFromPath(directory, filePath);
      agents[name] = {
        ...parsed.data,
        prompt: parsed.body,
      };
    }
  }
  return agents;
}

export function loadCodingAgents(configAgents?: Record<string, CodingAgentConfig>): CodingAgentInfo[] {
  const agents = builtInAgents();
  const mergedConfig = {
    ...(configAgents || {}),
    ...loadMarkdownAgents(),
  };

  for (const [name, rawConfig] of Object.entries(mergedConfig)) {
    const config = normalizeAgentConfig(rawConfig);
    if (!config) {
      continue;
    }

    const existing = agents[name];
    const next = existing ? applyConfig(existing, config) : createCustomAgent(name, config);
    if (next) {
      agents[name] = next;
    } else {
      delete agents[name];
    }
  }

  return Object.values(agents).sort((left, right) => {
    if (left.native !== right.native) {
      return left.native ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}

export function getDefaultCodingAgentName(defaultAgent?: string | null, agents = loadCodingAgents()): string {
  const configured = defaultAgent ? agents.find((agent) => agent.name === defaultAgent) : undefined;
  if (configured && configured.mode !== 'subagent') {
    return configured.name;
  }

  const build = agents.find((agent) => agent.name === 'build' && agent.mode !== 'subagent');
  if (build) {
    return build.name;
  }

  return agents.find((agent) => agent.mode !== 'subagent')?.name || 'build';
}

export function resolveCodingAgent(name?: string | null, defaultAgent?: string | null, configAgents?: Record<string, CodingAgentConfig>): CodingAgentInfo {
  const agents = loadCodingAgents(configAgents);
  const selectedName = name || getDefaultCodingAgentName(defaultAgent, agents);
  const selected = agents.find((agent) => agent.name === selectedName);

  if (!selected) {
    throw new Error(`Unknown coding agent: ${selectedName}`);
  }
  if (selected.mode === 'subagent') {
    throw new Error(`Coding agent "${selectedName}" is a subagent and cannot be selected as the primary agent.`);
  }

  return selected;
}

export function getToolPermissionKey(toolName: string): PermissionKey | undefined {
  return TOOL_PERMISSIONS[toolName];
}

export function getToolPermissionAction(toolName: string, agent: CodingAgentInfo): PermissionAction {
  const permissionKey = getToolPermissionKey(toolName);
  return permissionKey ? agent.permission[permissionKey] : 'ask';
}

export function filterToolSchemasForAgent(
  tools: ToolSchema[],
  agent: CodingAgentInfo,
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.filter((tool) => getToolPermissionAction(tool.function.name, agent) !== 'deny') as OpenAI.Chat.Completions.ChatCompletionTool[];
}

export function formatCodingAgentList(agents: CodingAgentInfo[], activeAgentName?: string): string {
  return agents
    .filter((agent) => agent.mode !== 'subagent')
    .map((agent) => {
      const marker = agent.name === activeAgentName ? '*' : '-';
      return `${marker} ${agent.name} (${agent.mode}) - ${agent.description}`;
    })
    .join('\n');
}
