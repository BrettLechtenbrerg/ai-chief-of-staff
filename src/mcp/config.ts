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
