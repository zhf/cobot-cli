/**
 * Strictly parse a final answer as one JSON object. A single surrounding
 * ```json fence is tolerated; any other prose makes the answer invalid.
 */
export function parseJsonObject(text: string): Record<string, unknown> | undefined {
  let body = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/.exec(body);
  if (fenced) body = fenced[1].trim();
  if (!body.startsWith('{')) return undefined;
  try {
    const value = JSON.parse(body) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

/** System guidance appended for JSON-only runs. */
export function jsonOutputInstructions(schema?: unknown): string {
  return [
    'Your final answer must be exactly one JSON object and nothing else: no prose, no markdown fences.',
    ...(schema === undefined ? [] : [`The object must satisfy this JSON Schema:\n${JSON.stringify(schema)}`]),
  ].join('\n');
}
