import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { Message } from './messages.js';

export type SessionTitleSource = 'auto' | 'manual';

export interface SessionStatsSnapshot {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	totalRequests: number;
	totalTime: number;
}

export interface StoredToolExecution {
	id: string;
	name: string;
	args: Record<string, any>;
	status: 'pending' | 'approved' | 'executing' | 'completed' | 'failed' | 'canceled';
	result?: any;
	needsApproval?: boolean;
}

export interface StoredChatMessage {
	id: string;
	role: 'user' | 'assistant' | 'system' | 'tool' | 'tool_execution';
	content: string;
	reasoning?: string;
	timestamp: string;
	toolExecution?: StoredToolExecution;
	type?: string;
	usageSnapshot?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
		total_requests: number;
		total_time: number;
		queue_time: number;
		prompt_time: number;
		completion_time: number;
	};
}

export interface SessionListItem {
	id: string;
	title: string;
	titleSource: SessionTitleSource;
	cwd: string;
	model: string;
	temperature: number;
	createdAt: string;
	updatedAt: string;
	messageCount: number;
}

export interface SessionRecord extends SessionListItem {
	agentMessages: Message[];
	baseAgentMessages: Message[];
	uiMessages: StoredChatMessage[];
	userMessageHistory: string[];
	sessionStats: SessionStatsSnapshot;
}

export interface CreateSessionOptions {
	title?: string;
	model: string;
	temperature: number;
	agentMessages: Message[];
	baseAgentMessages: Message[];
	uiMessages?: StoredChatMessage[];
	userMessageHistory?: string[];
	sessionStats?: SessionStatsSnapshot;
}

export interface SaveSessionStateOptions {
	model: string;
	temperature: number;
	agentMessages: Message[];
	baseAgentMessages: Message[];
	uiMessages: StoredChatMessage[];
	userMessageHistory: string[];
	sessionStats: SessionStatsSnapshot;
}

interface SessionRow {
	id: string;
	title: string;
	title_source: SessionTitleSource;
	cwd: string;
	model: string;
	temperature: number;
	created_at: string;
	updated_at: string;
	message_count: number;
}

interface SessionStateRow {
	agent_messages_json: string;
	base_agent_messages_json: string;
	ui_messages_json: string;
	user_message_history_json: string;
	stats_json: string;
}

const CONFIG_DIRECTORY_NAME = '.cobot';
const SESSION_DATABASE_FILE_NAME = 'sessions.sqlite';
const DEFAULT_SESSION_TITLE = 'New session';
const SESSION_TITLE_MAX_LENGTH = 64;

export function createEmptySessionStats(): SessionStatsSnapshot {
	return {
		promptTokens: 0,
		completionTokens: 0,
		totalTokens: 0,
		totalRequests: 0,
		totalTime: 0,
	};
}

export function shortSessionId(sessionId: string): string {
	return sessionId.slice(0, 8);
}

export function createSessionTitle(input: string): string {
	const normalizedTitle = input.replace(/\s+/g, ' ').trim();

	if (!normalizedTitle) {
		return DEFAULT_SESSION_TITLE;
	}

	if (normalizedTitle.length <= SESSION_TITLE_MAX_LENGTH) {
		return normalizedTitle;
	}

	return `${normalizedTitle.slice(0, SESSION_TITLE_MAX_LENGTH - 3).trimEnd()}...`;
}

function getDefaultDatabasePath(): string {
	return path.join(os.homedir(), CONFIG_DIRECTORY_NAME, SESSION_DATABASE_FILE_NAME);
}

function cloneMessages(messages: Message[]): Message[] {
	return JSON.parse(JSON.stringify(messages)) as Message[];
}

function parseJson<T>(value: string, fallback: T): T {
	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
}

function stringifyJson(value: unknown): string {
	return JSON.stringify(value);
}

function normalizeSessionStats(stats?: SessionStatsSnapshot): SessionStatsSnapshot {
	return {
		...createEmptySessionStats(),
		...(stats || {}),
	};
}

export class SessionStore {
	private database: Database;

	constructor(databasePath = getDefaultDatabasePath()) {
		const databaseDirectory = path.dirname(databasePath);

		if (!fs.existsSync(databaseDirectory)) {
			fs.mkdirSync(databaseDirectory, { recursive: true });
		}

		this.database = new Database(databasePath);
		this.database.exec('PRAGMA foreign_keys = ON');
		this.migrate();
	}

	private migrate(): void {
		const versionRow = this.database.query('PRAGMA user_version').get() as { user_version: number } | null;
		const currentVersion = versionRow?.user_version || 0;

		if (currentVersion >= 1) {
			return;
		}

		this.database.exec(`
			CREATE TABLE IF NOT EXISTS sessions (
				id TEXT PRIMARY KEY,
				title TEXT NOT NULL,
				title_source TEXT NOT NULL CHECK (title_source IN ('auto', 'manual')),
				cwd TEXT NOT NULL,
				model TEXT NOT NULL,
				temperature REAL NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				message_count INTEGER NOT NULL DEFAULT 0
			);

			CREATE TABLE IF NOT EXISTS session_state (
				session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
				agent_messages_json TEXT NOT NULL,
				base_agent_messages_json TEXT NOT NULL,
				ui_messages_json TEXT NOT NULL,
				user_message_history_json TEXT NOT NULL,
				stats_json TEXT NOT NULL
			);

			CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at DESC);

			PRAGMA user_version = 1;
		`);
	}

	createSession(options: CreateSessionOptions): SessionRecord {
		const id = randomUUID();
		const now = new Date().toISOString();
		const title = options.title?.trim() ? createSessionTitle(options.title) : DEFAULT_SESSION_TITLE;
		const titleSource: SessionTitleSource = options.title?.trim() ? 'manual' : 'auto';
		const uiMessages = options.uiMessages || [];
		const userMessageHistory = options.userMessageHistory || [];
		const sessionStats = normalizeSessionStats(options.sessionStats);

		const insertSession = this.database.transaction(() => {
			this.database.query(`
				INSERT INTO sessions (
					id,
					title,
					title_source,
					cwd,
					model,
					temperature,
					created_at,
					updated_at,
					message_count
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			`).run(
				id,
				title,
				titleSource,
				process.cwd(),
				options.model,
				options.temperature,
				now,
				now,
				uiMessages.length,
			);

			this.database.query(`
				INSERT INTO session_state (
					session_id,
					agent_messages_json,
					base_agent_messages_json,
					ui_messages_json,
					user_message_history_json,
					stats_json
				) VALUES (?, ?, ?, ?, ?, ?)
			`).run(
				id,
				stringifyJson(cloneMessages(options.agentMessages)),
				stringifyJson(cloneMessages(options.baseAgentMessages)),
				stringifyJson(uiMessages),
				stringifyJson(userMessageHistory),
				stringifyJson(sessionStats),
			);
		});

		insertSession();

		return this.getSessionById(id);
	}

	saveSessionState(sessionId: string, options: SaveSessionStateOptions): void {
		const now = new Date().toISOString();
		const sessionStats = normalizeSessionStats(options.sessionStats);

		const saveSession = this.database.transaction(() => {
			const updateResult = this.database.query(`
				UPDATE sessions
				SET model = ?,
					temperature = ?,
					updated_at = ?,
					message_count = ?
				WHERE id = ?
			`).run(
				options.model,
				options.temperature,
				now,
				options.uiMessages.length,
				sessionId,
			);

			if (updateResult.changes === 0) {
				throw new Error(`Session not found: ${sessionId}`);
			}

			this.database.query(`
				INSERT INTO session_state (
					session_id,
					agent_messages_json,
					base_agent_messages_json,
					ui_messages_json,
					user_message_history_json,
					stats_json
				) VALUES (?, ?, ?, ?, ?, ?)
				ON CONFLICT(session_id) DO UPDATE SET
					agent_messages_json = excluded.agent_messages_json,
					base_agent_messages_json = excluded.base_agent_messages_json,
					ui_messages_json = excluded.ui_messages_json,
					user_message_history_json = excluded.user_message_history_json,
					stats_json = excluded.stats_json
			`).run(
				sessionId,
				stringifyJson(cloneMessages(options.agentMessages)),
				stringifyJson(cloneMessages(options.baseAgentMessages)),
				stringifyJson(options.uiMessages),
				stringifyJson(options.userMessageHistory),
				stringifyJson(sessionStats),
			);
		});

		saveSession();
	}

	listSessions(limit = 20): SessionListItem[] {
		const rows = this.database.query(`
			SELECT
				id,
				title,
				title_source,
				cwd,
				model,
				temperature,
				created_at,
				updated_at,
				message_count
			FROM sessions
			ORDER BY updated_at DESC
			LIMIT ?
		`).all(limit) as SessionRow[];

		return rows.map((row) => this.mapSessionRow(row));
	}

	loadSession(reference: string): SessionRecord {
		const sessionId = this.resolveSessionId(reference);

		return this.getSessionById(sessionId);
	}

	deleteSession(reference: string): string {
		const sessionId = this.resolveSessionId(reference);

		this.database.query('DELETE FROM sessions WHERE id = ?').run(sessionId);

		return sessionId;
	}

	updateAutoTitleFromUserMessage(sessionId: string, userInput: string): string | null {
		const title = createSessionTitle(userInput);

		if (title === DEFAULT_SESSION_TITLE) {
			return null;
		}

		const now = new Date().toISOString();
		const result = this.database.query(`
			UPDATE sessions
			SET title = ?,
				updated_at = ?
			WHERE id = ?
				AND title_source = 'auto'
				AND title = ?
		`).run(title, now, sessionId, DEFAULT_SESSION_TITLE);

		return result.changes > 0 ? title : null;
	}

	close(): void {
		this.database.close();
	}

	private getSessionById(sessionId: string): SessionRecord {
		const sessionRow = this.database.query(`
			SELECT
				id,
				title,
				title_source,
				cwd,
				model,
				temperature,
				created_at,
				updated_at,
				message_count
			FROM sessions
			WHERE id = ?
		`).get(sessionId) as SessionRow | null;

		if (!sessionRow) {
			throw new Error(`Session not found: ${sessionId}`);
		}

		const stateRow = this.database.query(`
			SELECT
				agent_messages_json,
				base_agent_messages_json,
				ui_messages_json,
				user_message_history_json,
				stats_json
			FROM session_state
			WHERE session_id = ?
		`).get(sessionId) as SessionStateRow | null;

		if (!stateRow) {
			throw new Error(`Session state not found: ${sessionId}`);
		}

		return {
			...this.mapSessionRow(sessionRow),
			agentMessages: parseJson<Message[]>(stateRow.agent_messages_json, []),
			baseAgentMessages: parseJson<Message[]>(stateRow.base_agent_messages_json, []),
			uiMessages: parseJson<StoredChatMessage[]>(stateRow.ui_messages_json, []),
			userMessageHistory: parseJson<string[]>(stateRow.user_message_history_json, []),
			sessionStats: normalizeSessionStats(parseJson<SessionStatsSnapshot>(stateRow.stats_json, createEmptySessionStats())),
		};
	}

	private resolveSessionId(reference: string): string {
		const trimmedReference = reference.trim();

		if (!trimmedReference) {
			throw new Error('Provide a session id or id prefix.');
		}

		const exactMatch = this.database.query('SELECT id FROM sessions WHERE id = ?').get(trimmedReference) as { id: string } | null;

		if (exactMatch) {
			return exactMatch.id;
		}

		const prefixMatches = this.database.query(`
			SELECT id
			FROM sessions
			WHERE id LIKE ?
			ORDER BY updated_at DESC
		`).all(`${trimmedReference}%`) as { id: string }[];

		if (prefixMatches.length === 0) {
			throw new Error(`No session matches "${trimmedReference}".`);
		}

		if (prefixMatches.length > 1) {
			const matchingIds = prefixMatches.map((row) => shortSessionId(row.id)).join(', ');
			throw new Error(`Session prefix "${trimmedReference}" is ambiguous. Matches: ${matchingIds}`);
		}

		return prefixMatches[0].id;
	}

	private mapSessionRow(row: SessionRow): SessionListItem {
		return {
			id: row.id,
			title: row.title,
			titleSource: row.title_source,
			cwd: row.cwd,
			model: row.model,
			temperature: row.temperature,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			messageCount: row.message_count,
		};
	}
}
