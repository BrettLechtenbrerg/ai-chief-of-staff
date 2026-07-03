/**
 * Fallback Google access via the legacy "flo" token.
 *
 * Background: Brett's PERSONAL AI Chief of Staff authenticates Google through
 * the original flo-assistant system (tokens at `~/.flo/tokens.json`, refreshed
 * with the OAuth client in `~/.flo/credentials.json`). The NEW per-user OAuth
 * system (src/auth/google-oauth.ts → `<userData>/google-tokens.json`) is what
 * gets shipped to testers. Converting Brett's machine to the new system caused
 * problems in the past, so we DON'T convert it — instead, tools that need a
 * Google access token (currently only the SEO/Search Console tool) fall back to
 * the flo token when ACOS's own token isn't present.
 *
 * This module is intentionally self-contained and read-only-by-design: it reads
 * the flo token, refreshes it against Google's token endpoint using the flo
 * OAuth client when expired, writes the refreshed token back to the same file
 * (so flo's own servers benefit too), and reports whether the flo grant
 * includes the Search Console scope. It never logs tokens or secrets.
 *
 * Token/credentials file shapes match what flo writes via `googleapis`
 * (snake_case `access_token`/`refresh_token`/`expiry_date`), so nothing about
 * flo's existing behavior changes.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const FLO_DIR = path.join(os.homedir(), '.flo');
const FLO_TOKEN_PATH = path.join(FLO_DIR, 'tokens.json');
const FLO_CREDENTIALS_PATH = path.join(FLO_DIR, 'credentials.json');

const SEARCH_CONSOLE_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** Refresh proactively when within this many ms of expiry (mirrors GoogleOAuth). */
const REFRESH_LEEWAY_MS = 5 * 60 * 1000;

interface FloStoredTokens {
  access_token: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  expiry_date?: number;
}

interface FloCredentials {
  client_id: string;
  client_secret: string;
}

/** True if the flo token file exists at all. */
export function floTokenExists(): boolean {
  return fs.existsSync(FLO_TOKEN_PATH);
}

function readFloTokens(): FloStoredTokens | null {
  try {
    const raw = fs.readFileSync(FLO_TOKEN_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.access_token !== 'string') return null;
    return parsed as FloStoredTokens;
  } catch {
    return null;
  }
}

function readFloCredentials(): FloCredentials | null {
  try {
    const raw = fs.readFileSync(FLO_CREDENTIALS_PATH, 'utf8');
    const parsed = JSON.parse(raw) as { installed?: FloCredentials; web?: FloCredentials };
    const inner = parsed.installed || parsed.web;
    if (!inner?.client_id || !inner?.client_secret) return null;
    return { client_id: inner.client_id, client_secret: inner.client_secret };
  } catch {
    return null;
  }
}

/**
 * True when the flo grant includes the Search Console read-only scope. Used so
 * the SEO tool can tell Brett to run flo's re-auth (which now requests it) when
 * it's missing, instead of failing with an opaque 403.
 */
export function floHasSearchConsoleScope(): boolean {
  const tokens = readFloTokens();
  if (!tokens?.scope) return false;
  return tokens.scope.split(/\s+/).includes(SEARCH_CONSOLE_SCOPE);
}

/** Persist refreshed flo tokens back to disk (same file flo's servers read). */
function persistFloTokens(tokens: FloStoredTokens): void {
  try {
    // 0600: refresh tokens are credentials — owner read/write only
    fs.writeFileSync(FLO_TOKEN_PATH, JSON.stringify(tokens, null, 2) + '\n', { mode: 0o600 });
  } catch (err) {
    console.error('[FloToken] Failed to persist refreshed token:', (err as Error).message);
  }
}

async function refreshFloToken(
  existing: FloStoredTokens,
  creds: FloCredentials,
): Promise<FloStoredTokens | null> {
  if (!existing.refresh_token) return null;
  const body = new URLSearchParams({
    refresh_token: existing.refresh_token,
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    grant_type: 'refresh_token',
  });
  let resp: Response;
  try {
    resp = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (err) {
    console.error('[FloToken] Refresh network error:', (err as Error).message);
    return null;
  }
  if (!resp.ok) {
    // Don't log the body (may contain sensitive detail); status is enough.
    console.error('[FloToken] Refresh failed with status', resp.status);
    return null;
  }
  const data = (await resp.json()) as {
    access_token: string;
    expires_in: number;
    token_type: string;
    scope?: string;
    refresh_token?: string;
  };
  const merged: FloStoredTokens = {
    access_token: data.access_token,
    // Google omits refresh_token on refresh unless rotated.
    refresh_token: data.refresh_token || existing.refresh_token,
    expiry_date: Date.now() + data.expires_in * 1000,
    scope: data.scope || existing.scope,
    token_type: data.token_type || existing.token_type,
  };
  persistFloTokens(merged);
  return merged;
}

/**
 * Return a fresh, valid Google access token from the flo grant, or null if flo
 * isn't set up / refresh failed. Refreshes in-place when near expiry.
 */
export async function getFloAccessToken(): Promise<string | null> {
  const existing = readFloTokens();
  if (!existing) return null;

  const fresh =
    typeof existing.expiry_date === 'number' &&
    existing.expiry_date - REFRESH_LEEWAY_MS > Date.now();
  if (fresh) return existing.access_token;

  const creds = readFloCredentials();
  if (!creds) {
    // Can't refresh without the client — return the (possibly stale) token and
    // let the API call decide; a 401 will surface as a per-site note.
    return existing.access_token;
  }
  const refreshed = await refreshFloToken(existing, creds);
  return refreshed?.access_token ?? existing.access_token;
}
