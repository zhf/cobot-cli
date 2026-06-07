import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { CodingAgentConfig } from '../core/coding-agents.js';
import type { SkillConfig } from '../core/skills.js';

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
}

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
}

export default ConfigManager;
