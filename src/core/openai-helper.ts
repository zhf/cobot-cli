import OpenAI from 'openai';
import type { ClientOptions } from 'openai';
import ConfigManager from '../config/ConfigManager.js';

export interface ChatCompletionOptions {
  model: string;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  temperature?: number;
  max_tokens?: number;
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  tool_choice?: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption;
  stream?: boolean;
  stream_options?: OpenAI.Chat.Completions.ChatCompletionStreamOptions;
  signal?: AbortSignal;
  extraBody?: Record<string, unknown>;
}

export function getTokenLimitOption(model: string, maxTokens: number): Record<string, number> {
  return model.startsWith('gpt-5')
    ? { max_completion_tokens: maxTokens }
    : { max_tokens: maxTokens };
}

export function buildChatCompletionPayload(options: ChatCompletionOptions): Record<string, unknown> {
  const {
    model,
    messages,
    temperature = 0.7,
    max_tokens = 8000,
    tools,
    tool_choice,
    stream = false,
    stream_options,
    extraBody,
  } = options;
  const configManager = new ConfigManager();
  const completionOptions: Record<string, unknown> = {
    ...configManager.getExtraRequest(),
    ...(extraBody || {}),
    model,
    messages,
    temperature,
    stream,
    ...getTokenLimitOption(model, max_tokens),
  };

  if (tools) {
    completionOptions.tools = tools;
  }

  if (tool_choice) {
    completionOptions.tool_choice = tool_choice;
  }

  if (stream_options) {
    completionOptions.stream_options = stream_options;
  }

  return completionOptions;
}

export async function createChatCompletion(
  client: OpenAI,
  options: ChatCompletionOptions
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const completionOptions = buildChatCompletionPayload(options);

  const requestConfig: { signal?: AbortSignal } = {};
  if (options.signal) {
    requestConfig.signal = options.signal;
  }

  return client.chat.completions.create(completionOptions as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming, requestConfig);
}

export async function createStreamingChatCompletion(
  client: OpenAI,
  options: ChatCompletionOptions
): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
  const completionOptions = buildChatCompletionPayload({ ...options, stream: true });

  const requestConfig: { signal?: AbortSignal } = {};
  if (options.signal) {
    requestConfig.signal = options.signal;
  }

  return client.chat.completions.create(completionOptions as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming, requestConfig);
}
