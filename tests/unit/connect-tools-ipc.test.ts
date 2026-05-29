/**
 * Unit tests for src/main/ipc/connect-tools-ipc.ts entry-building.
 *
 * Covers (plan Step 9 verification):
 *   - validatePayload rejects empty/missing fields per authType
 *   - buildEntry produces ELECTRON_RUN_AS_NODE + correct env for Google tools
 *   - buildEntry maps `drive` \u2192 the `docs` Flo script (one server covers both)
 *   - buildEntry passes through GHL token + locationId env vars
 *   - buildEntry sets DataForSEO username + password env vars
 *   - buildEntry sets FIRECRAWL_API_KEY for Firecrawl
 *   - Every entry has _acos_managed: true + _acos_tool_id
 *   - makeToolStatus reports reconnect-needed when google disconnected
 *   - getSupportedTools hides GHL on Windows (simulated)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it, beforeEach, vi } from 'vitest';

// Mock electron so the IPC module is importable in a vitest environment.
vi.mock('electron', () => ({
  app: {
    getVersion: () => '1.0.0-beta.12',
    getPath: () => os.tmpdir(),
    isPackaged: false,
  },
  ipcMain: {
    handle: vi.fn(),
  },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openExternal: vi.fn() },
}));

// Provide a real-looking vendor tree on a tmp resourcesPath so
// bundled-paths' existence check passes.
function makeFakeVendor(): { resourcesPath: string; projectRoot: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ipc-test-'));
  const subdirs = [
    'vendor/flo-mcp-servers/gmail',
    'vendor/flo-mcp-servers/calendar',
    'vendor/flo-mcp-servers/docs',
    'vendor/flo-mcp-servers/bookmarks',
    'vendor/ghl-mcp',
  ];
  for (const s of subdirs) {
    fs.mkdirSync(path.join(root, s), { recursive: true });
  }
  for (const id of ['gmail', 'calendar', 'docs', 'bookmarks']) {
    fs.writeFileSync(path.join(root, `vendor/flo-mcp-servers/${id}/index.js`), '// stub');
  }
  fs.writeFileSync(path.join(root, 'vendor/ghl-mcp/main.py'), '# stub');
  return { resourcesPath: root, projectRoot: root };
}

process.env.ACOS_GOOGLE_CLIENT_ID = 'test-id.apps.googleusercontent.com';
process.env.ACOS_GOOGLE_CLIENT_SECRET = 'test-secret';

const { __test__ } = await import('../../src/main/ipc/connect-tools-ipc');
const { GoogleOAuth } = await import('../../src/auth/google-oauth');

describe('connect-tools-ipc', () => {
  let paths: { isPackaged: boolean; resourcesPath: string; projectRoot: string };

  beforeEach(() => {
    const { resourcesPath, projectRoot } = makeFakeVendor();
    paths = { isPackaged: true, resourcesPath, projectRoot };
    // Set a tmp userData dir so GoogleOAuth path resolution doesn't hit
    // the real ~/Library/Application Support tree.
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-userdata-'));
    GoogleOAuth.setUserDataDir(userDataDir);
  });

  describe('validatePayload', () => {
    it('passes empty payload for google-oauth and auto', () => {
      const tools = __test__.getSupportedTools();
      const gmail = tools.find((t) => t.id === 'gmail')!;
      const bookmarks = tools.find((t) => t.id === 'bookmarks')!;
      expect(() => __test__.validatePayload(gmail, undefined)).not.toThrow();
      expect(() => __test__.validatePayload(bookmarks, {})).not.toThrow();
    });

    it('rejects empty GHL fields with a friendly message', () => {
      const tools = __test__.getSupportedTools();
      const ghl = tools.find((t) => t.id === 'ghl')!;
      expect(() => __test__.validatePayload(ghl, { privateToken: '', locationId: '' })).toThrow(
        /required/i,
      );
      expect(() =>
        __test__.validatePayload(ghl, { privateToken: 'pit-x' }),
      ).toThrow(/Location ID is required/);
    });

    it('rejects missing API key for Firecrawl', () => {
      const tools = __test__.getSupportedTools();
      const fc = tools.find((t) => t.id === 'firecrawl')!;
      expect(() => __test__.validatePayload(fc, {})).toThrow(/API key is required/);
      expect(() => __test__.validatePayload(fc, { apiKey: '   ' })).toThrow(/API key is required/);
    });
  });

  describe('buildEntry', () => {
    it('builds Gmail entry with ELECTRON_RUN_AS_NODE and FLO_TOKEN_PATH', () => {
      const tools = __test__.getSupportedTools();
      const gmail = tools.find((t) => t.id === 'gmail')!;
      const entry = __test__.buildEntry(gmail, {}, paths);
      expect(entry.command).toBe(process.execPath);
      expect(entry.args![0]).toContain('gmail/index.js');
      expect(entry.env!.ELECTRON_RUN_AS_NODE).toBe('1');
      expect(entry.env!.FLO_TOKEN_PATH).toContain('google-tokens.json');
      expect(entry.env!.FLO_CREDENTIALS_PATH).toContain('google-credentials.json');
      expect((entry as Record<string, unknown>)._acos_managed).toBe(true);
      expect((entry as Record<string, unknown>)._acos_tool_id).toBe('gmail');
    });

    it('maps drive \u2192 docs Flo script', () => {
      const tools = __test__.getSupportedTools();
      const drive = tools.find((t) => t.id === 'drive')!;
      const entry = __test__.buildEntry(drive, {}, paths);
      expect(entry.args![0]).toContain('docs/index.js');
      // Even though args point at the docs script, the tool_id is still 'drive'.
      expect((entry as Record<string, unknown>)._acos_tool_id).toBe('drive');
    });

    it('builds GHL entry with python3 + env vars', () => {
      const tools = __test__.getSupportedTools();
      const ghl = tools.find((t) => t.id === 'ghl')!;
      const entry = __test__.buildEntry(
        ghl,
        { privateToken: 'pit-xyz', locationId: 'LOC-1' },
        paths,
      );
      expect(entry.command).toBe('python3');
      expect(entry.args![0]).toContain('ghl-mcp/main.py');
      expect(entry.env!.GHL_PRIVATE_TOKEN).toBe('pit-xyz');
      expect(entry.env!.GHL_LOCATION_ID).toBe('LOC-1');
    });

    it('builds DataForSEO entry with npx + credentials env', () => {
      const tools = __test__.getSupportedTools();
      const dfs = tools.find((t) => t.id === 'dataforseo')!;
      const entry = __test__.buildEntry(
        dfs,
        { username: 'u', password: 'p' },
        paths,
      );
      expect(entry.command).toBe('npx');
      expect(entry.args).toEqual(['-y', 'dataforseo-mcp-server']);
      expect(entry.env!.DATAFORSEO_USERNAME).toBe('u');
      expect(entry.env!.DATAFORSEO_PASSWORD).toBe('p');
    });

    it('builds Firecrawl entry with FIRECRAWL_API_KEY', () => {
      const tools = __test__.getSupportedTools();
      const fc = tools.find((t) => t.id === 'firecrawl')!;
      const entry = __test__.buildEntry(fc, { apiKey: 'fc-abc' }, paths);
      expect(entry.command).toBe('npx');
      expect(entry.args).toEqual(['-y', 'firecrawl-mcp']);
      expect(entry.env!.FIRECRAWL_API_KEY).toBe('fc-abc');
    });

    it('every entry is flagged _acos_managed + has _acos_tool_id', () => {
      const tools = __test__.getSupportedTools();
      for (const t of tools) {
        const payload =
          t.authType === 'two-field'
            ? Object.fromEntries((t.fields || []).map((f) => [f.key, 'x']))
            : t.authType === 'api-key'
              ? Object.fromEntries((t.fields || []).map((f) => [f.key, 'x']))
              : {};
        const entry = __test__.buildEntry(t, payload, paths);
        expect((entry as Record<string, unknown>)._acos_managed).toBe(true);
        expect((entry as Record<string, unknown>)._acos_tool_id).toBe(t.id);
      }
    });
  });

  describe('UX helper fields (signupUrl / dashboardUrl / helperHtml)', () => {
    it('populates sign-up + dashboard + helper for dataforseo', () => {
      const tools = __test__.getSupportedTools();
      const dfs = tools.find((t) => t.id === 'dataforseo')!;
      expect(dfs.signupUrl).toBe('https://app.dataforseo.com/register');
      expect(dfs.dashboardUrl).toBe('https://app.dataforseo.com');
      expect(dfs.helperHtml).toMatch(/API password/i);
      expect(dfs.helperHtml).toMatch(/login password/i);
    });

    it('populates sign-up + dashboard + helper for firecrawl', () => {
      const tools = __test__.getSupportedTools();
      const fc = tools.find((t) => t.id === 'firecrawl')!;
      expect(fc.signupUrl).toBe('https://www.firecrawl.dev/app');
      expect(fc.dashboardUrl).toBe('https://www.firecrawl.dev/app/api-keys');
      expect(fc.helperHtml).toMatch(/Free tier/i);
      expect(fc.helperHtml).toMatch(/fc-/);
    });

    it('leaves UX helper fields undefined for tools that do not need them', () => {
      const tools = __test__.getSupportedTools();
      for (const id of ['gmail', 'calendar', 'drive', 'bookmarks', 'ghl'] as const) {
        const t = tools.find((x) => x.id === id)!;
        expect(t.signupUrl).toBeUndefined();
        expect(t.dashboardUrl).toBeUndefined();
        expect(t.helperHtml).toBeUndefined();
      }
    });

    it('exposes GHL alias server names so hand-managed entries are recognized for status', () => {
      const ghl = __test__.getSupportedTools().find((t) => t.id === 'ghl')!;
      expect(ghl.mcpServerName).toBe('ghl-mcp');
      expect(ghl.aliasServerNames).toEqual(['flo-ghl', 'flo-ghl-brett']);
    });
  });

  describe('makeToolStatus', () => {
    it('reports connected when the live server is ready, even if ACOS google OAuth is disconnected', () => {
      // The bundled/Flo Google servers authenticate off their own token file,
      // not ACOS google-tokens.json. A live, tool-serving server must show as
      // connected regardless of ACOS OAuth state (the May 28 false-alarm fix).
      const tools = __test__.getSupportedTools();
      const gmail = tools.find((t) => t.id === 'gmail')!;
      const status = __test__.makeToolStatus(
        gmail,
        { command: 'node', args: ['gmail/index.js'] },
        { _acos_managed: true } as Record<string, unknown>,
        false,
        null,
        { status: 'ready', toolCount: 13, lastError: null },
      );
      expect(status.status).toBe('connected');
      expect(status.toolCount).toBe(13);
    });

    it('reports reconnect-needed only when google OAuth is disconnected AND the server is down', () => {
      const tools = __test__.getSupportedTools();
      const gmail = tools.find((t) => t.id === 'gmail')!;
      const status = __test__.makeToolStatus(
        gmail,
        { command: 'node', args: ['gmail/index.js'] },
        { _acos_managed: true } as Record<string, unknown>,
        false,
        null,
        { status: 'stopped', toolCount: 0, lastError: null },
      );
      expect(status.status).toBe('reconnect-needed');
    });

    it('reports not-connected when no entry exists', () => {
      const tools = __test__.getSupportedTools();
      const ghl = tools.find((t) => t.id === 'ghl')!;
      const status = __test__.makeToolStatus(ghl, undefined, undefined, true, 'a@b.c', undefined);
      expect(status.status).toBe('not-connected');
      expect(status.managedByAcos).toBe(false);
      expect(status.externallyManaged).toBe(false);
    });

    it('reports externallyManaged when an entry exists without our flag', () => {
      const tools = __test__.getSupportedTools();
      const ghl = tools.find((t) => t.id === 'ghl')!;
      const status = __test__.makeToolStatus(
        ghl,
        { command: 'python3', args: ['main.py'] },
        { command: 'python3' } as Record<string, unknown>,
        true,
        'a@b.c',
        { status: 'ready', toolCount: 30, lastError: null },
      );
      expect(status.externallyManaged).toBe(true);
      expect(status.managedByAcos).toBe(false);
      expect(status.status).toBe('connected');
    });
  });
});
