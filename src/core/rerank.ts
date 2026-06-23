import { debugLog } from './logger.js';

export interface RerankOptions {
  apiKey: string;
  baseURL: string;
  model: string;
  query: string;
  documents: string[];
  topN?: number;
  instruct?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface RerankHit {
  index: number;
  relevanceScore: number;
}

export interface RerankResult {
  results: RerankHit[];
  totalTokens: number;
}

interface QwenRerankResponse {
  results?: Array<{ index: number; relevance_score?: number }>;
  usage?: { total_tokens?: number };
  code?: string;
  message?: string;
}

const RERANK_BATCH_SIZE = 200;

export async function rerankDocuments(options: RerankOptions): Promise<RerankResult | null> {
  if (!options.apiKey) {
    debugLog('Rerank skipped: missing API key');
    return null;
  }
  if (!options.documents.length) {
    return { results: [], totalTokens: 0 };
  }

  try {
    const merged = await runRerankBatches(options);
    return merged;
  } catch (error) {
    debugLog('Rerank failed:', error);
    return null;
  }
}

async function runRerankBatches(options: RerankOptions): Promise<RerankResult> {
  const batches = partitionDocuments(options.documents, RERANK_BATCH_SIZE);
  const offsetForBatch = (batchIndex: number) => batchIndex * RERANK_BATCH_SIZE;
  const mergedResults: RerankHit[] = [];
  let totalTokens = 0;

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    if (options.signal?.aborted) {
      break;
    }

    const batch = batches[batchIndex];
    const offset = offsetForBatch(batchIndex);
    const batchTopN = options.topN ? Math.min(options.topN, batch.length) : batch.length;
    const batchResult = await callRerankEndpoint({
      ...options,
      documents: batch,
      topN: batchTopN,
    });

    if (!batchResult) {
      // Caller already logged via debugLog; surface as a soft failure by returning what we have.
      return { results: mergedResults, totalTokens };
    }

    for (const hit of batchResult.results) {
      mergedResults.push({ index: hit.index + offset, relevanceScore: hit.relevanceScore });
    }
    totalTokens += batchResult.totalTokens;
  }

  mergedResults.sort((left, right) => right.relevanceScore - left.relevanceScore);
  const trimmed = options.topN ? mergedResults.slice(0, options.topN) : mergedResults;
  return { results: trimmed, totalTokens };
}

function partitionDocuments(documents: string[], batchSize: number): string[][] {
  if (documents.length <= batchSize) {
    return [documents];
  }

  const batches: string[][] = [];
  for (let index = 0; index < documents.length; index += batchSize) {
    batches.push(documents.slice(index, index + batchSize));
  }
  return batches;
}

async function callRerankEndpoint(options: RerankOptions): Promise<RerankResult | null> {
  const controller = new AbortController();
  const timeoutId = options.timeoutMs
    ? setTimeout(() => controller.abort(), options.timeoutMs)
    : undefined;

  const combinedSignal = options.signal
    ? mergeAbortSignals(options.signal, controller.signal)
    : controller.signal;

  try {
    const response = await fetch(options.baseURL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options.model,
        query: options.query,
        documents: options.documents,
        top_n: options.topN ?? options.documents.length,
        instruct: options.instruct,
      }),
      signal: combinedSignal,
    });

    if (!response.ok) {
      const text = await safeReadText(response);
      debugLog(`Rerank HTTP ${response.status}:`, text);
      return null;
    }

    const data = (await response.json()) as QwenRerankResponse;
    if (data.code) {
      debugLog('Rerank error response:', { code: data.code, message: data.message });
      return null;
    }

    const results = (data.results || [])
      .map((entry) => ({
        index: typeof entry.index === 'number' ? entry.index : 0,
        relevanceScore: typeof entry.relevance_score === 'number' ? entry.relevance_score : 0,
      }))
      .sort((left, right) => right.relevanceScore - left.relevanceScore);

    return {
      results,
      totalTokens: data.usage?.total_tokens ?? 0,
    };
  } catch (error) {
    if (isAbortError(error)) {
      debugLog('Rerank request aborted (timeout or caller signal)');
    } else {
      debugLog('Rerank request threw:', error);
    }
    return null;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function mergeAbortSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      continue;
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === 'AbortError';
  }
  return false;
}
