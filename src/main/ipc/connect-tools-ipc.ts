/**
 * IPC for the Connect Tools panel (plan \u00a75).
 *
 * Layered on top of the lower-level connections-ipc.ts: this surface knows
 * about the curated *menu* of supported tools (Gmail, Calendar, Drive,
 * Bookmarks, GHL, DataForSEO, Firecrawl), what kind of auth each one
 * needs, and how to write the right `mcp-servers.json` entry for each.
 *
 * Exposed via preload as `window.pocketAgent.connectTools.*`:
 *   connectTools:listSupported  \u2192 hard-coded menu (id, name, fields, category)
 *   connectTools:getStatus      \u2192 per-tool { status, error?, toolCount, ... }
 *   connectTools:connect        \u2192 write mcp-servers.json entry + hot-start client
 *   connectTools:disconnect     \u2192 stop client + remove entry (preserves user-managed
 *                                 entries that lack the _acos_managed flag)
 *   connectTools:diagnostics    \u2192 JSON blob for the "Copy diagnostics" button
 *
 * Writes use `loadMCPConfig` / `saveMCPConfig` so the atomic-rename and
 * unknown-field-preservation contracts of the underlying config layer are
 * honored. The `_acos_managed: true` per-server flag is preserved by
 * config.ts because it lives outside `KNOWN_SERVER_KEYS`.
 *
 * Path resolution: bundled server paths flow through bundled-paths.ts so
 * dev vs packaged + macOS vs Windows are handled in one place.
 *
 * Process model: bundled Flo servers spawn via `process.execPath` with
 * `ELECTRON_RUN_AS_NODE=1` (plan Risk 9) so they use Electron's bundled
 * Node binary instead of relying on system Node being on PATH.
 */

import { app, ipcMain } from 'electron';
import { loadMCPConfig, saveMCPConfig } from '../../mcp/config';
import { getMCPManager } from '../../mcp/manager';
import type { ExternalMCPServerConfig } from '../../mcp/types';
import { GoogleOAuth } from '../../auth/google-oauth';
import {
  resolveFloServerPath,
  resolveGhlMainPath,
  type FloServerId,
} from '../../mcp/bundled-paths';

export type SupportedToolId =
  | 'gmail'
  | 'calendar'
  | 'drive'
  | 'bookmarks'
  | 'ghl'
  | 'dataforseo'
  | 'firecrawl';

export type AuthType = 'google-oauth' | 'api-key' | 'two-field' | 'auto';

export interface SupportedToolField {
  key: string;
  label: string;
  secret: boolean;
  placeholder?: string;
}

export interface SupportedTool {
  id: SupportedToolId;
  name: string;
  category: 'google' | 'crm' | 'research' | 'browser';
  description: string;
  authType: AuthType;
  fields?: SupportedToolField[];
  mcpServerName: string;
  /**
   * Windows-only: when true, this tool is hidden on Windows builds in v1
   * (plan Risk 4 — GHL needs Python, which we don't bundle yet).
   */
  unavailableOnWindows?: boolean;
  /**
   * Optional UX helpers used by the Connect Tools panel to give testers a
   * one-click path to the provider's sign-up page and dashboard, plus a
   * short inline callout above the input fields. helperHtml is rendered
   * as trusted innerHTML by the panel — it comes from this file (which we
   * ship and review), never from user input.
   */
  signupUrl?: string;
  dashboardUrl?: string;
  helperHtml?: string;
}

export interface ToolStatus {
  id: SupportedToolId;
  status: 'not-connected' | 'connecting' | 'connected' | 'failed' | 'reconnect-needed';
  email?: string;
  toolCount: number;
  lastError: string | null;
  managedByAcos: boolean;
  /** Server entry exists in mcp-servers.json but lacks _acos_managed flag. */
  externallyManaged: boolean;
}

interface ConnectPayloadGoogle {
  /* No fields — flow uses the system browser. */
}
interface ConnectPayloadApiKey {
  apiKey: string;
}
interface ConnectPayloadGhl {
  privateToken: string;
  locationId: string;
}
interface ConnectPayloadDataforseo {
  username: string;
  password: string;
}
type ConnectPayload =
  | ConnectPayloadGoogle
  | ConnectPayloadApiKey
  | ConnectPayloadGhl
  | ConnectPayloadDataforseo
  | Record<string, never>;

/** Sentinel marker on `mcp-servers.json` entries written by Connect Tools. */
const ACOS_MANAGED_FLAG = '_acos_managed';
const ACOS_TOOL_ID_FLAG = '_acos_tool_id';

/**
 * The curated menu shipped in v1. Order matches the panel card order
 * (Google first because it unlocks 3 cards at once).
 */
function getSupportedTools(): SupportedTool[] {
  return [
    {
      id: 'gmail',
      name: 'Gmail',
      category: 'google',
      description:
        'Read, search, send, label and delete email through your connected Google account.',
      authType: 'google-oauth',
      mcpServerName: 'flo-gmail',
    },
    {
      id: 'calendar',
      name: 'Google Calendar',
      category: 'google',
      description: 'Read events, create meetings, check free/busy.',
      authType: 'google-oauth',
      mcpServerName: 'flo-calendar',
    },
    {
      id: 'drive',
      name: 'Google Drive & Docs',
      category: 'google',
      description: 'Find files, read and edit Google Docs.',
      authType: 'google-oauth',
      mcpServerName: 'flo-docs',
    },
    {
      id: 'bookmarks',
      name: 'Chrome bookmarks',
      category: 'browser',
      description: 'Read your local Chrome bookmark tree.',
      authType: 'auto',
      mcpServerName: 'flo-bookmarks',
    },
    {
      id: 'ghl',
      name: 'GoHighLevel',
      category: 'crm',
      description: 'Manage contacts, opportunities, calendars in GHL.',
      authType: 'two-field',
      fields: [
        {
          key: 'privateToken',
          label: 'Private Integration Token',
          secret: true,
          placeholder: 'pit-...',
        },
        { key: 'locationId', label: 'Location ID', secret: false, placeholder: 'Uj6CJxW...' },
      ],
      mcpServerName: 'ghl-mcp',
      unavailableOnWindows: true,
    },
    {
      id: 'dataforseo',
      name: 'DataForSEO',
      category: 'research',
      description: 'Keyword research, SERP analysis, backlink data.',
      authType: 'two-field',
      fields: [
        { key: 'username', label: 'Username', secret: false },
        { key: 'password', label: 'API password', secret: true },
      ],
      mcpServerName: 'dataforseo-mcp-server',
      signupUrl: 'https://app.dataforseo.com/register',
      dashboardUrl: 'https://app.dataforseo.com',
      helperHtml:
        '<strong>Important:</strong> the <em>API password</em> is NOT your dashboard login password. It is a separate secret shown on the <strong>API Access</strong> page of your DataForSEO dashboard. If you use your login password here, the test will fail.',
    },
    {
      id: 'firecrawl',
      name: 'Firecrawl',
      category: 'research',
      description: 'Read, scrape and analyze any webpage.',
      authType: 'api-key',
      fields: [{ key: 'apiKey', label: 'API key', secret: true, placeholder: 'fc-...' }],
      mcpServerName: 'firecrawl-mcp',
      signupUrl: 'https://www.firecrawl.dev/app',
      dashboardUrl: 'https://www.firecrawl.dev/app/api-keys',
      helperHtml:
        '<strong>Free tier:</strong> Firecrawl gives 500 credits/month free — no card required. Find your API key on the <strong>API Keys</strong> page of your dashboard. It starts with <code>fc-</code>.',
    },
  ];
}

/**
 * Build the `mcp-servers.json` entry for a given tool + payload. The
 * resulting entry includes `_acos_managed: true` and `_acos_tool_id` so
 * the Connections panel can render them read-only and Connect Tools can
 * tell its own entries apart from user-authored ones.
 */
function buildEntry(
  tool: SupportedTool,
  payload: ConnectPayload,
  paths: BundledPathDeps,
): ExternalMCPServerConfig & Record<string, unknown> {
  const acosMeta = {
    [ACOS_MANAGED_FLAG]: true,
    [ACOS_TOOL_ID_FLAG]: tool.id,
  };

  switch (tool.id) {
    case 'gmail':
    case 'calendar':
    case 'drive':
    case 'bookmarks': {
      // Map drive \u2192 docs script (the Flo "docs" server covers Drive too).
      const serverKey: FloServerId = tool.id === 'drive' ? 'docs' : tool.id;
      const scriptPath = resolveFloServerPath(paths, serverKey);
      // Spawn via Electron's binary so ABI-bound deps (better-sqlite3) match
      // the prebuilt copy ACOS ships. Plan Risk 9.
      return {
        command: process.execPath,
        args: [scriptPath],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          FLO_TOKEN_PATH: GoogleOAuth.getTokensPath(),
          FLO_CREDENTIALS_PATH: GoogleOAuth.getCredentialsPath(),
        },
        ...acosMeta,
      };
    }
    case 'ghl': {
      const p = payload as ConnectPayloadGhl;
      const mainPath = resolveGhlMainPath(paths);
      return {
        command: 'python3',
        args: [mainPath],
        env: {
          GHL_PRIVATE_TOKEN: p.privateToken,
          GHL_LOCATION_ID: p.locationId,
        },
        ...acosMeta,
      };
    }
    case 'dataforseo': {
      const p = payload as ConnectPayloadDataforseo;
      return {
        command: 'npx',
        args: ['-y', 'dataforseo-mcp-server'],
        env: {
          DATAFORSEO_USERNAME: p.username,
          DATAFORSEO_PASSWORD: p.password,
        },
        ...acosMeta,
      };
    }
    case 'firecrawl': {
      const p = payload as ConnectPayloadApiKey;
      return {
        command: 'npx',
        args: ['-y', 'firecrawl-mcp'],
        env: { FIRECRAWL_API_KEY: p.apiKey },
        ...acosMeta,
      };
    }
  }
}

export interface BundledPathDeps {
  isPackaged: boolean;
  resourcesPath: string;
  projectRoot: string;
}

/**
 * Validate a connect payload by authType. Throws a user-facing message on
 * missing/empty fields so the panel can render the error inline.
 */
function validatePayload(tool: SupportedTool, payload: unknown): ConnectPayload {
  if (tool.authType === 'google-oauth' || tool.authType === 'auto') {
    return {};
  }
  if (!payload || typeof payload !== 'object') {
    throw new Error('Missing required fields');
  }
  const p = payload as Record<string, unknown>;
  if (!tool.fields) throw new Error('Tool is missing field schema');
  for (const f of tool.fields) {
    const v = p[f.key];
    if (typeof v !== 'string' || v.trim().length === 0) {
      throw new Error(`${f.label} is required`);
    }
  }
  return payload as ConnectPayload;
}

/**
 * Convert the existing entry + live MCPManager status into the ToolStatus
 * shape consumed by the panel.
 */
function makeToolStatus(
  tool: SupportedTool,
  entry: ExternalMCPServerConfig | undefined,
  rawEntry: Record<string, unknown> | undefined,
  googleConnected: boolean,
  googleEmail: string | null,
  liveStatus:
    | { status: string; toolCount: number; lastError: string | null }
    | undefined,
): ToolStatus {
  const managedByAcos = !!rawEntry?.[ACOS_MANAGED_FLAG];
  const externallyManaged = !!entry && !managedByAcos;
  if (!entry) {
    return {
      id: tool.id,
      status: 'not-connected',
      toolCount: 0,
      lastError: null,
      managedByAcos: false,
      externallyManaged: false,
    };
  }
  // Google tools also reflect OAuth state, since the entry can exist but
  // tokens may have been revoked.
  if (tool.authType === 'google-oauth' && !googleConnected) {
    return {
      id: tool.id,
      status: 'reconnect-needed',
      toolCount: liveStatus?.toolCount ?? 0,
      lastError: 'Google account disconnected',
      managedByAcos,
      externallyManaged,
    };
  }
  const liveState = liveStatus?.status;
  let status: ToolStatus['status'] = 'not-connected';
  if (liveState === 'ready') status = 'connected';
  else if (liveState === 'starting' || liveState === 'idle') status = 'connecting';
  else if (liveState === 'failed') status = 'failed';
  else if (liveState === 'disabled' || liveState === 'stopped') status = 'not-connected';

  return {
    id: tool.id,
    status,
    email: tool.authType === 'google-oauth' ? googleEmail || undefined : undefined,
    toolCount: liveStatus?.toolCount ?? 0,
    lastError: liveStatus?.lastError ?? null,
    managedByAcos,
    externallyManaged,
  };
}

/**
 * Read the raw mcp-servers.json off disk so we can see Connect Tools meta
 * flags (`_acos_managed`) that the strict `ExternalMCPServerConfig` loader
 * drops. Returns `undefined` if file missing or malformed.
 */
function readRawConfig(userDataDir: string): Record<string, Record<string, unknown>> | undefined {
  // We use the same path resolution as the loader but read raw JSON.
  // Falling back to {} on any error matches the loader's silent recovery.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path') as typeof import('path');
    const file = path.join(userDataDir, 'mcp-servers.json');
    if (!fs.existsSync(file)) return {};
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      mcpServers?: Record<string, Record<string, unknown>>;
    };
    return raw.mcpServers || {};
  } catch {
    return {};
  }
}

export function registerConnectToolsIPC(
  getUserDataDir: () => string,
  getBundledPaths: () => BundledPathDeps,
): void {
  ipcMain.handle('connectTools:listSupported', async (): Promise<SupportedTool[]> => {
    const tools = getSupportedTools();
    if (process.platform === 'win32') {
      return tools.filter((t) => !t.unavailableOnWindows);
    }
    return tools;
  });

  ipcMain.handle('connectTools:getStatus', async (): Promise<ToolStatus[]> => {
    const tools = getSupportedTools();
    const dir = getUserDataDir();
    const file = loadMCPConfig(dir);
    const rawServers = readRawConfig(dir) || {};
    const liveStatuses = new Map<string, { status: string; toolCount: number; lastError: string | null }>();
    for (const s of getMCPManager().getServerStatuses()) {
      liveStatuses.set(s.serverName, { status: s.status, toolCount: s.toolCount, lastError: s.lastError });
    }
    const googleStatus = GoogleOAuth.getStatus();
    return tools.map((t) =>
      makeToolStatus(
        t,
        file.mcpServers[t.mcpServerName],
        rawServers[t.mcpServerName],
        googleStatus.connected,
        googleStatus.email,
        liveStatuses.get(t.mcpServerName),
      ),
    );
  });

  ipcMain.handle(
    'connectTools:connect',
    async (
      _,
      toolId: SupportedToolId,
      payload: unknown,
    ): Promise<{ success: boolean; error?: string }> => {
      const tool = getSupportedTools().find((t) => t.id === toolId);
      if (!tool) return { success: false, error: `Unknown tool: ${toolId}` };
      try {
        const validated = validatePayload(tool, payload);

        // Google flows need fresh tokens before we write the entry — if the
        // user has never signed in, kick the browser flow first.
        if (tool.authType === 'google-oauth') {
          const status = GoogleOAuth.getStatus();
          if (!status.connected) {
            const flow = await GoogleOAuth.startFlow();
            if (!flow.success) return { success: false, error: flow.error };
          }
        }

        const entry = buildEntry(tool, validated, getBundledPaths());

        const dir = getUserDataDir();
        const file = loadMCPConfig(dir);
        file.mcpServers[tool.mcpServerName] = entry;
        saveMCPConfig(dir, file);

        const mgr = getMCPManager();
        // Replace handles both "new" and "existing" cases.
        await mgr.replaceClient(tool.mcpServerName, entry);
        return { success: true };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Connect failed',
        };
      }
    },
  );

  ipcMain.handle(
    'connectTools:disconnect',
    async (_, toolId: SupportedToolId): Promise<{ success: boolean; error?: string }> => {
      const tool = getSupportedTools().find((t) => t.id === toolId);
      if (!tool) return { success: false, error: `Unknown tool: ${toolId}` };
      try {
        const dir = getUserDataDir();
        const file = loadMCPConfig(dir);
        // Only remove the entry if WE wrote it — otherwise the user has a
        // hand-edited copy and we shouldn't stomp it.
        const rawServers = readRawConfig(dir) || {};
        const raw = rawServers[tool.mcpServerName];
        if (raw && raw[ACOS_MANAGED_FLAG] !== true) {
          return {
            success: false,
            error:
              'This connection is hand-managed in mcp-servers.json. Edit or remove it from Settings \u2192 Connections.',
          };
        }
        delete file.mcpServers[tool.mcpServerName];
        saveMCPConfig(dir, file);
        await getMCPManager().stopClient(tool.mcpServerName);
        return { success: true };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Disconnect failed',
        };
      }
    },
  );

  ipcMain.handle(
    'connectTools:detectMigratable',
    async (): Promise<
      Array<{ toolId: SupportedToolId; mcpServerName: string; currentCommand: string }>
    > => {
      // An existing entry is "migratable" when it shares a name with one of
      // our supported tools AND lacks the _acos_managed flag. Brett's dev
      // machine has hand-curated entries; testers have none, so this is a
      // no-op for them.
      const dir = getUserDataDir();
      const file = loadMCPConfig(dir);
      const raw = readRawConfig(dir) || {};
      const matches: Array<{ toolId: SupportedToolId; mcpServerName: string; currentCommand: string }> = [];
      for (const tool of getSupportedTools()) {
        const entry = file.mcpServers[tool.mcpServerName];
        const rawEntry = raw[tool.mcpServerName];
        if (!entry) continue;
        if (rawEntry && rawEntry[ACOS_MANAGED_FLAG] === true) continue;
        matches.push({
          toolId: tool.id,
          mcpServerName: tool.mcpServerName,
          currentCommand: entry.command,
        });
      }
      return matches;
    },
  );

  ipcMain.handle(
    'connectTools:adoptManagedFlag',
    async (
      _,
      toolId: SupportedToolId,
    ): Promise<{ success: boolean; error?: string }> => {
      // Stamp the _acos_managed flag onto an existing user-authored entry
      // so Connect Tools treats it as ours from here on. We do NOT rewrite
      // command/args/env — the user's existing setup keeps running
      // verbatim. Future edits via Connect Tools will overwrite it.
      const tool = getSupportedTools().find((t) => t.id === toolId);
      if (!tool) return { success: false, error: `Unknown tool: ${toolId}` };
      try {
        const dir = getUserDataDir();
        const file = loadMCPConfig(dir);
        const entry = file.mcpServers[tool.mcpServerName];
        if (!entry) return { success: false, error: 'No such entry to adopt' };
        // saveMCPConfig preserves unknown fields per-entry by merging with
        // what's on disk. We need to round-trip the entry plus the meta
        // flags. Easiest: write the validated shape unchanged — saveMCPConfig
        // will fold our additions over the prior unknown keys.
        const augmented = {
          ...entry,
          [ACOS_MANAGED_FLAG]: true,
          [ACOS_TOOL_ID_FLAG]: tool.id,
        } as ExternalMCPServerConfig;
        file.mcpServers[tool.mcpServerName] = augmented;
        saveMCPConfig(dir, file);
        return { success: true };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Adopt failed',
        };
      }
    },
  );

  ipcMain.handle('connectTools:diagnostics', async (): Promise<Record<string, unknown>> => {
    const dir = getUserDataDir();
    const tools = getSupportedTools();
    const file = loadMCPConfig(dir);
    const rawServers = readRawConfig(dir) || {};
    const liveStatuses = new Map<string, { status: string; toolCount: number; lastError: string | null }>();
    for (const s of getMCPManager().getServerStatuses()) {
      liveStatuses.set(s.serverName, { status: s.status, toolCount: s.toolCount, lastError: s.lastError });
    }
    const googleStatus = GoogleOAuth.getStatus();
    const versionString = app.getVersion();
    const toolsReport: Record<string, unknown> = {};
    for (const t of tools) {
      const status = makeToolStatus(
        t,
        file.mcpServers[t.mcpServerName],
        rawServers[t.mcpServerName],
        googleStatus.connected,
        googleStatus.email,
        liveStatuses.get(t.mcpServerName),
      );
      toolsReport[t.id] = status;
    }
    return {
      version: versionString,
      platform: process.platform,
      userDataDir: dir,
      google: googleStatus,
      tools: toolsReport,
      vendorRoot: getBundledPaths().isPackaged
        ? `${getBundledPaths().resourcesPath}/vendor`
        : `${getBundledPaths().projectRoot}/vendor`,
    };
  });
}

// Test seam: exported helpers so unit tests can verify entry shape per authType
// without spawning the whole IPC layer.
export const __test__ = { buildEntry, validatePayload, getSupportedTools, makeToolStatus };
