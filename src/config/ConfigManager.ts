import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { CodingAgentConfig } from '../core/coding-agents.js';
import type { SkillConfig } from '../core/skills.js';

export interface ExploreRerankConfig {
  model?: string;
  apiKey?: string;
  baseURL?: string;
  topN?: number;
  perRole?: number;
  timeoutMs?: number;
  instruct?: string;
}

export type ExploreThinkingMode = 'default' | 'disabled';

export interface ExploreThinkingConfig {
  worker?: ExploreThinkingMode;
  synthesis?: ExploreThinkingMode;
}

export interface ExploreAdaptiveConfig {
  minHighPriorityFiles?: number;
  minDeclarationEvidence?: number;
  maxLowSignalRatio?: number;
}

export interface ExploreScanConfig {
  maxFiles?: number;
  recentFirst?: boolean;
  multiRepoMinDirs?: number;
  perRepoMaxFiles?: number;
  ignoreDirs?: string[];
  honorGitignore?: boolean;
}

export type ExploreDelegationMode = 'hardcoded' | 'adaptive';

export interface ExploreDelegationConfig {
  mode?: ExploreDelegationMode;
}

interface ExploreConfig {
  rerank?: ExploreRerankConfig;
  thinking?: ExploreThinkingConfig;
  adaptive?: ExploreAdaptiveConfig;
  scan?: ExploreScanConfig;
  delegation?: ExploreDelegationConfig;
}

interface Config {
  openaiApiKey?: string;
  defaultModel?: string;
  defaultAgent?: string;
  default_agent?: string;
  agent?: Record<string, CodingAgentConfig>;
  agents?: Record<string, CodingAgentConfig>;
  skills?: SkillConfig;
  openaiBaseURL?: string;
  theme?: 'dark' | 'light';
  extraRequest?: string;
  seeyonChatApiKey?: string;
  seeyonChatEndpoint?: string;
  explore?: ExploreConfig;
}

const DEFAULT_RERANK_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-api/v1/reranks';
const DEFAULT_RERANK_TOP_N = 32;
const DEFAULT_RERANK_PER_ROLE = 8;
const DEFAULT_RERANK_TIMEOUT_MS = 8000;
const DEFAULT_RERANK_INSTRUCT = 'Given a web search query, retrieve relevant passages that answer the query.';
const DEFAULT_ADAPTIVE_MIN_HIGH_PRIORITY_FILES = 4;
const DEFAULT_ADAPTIVE_MIN_DECLARATION_EVIDENCE = 1;
const DEFAULT_ADAPTIVE_MAX_LOW_SIGNAL_RATIO = 0.5;
const DEFAULT_SCAN_MAX_FILES = 60000;
const DEFAULT_SCAN_RECENT_FIRST = true;
const DEFAULT_SCAN_MULTI_REPO_MIN_DIRS = 8;
const DEFAULT_SCAN_PER_REPO_MIN_FILES = 1500;
const DEFAULT_SCAN_MULTI_REPO_CAP = 40;
const DEFAULT_SCAN_IGNORE_DIRS = [
  '.git', '.hg', '.svn', 'node_modules', '.next', '.nuxt', 'dist', 'build', 'out',
  '.cache', 'coverage', 'target', '.turbo', '.parcel-cache',
];
const DEFAULT_SCAN_HONOR_GITIGNORE = true;
const DEFAULT_DELEGATION_MODE: ExploreDelegationMode = 'adaptive';

const CONFIG_DIRECTORY_NAME = '.cobot'; // In home directory
const CONFIG_FILE_NAME = 'config.json';
const DEFAULT_SEEYON_CHAT_ENDPOINT = process.env.NODE_ENV === 'development' ? 'http://localhost:3001' : 'https://seeyon.chat';

function expandEnvironmentVariables(value: string): string {
  return value.replace(/\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g, (match, bracedName: string | undefined, bareName: string | undefined) => {
    const envName = bracedName || bareName;

    if (!envName) {
      return match;
    }

    return process.env[envName] ?? match;
  });
}

function isTheme(value: string): value is 'dark' | 'light' {
  return value === 'dark' || value === 'light';
}

function expandExploreRerankConfig(value: ExploreRerankConfig | undefined): ExploreRerankConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const expanded: ExploreRerankConfig = {};
  if (typeof value.model === 'string') expanded.model = expandEnvironmentVariables(value.model);
  if (typeof value.apiKey === 'string') expanded.apiKey = expandEnvironmentVariables(value.apiKey);
  if (typeof value.baseURL === 'string') expanded.baseURL = expandEnvironmentVariables(value.baseURL);
  if (typeof value.instruct === 'string') expanded.instruct = expandEnvironmentVariables(value.instruct);
  if (typeof value.topN === 'number' && Number.isFinite(value.topN)) expanded.topN = value.topN;
  if (typeof value.perRole === 'number' && Number.isFinite(value.perRole)) expanded.perRole = value.perRole;
  if (typeof value.timeoutMs === 'number' && Number.isFinite(value.timeoutMs)) expanded.timeoutMs = value.timeoutMs;
  return expanded;
}

function expandExploreThinkingConfig(value: ExploreThinkingConfig | undefined): ExploreThinkingConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const expanded: ExploreThinkingConfig = {};
  if (value.worker === 'default' || value.worker === 'disabled') expanded.worker = value.worker;
  if (value.synthesis === 'default' || value.synthesis === 'disabled') expanded.synthesis = value.synthesis;
  return expanded;
}

function expandExploreAdaptiveConfig(value: ExploreAdaptiveConfig | undefined): ExploreAdaptiveConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const expanded: ExploreAdaptiveConfig = {};
  if (typeof value.minHighPriorityFiles === 'number' && Number.isFinite(value.minHighPriorityFiles) && value.minHighPriorityFiles >= 0) {
    expanded.minHighPriorityFiles = Math.floor(value.minHighPriorityFiles);
  }
  if (typeof value.minDeclarationEvidence === 'number' && Number.isFinite(value.minDeclarationEvidence) && value.minDeclarationEvidence >= 0) {
    expanded.minDeclarationEvidence = Math.floor(value.minDeclarationEvidence);
  }
  if (typeof value.maxLowSignalRatio === 'number' && Number.isFinite(value.maxLowSignalRatio) && value.maxLowSignalRatio >= 0 && value.maxLowSignalRatio <= 1) {
    expanded.maxLowSignalRatio = value.maxLowSignalRatio;
  }
  return expanded;
}

function expandExploreScanConfig(value: ExploreScanConfig | undefined): ExploreScanConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const expanded: ExploreScanConfig = {};
  if (typeof value.maxFiles === 'number' && Number.isFinite(value.maxFiles) && value.maxFiles > 0) {
    expanded.maxFiles = Math.floor(value.maxFiles);
  }
  if (typeof value.recentFirst === 'boolean') {
    expanded.recentFirst = value.recentFirst;
  }
  if (typeof value.multiRepoMinDirs === 'number' && Number.isFinite(value.multiRepoMinDirs) && value.multiRepoMinDirs > 0) {
    expanded.multiRepoMinDirs = Math.floor(value.multiRepoMinDirs);
  }
  if (typeof value.perRepoMaxFiles === 'number' && Number.isFinite(value.perRepoMaxFiles) && value.perRepoMaxFiles > 0) {
    expanded.perRepoMaxFiles = Math.floor(value.perRepoMaxFiles);
  }
  if (Array.isArray(value.ignoreDirs)) {
    const ignoreDirs = value.ignoreDirs
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (ignoreDirs.length > 0) {
      expanded.ignoreDirs = ignoreDirs;
    }
  }
  if (typeof value.honorGitignore === 'boolean') {
    expanded.honorGitignore = value.honorGitignore;
  }
  return expanded;
}

function expandConfig(config: Config): Config {
  const expandedConfig: Config = {};

  if (config.openaiApiKey) expandedConfig.openaiApiKey = expandEnvironmentVariables(config.openaiApiKey);
  if (config.defaultModel) expandedConfig.defaultModel = expandEnvironmentVariables(config.defaultModel);
  if (config.defaultAgent) expandedConfig.defaultAgent = expandEnvironmentVariables(config.defaultAgent);
  if (config.default_agent) expandedConfig.default_agent = expandEnvironmentVariables(config.default_agent);
  if (config.agent) expandedConfig.agent = config.agent;
  if (config.agents) expandedConfig.agents = config.agents;
  if (config.skills) expandedConfig.skills = config.skills;
  if (config.openaiBaseURL) expandedConfig.openaiBaseURL = expandEnvironmentVariables(config.openaiBaseURL);
  if (config.extraRequest) expandedConfig.extraRequest = expandEnvironmentVariables(config.extraRequest);
  if (config.seeyonChatApiKey) expandedConfig.seeyonChatApiKey = expandEnvironmentVariables(config.seeyonChatApiKey);
  if (config.seeyonChatEndpoint) expandedConfig.seeyonChatEndpoint = expandEnvironmentVariables(config.seeyonChatEndpoint);

  if (config.theme) {
    const expandedTheme = expandEnvironmentVariables(config.theme);
    if (isTheme(expandedTheme)) expandedConfig.theme = expandedTheme;
  }

  const expandedRerank = expandExploreRerankConfig(config.explore?.rerank);
  const expandedThinking = expandExploreThinkingConfig(config.explore?.thinking);
  const expandedAdaptive = expandExploreAdaptiveConfig(config.explore?.adaptive);
  const expandedScan = expandExploreScanConfig(config.explore?.scan);
  if (expandedRerank || expandedThinking || expandedAdaptive || expandedScan) {
    expandedConfig.explore = {
      ...(expandedRerank ? { rerank: expandedRerank } : {}),
      ...(expandedThinking ? { thinking: expandedThinking } : {}),
      ...(expandedAdaptive ? { adaptive: expandedAdaptive } : {}),
      ...(expandedScan ? { scan: expandedScan } : {}),
    };
  }

  return expandedConfig;
}

class ConfigManager {
  private configPath: string;

  constructor() {
    const homeDir = os.homedir();
    this.configPath = path.join(homeDir, CONFIG_DIRECTORY_NAME, CONFIG_FILE_NAME);
  }

  private ensureConfigDirectoryExists(): void {
    const configDirectory = path.dirname(this.configPath);
    if (!fs.existsSync(configDirectory)) {
      fs.mkdirSync(configDirectory, { recursive: true });
    }
  }

  private readConfigFromFile(): Config {
    try {
      if (!fs.existsSync(this.configPath)) {
        return {};
      }
      const configData = fs.readFileSync(this.configPath, 'utf8');
      return JSON.parse(configData);
    } catch (error) {
      console.warn('Failed to read config file:', error);
      return {};
    }
  }

  private getConfig(): Config {
    // Priority: Config File > COBOT_* env vars > provider env vars > defaults
    const fileConfig = expandConfig(this.readConfigFromFile());
    const mergedConfig: Config = {};
    
    // Start with file config (highest priority)
    if (fileConfig.openaiApiKey) mergedConfig.openaiApiKey = fileConfig.openaiApiKey;
    if (fileConfig.defaultModel) mergedConfig.defaultModel = fileConfig.defaultModel;
    if (fileConfig.defaultAgent || fileConfig.default_agent) mergedConfig.defaultAgent = fileConfig.defaultAgent || fileConfig.default_agent;
    if (fileConfig.agent) mergedConfig.agent = fileConfig.agent;
    if (fileConfig.agents) mergedConfig.agents = fileConfig.agents;
    if (fileConfig.skills) mergedConfig.skills = fileConfig.skills;
    if (fileConfig.openaiBaseURL) mergedConfig.openaiBaseURL = fileConfig.openaiBaseURL;
    if (fileConfig.theme) mergedConfig.theme = fileConfig.theme;
    if (fileConfig.extraRequest) mergedConfig.extraRequest = fileConfig.extraRequest;
    if (fileConfig.seeyonChatApiKey) mergedConfig.seeyonChatApiKey = fileConfig.seeyonChatApiKey;
    if (fileConfig.seeyonChatEndpoint) mergedConfig.seeyonChatEndpoint = fileConfig.seeyonChatEndpoint;
    if (fileConfig.explore?.rerank || fileConfig.explore?.thinking || fileConfig.explore?.adaptive || fileConfig.explore?.scan || fileConfig.explore?.delegation) {
      mergedConfig.explore = {
        ...(fileConfig.explore.rerank ? { rerank: { ...fileConfig.explore.rerank } } : {}),
        ...(fileConfig.explore.thinking ? { thinking: { ...fileConfig.explore.thinking } } : {}),
        ...(fileConfig.explore.adaptive ? { adaptive: { ...fileConfig.explore.adaptive } } : {}),
        ...(fileConfig.explore.scan ? { scan: { ...fileConfig.explore.scan } } : {}),
        ...(fileConfig.explore.delegation ? { delegation: { ...fileConfig.explore.delegation } } : {}),
      };
    }
    
    // COBOT_* environment variables (medium priority)
    if (!mergedConfig.openaiApiKey && process.env.COBOT_OPENAI_API_KEY) {
      mergedConfig.openaiApiKey = process.env.COBOT_OPENAI_API_KEY;
    }
    if (!mergedConfig.defaultModel && process.env.COBOT_DEFAULT_MODEL) {
      mergedConfig.defaultModel = process.env.COBOT_DEFAULT_MODEL;
    }
    if (!mergedConfig.defaultAgent && process.env.COBOT_DEFAULT_AGENT) {
      mergedConfig.defaultAgent = process.env.COBOT_DEFAULT_AGENT;
    }
    if (!mergedConfig.openaiBaseURL && process.env.COBOT_OPENAI_BASE_URL) {
      mergedConfig.openaiBaseURL = process.env.COBOT_OPENAI_BASE_URL;
    }
    if (!mergedConfig.seeyonChatApiKey && process.env.COBOT_SEEYON_CHAT_API_KEY) {
      mergedConfig.seeyonChatApiKey = process.env.COBOT_SEEYON_CHAT_API_KEY;
    }
    if (!mergedConfig.seeyonChatEndpoint && process.env.COBOT_SEEYON_CHAT_ENDPOINT) {
      mergedConfig.seeyonChatEndpoint = process.env.COBOT_SEEYON_CHAT_ENDPOINT;
    }

    // SEEYON_* environment variables (fallback aliases)
    if (!mergedConfig.seeyonChatApiKey && process.env.SEEYON_CHAT_API_KEY) {
      mergedConfig.seeyonChatApiKey = process.env.SEEYON_CHAT_API_KEY;
    }
    if (!mergedConfig.seeyonChatEndpoint && process.env.SEEYON_CHAT_ENDPOINT) {
      mergedConfig.seeyonChatEndpoint = process.env.SEEYON_CHAT_ENDPOINT;
    }

    // Explore rerank environment variables (fallback aliases)
    const rerankEnv: ExploreRerankConfig = { ...(mergedConfig.explore?.rerank || {}) };
    if (!rerankEnv.model && process.env.COBOT_EXPLORE_RERANK_MODEL) {
      rerankEnv.model = process.env.COBOT_EXPLORE_RERANK_MODEL;
    }
    if (!rerankEnv.apiKey && (process.env.COBOT_EXPLORE_RERANK_API_KEY || process.env.DASHSCOPE_API_KEY)) {
      rerankEnv.apiKey = process.env.COBOT_EXPLORE_RERANK_API_KEY || process.env.DASHSCOPE_API_KEY;
    }
    if (!rerankEnv.baseURL && process.env.COBOT_EXPLORE_RERANK_BASE_URL) {
      rerankEnv.baseURL = process.env.COBOT_EXPLORE_RERANK_BASE_URL;
    }
    if (rerankEnv.topN === undefined && process.env.COBOT_EXPLORE_RERANK_TOP_N) {
      const parsedTopN = Number(process.env.COBOT_EXPLORE_RERANK_TOP_N);
      if (Number.isFinite(parsedTopN)) rerankEnv.topN = parsedTopN;
    }
    if (rerankEnv.perRole === undefined && process.env.COBOT_EXPLORE_RERANK_PER_ROLE) {
      const parsedPerRole = Number(process.env.COBOT_EXPLORE_RERANK_PER_ROLE);
      if (Number.isFinite(parsedPerRole)) rerankEnv.perRole = parsedPerRole;
    }
    if (rerankEnv.timeoutMs === undefined && process.env.COBOT_EXPLORE_RERANK_TIMEOUT_MS) {
      const parsedTimeout = Number(process.env.COBOT_EXPLORE_RERANK_TIMEOUT_MS);
      if (Number.isFinite(parsedTimeout)) rerankEnv.timeoutMs = parsedTimeout;
    }
    if (!rerankEnv.instruct && process.env.COBOT_EXPLORE_RERANK_INSTRUCT) {
      rerankEnv.instruct = process.env.COBOT_EXPLORE_RERANK_INSTRUCT;
    }
    if (Object.keys(rerankEnv).length > 0) {
      mergedConfig.explore = {
        ...(mergedConfig.explore || {}),
        rerank: rerankEnv,
      };
    }

    // Explore thinking environment variables (fallback aliases)
    const thinkingEnv: ExploreThinkingConfig = { ...(mergedConfig.explore?.thinking || {}) };
    const workerThinkingEnv = process.env.COBOT_EXPLORE_THINKING_WORKER;
    if (!thinkingEnv.worker && (workerThinkingEnv === 'default' || workerThinkingEnv === 'disabled')) {
      thinkingEnv.worker = workerThinkingEnv;
    }
    const synthesisThinkingEnv = process.env.COBOT_EXPLORE_THINKING_SYNTHESIS;
    if (!thinkingEnv.synthesis && (synthesisThinkingEnv === 'default' || synthesisThinkingEnv === 'disabled')) {
      thinkingEnv.synthesis = synthesisThinkingEnv;
    }
    if (Object.keys(thinkingEnv).length > 0) {
      mergedConfig.explore = {
        ...(mergedConfig.explore || {}),
        thinking: thinkingEnv,
      };
    }

    // Explore adaptive environment variables (fallback aliases)
    const adaptiveEnv: ExploreAdaptiveConfig = { ...(mergedConfig.explore?.adaptive || {}) };
    const minHighPriorityEnv = process.env.COBOT_EXPLORE_ADAPTIVE_MIN_HIGH_PRIORITY_FILES;
    if (adaptiveEnv.minHighPriorityFiles === undefined && minHighPriorityEnv !== undefined) {
      const parsed = Number(minHighPriorityEnv);
      if (Number.isFinite(parsed) && parsed >= 0) adaptiveEnv.minHighPriorityFiles = Math.floor(parsed);
    }
    const minDeclarationEnv = process.env.COBOT_EXPLORE_ADAPTIVE_MIN_DECLARATION_EVIDENCE;
    if (adaptiveEnv.minDeclarationEvidence === undefined && minDeclarationEnv !== undefined) {
      const parsed = Number(minDeclarationEnv);
      if (Number.isFinite(parsed) && parsed >= 0) adaptiveEnv.minDeclarationEvidence = Math.floor(parsed);
    }
    const maxLowSignalEnv = process.env.COBOT_EXPLORE_ADAPTIVE_MAX_LOW_SIGNAL_RATIO;
    if (adaptiveEnv.maxLowSignalRatio === undefined && maxLowSignalEnv !== undefined) {
      const parsed = Number(maxLowSignalEnv);
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) adaptiveEnv.maxLowSignalRatio = parsed;
    }
    if (Object.keys(adaptiveEnv).length > 0) {
      mergedConfig.explore = {
        ...(mergedConfig.explore || {}),
        adaptive: adaptiveEnv,
      };
    }

    // Explore scan environment variables (fallback aliases)
    const scanEnv: ExploreScanConfig = { ...(mergedConfig.explore?.scan || {}) };
    const maxFilesEnv = process.env.COBOT_EXPLORE_SCAN_MAX_FILES;
    if (scanEnv.maxFiles === undefined && maxFilesEnv !== undefined) {
      const parsed = Number(maxFilesEnv);
      if (Number.isFinite(parsed) && parsed > 0) scanEnv.maxFiles = Math.floor(parsed);
    }
    const recentFirstEnv = process.env.COBOT_EXPLORE_SCAN_RECENT_FIRST;
    if (scanEnv.recentFirst === undefined && recentFirstEnv !== undefined) {
      const normalized = recentFirstEnv.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
        scanEnv.recentFirst = true;
      } else if (normalized === 'false' || normalized === '0' || normalized === 'no') {
        scanEnv.recentFirst = false;
      }
    }
    const multiRepoMinDirsEnv = process.env.COBOT_EXPLORE_SCAN_MULTI_REPO_MIN_DIRS;
    if (scanEnv.multiRepoMinDirs === undefined && multiRepoMinDirsEnv !== undefined) {
      const parsed = Number(multiRepoMinDirsEnv);
      if (Number.isFinite(parsed) && parsed > 0) scanEnv.multiRepoMinDirs = Math.floor(parsed);
    }
    const perRepoMaxFilesEnv = process.env.COBOT_EXPLORE_SCAN_PER_REPO_MAX_FILES;
    if (scanEnv.perRepoMaxFiles === undefined && perRepoMaxFilesEnv !== undefined) {
      const parsed = Number(perRepoMaxFilesEnv);
      if (Number.isFinite(parsed) && parsed > 0) scanEnv.perRepoMaxFiles = Math.floor(parsed);
    }
    const ignoreDirsEnv = process.env.COBOT_EXPLORE_SCAN_IGNORE_DIRS;
    if (scanEnv.ignoreDirs === undefined && ignoreDirsEnv !== undefined) {
      const ignoreDirs = ignoreDirsEnv
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      if (ignoreDirs.length > 0) {
        scanEnv.ignoreDirs = ignoreDirs;
      }
    }
    const honorGitignoreEnv = process.env.COBOT_EXPLORE_SCAN_HONOR_GITIGNORE;
    if (scanEnv.honorGitignore === undefined && honorGitignoreEnv !== undefined) {
      const normalized = honorGitignoreEnv.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
        scanEnv.honorGitignore = true;
      } else if (normalized === 'false' || normalized === '0' || normalized === 'no') {
        scanEnv.honorGitignore = false;
      }
    }
    if (Object.keys(scanEnv).length > 0) {
      mergedConfig.explore = {
        ...(mergedConfig.explore || {}),
        scan: scanEnv,
      };
    }

    const delegationEnv: ExploreDelegationConfig = { ...(mergedConfig.explore?.delegation || {}) };
    const delegationModeEnv = process.env.COBOT_EXPLORE_DELEGATION_MODE;
    if (!delegationEnv.mode && (delegationModeEnv === 'hardcoded' || delegationModeEnv === 'adaptive')) {
      delegationEnv.mode = delegationModeEnv;
    }
    if (Object.keys(delegationEnv).length > 0) {
      mergedConfig.explore = {
        ...(mergedConfig.explore || {}),
        delegation: delegationEnv,
      };
    }
    
    // OPENAI_* environment variables (lowest priority, as fallback)
    if (!mergedConfig.openaiApiKey && process.env.OPENAI_API_KEY) {
      mergedConfig.openaiApiKey = process.env.OPENAI_API_KEY;
    }
    if (!mergedConfig.openaiBaseURL && process.env.OPENAI_BASE_URL) {
      mergedConfig.openaiBaseURL = process.env.OPENAI_BASE_URL;
    }
    
    return mergedConfig;
  }

  private removeConfigValue(key: keyof Config, warningMessage: string): void {
    try {
      const config = this.readConfigFromFile();
      delete config[key];

      if (Object.keys(config).length === 0) {
        if (fs.existsSync(this.configPath)) {
          fs.unlinkSync(this.configPath);
        }
      } else {
        this.writeConfigToFile(config);
      }
    } catch (error) {
      console.warn(warningMessage, error);
    }
  }

  private writeConfigToFile(config: Config): void {
    this.ensureConfigDirectoryExists();
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), {
      mode: 0o600, // Read/write for owner only
    });
    // Ensure restrictive perms even if file already existed
    try {
      fs.chmodSync(this.configPath, 0o600);
    } catch {
      // noop (esp. on Windows where chmod may not be supported)
    }
  }

  public getApiKey(): string | null {
    const config = this.getConfig();
    return config.openaiApiKey || null;
  }

  public setApiKey(apiKey: string): void {
    try {
      const config = this.readConfigFromFile();
      config.openaiApiKey = apiKey;
      this.writeConfigToFile(config);
    } catch (error) {
      throw new Error(`Failed to save API key: ${error}`);
    }
  }

  public clearApiKey(): void {
    this.removeConfigValue('openaiApiKey', 'Failed to clear API key:');
  }

  public getDefaultModel(): string | null {
    const config = this.getConfig();
    return config.defaultModel || null;
  }

  public setDefaultModel(model: string): void {
    try {
      const config = this.readConfigFromFile();
      config.defaultModel = model;
      this.writeConfigToFile(config);
    } catch (error) {
      throw new Error(`Failed to save default model: ${error}`);
    }
  }

  public getDefaultAgent(): string | null {
    const config = this.getConfig();
    return config.defaultAgent || null;
  }

  public setDefaultAgent(agentName: string): void {
    try {
      const config = this.readConfigFromFile();
      config.defaultAgent = agentName;
      this.writeConfigToFile(config);
    } catch (error) {
      throw new Error(`Failed to save default agent: ${error}`);
    }
  }

  public clearDefaultAgent(): void {
    try {
      const config = this.readConfigFromFile();
      delete config.defaultAgent;
      delete config.default_agent;

      if (Object.keys(config).length === 0) {
        if (fs.existsSync(this.configPath)) {
          fs.unlinkSync(this.configPath);
        }
      } else {
        this.writeConfigToFile(config);
      }
    } catch (error) {
      console.warn('Failed to clear default agent:', error);
    }
  }

  public getCodingAgents(): Record<string, CodingAgentConfig> {
    const config = this.getConfig();
    return {
      ...(config.agent || {}),
      ...(config.agents || {}),
    };
  }

  public getSkillsConfig(): SkillConfig {
    const config = this.getConfig();
    return config.skills || {};
  }

  public getBaseURL(): string | null {
    const config = this.getConfig();
    return config.openaiBaseURL || null;
  }

  public setBaseURL(baseURL: string): void {
    try {
      const config = this.readConfigFromFile();
      config.openaiBaseURL = baseURL;
      this.writeConfigToFile(config);
    } catch (error) {
      throw new Error(`Failed to save base URL: ${error}`);
    }
  }

  public clearBaseURL(): void {
    this.removeConfigValue('openaiBaseURL', 'Failed to clear base URL:');
  }

  public getTheme(): 'dark' | 'light' {
    const config = this.getConfig();
    return config.theme || 'dark'; // Default to dark theme
  }

  public setTheme(theme: 'dark' | 'light'): void {
    try {
      const config = this.readConfigFromFile();
      config.theme = theme;
      this.writeConfigToFile(config);
    } catch (error) {
      throw new Error(`Failed to save theme preference: ${error}`);
    }
  }

  public getExtraRequestString(): string | null {
    const config = this.getConfig();
    return config.extraRequest || null;
  }

  public getExtraRequest(): Record<string, unknown> {
    const extraRequest = this.getExtraRequestString();

    if (!extraRequest) {
      return {};
    }

    try {
      const parsedValue: unknown = JSON.parse(extraRequest);

      if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) {
        console.warn('Ignoring extraRequest config: value must parse to a JSON object');
        return {};
      }

      return parsedValue as Record<string, unknown>;
    } catch (error) {
      console.warn('Ignoring extraRequest config: failed to parse JSON:', error);
      return {};
    }
  }

  public setExtraRequest(extraRequest: string): void {
    try {
      const parsedValue: unknown = JSON.parse(extraRequest);

      if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) {
        throw new Error('extraRequest must be a JSON object string');
      }

      const config = this.readConfigFromFile();
      config.extraRequest = extraRequest;
      this.writeConfigToFile(config);
    } catch (error) {
      throw new Error(`Failed to save extra request payload: ${error}`);
    }
  }

  public clearExtraRequest(): void {
    this.removeConfigValue('extraRequest', 'Failed to clear extra request payload:');
  }

  public getSeeyonChatApiKey(): string | null {
    const config = this.getConfig();
    return config.seeyonChatApiKey || null;
  }

  public setSeeyonChatApiKey(apiKey: string): void {
    try {
      const config = this.readConfigFromFile();
      config.seeyonChatApiKey = apiKey;
      this.writeConfigToFile(config);
    } catch (error) {
      throw new Error(`Failed to save Seeyon Chat API key: ${error}`);
    }
  }

  public clearSeeyonChatApiKey(): void {
    this.removeConfigValue('seeyonChatApiKey', 'Failed to clear Seeyon Chat API key:');
  }

  public getSeeyonChatEndpoint(): string {
    const config = this.getConfig();
    return config.seeyonChatEndpoint || DEFAULT_SEEYON_CHAT_ENDPOINT;
  }

  public setSeeyonChatEndpoint(endpoint: string): void {
    try {
      const config = this.readConfigFromFile();
      config.seeyonChatEndpoint = endpoint;
      this.writeConfigToFile(config);
    } catch (error) {
      throw new Error(`Failed to save Seeyon Chat endpoint: ${error}`);
    }
  }

  public clearSeeyonChatEndpoint(): void {
    this.removeConfigValue('seeyonChatEndpoint', 'Failed to clear Seeyon Chat endpoint:');
  }

  public getExploreRerankConfig(): ExploreRerankConfig | null {
    const config = this.getConfig();
    const rerank = config.explore?.rerank;
    if (!rerank || !rerank.model) {
      return null;
    }

    return {
      model: rerank.model,
      apiKey: rerank.apiKey || undefined,
      baseURL: rerank.baseURL || DEFAULT_RERANK_BASE_URL,
      topN: typeof rerank.topN === 'number' ? rerank.topN : DEFAULT_RERANK_TOP_N,
      perRole: typeof rerank.perRole === 'number' ? rerank.perRole : DEFAULT_RERANK_PER_ROLE,
      timeoutMs: typeof rerank.timeoutMs === 'number' ? rerank.timeoutMs : DEFAULT_RERANK_TIMEOUT_MS,
      instruct: rerank.instruct || DEFAULT_RERANK_INSTRUCT,
    };
  }

  public setExploreRerankConfig(partial: ExploreRerankConfig): void {
    try {
      const config = this.readConfigFromFile();
      const existing = config.explore?.rerank || {};
      config.explore = {
        ...(config.explore || {}),
        rerank: { ...existing, ...partial },
      };
      this.writeConfigToFile(config);
    } catch (error) {
      throw new Error(`Failed to save explore rerank config: ${error}`);
    }
  }

  public clearExploreRerankConfig(): void {
    try {
      const config = this.readConfigFromFile();
      if (config.explore) {
        delete config.explore.rerank;
        if (Object.keys(config.explore).length === 0) {
          delete config.explore;
        }
      }

      if (Object.keys(config).length === 0) {
        if (fs.existsSync(this.configPath)) {
          fs.unlinkSync(this.configPath);
        }
      } else {
        this.writeConfigToFile(config);
      }
    } catch (error) {
      console.warn('Failed to clear explore rerank config:', error);
    }
  }

  public getExploreThinkingConfig(): ExploreThinkingConfig {
    const config = this.getConfig();
    const thinking = config.explore?.thinking;
    return {
      worker: thinking?.worker === 'disabled' ? 'disabled' : 'default',
      synthesis: thinking?.synthesis === 'disabled' ? 'disabled' : 'default',
    };
  }

  public setExploreThinkingConfig(partial: ExploreThinkingConfig): void {
    try {
      const config = this.readConfigFromFile();
      const existing = config.explore?.thinking || {};
      config.explore = {
        ...(config.explore || {}),
        thinking: { ...existing, ...partial },
      };
      this.writeConfigToFile(config);
    } catch (error) {
      throw new Error(`Failed to save explore thinking config: ${error}`);
    }
  }

  public clearExploreThinkingConfig(): void {
    try {
      const config = this.readConfigFromFile();
      if (config.explore) {
        delete config.explore.thinking;
        if (Object.keys(config.explore).length === 0) {
          delete config.explore;
        }
      }

      if (Object.keys(config).length === 0) {
        if (fs.existsSync(this.configPath)) {
          fs.unlinkSync(this.configPath);
        }
      } else {
        this.writeConfigToFile(config);
      }
    } catch (error) {
      console.warn('Failed to clear explore thinking config:', error);
    }
  }

  public getExploreAdaptiveConfig(): ExploreAdaptiveConfig {
    const config = this.getConfig();
    const adaptive = config.explore?.adaptive;
    return {
      minHighPriorityFiles: typeof adaptive?.minHighPriorityFiles === 'number' ? adaptive.minHighPriorityFiles : DEFAULT_ADAPTIVE_MIN_HIGH_PRIORITY_FILES,
      minDeclarationEvidence: typeof adaptive?.minDeclarationEvidence === 'number' ? adaptive.minDeclarationEvidence : DEFAULT_ADAPTIVE_MIN_DECLARATION_EVIDENCE,
      maxLowSignalRatio: typeof adaptive?.maxLowSignalRatio === 'number' ? adaptive.maxLowSignalRatio : DEFAULT_ADAPTIVE_MAX_LOW_SIGNAL_RATIO,
    };
  }

  public setExploreAdaptiveConfig(partial: ExploreAdaptiveConfig): void {
    try {
      const config = this.readConfigFromFile();
      const existing = config.explore?.adaptive || {};
      config.explore = {
        ...(config.explore || {}),
        adaptive: { ...existing, ...partial },
      };
      this.writeConfigToFile(config);
    } catch (error) {
      throw new Error(`Failed to save explore adaptive config: ${error}`);
    }
  }

  public clearExploreAdaptiveConfig(): void {
    try {
      const config = this.readConfigFromFile();
      if (config.explore) {
        delete config.explore.adaptive;
        if (Object.keys(config.explore).length === 0) {
          delete config.explore;
        }
      }

      if (Object.keys(config).length === 0) {
        if (fs.existsSync(this.configPath)) {
          fs.unlinkSync(this.configPath);
        }
      } else {
        this.writeConfigToFile(config);
      }
    } catch (error) {
      console.warn('Failed to clear explore adaptive config:', error);
    }
  }

  public getExploreScanConfig(): Required<ExploreScanConfig> {
    const config = this.getConfig();
    const scan = config.explore?.scan;
    const maxFiles = typeof scan?.maxFiles === 'number' ? scan.maxFiles : DEFAULT_SCAN_MAX_FILES;
    const ignoreDirs = [...new Set([
      ...DEFAULT_SCAN_IGNORE_DIRS,
      ...(Array.isArray(scan?.ignoreDirs) ? scan.ignoreDirs : []),
    ])];
    return {
      maxFiles,
      recentFirst: scan?.recentFirst ?? DEFAULT_SCAN_RECENT_FIRST,
      multiRepoMinDirs: typeof scan?.multiRepoMinDirs === 'number' ? scan.multiRepoMinDirs : DEFAULT_SCAN_MULTI_REPO_MIN_DIRS,
      perRepoMaxFiles: typeof scan?.perRepoMaxFiles === 'number'
        ? scan.perRepoMaxFiles
        : Math.max(
          DEFAULT_SCAN_PER_REPO_MIN_FILES,
          Math.floor(maxFiles / DEFAULT_SCAN_MULTI_REPO_CAP),
        ),
      ignoreDirs,
      honorGitignore: scan?.honorGitignore ?? DEFAULT_SCAN_HONOR_GITIGNORE,
    };
  }

  public setExploreScanConfig(partial: ExploreScanConfig): void {
    try {
      const config = this.readConfigFromFile();
      const existing = config.explore?.scan || {};
      config.explore = {
        ...(config.explore || {}),
        scan: { ...existing, ...partial },
      };
      this.writeConfigToFile(config);
    } catch (error) {
      throw new Error(`Failed to save explore scan config: ${error}`);
    }
  }

  public clearExploreScanConfig(): void {
    try {
      const config = this.readConfigFromFile();
      if (config.explore) {
        delete config.explore.scan;
        if (Object.keys(config.explore).length === 0) {
          delete config.explore;
        }
      }

      if (Object.keys(config).length === 0) {
        if (fs.existsSync(this.configPath)) {
          fs.unlinkSync(this.configPath);
        }
      } else {
        this.writeConfigToFile(config);
      }
    } catch (error) {
      console.warn('Failed to clear explore scan config:', error);
    }
  }

  public getExploreDelegationConfig(): Required<ExploreDelegationConfig> {
    const config = this.getConfig();
    const delegation = config.explore?.delegation;
    return {
      mode: delegation?.mode === 'hardcoded' ? 'hardcoded' : DEFAULT_DELEGATION_MODE,
    };
  }

  public setExploreDelegationConfig(partial: ExploreDelegationConfig): void {
    try {
      const config = this.readConfigFromFile();
      const existing = config.explore?.delegation || {};
      config.explore = {
        ...(config.explore || {}),
        delegation: { ...existing, ...partial },
      };
      this.writeConfigToFile(config);
    } catch (error) {
      throw new Error(`Failed to save explore delegation config: ${error}`);
    }
  }

  public clearExploreDelegationConfig(): void {
    try {
      const config = this.readConfigFromFile();
      if (config.explore) {
        delete config.explore.delegation;
        if (Object.keys(config.explore).length === 0) {
          delete config.explore;
        }
      }

      if (Object.keys(config).length === 0) {
        if (fs.existsSync(this.configPath)) {
          fs.unlinkSync(this.configPath);
        }
      } else {
        this.writeConfigToFile(config);
      }
    } catch (error) {
      console.warn('Failed to clear explore delegation config:', error);
    }
  }
}

export default ConfigManager;
