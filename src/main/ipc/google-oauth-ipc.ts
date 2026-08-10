/**
 * IPC for the Google OAuth (Installed-App) flow used by the Connect Tools
 * panel and by the bundled Flo MCP servers (gmail / calendar / docs).
 *
 * Renderer-visible channels (all exposed via preload as
 * `window.pocketAgent.googleOAuth.*`):
 *
 *   google-oauth:start       \u2192 kick off the loopback OAuth flow, return
 *                              { success, error?, email? }
 *   google-oauth:status      \u2192 { connected, email, expiresAt, scopes, needsReconnect }
 *   google-oauth:disconnect  \u2192 { success } (best-effort token revoke + delete file)
 *   google-oauth:ensureValid \u2192 { ok } (used by debug \u201ccopy diagnostics\u201d button)
 *
 * Event broadcast to renderer:
 *   google-oauth:expired \u2014 fired when a refresh call returns invalid_grant.
 *                          Connect Tools panel listens and flips affected
 *                          tool cards into the "Reconnect needed" state.
 */

import { trustedHandle } from './trusted-ipc.js';
import { GoogleOAuth, type GoogleTokenStatus, type FlowResult } from '../../auth/google-oauth';

export function registerGoogleOAuthIPC(): void {
  trustedHandle('google-oauth:start', async (): Promise<FlowResult> => {
    return GoogleOAuth.startFlow();
  });

  trustedHandle('google-oauth:status', async (): Promise<GoogleTokenStatus> => {
    return GoogleOAuth.getStatus();
  });

  trustedHandle('google-oauth:disconnect', async (): Promise<{ success: boolean }> => {
    await GoogleOAuth.disconnect();
    return { success: true };
  });

  trustedHandle('google-oauth:ensureValid', async (): Promise<{ ok: boolean }> => {
    const ok = await GoogleOAuth.ensureValidToken();
    return { ok };
  });
}
