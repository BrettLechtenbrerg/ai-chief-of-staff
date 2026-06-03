# Vendored MCP servers

Bundled into the AI Chief of Staff `.app` via `electron-builder` `extraResources`
so the Connect Tools panel can spawn them without forcing testers to clone
upstream Flo or hand-install Python packages globally.

| Path | Upstream | Type | License |
|------|----------|------|---------|
| `flo-mcp-servers/gmail/index.js` | `~/flo-assistant/servers/gmail/dist/index.js` | Compiled JS (ESM) | TSAI-internal (see Flo repo) |
| `flo-mcp-servers/calendar/index.js` | `~/flo-assistant/servers/calendar/dist/index.js` | Compiled JS (ESM) | TSAI-internal |
| `flo-mcp-servers/docs/index.js` | `~/flo-assistant/servers/docs/dist/index.js` | Compiled JS (ESM) | TSAI-internal |
| `flo-mcp-servers/bookmarks/index.js` | `~/flo-assistant/servers/bookmarks/dist/index.js` | Compiled JS (ESM) | TSAI-internal |
| `flo-mcp-servers/node_modules/@flo/shared/dist/*.js` | `~/flo-assistant/shared/dist/*.js` | Compiled JS (ESM) | TSAI-internal |
| `flo-mcp-servers/node_modules/{googleapis,@modelcontextprotocol/sdk,zod,...}` | npm | Runtime deps | Apache-2.0 / MIT |
| `ghl-mcp-node/index.js` | Node port of `~/ghl-mcp/main.py` (originally based on the tenfoldmarc GHL server) | JS (ESM) | TSAI-internal |
| `ghl-mcp-node/node_modules/@modelcontextprotocol/sdk` | npm | Runtime dep | MIT |
| `ghl-mcp/main.py` | `~/ghl-mcp/main.py` | Python (FastMCP) — **reference only / superseded by `ghl-mcp-node`** | TSAI-internal |
| `ghl-mcp/requirements.txt` | `~/ghl-mcp/requirements.txt` | pip requirements — **reference only** | — |

## Why vendor

Testers don't have `~/flo-assistant/` or `~/ghl-mcp/` on their machines. Vendoring
ships a single self-contained bundle. Resolved at runtime by
`src/mcp/bundled-paths.ts` and started by the Connect Tools IPC layer.

### GHL: Node port (no Python)

`ghl-mcp-node/index.js` is a hand-maintained Node (ESM) port of the Python
`ghl-mcp/main.py`. It exposes the **same 91 tools** (identical names, args, REST
endpoints, bodies, `Version: 2021-07-28` header, `locationId` injection, 25k
truncation, and `HTTP <code>: <body[:500]>` error passthrough). It is spawned via
Electron's bundled Node (`process.execPath` + `ELECTRON_RUN_AS_NODE=1`) exactly
like the Flo servers, so a fresh-install tester needs **no Python runtime** and it
works on **macOS and Windows**.

The Python `ghl-mcp/` tree is kept on disk as provenance/reference for this round
but is **no longer referenced by app code** — `connect-tools-ipc.ts` now writes a
Node-spawn entry. It will be pruned in a later cleanup once the Node server is
field-proven.

**Keep `ghl-mcp-node/index.js` in lockstep with `ghl-mcp/main.py`.** When the
Python tool set changes, mirror it in the Node port and re-run the parity gate:
`npx vitest run tests/unit/ghl-node-server.test.ts`. Runtime dep install:
`vendor/ghl-mcp-node/refresh.sh`. The server has **no native modules** (pure JS +
global `fetch`), so it needs no afterPack symlink and does not affect the
better-sqlite3 seal handling.

## Patches applied

### `flo-mcp-servers/node_modules/@flo/shared/dist/oauth.js`

The upstream `OAuthManager` hard-codes `~/.flo/tokens.json` and
`~/.flo/credentials.json`. ACOS owns auth state in `<userData>/` so the
bundled servers must read tokens/credentials from there instead. The vendor
patch (plan §6) makes those paths configurable via env vars:

```js
// Before
const TOKEN_PATH = path.join(process.env.HOME || '', '.flo', 'tokens.json');
const CREDENTIALS_PATH = path.join(process.env.HOME || '', '.flo', 'credentials.json');

// After (ACOS vendor patch)
const TOKEN_PATH = process.env.FLO_TOKEN_PATH || path.join(process.env.HOME || '', '.flo', 'tokens.json');
const CREDENTIALS_PATH = process.env.FLO_CREDENTIALS_PATH || path.join(process.env.HOME || '', '.flo', 'credentials.json');
```

Backwards-compat: a standalone `~/flo-assistant` install with no env vars
behaves identically to upstream.

### Missing native deps for `@flo/shared/proposal-cache.js`

`@flo/shared/dist/proposal-cache.js` imports `better-sqlite3`, which isn't
in the vendored `node_modules/` (only `googleapis`, `@modelcontextprotocol/sdk`,
`zod` are declared in vendor `package.json`). At runtime the bundled servers
spawn via Electron's binary, and ACOS's main `node_modules/` already has
`better-sqlite3` (Electron-rebuilt for the correct ABI). The packaged app
resolves it via post-install symlinks created in `Contents/Resources/vendor/flo-mcp-servers/node_modules/`:

- `better-sqlite3` → `../../app/node_modules/better-sqlite3`
- `bindings` → `../../app/node_modules/bindings`
- `file-uri-to-path` → `../../app/node_modules/file-uri-to-path`

**TODO:** bake these symlinks into the build via `electron-builder` `extraFiles`
or an `afterPack` hook so they're created automatically on every packaged build.
Until then, the install-local.cjs script handles dev installs and the
release pipeline needs a manual patch step.

**Follow-up:** upstream this patch into `~/flo-assistant/shared/src/oauth.ts`
and delete the vendor fork. Until then, `refresh-vendor.sh` re-applies the
patch on every refresh.

## Refresh procedure

```bash
cd vendor/flo-mcp-servers
./refresh-vendor.sh                  # uses ~/flo-assistant by default
./refresh-vendor.sh /path/to/flo     # or pass a path
```

The script:
1. Copies each server's compiled `dist/index.js` into the vendor tree.
2. Runs `npm install` for runtime deps (`googleapis`, `@modelcontextprotocol/sdk`, `zod`).
3. Re-vendors `@flo/shared` compiled output (it's not on npm).
4. Re-applies the `oauth.js` env-var patch (idempotent).

Re-vendoring is required whenever upstream Flo ships a relevant change.
CI does not re-vendor automatically — bump deliberately.

## Size

| Component | Approx. size |
|---|---|
| `flo-mcp-servers/` (4 servers + shared) | ~280 KB |
| `flo-mcp-servers/node_modules/` (`googleapis` dominates) | ~113 MB |
| `ghl-mcp/main.py` (reference only) | ~70 KB |
| `ghl-mcp-node/index.js` | ~60 KB |
| `ghl-mcp-node/node_modules/` (`@modelcontextprotocol/sdk`) | ~7.5 MB |
| **Total vendored** | **~121 MB** |

Plan §Risks #7 acknowledges the bundle-size growth and lists falling back
to standalone `@google/*` packages if DMG growth becomes objectionable.

## License acknowledgment

`googleapis` is Apache-2.0. `@modelcontextprotocol/sdk` and `zod` are MIT.
All copied verbatim under their original licenses; license texts live inside
each dependency's directory.
