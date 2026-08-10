/**
 * Verifies the vendored `@flo/shared` oauth.js honors FLO_TOKEN_PATH and
 * FLO_CREDENTIALS_PATH env vars (plan §6 — ACOS vendor patch).
 *
 * The bundled Flo MCP servers spawn with these env vars set to
 * `<userData>/google-tokens.json` and `<userData>/google-credentials.json`
 * so they read ACOS-managed auth state instead of `~/.flo/`.
 *
 * If this test fails after a vendor refresh, restore the tracked ./shared
 * security patch. refresh-vendor.sh intentionally fails closed rather than
 * rewriting it from mutable upstream output.
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const VENDORED_OAUTH = path.resolve(
  __dirname,
  '../../vendor/flo-mcp-servers/node_modules/@flo/shared/dist/oauth.js',
);
const TRACKED_PROPOSAL_CACHE = path.resolve(
  __dirname,
  '../../vendor/flo-mcp-servers/shared/dist/proposal-cache.js',
);

describe('vendored @flo/shared/dist/oauth.js env-var override', () => {
  it('contains the ACOS vendor patch marker', () => {
    const src = fs.readFileSync(VENDORED_OAUTH, 'utf8');
    expect(src).toContain('ACOS vendor patch');
  });

  it('reads TOKEN_PATH from FLO_TOKEN_PATH env var with HOME fallback', () => {
    const src = fs.readFileSync(VENDORED_OAUTH, 'utf8');
    // Look for the exact override pattern — both clauses must be present.
    expect(src).toMatch(/process\.env\.FLO_TOKEN_PATH\s*\|\|/);
    expect(src).toMatch(/process\.env\.HOME[^)]*'\.flo',\s*'tokens\.json'/);
  });

  it('reads CREDENTIALS_PATH from FLO_CREDENTIALS_PATH env var with HOME fallback', () => {
    const src = fs.readFileSync(VENDORED_OAUTH, 'utf8');
    expect(src).toMatch(/process\.env\.FLO_CREDENTIALS_PATH\s*\|\|/);
    expect(src).toMatch(/process\.env\.HOME[^)]*'\.flo',\s*'credentials\.json'/);
  });

  it('still exports OAuthManager and oauthManager singleton', () => {
    const src = fs.readFileSync(VENDORED_OAUTH, 'utf8');
    expect(src).toContain('export class OAuthManager');
    expect(src).toContain('export const oauthManager');
  });

  it('keeps proposal data in the app-selected path with private permissions', () => {
    const src = fs.readFileSync(TRACKED_PROPOSAL_CACHE, 'utf8');
    expect(src).toContain('FLO_PROPOSALS_PATH');
    expect(src).toContain("mode: 0o700");
    expect(src).toContain('fs.chmodSync(DB_PATH, 0o600)');
    expect(src).toContain("this.db.pragma('journal_mode = WAL')");
  });
});
