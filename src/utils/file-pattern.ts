/** Match basename wildcards or slash-separated paths. Brackets are literal (e.g. Next.js [id].ts). */
export function matchesFilePattern(value: string, pattern: string): boolean {
	let expression = '';
	for (let i = 0; i < pattern.length; i++) {
		const char = pattern[i];
		if (char === '*' && pattern[i + 1] === '*') {
			i++;
			if (pattern[i + 1] === '/') {
				i++;
				expression += '(?:.*/)?';
			} else {
				expression += '.*';
			}
		} else if (char === '*') {
			expression += '[^/]*';
		} else if (char === '?') {
			expression += '[^/]';
		} else {
			expression += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		}
	}
	return new RegExp(`^${expression}$`, 'i').test(value);
}
