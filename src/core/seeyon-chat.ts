import ConfigManager from '../config/ConfigManager.js';

export interface SeeyonAgent {
  _id: string;
  name: string;
  description?: string;
  avatar?: string;
  public?: boolean;
  promoted?: boolean;
  copyable?: boolean;
  agentTags?: string[];
  agentSettings?: {
    enabled?: boolean;
    interactive?: boolean;
    resultType?: 'rawResponse' | 'conversation' | 'json' | 'conclusion';
    resultSchema?: string;
    prompt?: string;
  };
}

export interface RunSeeyonAgentPayload {
  input: string;
  context?: Record<string, unknown>;
  formData?: Record<string, unknown>;
  fileIds?: string[];
  attachments?: string[];
  retrievalStrategy?: Record<string, unknown>;
}

export interface SeeyonAgentRunResult {
  content: string;
  raw: unknown;
}

export class SeeyonChatError extends Error {
  public status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'SeeyonChatError';
    this.status = status;
  }
}

function normalizeEndpoint(endpoint: string): string {
  const trimmedEndpoint = endpoint.trim().replace(/\/+$/, '');

  if (trimmedEndpoint.endsWith('/api')) {
    return trimmedEndpoint;
  }

  return `${trimmedEndpoint}/api`;
}

function getErrorMessage(status: number, body: unknown): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const message = record.message || record.error;

    if (typeof message === 'string') {
      return message;
    }
  }

  if (typeof body === 'string' && body.trim()) {
    return body;
  }

  if (status === 401) return 'Unauthorized. Check seeyonChatApiKey.';
  if (status === 403) return 'Forbidden. This account cannot access the requested agent.';
  if (status === 404) return 'Not found.';
  if (status === 429) return 'Rate limited by Seeyon Chat.';

  return `Seeyon Chat request failed with status ${status}.`;
}

async function readResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    return response.json();
  }

  return response.text();
}

function stringifyResult(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

export function formatAgentResultForContext(agent: SeeyonAgent, prompt: string, result: string): string {
  return [
    `Seeyon Chat agent "${agent.name}" was called.`,
    `Agent id: ${agent._id}`,
    '',
    'Request:',
    prompt,
    '',
    'Response:',
    result,
  ].join('\n');
}

export class SeeyonChatClient {
  private endpoint: string;

  private apiKey: string;

  constructor(apiKey: string, endpoint: string) {
    this.apiKey = apiKey;
    this.endpoint = normalizeEndpoint(endpoint);
  }

  static fromConfig(configManager = new ConfigManager()): SeeyonChatClient {
    const apiKey = configManager.getSeeyonChatApiKey();

    if (!apiKey) {
      throw new SeeyonChatError('No Seeyon Chat API key configured. Set seeyonChatApiKey first.');
    }

    return new SeeyonChatClient(apiKey, configManager.getSeeyonChatEndpoint());
  }

  async listAgents(): Promise<SeeyonAgent[]> {
    const response = await this.request('/agents', { method: 'GET' });

    if (!Array.isArray(response)) {
      throw new SeeyonChatError('Unexpected Seeyon Chat agents response.');
    }

    return response.filter((agent): agent is SeeyonAgent => {
      if (!agent || typeof agent !== 'object') return false;
      const record = agent as Record<string, unknown>;
      return typeof record._id === 'string' && typeof record.name === 'string';
    });
  }

  async runAgent(agentId: string, payload: RunSeeyonAgentPayload): Promise<SeeyonAgentRunResult> {
    const raw = await this.request(`/agents/${encodeURIComponent(agentId)}/run`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    return {
      content: stringifyResult(raw),
      raw,
    };
  }

  async resolveAgent(reference: string): Promise<SeeyonAgent> {
    const agents = await this.listAgents();
    const normalizedReference = reference.trim().toLowerCase();
    const idMatch = agents.find(agent => agent._id === reference.trim());

    if (idMatch) {
      return idMatch;
    }

    const normalizedName = normalizedReference;
    const exactMatches = agents.filter(agent => agent.name.toLowerCase() === normalizedName);

    if (exactMatches.length === 1) {
      return exactMatches[0];
    }

    if (exactMatches.length > 1) {
      throw new SeeyonChatError(`Multiple Seeyon Chat agents named "${reference}". Use a chatbot id.`);
    }

    const partialMatches = agents.filter(agent => agent.name.toLowerCase().includes(normalizedName));

    if (partialMatches.length === 1) {
      return partialMatches[0];
    }

    if (partialMatches.length > 1) {
      throw new SeeyonChatError(`Multiple Seeyon Chat agents match "${reference}": ${partialMatches.map(agent => `${agent.name} (${agent._id})`).join(', ')}`);
    }

    throw new SeeyonChatError(`No Seeyon Chat agent found for name or chatbot id "${reference}".`);
  }

  private async request(pathname: string, init: RequestInit): Promise<unknown> {
    const response = await fetch(`${this.endpoint}${pathname}`, {
      ...init,
      headers: {
        'Authorization': `Apikey ${this.apiKey}`,
        'Content-Type': 'application/json',
        'x-lang': 'en',
        ...init.headers,
      },
    });
    const body = await readResponse(response);

    if (!response.ok) {
      throw new SeeyonChatError(getErrorMessage(response.status, body), response.status);
    }

    return body;
  }
}
