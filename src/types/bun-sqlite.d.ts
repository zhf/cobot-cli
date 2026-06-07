declare module 'bun:sqlite' {
	export interface StatementRunResult {
		changes: number;
		lastInsertRowid: number | bigint;
	}

	export interface Statement {
		run(...params: unknown[]): StatementRunResult;
		get(...params: unknown[]): unknown;
		all(...params: unknown[]): unknown[];
	}

	export class Database {
		constructor(filename: string);
		exec(sql: string): void;
		query(sql: string): Statement;
		transaction<T extends (...args: never[]) => unknown>(callback: T): T;
		close(): void;
	}
}
