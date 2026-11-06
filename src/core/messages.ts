import type { ResponseOutputItem } from 'openai/resources/responses/responses.js';

export interface ToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

export type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } };

export type MessageContent = string | MessageContentPart[];

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: MessageContent;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  reasoning?: string;
  responseOutput?: ResponseOutputItem[];
}

export function messageContentToString(content: MessageContent | undefined | null): string {
  if (content == null) {
    return '';
  }
  if (typeof content === 'string') {
    return content;
  }
  return content
    .map((part) => {
      if (part.type === 'text') {
        return part.text;
      }
      if (part.type === 'image_url') {
        return '[image]';
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

export interface ApiError {
  status: number;
  error: {
    error?: {
      message: string;
      code?: string;
    };
  };
}
