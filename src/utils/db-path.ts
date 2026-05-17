/**
 * Shared database path resolution for AI Chief of Staff's SQLite store.
 *
 * Probes each platform-specific location in order and returns the first one
 * that exists on disk. Falls back to the macOS path when none are found so
 * the caller gets a predictable value it can pass to `new Database(…)`.
 *
 * Note: this file is also imported by MCP subprocesses where the `electron`
 * module is unavailable, which is why we resolve OS paths manually instead
 * of via `app.getPath('userData')`. The folder name (`AI Chief of Staff`)
 * matches the `productName` field in package.json so the DB ends up alongside
 * the other Electron-managed user data on macOS.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Ordered list of candidate DB paths for the current environment.
 *
 * IMPORTANT (May 17, 2026): Electron's `app.getPath('userData')` derives the
 * folder name from `package.json` `name` (the lowercase slug), NOT
 * `productName`, unless `app.setName()` is called. So both dev (`npm run dev`)
 * AND the packaged macOS app end up writing to the lowercase-slug folder.
 *
 * The Title Case path is kept as a fallback in case a future Electron version
 * changes this behavior or a user has migrated their data manually, but the
 * canonical location is now the lowercase slug.
 */
export function getDbCandidates(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return [
    path.join(home, 'Library/Application Support/ai-chief-of-staff/ai-chief-of-staff.db'), // macOS (canonical — matches package.json `name`)
    path.join(home, 'Library/Application Support/AI Chief of Staff/ai-chief-of-staff.db'), // macOS legacy/fallback (matches `productName` if app.setName is ever called)
    path.join(home, '.config/ai-chief-of-staff/ai-chief-of-staff.db'), // Linux
    path.join(home, 'AppData/Roaming/ai-chief-of-staff/ai-chief-of-staff.db'), // Windows
  ];
}

/**
 * Return the path to the AI Chief of Staff SQLite database.
 *
 * Walks the platform-ordered candidate list and returns the first path that
 * exists. If none exist yet (first run / fresh install), returns the macOS
 * path as the conventional default.
 */
export function getDbPath(): string {
  const candidates = getDbCandidates();
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}
