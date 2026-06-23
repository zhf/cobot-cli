export function capitalize(value: string): string {
	return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

export function capitalizeIdentifierPart(value: string): string {
	const cleaned = value.replace(/^[^A-Za-z0-9_$]+|[^A-Za-z0-9_$]+$/g, '');
	return cleaned ? `${cleaned[0].toUpperCase()}${cleaned.slice(1)}` : cleaned;
}

export function lowerFirst(value: string): string {
	return value ? `${value[0].toLowerCase()}${value.slice(1)}` : value;
}

export function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function truncate(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value;
	}

	return `${value.slice(0, maxLength)}\n... [truncated]`;
}

export function trimLine(line: string): string {
	const trimmed = line.trim();
	return trimmed.length > 240 ? `${trimmed.slice(0, 240)}...` : trimmed;
}

export function parseJsonObject(content: string): unknown {
	const trimmed = content.trim();
	if (!trimmed) {
		return undefined;
	}

	try {
		return JSON.parse(trimmed);
	} catch {
		const match = trimmed.match(/\{[\s\S]*\}/);
		if (!match) {
			return undefined;
		}
		try {
			return JSON.parse(match[0]);
		} catch {
			return undefined;
		}
	}
}

export function stringArrayField(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function uniqueStrings(values: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		if (seen.has(value)) {
			continue;
		}
		seen.add(value);
		result.push(value);
	}
	return result;
}