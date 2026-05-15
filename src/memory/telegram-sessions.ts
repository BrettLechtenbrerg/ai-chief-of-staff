import Database from 'better-sqlite3';

export interface TelegramChatSession {
  chat_id: number;
  session_id: string;
  group_name: string | null;
  created_at: string;
}

/**
 * Link a Telegram chat to a session
 */
export function linkTelegramChat(
  db: Database.Database,
  chatId: number,
  sessionId: string,
  groupName?: string
): boolean {
  try {
    db.prepare(
      `
      INSERT INTO telegram_chat_sessions (chat_id, session_id, group_name)
      VALUES (?, ?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET
        session_id = excluded.session_id,
        group_name = excluded.group_name
    `
    ).run(chatId, sessionId, groupName || null);
    return true;
  } catch (err) {
    console.error('[Memory] Failed to link Telegram chat:', err);
    return false;
  }
}

/**
 * Unlink a Telegram chat from its session
 */
export function unlinkTelegramChat(db: Database.Database, chatId: number): boolean {
  const result = db.prepare('DELETE FROM telegram_chat_sessions WHERE chat_id = ?').run(chatId);
  return result.changes > 0;
}

/**
 * Get the session ID for a Telegram chat
 */
export function getSessionForChat(db: Database.Database, chatId: number): string | null {
  const row = db
    .prepare(
      `
    SELECT session_id FROM telegram_chat_sessions WHERE chat_id = ?
  `
    )
    .get(chatId) as { session_id: string } | undefined;
  return row?.session_id || null;
}

/**
 * Get the Telegram chat ID for a session
 */
export function getChatForSession(db: Database.Database, sessionId: string): number | null {
  const row = db
    .prepare(
      `
    SELECT chat_id FROM telegram_chat_sessions WHERE session_id = ?
  `
    )
    .get(sessionId) as { chat_id: number } | undefined;
  return row?.chat_id || null;
}

/**
 * Get all Telegram chat to session mappings
 */
export function getAllTelegramChatSessions(db: Database.Database): TelegramChatSession[] {
  return db
    .prepare(
      `
    SELECT chat_id, session_id, group_name, created_at
    FROM telegram_chat_sessions
    ORDER BY created_at DESC
  `
    )
    .all() as TelegramChatSession[];
}
