/**
 * IPC for the Connect Tools panel (plan \u00a75).
 *
 * Layered on top of the lower-level connections-ipc.ts: this surface knows
 * about the curated *menu* of supported tools (Gmail, Calendar, Drive,
 * Bookmarks, GHL, DataForSEO, Firecrawl, Meta Ads), what kind of auth each one
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

import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { trustedHandle } from './trusted-ipc.js';
import { loadMCPConfig, saveMCPConfig } from '../../mcp/config';
import { getMCPManager } from '../../mcp/manager';
import type { ExternalMCPServerConfig } from '../../mcp/types';
import { GoogleOAuth } from '../../auth/google-oauth';
import {
  resolveFloServerPath,
  resolveGhlNodePath,
  type FloServerId,
} from '../../mcp/bundled-paths';

export type SupportedToolId =
  | 'gmail'
  | 'calendar'
  | 'drive'
  | 'bookmarks'
  | 'ghl'
  | 'dataforseo'
  | 'firecrawl'
  | 'meta-ads';

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
  category: 'google' | 'crm' | 'research' | 'browser' | 'marketing';
  description: string;
  authType: AuthType;
  fields?: SupportedToolField[];
  mcpServerName: string;
  /**
   * Alternate `mcp-servers.json` entry names this card should also recognize
   * for STATUS display. Some users hand-manage a tool under a different name
   * (e.g. GHL as `flo-ghl` / `flo-ghl-brett` instead of the canonical
   * `ghl-mcp`, or run multiple locations). When the canonical entry is
   * absent, status resolution falls back to the first present alias so the
   * card reflects the real running server instead of showing blank. The
   * connect/disconnect write path always uses the canonical `mcpServerName`.
   */
  aliasServerNames?: string[];
  /**
   * When true, this tool is hidden on Windows builds. Historically set on GHL
   * because it required a Python runtime we didn't bundle. GHL now ships as a
   * Python-free Node server (vendor/ghl-mcp-node) spawned via Electron's own
   * Node, so it is available on Windows — no tool currently sets this flag, but
   * it remains for any future platform-gated connector.
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

/** No fields — the Google flow uses the system browser. */
type ConnectPayloadGoogle = Record<string, never>;
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
      // Recognize the common hand-managed names (and the per-location variant)
      // so the card shows Connected when an existing GHL server is live. Brett's
      // hand-built Python venv entries (flo-ghl / flo-ghl-brett) keep resolving
      // to "Connected" on his machine; testers connect via the bundled Node
      // server written under the canonical `ghl-mcp` name.
      aliasServerNames: ['flo-ghl', 'flo-ghl-brett'],
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
    {
      id: 'meta-ads',
      name: 'Meta Ads',
      category: 'marketing',
      description:
        'Read-only access to your Facebook/Instagram ad accounts: campaigns, ad sets, spend and performance insights.',
      authType: 'auto',
      mcpServerName: 'meta-ads',
      signupUrl: 'https://pipeboard.co',
      dashboardUrl: 'https://pipeboard.co',
      helperHtml:
        '<strong>Heads up:</strong> clicking Enable opens your browser to authorize via Pipeboard, which connects to your Meta (Facebook) account. Sign in with the account that has Business Manager access to your ad accounts. Meta\u2019s consent screen grants ad-management permission (it has no narrower tier), but the Ad Analyzer is <strong>read-only by design</strong> — it never changes your campaigns, only recommends. First connect can take a minute or two — the browser window is part of the flow, not an error.',
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
      // Python-free: spawn the vendored Node port via Electron's bundled Node
      // (ELECTRON_RUN_AS_NODE=1), exactly like the Flo servers. Same 91 GHL
      // tools, no runtime to install, works on macOS + Windows.
      const scriptPath = resolveGhlNodePath(paths);
      return {
        command: process.execPath,
        args: [scriptPath],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
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
    case 'meta-ads': {
      // Remote MCP bridged over stdio via mcp-remote. Spike result (Jun 9):
      // Meta's official endpoint (mcp.facebook.com/ads) rejects mcp-remote's
      // dynamic client registration ("Dynamic registration is not available
      // for this client"), so we use Pipeboard's hosted Meta Ads MCP, whose
      // OAuth flow works with mcp-remote's localhost callback. Tokens cache
      // in ~/.mcp-auth so restarts are silent. --auth-timeout 120 because
      // the browser OAuth (Pipeboard login + Meta connect) easily exceeds
      // the 30s default on first run.
      return {
        command: 'npx',
        args: [
          '-y',
          'mcp-remote',
          'https://mcp.pipeboard.co/meta-ads-mcp',
          '--auth-timeout',
          '120',
        ],
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
  // The live MCP server is the source of truth for "is this working right
  // now". A server that is `ready` with tools IS connected, regardless of
  // ACOS's own Google OAuth state — hand-managed Google entries (e.g. the
  // bundled Flo servers) authenticate off their own token file
  // (~/.flo/tokens.json) rather than ACOS's google-tokens.json. Keying the
  // card off ACOS OAuth alone produced a false "Reconnect needed" badge on
  // working connections (the May 28 incident). So we derive status from the
  // live server first, and only fall back to ACOS OAuth state when the server
  // is NOT already up.
  const liveState = liveStatus?.status;
  const serverIsUp = liveState === 'ready' && (liveStatus?.toolCount ?? 0) > 0;

  // Surface a Google reconnect prompt only when the server is genuinely down
  // AND ACOS's own OAuth is disconnected. A live, tool-serving server is never
  // "reconnect-needed" no matter which token file it uses.
  if (tool.authType === 'google-oauth' && !googleConnected && !serverIsUp) {
    return {
      id: tool.id,
      status: 'reconnect-needed',
      toolCount: liveStatus?.toolCount ?? 0,
      lastError: 'Google account disconnected',
      managedByAcos,
      externallyManaged,
    };
  }

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
  trustedHandle('connectTools:listSupported', async (): Promise<SupportedTool[]> => {
    const tools = getSupportedTools();
    if (process.platform === 'win32') {
      return tools.filter((t) => !t.unavailableOnWindows);
    }
    return tools;
  });

  trustedHandle('connectTools:getStatus', async (): Promise<ToolStatus[]> => {
    const tools = getSupportedTools();
    const dir = getUserDataDir();
    const file = loadMCPConfig(dir);
    const rawServers = readRawConfig(dir) || {};
    const liveStatuses = new Map<string, { status: string; toolCount: number; lastError: string | null }>();
    for (const s of getMCPManager().getServerStatuses()) {
      liveStatuses.set(s.serverName, { status: s.status, toolCount: s.toolCount, lastError: s.lastError });
    }
    const googleStatus = GoogleOAuth.getStatus();
    return tools.map((t) => {
      // Resolve the backing entry by canonical name first, then by any
      // recognized alias (e.g. a GHL server hand-managed as `flo-ghl`). The
      // resolved name is used consistently for entry, raw flags, and live
      // status so the card reflects whichever server is actually present.
      const candidateNames = [t.mcpServerName, ...(t.aliasServerNames ?? [])];
      const resolvedName =
        candidateNames.find((n) => file.mcpServers[n]) ?? t.mcpServerName;
      return makeToolStatus(
        t,
        file.mcpServers[resolvedName],
        rawServers[resolvedName],
        googleStatus.connected,
        googleStatus.email,
        liveStatuses.get(resolvedName),
      );
    });
  });

  trustedHandle(
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

  trustedHandle(
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

  trustedHandle(
    'connectTools:detectMigratable',
    async (): Promise<
      Array<{ toolId: SupportedToolId; mcpServerName: string; currentCommand: string }>
    > => {
      // An existing entry is "migratable" only when it shares a name with one
      // of our supported tools, lacks the _acos_managed flag, AND its server
      // is not already up and serving tools. We resolve by canonical name
      // first then aliases (e.g. GHL as flo-ghl) so a hand-managed tool that
      // is already working never re-triggers the migration prompt. Brett's
      // dev machine has hand-curated entries; testers have none.
      const dir = getUserDataDir();
      const file = loadMCPConfig(dir);
      const raw = readRawConfig(dir) || {};
      const liveStatuses = new Map<string, { status: string; toolCount: number }>();
      for (const s of getMCPManager().getServerStatuses()) {
        liveStatuses.set(s.serverName, { status: s.status, toolCount: s.toolCount });
      }
      const matches: Array<{ toolId: SupportedToolId; mcpServerName: string; currentCommand: string }> = [];
      for (const tool of getSupportedTools()) {
        const candidateNames = [tool.mcpServerName, ...(tool.aliasServerNames ?? [])];
        const resolvedName = candidateNames.find((n) => file.mcpServers[n]) ?? tool.mcpServerName;
        const entry = file.mcpServers[resolvedName];
        const rawEntry = raw[resolvedName];
        if (!entry) continue;
        // Already adopted by Connect Tools — nothing to migrate.
        if (rawEntry && rawEntry[ACOS_MANAGED_FLAG] === true) continue;
        // Already running and serving tools — it works as-is; don't nag.
        const live = liveStatuses.get(resolvedName);
        if (live && live.status === 'ready' && live.toolCount > 0) continue;
        matches.push({
          toolId: tool.id,
          mcpServerName: resolvedName,
          currentCommand: entry.command,
        });
      }
      return matches;
    },
  );

  trustedHandle(
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

  trustedHandle('connectTools:diagnostics', async (): Promise<Record<string, unknown>> => {
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
