export interface ToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  reasoning?: string;
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