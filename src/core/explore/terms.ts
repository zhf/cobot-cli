import * as path from 'path';
import { INSTRUCTION_WORDS, BIGRAM_GLUE_WORDS } from './constants.js';
import { capitalize, capitalizeIdentifierPart, lowerFirst, uniqueStrings } from './text-utils.js';

export function isAcronymToken(word: string): boolean {
	return /^[A-Z]{2,6}$/.test(word);
}

export function splitIdentifierParts(value: string): string[] {
	return value
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
		.split(/[^A-Za-z0-9]+/)
		.map((part) => part.trim())
		.filter((part) => part.length >= 3);
}

export function termPriority(term: string): number {
	if (isFileLikeTerm(term)) {
		return 260;
	}
	if (isDottedIdentifier(term)) {
		return 240;
	}
	if (isKeyboardTerm(term)) {
		return 180;
	}
	if (isCompoundIdentifier(term)) {
		return 120;
	}
	if (term.length >= 12 && !/\s/.test(term)) {
		return 40;
	}
	return 0;
}

export function isFileLikeTerm(term: string): boolean {
	return /(?:^|\/)[^/\s]+\.[A-Za-z0-9]{1,8}$/.test(term);
}

export function isDottedIdentifier(term: string): boolean {
	return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$-]*)+$/.test(term);
}

export function isKeyboardTerm(term: string): boolean {
	return /\b(?:Ctrl|Cmd|Command|Alt|Shift|Meta)\+[A-Za-z0-9]\b/i.test(term)
		|| /^Key[A-Z0-9]$/.test(term)
		|| term === 'CtrlCmd';
}

export function isStrongExactMatchTerm(term: string): boolean {
	if (termPriority(term) < 120) {
		return false;
	}
	if (isFileLikeTerm(term) || isDottedIdentifier(term)) {
		return true;
	}
	return term.length >= 8;
}

export function isCompoundIdentifier(term: string): boolean {
	if (/^[A-Z]{2,8}$/.test(term)) {
		return false;
	}
	if (/^[a-z_$][\w$]*(?:[A-Z][A-Za-z0-9_$]+)+$/.test(term)) {
		return true;
	}
	if (/^[A-Z][a-z][\w$]*(?:[A-Z][A-Za-z0-9_$]+)*$/.test(term)) {
		return true;
	}
	return /^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)+$/.test(term);
}

export function isStrongPathTerm(term: string): boolean {
	return termPriority(term) >= 120;
}

export function termMatchesLine(line: string, term: string): boolean {
	if (term.length <= 6 && /[A-Z]/.test(term)) {
		return line.includes(term);
	}
	return line.toLowerCase().includes(term.toLowerCase());
}

export function extractStructuredTerms(value: string): string[] {
	const terms: string[] = [];
	const patterns = [
		/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$-]*)+/g,
		/[A-Za-z_$][\w$]*(?:[A-Z][A-Za-z0-9_$]+)+/g,
		/[a-z][a-z0-9]*(?:_[a-z][a-z0-9]*)+/g,
	];

	for (const pattern of patterns) {
		for (const match of value.matchAll(pattern)) {
			terms.push(match[0]);
		}
	}

	return terms;
}

export function extractFileLikeTerms(value: string): string[] {
	const terms: string[] = [];
	for (const match of value.matchAll(/\b[A-Za-z0-9][A-Za-z0-9_.-]*\.(?:[A-Za-z0-9]{1,8})\b/g)) {
		terms.push(match[0]);
	}
	return terms;
}

export function extractQuotedTerms(value: string): string[] {
	const terms: string[] = [];
	for (const match of value.matchAll(/["'`]([^"'`]{3,80})["'`]/g)) {
		terms.push(match[1]);
	}
	return terms;
}

export function extractWordVariants(value: string): string[] {
	const rawWords = value
		.replace(/[^A-Za-z0-9_+#.-]+/g, ' ')
		.split(/\s+/)
		.filter((word) => word.length >= 3);
	const words = rawWords.filter((word) => word.length >= 4 && !INSTRUCTION_WORDS.has(word.toLowerCase()));
	const terms: string[] = [];

	terms.push(...words.slice(0, 12));
	for (let index = 0; index < rawWords.length - 1; index++) {
		const left = rawWords[index];
		const right = rawWords[index + 1];
		if (left.length < 3 || right.length < 3) {
			continue;
		}
		if (INSTRUCTION_WORDS.has(left.toLowerCase()) && INSTRUCTION_WORDS.has(right.toLowerCase())) {
			continue;
		}
		if (BIGRAM_GLUE_WORDS.has(left.toLowerCase()) || BIGRAM_GLUE_WORDS.has(right.toLowerCase())) {
			continue;
		}
		if (isAcronymToken(left) || isAcronymToken(right)) {
			continue;
		}
		terms.push(`${left} ${right}`);
		terms.push(`${capitalize(left)}${capitalize(right)}`);
		terms.push(`${lowerFirst(left)}${capitalize(right)}`);
	}

	return terms;
}

export function extractKeyboardTerms(value: string): string[] {
	const terms: string[] = [];
	for (const match of value.matchAll(/\b(?:Ctrl|Cmd|Command|Alt|Shift|Meta)\+([A-Za-z0-9])\b/gi)) {
		const key = match[1].toUpperCase();
		terms.push(match[0]);
		terms.push(`Key${key}`);
		terms.push('CtrlCmd');
	}
	return terms;
}

export function extractDomainHints(value: string): string[] {
	return extractNounPhraseVariants(value);
}

export function extractNounPhraseVariants(value: string): string[] {
	const words = value
		.replace(/[^A-Za-z0-9_+#.-]+/g, ' ')
		.split(/\s+/)
		.filter((word) => word.length >= 3);
	const phrases: Array<{ left: string; right: string }> = [];

	for (let index = 0; index < words.length - 1; index++) {
		const left = words[index];
		const right = words[index + 1];
		if (!isNounPhraseWord(left) || !isNounPhraseWord(right)) {
			continue;
		}

		const phrase = `${left} ${right}`;
		if (phrase.length > 80) {
			continue;
		}

		phrases.push({ left, right });
	}

	const terms: string[] = [];
	for (const { left, right } of phrases) {
		terms.push(`${capitalize(left)}${capitalize(right)}`);
	}
	for (const { left, right } of phrases) {
		terms.push(`${lowerFirst(left)}${capitalize(right)}`);
	}
	for (const { left, right } of phrases) {
		terms.push(`${left} ${right}`);
	}
	for (const { left, right } of phrases) {
		terms.push(`${lowerFirst(left)}_${lowerFirst(right)}`);
		terms.push(`${lowerFirst(left)}-${lowerFirst(right)}`);
	}
	return terms;
}

export function isNounPhraseWord(word: string): boolean {
	const lowerWord = word.toLowerCase();
	return word.length >= 3
		&& !INSTRUCTION_WORDS.has(lowerWord)
		&& !/^(?:code|using|used|use|this|that|those|these|same|better|answer|answers|case|cases|repository|local|only|line|evidence)$/i.test(word)
		&& !/^(?:find|identify|resolve|resolves|resolved|load|loads|loaded|read|reads|create|creates|created|launch|launches|launched|spawn|spawns|start|starts|open|opens|run|runs)$/i.test(word);
}

export function extractRoleObjectTerms(value: string): string[] {
	const roles = roleSuffixesForRequest(value);
	if (roles.length === 0) {
		return [];
	}

	const rawWords = value
		.replace(/[^A-Za-z0-9_$+#.-]+/g, ' ')
		.split(/\s+/)
		.map((word) => word.trim())
		.filter((word) => word.length >= 3);
	const objects: string[][] = [];

	for (const word of rawWords) {
		if (isNounPhraseWord(word) || isRoleWord(word)) {
			objects.push([singularizeRoleObject(word)]);
		}
	}

	for (const term of extractStructuredTerms(value)) {
		const parts = splitIdentifierParts(term);
		if (parts.length > 0) {
			objects.push(parts);
		}
	}

	const primaryTerms: string[] = [];
	const secondaryTerms: string[] = [];
	for (const objectParts of uniqueCandidateParts(objects).slice(0, 10)) {
		const objectName = objectParts.map((part) => capitalizeIdentifierPart(singularizeRoleObject(part))).join('');
		if (objectName.length < 4 || objectName.length > 64) {
			continue;
		}
		for (const role of roles) {
			if (objectName.toLowerCase().endsWith(role.toLowerCase())) {
				continue;
			}
			if (objectAlreadyHasRoleSuffix(objectName) && !['Factory', 'Context', 'Container', 'Config'].includes(role)) {
				continue;
			}
			primaryTerms.push(`${objectName}${role}`);
			secondaryTerms.push(`${lowerFirst(objectName)}${role}`);
		}
	}

	return uniqueTerms([...primaryTerms, ...secondaryTerms]).slice(0, 24);
}

export function roleSuffixesForRequest(value: string): string[] {
	const lowerValue = value.toLowerCase();
	const roles: string[] = [];
	const rolePatterns: Array<[RegExp, string]> = [
		[/\bservices?\b/, 'Service'],
		[/\bresolvers?\b|\bresolve[sd]?\b/, 'Resolver'],
		[/\bfactory|factories\b/, 'Factory'],
		[/\bloaders?\b|\bloads?\b/, 'Loader'],
		[/\bcontexts?\b/, 'Context'],
		[/\bcontainers?\b|\bstartup\b|\bstartups\b/, 'Container'],
		[/\bconfig(?:uration)?s?\b|\bsettings?\b/, 'Config'],
		[/\bregistr(?:y|ies)\b/, 'Registry'],
		[/\bproviders?\b/, 'Provider'],
		[/\bcontrollers?\b/, 'Controller'],
		[/\bmodels?\b/, 'Model'],
		[/\breaders?\b|\breads?\b/, 'Reader'],
		[/\bdispatchers?\b|\bdispatch\b/, 'Dispatcher'],
		[/\bprofiles?\b/, 'Profile'],
	];

	for (const [pattern, role] of rolePatterns) {
		if (pattern.test(lowerValue)) {
			roles.push(role);
		}
	}

	return uniqueStrings(roles).slice(0, 8);
}

export function isRoleWord(word: string): boolean {
	return /^(?:service|services|resolver|resolvers|factory|factories|loader|loaders|context|contexts|container|containers|config|configs|configuration|configurations|setting|settings|registry|registries|provider|providers|controller|controllers|model|models|reader|readers|dispatcher|dispatchers|profile|profiles)$/i.test(word);
}

export function objectAlreadyHasRoleSuffix(value: string): boolean {
	return /(?:Service|Resolver|Factory|Loader|Context|Container|Config|Registry|Provider|Controller|Model|Reader|Dispatcher|Profile)$/i.test(value);
}

export function singularizeRoleObject(word: string): string {
	if (/ies$/i.test(word) && word.length > 4) {
		return `${word.slice(0, -3)}y`;
	}
	if (/s$/i.test(word) && !/ss$/i.test(word) && word.length > 4) {
		return word.slice(0, -1);
	}
	return word;
}

export function extractActionObjectTerms(value: string): string[] {
	const actions = actionPrefixesForRequest(value);
	if (actions.length === 0) {
		return [];
	}

	const rawWords = value
		.replace(/[^A-Za-z0-9_$+#.-]+/g, ' ')
		.split(/\s+/)
		.map((word) => word.trim())
		.filter((word) => word.length >= 3);
	const candidates: string[][] = [];
	const structuredTerms = extractStructuredTerms(value);

	for (const term of structuredTerms) {
		const parts = splitIdentifierParts(term);
		if (parts.length > 0) {
			candidates.push(parts);
		}
	}

	const significantWords = rawWords.filter((word) => isActionObjectWord(word));

	for (let index = 0; index < rawWords.length - 1; index++) {
		const left = rawWords[index];
		const right = rawWords[index + 1];
		if (isActionObjectWord(left) && isActionNominalization(right)) {
			candidates.push([left]);
		}
	}

	for (let index = 0; index < rawWords.length - 2; index++) {
		const parts = rawWords.slice(index, index + 3);
		if (parts.every(isActionObjectWord)) {
			candidates.push(parts);
		}
	}

	for (let index = 0; index < rawWords.length - 1; index++) {
		const left = rawWords[index];
		const right = rawWords[index + 1];
		if (isActionObjectWord(left) && isActionObjectWord(right)) {
			candidates.push([left, right]);
		}
	}

	for (const word of significantWords) {
		candidates.push([word]);
	}

	const terms: string[] = [];
	for (const parts of uniqueCandidateParts(candidates).slice(0, 8)) {
		const suffix = parts.map((part) => capitalizeIdentifierPart(part)).join('');
		if (suffix.length < 4 || suffix.length > 80) {
			continue;
		}
		for (const action of actions) {
			terms.push(`${action}${suffix}`);
		}
	}

	return uniqueTerms(terms).slice(0, 10);
}

export function uniqueCandidateParts(candidates: string[][]): string[][] {
	const seen = new Set<string>();
	const result: string[][] = [];

	for (const candidate of candidates) {
		const normalized = candidate
			.map((part) => part.toLowerCase().replace(/[^a-z0-9_$]/g, ''))
			.filter(Boolean);
		if (normalized.length === 0) {
			continue;
		}

		const key = normalized.join(' ');
		if (seen.has(key)) {
			continue;
		}

		seen.add(key);
		result.push(candidate);
	}

	return result;
}

export function actionPrefixesForRequest(value: string): string[] {
	const lowerValue = value.toLowerCase();
	const actions: string[] = [];

	if (/\b(resolve|resolves|resolved|resolver|default)\b/.test(lowerValue)) {
		actions.push('resolve', 'get');
	}
	if (/\b(create|creates|created|creation|launch|launches|launched|spawn|spawns|start|starts|open|opens)\b/.test(lowerValue)) {
		actions.push('create');
	}
	if (/\b(load|loads|loaded|loader|read|reads|reader|definition|definitions)\b/.test(lowerValue)) {
		actions.push('load', 'read');
	}
	if (/\b(factory|factories|context|container|dispatcher|service|services)\b/.test(lowerValue)) {
		actions.push('get', 'create');
	}

	return uniqueStrings(actions).slice(0, 6);
}

export function isActionObjectWord(word: string): boolean {
	const lowerWord = word.toLowerCase();
	return word.length >= 4
		&& !INSTRUCTION_WORDS.has(lowerWord)
		&& !isActionVerbWord(lowerWord)
		&& !isActionNominalization(lowerWord)
		&& !/^(?:code|using|used|user|users|this|that|those|these|same|better|answer|answers|case|cases|repository|local|only|path|line|evidence)$/i.test(word);
}

export function isActionVerbWord(word: string): boolean {
	return /^(?:find|identify|resolve|resolves|resolved|resolver|load|loads|loaded|loader|read|reads|reader|create|creates|created|launch|launches|launched|spawn|spawns|start|starts|open|opens|run|runs|used|using)$/i.test(word);
}

export function isActionNominalization(word: string): boolean {
	return /^(?:creation|resolution|loading|loader|launch|startup|wiring|configuration|config|declaration|definition|definitions|path)$/i.test(word);
}

export function uniqueTerms(terms: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const rawTerm of terms) {
		const term = rawTerm.trim().replace(/\s+/g, ' ').replace(/^[^\w$]+|[^\w$]+$/g, '');
		const lowerTerm = term.toLowerCase();
		if (term.length < 3 || seen.has(lowerTerm) || INSTRUCTION_WORDS.has(lowerTerm) || isLowValueSearchTerm(term)) {
			continue;
		}
		seen.add(lowerTerm);
		result.push(term);
	}
	return result;
}

export function isLowValueSearchTerm(term: string): boolean {
	return /^(?:debug\.log|console\.|logger\.|log\.|system\.out)/i.test(term)
		|| /^(?:get|set|has|is)[A-Z]?[A-Za-z0-9_]*$/.test(term)
		|| /^[A-Z]{2,6}$/.test(term);
}

export function extractRootNoiseTerms(root: string): Set<string> {
	const basename = path.basename(root);
	const parts = splitIdentifierParts(basename);
	const values = [
		basename,
		...parts,
		...basename.split(/[^A-Za-z0-9]+/),
	]
		.map(normalizeNoiseTerm)
		.filter((term) => term.length >= 3 && term !== 'main' && term !== 'trunk');

	return new Set(values);
}

export function filterNoiseTerms(terms: string[], rootNoiseTerms: Set<string>): string[] {
	if (rootNoiseTerms.size === 0) {
		return terms;
	}

	return terms.filter((term) => {
		const normalizedTerm = normalizeNoiseTerm(term);
		if (rootNoiseTerms.has(normalizedTerm)) {
			return false;
		}

		const parts = splitIdentifierParts(term).map(normalizeNoiseTerm).filter(Boolean);
		return !(parts.length > 0 && parts.every((part) => rootNoiseTerms.has(part)));
	});
}

export function normalizeNoiseTerm(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}