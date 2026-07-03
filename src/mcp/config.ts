/**
 * Loader for the user-editable external MCP servers config file.
 *
 * File location: `<userData>/mcp-servers.json` where `<userData>` is
 * `~/Library/Application Support/AI Chief of Staff/` on macOS (matches
 * Electron's `app.getPath('userData')` so the file lives alongside settings.db).
 *
 * Shape matches Claude Desktop's `claude_desktop_config.json`, so users
 * can copy entries between the two without conversion. We only consume the
 * `mcpServers` top-level key — other Claude Desktop preferences are ignored.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ExternalMCPServerConfig, ExternalMCPServersFile } from './types';

/** Top-level keys we know about. Anything else is preserved verbatim on save. */
const KNOWN_TOP_LEVEL_KEYS = new Set(['mcpServers']);

/** Server-entry keys we know about. Anything else is preserved verbatim on save. */
const KNOWN_SERVER_KEYS = new Set(['command', 'args', 'env', 'cwd', 'disabled', 'hidden']);

/**
 * Resolve the user-data directory for the running app. In Electron main, this
 * is `app.getPath('userData')`. We accept it as a parameter so non-Electron
 * callers (tests, scripts) can pass a temp dir.
 */
export function resolveMCPConfigPath(userDataDir: string): string {
  return path.join(userDataDir, 'mcp-servers.json');
}

/**
 * Load and parse the MCP servers config file. Returns an empty server set
 * when the file does not exist or contains invalid JSON. Logging surfaces
 * the failure so users can fix it without silently losing tools.
 */
export function loadMCPConfig(userDataDir: string): ExternalMCPServersFile {
  const configPath = resolveMCPConfigPath(userDataDir);
  if (!fs.existsSync(configPath)) {
    console.log(`[MCP Config] No mcp-servers.json at ${configPath} — no external MCP servers will load`);
    return { mcpServers: {} };
  }

  // Tighten perms on files written by older versions (pre-0600) — server
  // entries can carry credentials in env fields. Best-effort; Windows ACLs
  // don't map to POSIX modes and chmod is a no-op there.
  try {
    fs.chmodSync(configPath, 0o600);
  } catch {
    /* ignore — read below surfaces any real access problem */
  }

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (err) {
    console.error(`[MCP Config] Could not read ${configPath}:`, (err as Error).message);
    return { mcpServers: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(
      `[MCP Config] ${configPath} is not valid JSON — no external MCP servers will load:`,
      (err as Error).message,
    );
    return { mcpServers: {} };
  }

  if (!parsed || typeof parsed !== 'object' || !('mcpServers' in parsed)) {
    console.warn(`[MCP Config] ${configPath} is missing the top-level "mcpServers" object`);
    return { mcpServers: {} };
  }

  const rawServers = (parsed as { mcpServers: unknown }).mcpServers;
  if (!rawServers || typeof rawServers !== 'object') {
    console.warn(`[MCP Config] ${configPath} "mcpServers" is not an object`);
    return { mcpServers: {} };
  }

  const validated: Record<string, ExternalMCPServerConfig> = {};
  for (const [name, value] of Object.entries(rawServers)) {
    const validated_entry = validateServerConfig(name, value);
    if (validated_entry) validated[name] = validated_entry;
  }

  const count = Object.keys(validated).length;
  console.log(`[MCP Config] Loaded ${count} external MCP server config${count === 1 ? '' : 's'} from ${configPath}`);
  return { mcpServers: validated };
}

/**
 * Validate a single server entry. Returns the normalized config or null
 * if the entry is malformed. Logs a warning either way so users can see
 * which entry got dropped.
 */
function validateServerConfig(name: string, raw: unknown): ExternalMCPServerConfig | null {
  if (!raw || typeof raw !== 'object') {
    console.warn(`[MCP Config] Server "${name}" skipped: entry is not an object`);
    return null;
  }
  const entry = raw as Record<string, unknown>;
  if (typeof entry.command !== 'string' || entry.command.length === 0) {
    console.warn(`[MCP Config] Server "${name}" skipped: missing "command" string`);
    return null;
  }

  const normalized: ExternalMCPServerConfig = { command: entry.command };
  if (Array.isArray(entry.args)) {
    normalized.args = entry.args.map((a) => String(a));
  }
  if (entry.env && typeof entry.env === 'object') {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(entry.env as Record<string, unknown>)) {
      env[k] = String(v);
    }
    normalized.env = env;
  }
  if (typeof entry.cwd === 'string') {
    normalized.cwd = entry.cwd;
  }
  if (entry.disabled === true) {
    normalized.disabled = true;
  }
  if (entry.hidden === true) {
    normalized.hidden = true;
  }
  return normalized;
}

/**
 * Validate the shape of a server config without dropping unknown fields.
 * Used by `saveMCPConfig` so the round trip preserves forward-compat keys
 * (e.g. a future ACOS version adds `timeout` — the current Settings UI
 * shouldn't wipe it on a save).
 *
 * Throws on malformed input rather than silently dropping (different
 * contract from `validateServerConfig` which is best-effort on load).
 */
function validateForSave(name: string, raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Server "${name}" must be an object`);
  }
  const entry = raw as Record<string, unknown>;
  if (typeof entry.command !== 'string' || entry.command.length === 0) {
    throw new Error(`Server "${name}" must have a non-empty "command" string`);
  }
  if (entry.args !== undefined && !Array.isArray(entry.args)) {
    throw new Error(`Server "${name}" "args" must be an array`);
  }
  if (entry.env !== undefined && (typeof entry.env !== 'object' || entry.env === null || Array.isArray(entry.env))) {
    throw new Error(`Server "${name}" "env" must be an object`);
  }
  if (entry.cwd !== undefined && typeof entry.cwd !== 'string') {
    throw new Error(`Server "${name}" "cwd" must be a string`);
  }
  if (entry.disabled !== undefined && typeof entry.disabled !== 'boolean') {
    throw new Error(`Server "${name}" "disabled" must be a boolean`);
  }
  if (entry.hidden !== undefined && typeof entry.hidden !== 'boolean') {
    throw new Error(`Server "${name}" "hidden" must be a boolean`);
  }
  return entry;
}

/**
 * Atomically write `mcp-servers.json` to disk.
 *
 * Strategy: write to `<file>.tmp`, fsync, then rename onto the real path.
 * The rename is atomic on POSIX so a crash mid-write leaves either the old
 * file intact OR the new file complete — never a torn half-written file.
 *
 * Unknown fields (both top-level and per-server) are preserved by merging
 * the new shape onto whatever is currently on disk, so a future ACOS that
 * adds keys won't be silently wiped by an older Settings UI.
 *
 * Throws on validation failure or disk error so callers can surface the
 * problem to the user instead of pretending the save succeeded.
 */
export function saveMCPConfig(userDataDir: string, file: ExternalMCPServersFile): void {
  if (!file || typeof file !== 'object' || !file.mcpServers || typeof file.mcpServers !== 'object') {
    throw new Error('saveMCPConfig: file must have an "mcpServers" object');
  }

  // Validate every entry first — bail out before touching disk if anything
  // is malformed so the previous config stays intact.
  const validated: Record<string, Record<string, unknown>> = {};
  for (const [name, value] of Object.entries(file.mcpServers)) {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('saveMCPConfig: server name must be a non-empty string');
    }
    validated[name] = validateForSave(name, value);
  }

  // Load existing on-disk shape so we can preserve unknown fields (both
  // top-level and per-server). Best-effort: if the file is corrupt or
  // missing we still write the new one.
  const configPath = resolveMCPConfigPath(userDataDir);
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>;
      }
    } catch {
      // Ignore — we'll overwrite with a clean shape.
    }
  }

  // Merge per-server: for each server we keep, start with whatever was on
  // disk, then overlay the validated fields. This preserves unknown
  // per-server keys (e.g. a future `timeout` field) for servers we keep,
  // and naturally drops them for servers being deleted.
  const existingServers =
    existing && typeof existing === 'object' && existing.mcpServers && typeof existing.mcpServers === 'object'
      ? (existing.mcpServers as Record<string, unknown>)
      : {};

  const mergedServers: Record<string, Record<string, unknown>> = {};
  for (const [name, newEntry] of Object.entries(validated)) {
    const prior = existingServers[name];
    if (prior && typeof prior === 'object' && !Array.isArray(prior)) {
      // Start with prior unknown keys, overlay every known key from newEntry.
      const merged: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(prior)) {
        if (!KNOWN_SERVER_KEYS.has(k)) merged[k] = v;
      }
      for (const [k, v] of Object.entries(newEntry)) {
        merged[k] = v;
      }
      mergedServers[name] = merged;
    } else {
      mergedServers[name] = newEntry;
    }
  }

  // Build the final top-level object, preserving unknown top-level keys.
  const finalDoc: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(existing)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(k)) finalDoc[k] = v;
  }
  finalDoc.mcpServers = mergedServers;

  // Ensure the user-data directory exists. Electron creates this on first
  // launch but tests pass tmp dirs so we make this resilient.
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  const tmpPath = `${configPath}.tmp`;
  const json = JSON.stringify(finalDoc, null, 2) + '\n';

  // Write + fsync + rename. fsync ensures the bytes hit disk before the
  // rename, so a power loss between the two leaves either the old file
  // or the complete new file — never a truncated tmp.
  // 0600: server entries can carry credentials in env (GHL token, DataForSEO
  // password) — owner read/write only
  const fd = fs.openSync(tmpPath, 'w', 0o600);
  try {
    fs.writeFileSync(fd, json);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, configPath);
}
