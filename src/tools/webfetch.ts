import { ToolResult, createToolResponse } from './files.js';

const DEFAULT_TIMEOUT_SECONDS = 30;
const MAX_TIMEOUT_SECONDS = 120;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

type WebFetchFormat = 'text' | 'markdown' | 'html';

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function htmlToMarkdown(html: string): string {
  return stripHtml(html);
}

export async function webfetch(url: string, format: WebFetchFormat = 'markdown', timeout?: number): Promise<ToolResult> {
  try {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return createToolResponse(false, undefined, '', 'Error: URL must start with http:// or https://');
    }

    const timeoutSeconds = Math.min(timeout || DEFAULT_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'cobot-cli',
          Accept: 'text/html,text/markdown,text/plain,*/*;q=0.8',
        },
      });

      if (!response.ok) {
        return createToolResponse(false, undefined, '', `Error: HTTP ${response.status} ${response.statusText}`);
      }

      const contentLength = response.headers.get('content-length');
      if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
        return createToolResponse(false, undefined, '', 'Error: Response too large (exceeds 5MB limit)');
      }

      const body = await response.text();
      if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) {
        return createToolResponse(false, undefined, '', 'Error: Response too large (exceeds 5MB limit)');
      }

      const content = format === 'html'
        ? body
        : format === 'text'
          ? stripHtml(body)
          : htmlToMarkdown(body);

      return createToolResponse(true, content, `Fetched ${url}`);
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'Error: Request timed out'
      : `Error: Failed to fetch URL - ${error instanceof Error ? error.message : String(error)}`;
    return createToolResponse(false, undefined, '', message);
  }
}
