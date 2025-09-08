import OpenAI from 'openai';
import type { ClientOptions } from 'openai';

export interface ChatCompletionOptions {
  model: string;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  temperature?: number;
  max_tokens?: number;
  tools?: any;
  tool_choice?: any;
  stream?: boolean;
  signal?: AbortSignal;
}

export async function createChatCompletion(
  client: OpenAI,
  options: ChatCompletionOptions
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const {
    model,
    messages,
    temperature = 0.7,
    max_tokens = 8000,
    tools,
    tool_choice,
    stream = false,
    signal,
  } = options;

  const completionOptions: any = {
    model,
    messages,
    temperature,
    max_tokens,
    stream,
  };

  if (tools) {
    completionOptions.tools = tools;
  }

  if (tool_choice) {
    completionOptions.tool_choice = tool_choice;
  }

  const requestConfig: any = {};
  if (signal) {
    requestConfig.signal = signal;
  }

  return client.chat.completions.create(completionOptions, requestConfig);
}