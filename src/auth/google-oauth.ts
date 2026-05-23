/**
 * Google OAuth 2.0 — Installed App (Desktop) flow.
 *
 * Implements the loopback redirect pattern documented at
 * https://developers.google.com/identity/protocols/oauth2/native-app:
 *
 *   1. Spawn a localhost HTTP server on a random high port.
 *   2. Build authorize URL with PKCE (S256), access_type=offline,
 *      prompt=consent, redirect_uri=http://127.0.0.1:PORT/callback.
 *   3. shell.openExternal() opens the system browser. User consents.
 *      Google redirects to http://127.0.0.1:PORT/callback?code=...
 *   4. The loopback server captures the code, returns a tiny success
 *      page, and shuts down.
 *   5. Exchange code (+ code_verifier) at the token endpoint.
 *   6. Save tokens to `<userData>/google-tokens.json` in the same shape
 *      the bundled Flo MCP servers expect (they read it via `oauthManager`
 *      patched to honor FLO_TOKEN_PATH).
 *
 * Refresh strategy: tokens are auto-refreshed by `ensureValidToken()`
 * when the access token is within 5 minutes of expiry. Google access
 * tokens live ~1 hour; refresh tokens live ~6 months or until revoked.
 *
 * Concurrency: a single in-flight refresh is deduped (`refreshPromise`),
 * same pattern as `ClaudeOAuthManager` in `oauth.ts`. Token-exchange is
 * guarded by `exchangeInProgress` so a duplicate callback never double-
 * spends a one-time auth code.
 *
 * On revoked-grant detection (`invalid_grant` from Google), we broadcast
 * `google-oauth:expired` to every renderer so the Connect Tools panel can
 * show a "Reconnect needed" badge (plan §6, Risk 6).
 */

import crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { AddressInfo } from 'net';
import { app, BrowserWindow, shell } from 'electron';
import {
  GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET,
  GOOGLE_OAUTH_ENDPOINTS,
  GOOGLE_OAUTH_SCOPES,
  isUsingPlaceholderCredentials,
} from './google-credentials';

interface PKCEPair {
  verifier: string;
  challenge: string;
  state: string;
}

/**
 * Token shape persisted to `<userData>/google-tokens.json`. We mirror the
 * field names emitted by Google's OAuth2 client library (snake_case
 * `access_token` / `refresh_token` / `expiry_date`) so the bundled Flo MCP
 * servers — which use `googleapis` directly — can `setCredentials()` from
 * the file unchanged.
 */
export interface GoogleStoredTokens {
  access_token: string;
  refresh_token: string;
  scope: string;
  token_type: string;
  /** ms since epoch — googleapis convention. */
  expiry_date: number;
  /** Cached user email; refreshed on first userinfo lookup. */
  email?: string;
}

export interface GoogleTokenStatus {
  connected: boolean;
  email: string | null;
  expiresAt: number | null;
  scopes: string[];
  needsReconnect: boolean;
}

export interface FlowResult {
  success: boolean;
  error?: string;
  email?: string;
}

/** Loopback ports avoid the well-known ranges and macOS reserved blocks. */
const LOOPBACK_PORT_MIN = 50000;
const LOOPBACK_PORT_MAX = 60000;
const LOOPBACK_PORT_RETRIES = 5;

/** Refresh proactively when within this many ms of expiry. */
const REFRESH_LEEWAY_MS = 5 * 60 * 1000;

/** Filename inside Electron `userData` for the persisted tokens. */
const TOKENS_FILENAME = 'google-tokens.json';

/** Filename inside Electron `userData` for the synthesized credentials.json. */
const CREDENTIALS_FILENAME = 'google-credentials.json';

class GoogleOAuthManager {
  private static instance: GoogleOAuthManager | null = null;
  private currentPKCE: PKCEPair | null = null;
  private pendingServer: http.Server | null = null;
  private exchangeInProgress = false;
  private refreshPromise: Promise<boolean> | null = null;
  /** Override hook for tests — production resolves via electron `app`. */
  private userDataDirOverride: string | null = null;

  private constructor() {}

  static getInstance(): GoogleOAuthManager {
    if (!GoogleOAuthManager.instance) {
      GoogleOAuthManager.instance = new GoogleOAuthManager();
    }
    return GoogleOAuthManager.instance;
  }

  /** Test seam — set before importing this module is impractical, so we
   * expose a setter rather than reading env at construction time. */
  setUserDataDir(dir: string): void {
    this.userDataDirOverride = dir;
  }

  private getUserDataDir(): string {
    if (this.userDataDirOverride) return this.userDataDirOverride;
    return app.getPath('userData');
  }

  getTokensPath(): string {
    return path.join(this.getUserDataDir(), TOKENS_FILENAME);
  }

  getCredentialsPath(): string {
    return path.join(this.getUserDataDir(), CREDENTIALS_FILENAME);
  }

  /**
   * Generate PKCE pair + state token. Verifier is 32 random bytes
   * base64url-encoded; challenge is SHA-256(verifier) base64url.
   * State is a separate 16-byte hex token validated on callback.
   */
  private generatePKCE(): PKCEPair {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const state = crypto.randomBytes(16).toString('hex');
    return { verifier, challenge, state };
  }

  /**
   * Build the Google authorize URL with PKCE + the configured scopes.
   * `prompt=consent` forces issuance of a refresh_token even when the user
   * has previously authorized this client.
   */
  private buildAuthorizeUrl(pkce: PKCEPair, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: GOOGLE_OAUTH_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GOOGLE_OAUTH_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
      state: pkce.state,
      include_granted_scopes: 'true',
    });
    return `${GOOGLE_OAUTH_ENDPOINTS.authorize}?${params.toString()}`;
  }

  /**
   * Bind a loopback HTTP server on a random port. We retry a few times
   * in case EADDRINUSE on the first pick.
   */
  private async startLoopbackServer(
    onResult: (code: string | null, state: string | null, error: string | null) => void,
  ): Promise<http.Server> {
    for (let attempt = 0; attempt < LOOPBACK_PORT_RETRIES; attempt++) {
      const port =
        LOOPBACK_PORT_MIN +
        Math.floor(Math.random() * (LOOPBACK_PORT_MAX - LOOPBACK_PORT_MIN));
      try {
        const server = await new Promise<http.Server>((resolve, reject) => {
          const srv = http.createServer((req, res) => {
            // Only accept GET /callback — ignore favicon, etc.
            const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
            if (url.pathname !== '/callback') {
              res.statusCode = 404;
              res.end('Not Found');
              return;
            }
            const code = url.searchParams.get('code');
            const state = url.searchParams.get('state');
            const error = url.searchParams.get('error');

            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(SUCCESS_HTML);
            onResult(code, state, error);
          });
          srv.once('error', reject);
          srv.listen(port, '127.0.0.1', () => resolve(srv));
        });
        return server;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'EADDRINUSE') throw err;
        // Try another port.
      }
    }
    throw new Error(
      `Could not bind loopback OAuth server on a free port in [${LOOPBACK_PORT_MIN}, ${LOOPBACK_PORT_MAX})`,
    );
  }

  /**
   * Run the full Installed-App OAuth flow end to end. Resolves once the
   * loopback server has received the code, tokens have been exchanged,
   * and the user's email has been cached.
   */
  async startFlow(): Promise<FlowResult> {
    if (isUsingPlaceholderCredentials()) {
      return {
        success: false,
        error:
          'Google OAuth is not configured for this build. The TSAI Google Cloud project credentials have not been embedded yet — contact Brett.',
      };
    }
    if (this.exchangeInProgress) {
      return { success: false, error: 'A Google sign-in is already in progress.' };
    }
    this.exchangeInProgress = true;
    try {
      // Promise that resolves when the loopback hit /callback.
      let resolveCallback!: (v: {
        code: string | null;
        state: string | null;
        error: string | null;
      }) => void;
      const callbackPromise = new Promise<{
        code: string | null;
        state: string | null;
        error: string | null;
      }>((resolve) => {
        resolveCallback = resolve;
      });

      const server = await this.startLoopbackServer((code, state, error) =>
        resolveCallback({ code, state, error }),
      );
      this.pendingServer = server;
      const addr = server.address() as AddressInfo;
      const redirectUri = `http://127.0.0.1:${addr.port}/callback`;

      const pkce = this.generatePKCE();
      this.currentPKCE = pkce;
      const authUrl = this.buildAuthorizeUrl(pkce, redirectUri);
      await shell.openExternal(authUrl);

      const { code, state, error } = await callbackPromise;
      // Always close the loopback server immediately after the callback.
      await this.stopLoopbackServer();

      if (error) {
        return { success: false, error: `Google returned an error: ${error}` };
      }
      if (!code) {
        return { success: false, error: 'Google did not return an authorization code.' };
      }
      if (state !== pkce.state) {
        return {
          success: false,
          error: 'OAuth state mismatch — possible CSRF, sign-in aborted.',
        };
      }

      const tokens = await this.exchangeCodeForTokens(code, pkce, redirectUri);
      const email = await this.fetchUserEmail(tokens.access_token).catch(() => null);
      const stored: GoogleStoredTokens = { ...tokens, email: email || undefined };
      this.persistTokens(stored);
      this.currentPKCE = null;
      return { success: true, email: email || undefined };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Google sign-in failed.',
      };
    } finally {
      this.exchangeInProgress = false;
      await this.stopLoopbackServer().catch(() => undefined);
    }
  }

  private async stopLoopbackServer(): Promise<void> {
    const srv = this.pendingServer;
    if (!srv) return;
    this.pendingServer = null;
    await new Promise<void>((resolve) => {
      srv.close(() => resolve());
    });
  }

  /**
   * Exchange the one-time auth code for access + refresh tokens.
   */
  private async exchangeCodeForTokens(
    code: string,
    pkce: PKCEPair,
    redirectUri: string,
  ): Promise<GoogleStoredTokens> {
    const body = new URLSearchParams({
      code,
      client_id: GOOGLE_OAUTH_CLIENT_ID,
      client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: pkce.verifier,
    });
    const resp = await fetch(GOOGLE_OAUTH_ENDPOINTS.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Token exchange failed (${resp.status}): ${text}`);
    }
    const data = (await resp.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      token_type: string;
      scope: string;
    };
    if (!data.access_token) {
      throw new Error('Token exchange returned no access_token.');
    }
    if (!data.refresh_token) {
      throw new Error(
        'Google did not return a refresh_token — try removing this app from your Google account and reconnecting.',
      );
    }
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expiry_date: Date.now() + data.expires_in * 1000,
      scope: data.scope,
      token_type: data.token_type,
    };
  }

  /**
   * Refresh the access token using the stored refresh token. Returns the
   * new stored bundle, or null if the refresh failed (e.g. user revoked
   * access — caller should broadcast `google-oauth:expired`).
   */
  private async refreshAccessToken(): Promise<GoogleStoredTokens | null> {
    const existing = this.readTokens();
    if (!existing?.refresh_token) return null;
    const body = new URLSearchParams({
      refresh_token: existing.refresh_token,
      client_id: GOOGLE_OAUTH_CLIENT_ID,
      client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
      grant_type: 'refresh_token',
    });
    const resp = await fetch(GOOGLE_OAUTH_ENDPOINTS.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!resp.ok) {
      const text = await resp.text();
      // `invalid_grant` is the canonical "refresh token revoked" signal.
      if (text.includes('invalid_grant')) {
        this.broadcastExpired();
        return null;
      }
      console.error('[GoogleOAuth] Refresh failed:', resp.status, text);
      return null;
    }
    const data = (await resp.json()) as {
      access_token: string;
      expires_in: number;
      token_type: string;
      scope?: string;
      refresh_token?: string;
    };
    const merged: GoogleStoredTokens = {
      access_token: data.access_token,
      // Google omits refresh_token on refresh responses unless rotated.
      refresh_token: data.refresh_token || existing.refresh_token,
      expiry_date: Date.now() + data.expires_in * 1000,
      scope: data.scope || existing.scope,
      token_type: data.token_type,
      email: existing.email,
    };
    this.persistTokens(merged);
    return merged;
  }

  /**
   * Ensure the persisted access token is fresh. Returns true if a valid
   * access token is now on disk, false if not connected or refresh failed.
   * Concurrent calls share a single in-flight refresh.
   */
  async ensureValidToken(): Promise<boolean> {
    const existing = this.readTokens();
    if (!existing) return false;
    if (existing.expiry_date - REFRESH_LEEWAY_MS > Date.now()) {
      return true;
    }
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      const refreshed = await this.refreshAccessToken();
      return !!refreshed;
    })().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  /**
   * Read userinfo to populate the connected email. Called once after
   * the initial token exchange; subsequent calls read from cache.
   */
  private async fetchUserEmail(accessToken: string): Promise<string | null> {
    const resp = await fetch(GOOGLE_OAUTH_ENDPOINTS.userInfo, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { email?: string };
    return data.email || null;
  }

  /**
   * High-level status used by `google-oauth:status` IPC + the panel cards.
   * Does NOT trigger a refresh — caller can run `ensureValidToken()` first
   * if they need a guaranteed-fresh access token.
   */
  getStatus(): GoogleTokenStatus {
    const tokens = this.readTokens();
    if (!tokens) {
      return {
        connected: false,
        email: null,
        expiresAt: null,
        scopes: [],
        needsReconnect: false,
      };
    }
    return {
      connected: true,
      email: tokens.email || null,
      expiresAt: tokens.expiry_date,
      scopes: tokens.scope ? tokens.scope.split(/\s+/) : [],
      needsReconnect: false,
    };
  }

  /**
   * Persist tokens atomically: write to .tmp, fsync, rename. Same pattern
   * used by `saveMCPConfig` (mcp/config.ts).
   */
  private persistTokens(tokens: GoogleStoredTokens): void {
    const target = this.getTokensPath();
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${target}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, JSON.stringify(tokens, null, 2) + '\n');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, target);
  }

  /**
   * Read persisted tokens, returning null when the file is missing or
   * malformed (treated as "not connected" — caller can prompt the user
   * to sign in again).
   */
  private readTokens(): GoogleStoredTokens | null {
    const target = this.getTokensPath();
    if (!fs.existsSync(target)) return null;
    try {
      const raw = fs.readFileSync(target, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.access_token !== 'string') return null;
      return parsed as GoogleStoredTokens;
    } catch (err) {
      console.error('[GoogleOAuth] Failed to read tokens file:', (err as Error).message);
      return null;
    }
  }

  /**
   * Write `<userData>/google-credentials.json` in the exact shape the
   * Flo OAuthManager (and `googleapis` OAuth2) expects, so the bundled
   * Flo MCP servers can `setCredentials()` against it once their oauth.ts
   * honors FLO_CREDENTIALS_PATH.
   *
   * Called once on app launch (and every launch — cheap and idempotent).
   * Skipped when running against placeholder credentials so we don't
   * stomp a real file from a side-by-side dev install.
   */
  ensureCredentialsFile(): void {
    if (isUsingPlaceholderCredentials()) return;
    const target = this.getCredentialsPath();
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const doc = {
      installed: {
        client_id: GOOGLE_OAUTH_CLIENT_ID,
        client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
        auth_uri: GOOGLE_OAUTH_ENDPOINTS.authorize,
        token_uri: GOOGLE_OAUTH_ENDPOINTS.token,
        redirect_uris: ['http://127.0.0.1'],
      },
    };
    // Always overwrite — credentials may rotate, and the file is derived
    // entirely from baked-in constants.
    fs.writeFileSync(target, JSON.stringify(doc, null, 2) + '\n', { mode: 0o600 });
  }

  /**
   * Delete the persisted tokens. Best-effort revoke against Google's
   * revoke endpoint — failure is non-fatal (e.g. offline).
   */
  async disconnect(): Promise<void> {
    const tokens = this.readTokens();
    const target = this.getTokensPath();
    if (fs.existsSync(target)) {
      try {
        fs.unlinkSync(target);
      } catch (err) {
        console.error('[GoogleOAuth] Could not delete tokens file:', (err as Error).message);
      }
    }
    if (tokens?.refresh_token) {
      try {
        await fetch(
          `${GOOGLE_OAUTH_ENDPOINTS.revoke}?token=${encodeURIComponent(tokens.refresh_token)}`,
          { method: 'POST' },
        );
      } catch {
        // Best-effort.
      }
    }
  }

  /**
   * Broadcast a `google-oauth:expired` event to every renderer. Connect
   * Tools panel listens for this to flip affected cards into
   * "Reconnect needed" state.
   */
  private broadcastExpired(): void {
    try {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.send('google-oauth:expired');
        }
      }
    } catch {
      // Electron not ready or no windows — ignore.
    }
  }

  /** Cancel any pending flow — closes the loopback server and resets PKCE. */
  async cancelFlow(): Promise<void> {
    this.currentPKCE = null;
    this.exchangeInProgress = false;
    await this.stopLoopbackServer().catch(() => undefined);
  }
}

const SUCCESS_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>AI Chief of Staff — Connected</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
           background: #0d1117; color: #e6edf3; display: flex; align-items: center;
           justify-content: center; height: 100vh; margin: 0; }
    .card { text-align: center; padding: 2rem 3rem; background: #161b22;
            border: 1px solid #30363d; border-radius: 12px; max-width: 420px; }
    h1 { margin: 0 0 0.5rem; font-size: 1.4rem; }
    p { margin: 0; color: #8b949e; }
  </style>
</head>
<body>
  <div class="card">
    <h1>✓ Connected</h1>
    <p>You can close this window and return to AI Chief of Staff.</p>
  </div>
</body>
</html>
`;

export const GoogleOAuth = GoogleOAuthManager.getInstance();
export { GoogleOAuthManager };
