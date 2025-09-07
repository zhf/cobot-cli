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
    const config = this.readConfigFromFile();
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
    const config = this.readConfigFromFile();
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
    const config = this.readConfigFromFile();
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
    const config = this.readConfigFromFile();
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
