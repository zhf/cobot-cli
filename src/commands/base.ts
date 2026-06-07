import type { SessionListItem } from '../core/session-store.js';
import type { CodingAgentInfo } from '../core/coding-agents.js';

export interface CommandContext {
  addMessage: (message: unknown) => void;
  clearHistory: () => void;
  setShowLogin: (show: boolean) => void;
  setShowModelSelector?: (show: boolean) => void;
  setShowBaseURLSelector?: (show: boolean) => void;
  setShowSeeyonAgentRunner?: (show: boolean) => void;
  commandArgs?: string;
  startNewSession?: (title?: string) => void;
  listSessions?: () => SessionListItem[];
  resumeSession?: (reference?: string) => void;
  deleteSession?: (reference: string) => void;
  listCodingAgents?: () => CodingAgentInfo[];
  switchCodingAgent?: (agentName: string) => void;
  activeCodingAgentName?: string;
  activeSessionId?: string;
  toggleReasoning?: () => void;
  showReasoning?: boolean;
  toggleTheme?: () => void;
  isDarkTheme?: boolean;
  sessionStats?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    totalRequests: number;
    totalTime: number;
  };
}

export interface CommandDefinition {
  command: string;
  description: string;
  handler: (context: CommandContext) => void;
}

export abstract class BaseCommand implements CommandDefinition {
  abstract command: string;

  abstract description: string;

  abstract handler(context: CommandContext): void;
}
