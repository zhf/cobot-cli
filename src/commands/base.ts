export interface CommandContext {
  addMessage: (message: unknown) => void;
  clearHistory: () => void;
  setShowLogin: (show: boolean) => void;
  setShowModelSelector?: (show: boolean) => void;
  setShowBaseURLSelector?: (show: boolean) => void;
  toggleReasoning?: () => void;
  showReasoning?: boolean;
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
