/**
 * Claude OAuth Implementation
 *
 * Uses PKCE flow with manual code entry (user copies code from browser).
 * Based on Claude Code's OAuth implementation.
 */

import crypto from 'crypto';
import { BrowserWindow, shell } from 'electron';
import { SettingsManager } from '../settings';

// OAuth Configuration (same as Claude Code)
const OAUTH_CONFIG = {
  clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  authorizeUrl: 'https://claude.ai/oauth/authorize',
  tokenUrl: 'https://platform.claude.com/v1/oauth/token',
  redirectUri: 'https://platform.claude.com/oauth/code/callback',
  scopes:
    'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload',
};

interface PKCEPair {
  verifier: string;
  challenge: string;
}

interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

class ClaudeOAuthManager {
  private static instance: ClaudeOAuthManager | null = null;
  private currentPKCE: PKCEPair | null = null;
  private pendingAuth: boolean = false;
  private refreshPromise: Promise<boolean> | null = null;
  private exchangeInProgress: boolean = false;

  private constructor() {}

  static getInstance(): ClaudeOAuthManager {
    if (!ClaudeOAuthManager.instance) {
      ClaudeOAuthManager.instance = new ClaudeOAuthManager();
    }
    return ClaudeOAuthManager.instance;
  }

  /**
   * Generate PKCE pair for OAuth
   */
  private generatePKCE(): PKCEPair {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
  }

  /**
   * Build authorization URL
   */
  private getAuthorizationURL(): string {
    this.currentPKCE = this.generatePKCE();

    const params = new URLSearchParams({
      code: 'true',
      client_id: OAUTH_CONFIG.clientId,
      response_type: 'code',
      redirect_uri: OAUTH_CONFIG.redirectUri,
      scope: OAUTH_CONFIG.scopes,
      code_challenge: this.currentPKCE.challenge,
      code_challenge_method: 'S256',
      state: this.currentPKCE.verifier,
    });

    return `${OAUTH_CONFIG.authorizeUrl}?${params.toString()}`;
  }

  /**
   * Start OAuth flow - opens browser for user to authenticate
   */
  async startFlow(): Promise<{ success: boolean; error?: string }> {
    try {
      const authUrl = this.getAuthorizationURL();
      this.pendingAuth = true;

      // Open browser for authentication
      await shell.openExternal(authUrl);

      return { success: true };
    } catch (error) {
      this.pendingAuth = false;
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start OAuth flow',
      };
    }
  }

  /**
   * Check if OAuth flow is pending (waiting for code)
   */
  isPending(): boolean {
    return this.pendingAuth;
  }

  /**
   * Fetch with retry and exponential backoff for rate limit errors.
   * Handles both HTTP 429 and Anthropic's JSON body rate_limit_error responses.
   */
  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    maxRetries: number = 5
  ): Promise<Response> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const response = await fetch(url, options);

      console.log(
        `[OAuth] Token endpoint response: status=${response.status} (attempt ${attempt + 1}/${maxRetries + 1})`
      );

      const isRateLimited = response.status === 429;
      let bodyRateLimited = false;

      // Check for Anthropic-style rate_limit_error in response body (may come as non-429 status)
      if (!isRateLimited && !response.ok) {
        const cloned = response.clone();
        try {
          const body = await cloned.text();
          bodyRateLimited = body.includes('rate_limit_error');
        } catch {
          // Ignore clone/parse errors
        }
      }

      if ((isRateLimited || bodyRateLimited) && attempt < maxRetries) {
        // Use Retry-After header if present, otherwise start at 5s and double each time
        const retryAfter = response.headers.get('retry-after');
        const delaySeconds = retryAfter ? parseInt(retryAfter, 10) : 5 * Math.pow(2, attempt);
        const delayMs = (isNaN(delaySeconds) ? 5 * Math.pow(2, attempt) : delaySeconds) * 1000;
        console.log(
          `[OAuth] Rate limited, retrying in ${delayMs / 1000}s (attempt ${attempt + 1}/${maxRetries})`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      return response;
    }

    // Should not reach here, but satisfy TypeScript
    throw new Error('Max retries exceeded');
  }

  /**
   * Complete OAuth flow with authorization code from user
   */
  async completeWithCode(code: string): Promise<{ success: boolean; error?: string }> {
    if (!this.currentPKCE) {
      return { success: false, error: 'No pending OAuth flow' };
    }

    // Guard against duplicate submissions
    if (this.exchangeInProgress) {
      return { success: false, error: 'Token exchange already in progress' };
    }

    this.exchangeInProgress = true;
    try {
      const tokens = await this.exchangeCodeForTokens(code, this.currentPKCE);

      // Save tokens securely
      SettingsManager.set('auth.method', 'oauth');
      SettingsManager.set('auth.oauthToken', tokens.accessToken);
      SettingsManager.set('auth.refreshToken', tokens.refreshToken);
      SettingsManager.set('auth.tokenExpiresAt', tokens.expiresAt.toString());

      this.pendingAuth = false;
      this.currentPKCE = null;

      console.log('[OAuth] Successfully authenticated');
      return { success: true };
    } catch (error) {
      this.pendingAuth = false;
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to exchange code for tokens',
      };
    } finally {
      this.exchangeInProgress = false;
    }
  }

  /**
   * Exchange authorization code for tokens
   */
  private async exchangeCodeForTokens(code: string, pkce: PKCEPair): Promise<OAuthTokens> {
    // Handle code#state format (user pastes the full callback code)
    const parts = code.trim().split('#');
    const authCode = parts[0];
    const state = parts.length > 1 ? parts[1] : pkce.verifier;

    console.log('[OAuth] Exchanging code:', {
      codeLength: authCode.length,
      hasState: parts.length > 1,
      stateMatch: state === pkce.verifier,
    });

    const response = await this.fetchWithRetry(OAUTH_CONFIG.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: authCode,
        state: state,
        code_verifier: pkce.verifier,
        client_id: OAUTH_CONFIG.clientId,
        redirect_uri: OAUTH_CONFIG.redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token exchange failed: ${errorText}`);
    }

    const data = await response.json();

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }

  /**
   * Refresh access token if needed (deduplicates concurrent calls)
   */
  async refreshTokenIfNeeded(): Promise<boolean> {
    const expiresAt = parseInt(SettingsManager.get('auth.tokenExpiresAt') || '0', 10);
    const refreshToken = SettingsManager.get('auth.refreshToken');

    // Check if token expires within 60 seconds
    if (Date.now() < expiresAt - 60000) {
      return true; // Token still valid
    }

    if (!refreshToken) {
      return false;
    }

    // Deduplicate concurrent refresh calls — reuse in-flight promise
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        const tokens = await this.refreshAccessToken(refreshToken);

        SettingsManager.set('auth.oauthToken', tokens.accessToken);
        SettingsManager.set('auth.refreshToken', tokens.refreshToken);
        SettingsManager.set('auth.tokenExpiresAt', tokens.expiresAt.toString());

        console.log('[OAuth] Token refreshed');
        return true;
      } catch (error) {
        console.error('[OAuth] Token refresh failed:', error);
        // Clear expiry so subsequent checks don't falsely report the token as valid.
        // This ensures the settings UI won't show "Connected" for a dead session.
        SettingsManager.set('auth.tokenExpiresAt', '0');
        return false;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  /**
   * Refresh access token
   */
  private async refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
    const response = await this.fetchWithRetry(OAUTH_CONFIG.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        client_id: OAUTH_CONFIG.clientId,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token refresh failed: ${errorText}`);
    }

    const data = await response.json();

    if (!data.access_token || typeof data.access_token !== 'string') {
      throw new Error(
        `Token refresh returned malformed response: missing or invalid access_token (got ${JSON.stringify(data.access_token)})`
      );
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }

  /**
   * Get current access token (refreshing if needed)
   */
  async getAccessToken(): Promise<string | null> {
    const authMethod = SettingsManager.get('auth.method');
    if (authMethod !== 'oauth') {
      return null;
    }

    const refreshed = await this.refreshTokenIfNeeded();
    if (!refreshed) {
      // Notify all renderer windows so UIs update immediately
      this.broadcastAuthExpired();
      return null;
    }

    return SettingsManager.get('auth.oauthToken') || null;
  }

  /**
   * Broadcast auth:expired event to all open renderer windows
   * so settings panels update without manual refresh.
   */
  private broadcastAuthExpired(): void {
    try {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.send('auth:expired');
        }
      }
    } catch {
      // Electron not ready or no windows — ignore
    }
  }

  /**
   * Cancel pending OAuth flow
   */
  cancelFlow(): void {
    this.pendingAuth = false;
    this.currentPKCE = null;
  }

  /**
   * Clear stored OAuth credentials
   */
  logout(): void {
    SettingsManager.set('auth.method', '');
    SettingsManager.set('auth.oauthToken', '');
    SettingsManager.set('auth.refreshToken', '');
    SettingsManager.set('auth.tokenExpiresAt', '');
    this.pendingAuth = false;
    this.currentPKCE = null;
  }
}

export const ClaudeOAuth = ClaudeOAuthManager.getInstance();
