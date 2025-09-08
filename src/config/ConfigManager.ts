import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface Config {
  openaiApiKey?: string;
  defaultModel?: string;
  openaiBaseURL?: string;
  theme?: 'dark' | 'light';
}

const CONFIG_DIRECTORY_NAME = '.cobot'; // In home directory
const CONFIG_FILE_NAME = 'config.json';

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
    // Priority: Config File > COBOT_* env vars > OPENAI_* env vars > Defaults
    const fileConfig = this.readConfigFromFile();
    const mergedConfig: Config = {};
    
    // Start with file config (highest priority)
    if (fileConfig.openaiApiKey) mergedConfig.openaiApiKey = fileConfig.openaiApiKey;
    if (fileConfig.defaultModel) mergedConfig.defaultModel = fileConfig.defaultModel;
    if (fileConfig.openaiBaseURL) mergedConfig.openaiBaseURL = fileConfig.openaiBaseURL;
    if (fileConfig.theme) mergedConfig.theme = fileConfig.theme;
    
    // COBOT_* environment variables (medium priority)
    if (!mergedConfig.openaiApiKey && process.env.COBOT_OPENAI_API_KEY) {
      mergedConfig.openaiApiKey = process.env.COBOT_OPENAI_API_KEY;
    }
    if (!mergedConfig.defaultModel && process.env.COBOT_DEFAULT_MODEL) {
      mergedConfig.defaultModel = process.env.COBOT_DEFAULT_MODEL;
    }
    if (!mergedConfig.openaiBaseURL && process.env.COBOT_OPENAI_BASE_URL) {
      mergedConfig.openaiBaseURL = process.env.COBOT_OPENAI_BASE_URL;
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
    try {
      const config = this.readConfigFromFile();
      delete config.openaiApiKey;

      if (Object.keys(config).length === 0) {
        if (fs.existsSync(this.configPath)) {
          fs.unlinkSync(this.configPath);
        }
      } else {
        this.writeConfigToFile(config);
      }
    } catch (error) {
      console.warn('Failed to clear API key:', error);
    }
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
    try {
      const config = this.readConfigFromFile();
      delete config.openaiBaseURL;

      if (Object.keys(config).length === 0) {
        if (fs.existsSync(this.configPath)) {
          fs.unlinkSync(this.configPath);
        }
      } else {
        this.writeConfigToFile(config);
      }
    } catch (error) {
      console.warn('Failed to clear base URL:', error);
    }
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
}

export default ConfigManager;
