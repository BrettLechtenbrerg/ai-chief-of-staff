import Database from 'better-sqlite3';
import type { AgentModeId } from '../agent/agent-modes';

/**
 * How a session was created. 'automation' threads come from a bottom-panel
 * action (SEO Report, Content Writer) or a cron autorun and are grouped
 * separately in the sidebar so they're easy to find; 'chat' threads are
 * normal user-started conversations. Classification is durable (stored, not
 * inferred from the name) so renaming a thread never moves it between groups.
 */
export type SessionKind = 'chat' | 'automation';

export interface Session {
  id: string;
  name: string;
  mode?: AgentModeId;
  kind?: SessionKind;
  working_directory?: string | null;
  brand_id?: string | null;
  created_at: string;
  updated_at: string;
  telegram_linked?: boolean;
  telegram_group_name?: string | null;
}

/**
 * Create a new session
 * @throws Error if session name already exists
 */
export function createSession(
  db: Database.Database,
  name: string,
  mode: AgentModeId = 'general',
  workingDirectory?: string | null,
  kind: SessionKind = 'chat'
): Session {
  // Check for duplicate name
  const existing = getSessionByName(db, name);
  if (existing) {
    throw new Error(`Session name "${name}" already exists`);
  }

  const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  db.prepare(
    `
      INSERT INTO sessions (id, name, mode, kind, working_directory, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, (strftime('%Y-%m-%dT%H:%M:%fZ')), (strftime('%Y-%m-%dT%H:%M:%fZ')))
    `
  ).run(id, name, mode, kind, workingDirectory ?? null);

  return getSession(db, id)!;
}

/**
 * Ensure a session exists (create it if not).
 * Used by saveMessage to avoid FK constraint violations for auto-created sessions.
 */
export function ensureSession(
  db: Database.Database,
  id: string,
  mode: AgentModeId = 'general'
): void {
  const existing = getSession(db, id);
  if (existing) return;

  db.prepare(
    `
      INSERT INTO sessions (id, name, mode, working_directory, created_at, updated_at)
      VALUES (?, ?, ?, NULL, (strftime('%Y-%m-%dT%H:%M:%fZ')), (strftime('%Y-%m-%dT%H:%M:%fZ')))
    `
  ).run(id, id, mode);
}

/**
 * Get a session by name (exact match)
 */
export function getSessionByName(db: Database.Database, name: string): Session | null {
  const row = db
    .prepare(
      `
      SELECT id, name, mode, kind, working_directory, brand_id, created_at, updated_at
      FROM sessions
      WHERE name = ?
    `
    )
    .get(name) as Session | undefined;

  return row || null;
}

/**
 * Get a session by ID
 */
export function getSession(db: Database.Database, id: string): Session | null {
  const row = db
    .prepare(
      `
      SELECT id, name, mode, kind, working_directory, brand_id, created_at, updated_at
      FROM sessions
      WHERE id = ?
    `
    )
    .get(id) as Session | undefined;

  return row || null;
}

/**
 * Get all sessions, ordered by most recent activity
 * Includes telegram link status
 */
export function getSessions(db: Database.Database): Session[] {
  interface SessionRow {
    id: string;
    name: string;
    mode: string | null;
    kind: string | null;
    working_directory: string | null;
    brand_id: string | null;
    created_at: string;
    updated_at: string;
    telegram_linked: number;
    telegram_group_name: string | null;
  }
  const rows = db
    .prepare(
      `
      SELECT
        s.id,
        s.name,
        s.mode,
        s.kind,
        s.working_directory,
        s.brand_id,
        s.created_at,
        s.updated_at,
        CASE WHEN t.chat_id IS NOT NULL THEN 1 ELSE 0 END as telegram_linked,
        t.group_name as telegram_group_name
      FROM sessions s
      LEFT JOIN telegram_chat_sessions t ON s.id = t.session_id
      GROUP BY s.id
      ORDER BY s.updated_at DESC
    `
    )
    .all() as SessionRow[];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    mode: (row.mode as AgentModeId) || 'general',
    kind: (row.kind as SessionKind) || 'chat',
    working_directory: row.working_directory,
    brand_id: row.brand_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    telegram_linked: !!row.telegram_linked,
    telegram_group_name: row.telegram_group_name,
  }));
}

/**
 * Get the working directory for a session (null means use root workspace)
 */
export function getSessionWorkingDirectory(
  db: Database.Database,
  sessionId: string
): string | null {
  const row = db.prepare('SELECT working_directory FROM sessions WHERE id = ?').get(sessionId) as
    | { working_directory: string | null }
    | undefined;
  return row?.working_directory ?? null;
}

/**
 * Set the working directory for a session
 */
export function setSessionWorkingDirectory(
  db: Database.Database,
  sessionId: string,
  workingDirectory: string | null
): void {
  db.prepare(
    `
      UPDATE sessions SET working_directory = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ'))
      WHERE id = ?
    `
  ).run(workingDirectory, sessionId);
}

/**
 * Rename a session, optionally updating the working directory
 * @throws Error if new name already exists
 */
export function renameSession(
  db: Database.Database,
  id: string,
  name: string,
  workingDirectory?: string
): boolean {
  // Check for duplicate name (excluding self)
  const existing = getSessionByName(db, name);
  if (existing && existing.id !== id) {
    throw new Error(`Session name "${name}" already exists`);
  }

  if (workingDirectory !== undefined) {
    const result = db
      .prepare(
        `
        UPDATE sessions SET name = ?, working_directory = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ'))
        WHERE id = ?
      `
      )
      .run(name, workingDirectory, id);
    return result.changes > 0;
  }

  const result = db
    .prepare(
      `
      UPDATE sessions SET name = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ'))
      WHERE id = ?
    `
    )
    .run(name, id);

  return result.changes > 0;
}

/**
 * Delete a session and all its related data
 */
export function deleteSession(db: Database.Database, id: string): boolean {
  // Delete all related data first (due to foreign key constraints)
  // Order matters: delete child records before parent records

  // Delete messages and summaries
  db.prepare('DELETE FROM messages WHERE session_id = ?').run(id);
  db.prepare('DELETE FROM summaries WHERE session_id = ?').run(id);
  db.prepare('DELETE FROM rolling_summaries WHERE session_id = ?').run(id);

  // Delete session-scoped items (calendar, tasks, cron jobs)
  db.prepare('DELETE FROM calendar_events WHERE session_id = ?').run(id);
  db.prepare('DELETE FROM tasks WHERE session_id = ?').run(id);
  db.prepare('DELETE FROM cron_jobs WHERE session_id = ?').run(id);

  // Delete telegram chat session mapping
  db.prepare('DELETE FROM telegram_chat_sessions WHERE session_id = ?').run(id);

  // Finally delete the session itself
  const result = db.prepare('DELETE FROM sessions WHERE id = ?').run(id);

  console.log(`[Memory] Deleted session ${id}: ${result.changes > 0 ? 'success' : 'not found'}`);
  return result.changes > 0;
}

/**
 * Touch session (update updated_at timestamp)
 */
export function touchSession(db: Database.Database, id: string): void {
  db.prepare(`UPDATE sessions SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ')) WHERE id = ?`).run(
    id
  );
}

/**
 * Get session message count
 */
export function getSessionMessageCount(db: Database.Database, sessionId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) as c FROM messages WHERE session_id = ?')
    .get(sessionId) as { c: number };
  return row.c;
}

/**
 * Get the mode for a session (defaults to 'general' for legacy sessions).
 * AI Chief of Staff ships as a personal assistant, not a coding agent.
 */
export function getSessionMode(db: Database.Database, sessionId: string): AgentModeId {
  const row = db.prepare('SELECT mode FROM sessions WHERE id = ?').get(sessionId) as
    | { mode: string | null }
    | undefined;
  return (row?.mode as AgentModeId) || 'general';
}

/**
 * Set the mode for a session
 */
export function setSessionMode(
  db: Database.Database,
  sessionId: string,
  mode: AgentModeId
): boolean {
  const result = db
    .prepare(
      `
      UPDATE sessions SET mode = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ'))
      WHERE id = ?
    `
    )
    .run(mode, sessionId);
  return result.changes > 0;
}

/**
 * Get the brand_id for a session (null = use the default brand).
 */
export function getSessionBrandId(db: Database.Database, sessionId: string): string | null {
  const row = db.prepare('SELECT brand_id FROM sessions WHERE id = ?').get(sessionId) as
    | { brand_id: string | null }
    | undefined;
  return row?.brand_id ?? null;
}

/**
 * Set the brand_id for a session (null clears it, falling back to default).
 */
export function setSessionBrandId(
  db: Database.Database,
  sessionId: string,
  brandId: string | null
): boolean {
  const result = db
    .prepare(
      `UPDATE sessions SET brand_id = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ')) WHERE id = ?`
    )
    .run(brandId, sessionId);
  return result.changes > 0;
}

// ============ SDK SESSION PERSISTENCE ============

/**
 * Get the SDK session ID for a given app session
 */
export function getSdkSessionId(db: Database.Database, sessionId: string): string | null {
  const row = db.prepare('SELECT sdk_session_id FROM sessions WHERE id = ?').get(sessionId) as
    | { sdk_session_id: string | null }
    | undefined;
  return row?.sdk_session_id ?? null;
}

/**
 * Store the SDK session ID for a given app session
 */
export function setSdkSessionId(
  db: Database.Database,
  sessionId: string,
  sdkSessionId: string
): void {
  db.prepare('UPDATE sessions SET sdk_session_id = ? WHERE id = ?').run(sdkSessionId, sessionId);
}

/**
 * Clear the SDK session ID for a given app session (forces fresh start)
 */
export function clearSdkSessionId(db: Database.Database, sessionId: string): void {
  db.prepare('UPDATE sessions SET sdk_session_id = NULL WHERE id = ?').run(sessionId);
}
