/**
 * Shared database path resolution for pocket-agent's SQLite store.
 *
 * Probes each platform-specific location in order and returns the first one
 * that exists on disk. Falls back to the macOS path when none are found so
 * the caller gets a predictable value it can pass to `new Database(…)`.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Ordered list of candidate DB paths for the current environment. */
export function getDbCandidates(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return [
    path.join(home, 'Library/Application Support/pocket-agent/pocket-agent.db'), // macOS
    path.join(home, '.config/pocket-agent/pocket-agent.db'), // Linux
    path.join(home, 'AppData/Roaming/pocket-agent/pocket-agent.db'), // Windows
  ];
}

/**
 * Return the path to the pocket-agent SQLite database.
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
