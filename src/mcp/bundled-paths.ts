/**
 * Resolve filesystem paths for vendored MCP server bundles (plan §7).
 *
 * In a packaged Electron app, `electron-builder` `extraResources` copies
 * `vendor/` into `Contents/Resources/vendor/` on macOS and
 * `<install>\resources\vendor\` on Windows. `process.resourcesPath` points
 * at that directory.
 *
 * In dev (`npm run dev`), `app.isPackaged` is false and `process.cwd()` is
 * the repo root, so we resolve against `vendor/` next to package.json.
 *
 * Why this module exists: the Connect Tools IPC writes absolute paths
 * into `mcp-servers.json` entries (so the MCPManager can spawn the
 * vendored servers via `node <path>`). Those paths differ between dev
 * and prod, and between macOS and Windows, so the resolution logic is
 * centralized here and unit-tested.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Vendor subdirectory layout — see `vendor/VENDORED.md`.
 * Keep in sync with `refresh-vendor.sh`.
 */
export const VENDOR_SUBDIRS = {
  flo: {
    root: 'flo-mcp-servers',
    servers: {
      gmail: path.join('flo-mcp-servers', 'gmail', 'index.js'),
      calendar: path.join('flo-mcp-servers', 'calendar', 'index.js'),
      docs: path.join('flo-mcp-servers', 'docs', 'index.js'),
      bookmarks: path.join('flo-mcp-servers', 'bookmarks', 'index.js'),
    },
  },
  ghl: {
    root: 'ghl-mcp',
    main: path.join('ghl-mcp', 'main.py'),
    requirements: path.join('ghl-mcp', 'requirements.txt'),
  },
  ghlNode: {
    root: 'ghl-mcp-node',
    main: path.join('ghl-mcp-node', 'index.js'),
  },
} as const;

export type FloServerId = keyof typeof VENDOR_SUBDIRS.flo.servers;

export interface BundledPathsDeps {
  /** True when running in a packaged Electron app. */
  isPackaged: boolean;
  /** `process.resourcesPath` in packaged mode; ignored otherwise. */
  resourcesPath: string;
  /** Project root (where `vendor/` lives) in dev. */
  projectRoot: string;
}

/**
 * Return the absolute path to the `vendor/` directory. In packaged mode,
 * this resolves under `process.resourcesPath`; in dev, under `projectRoot`.
 */
export function resolveVendorRoot(deps: BundledPathsDeps): string {
  if (deps.isPackaged) {
    return path.join(deps.resourcesPath, 'vendor');
  }
  return path.join(deps.projectRoot, 'vendor');
}

/**
 * Resolve a Flo server's bundled index.js path. Throws if the path does
 * not exist on disk — callers should treat that as a corrupt install and
 * surface a user-facing error rather than silently failing later.
 */
export function resolveFloServerPath(deps: BundledPathsDeps, id: FloServerId): string {
  const vendor = resolveVendorRoot(deps);
  const rel = VENDOR_SUBDIRS.flo.servers[id];
  const abs = path.join(vendor, rel);
  if (!fs.existsSync(abs)) {
    throw new Error(
      `Bundled Flo server "${id}" not found at ${abs}. The .app bundle may be corrupted — reinstall AI Chief of Staff.`,
    );
  }
  return abs;
}

/**
 * Resolve the bundled GHL main.py path. Throws on missing file (same
 * corrupt-install semantics as resolveFloServerPath).
 */
export function resolveGhlMainPath(deps: BundledPathsDeps): string {
  const vendor = resolveVendorRoot(deps);
  const abs = path.join(vendor, VENDOR_SUBDIRS.ghl.main);
  if (!fs.existsSync(abs)) {
    throw new Error(
      `Bundled GHL server main.py not found at ${abs}. The .app bundle may be corrupted — reinstall AI Chief of Staff.`,
    );
  }
  return abs;
}

/**
 * Resolve the bundled GHL requirements.txt — used by the Connect Tools
 * panel's "Install dependencies" helper.
 */
export function resolveGhlRequirementsPath(deps: BundledPathsDeps): string {
  const vendor = resolveVendorRoot(deps);
  return path.join(vendor, VENDOR_SUBDIRS.ghl.requirements);
}

/**
 * Resolve the bundled GHL Node server (`ghl-mcp-node/index.js`). This is the
 * Python-free port spawned via Electron's bundled Node — it exposes the same
 * 91 GHL tools as the original `main.py` and works on macOS + Windows with no
 * runtime to install. Throws on missing file (same corrupt-install semantics
 * as resolveFloServerPath).
 */
export function resolveGhlNodePath(deps: BundledPathsDeps): string {
  const vendor = resolveVendorRoot(deps);
  const abs = path.join(vendor, VENDOR_SUBDIRS.ghlNode.main);
  if (!fs.existsSync(abs)) {
    throw new Error(
      `Bundled GHL Node server not found at ${abs}. The .app bundle may be corrupted — reinstall AI Chief of Staff.`,
    );
  }
  return abs;
}
