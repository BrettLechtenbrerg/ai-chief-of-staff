/**
 * TSAI Google Cloud project OAuth credentials.
 *
 * Plan §1 (Architecture) calls for a dedicated TSAI Google Cloud project
 * `tsai-ai-chief-of-staff` in External + Testing mode. The Desktop-app
 * client_id is baked into the binary; the client_secret for a Desktop client
 * is acknowledged by Google's installed-app docs as not-truly-secret (PKCE
 * is the actual protection). We still treat it as moderately sensitive —
 * never log it, never commit a real value.
 *
 * STATUS — placeholder values pending Step 2 of the approved plan:
 *   "TSAI creates the new tsai-ai-chief-of-staff Google Cloud project in
 *    Testing mode … downloads the Desktop-app credentials JSON, hands it
 *    to Brett."
 *
 * When the real project exists, swap PLACEHOLDER_* with the real client_id
 * and client_secret from the downloaded JSON. The OAuth flow code in
 * `google-oauth.ts` and all unit tests are written against this module's
 * shape and do not need to change.
 *
 * Scopes mirror `flo-assistant/shared/src/oauth.ts` lines 5–12 so the four
 * bundled Flo MCP servers (gmail / calendar / docs / bookmarks) accept the
 * tokens unchanged once their oauth.ts honors FLO_TOKEN_PATH / FLO_CREDENTIALS_PATH.
 */

// Real credentials for TSAI Google Cloud project `tsai-ai-chief-of-staff`,
// downloaded from the Desktop-app OAuth client created on May 23, 2026.
// Owner: brettlechtenberg@gmail.com. Project ID: tsai-ai-chief-of-staff.
// Override via env vars at build time for forks/clones.
export const GOOGLE_OAUTH_CLIENT_ID =
  process.env.ACOS_GOOGLE_CLIENT_ID ||
  '746746276451-0frebau8jtuerrvo8sbaiotldbv73f4t.apps.googleusercontent.com';

export const GOOGLE_OAUTH_CLIENT_SECRET =
  process.env.ACOS_GOOGLE_CLIENT_SECRET || 'GOCSPX-REDACTED_OLD_ROTATED_2026_05_25';

/** Scopes — keep identical to flo-assistant/shared/src/oauth.ts SCOPES. */
export const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/documents',
  // userinfo.email is needed to display "Connected as <email>" in the panel.
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

export const GOOGLE_OAUTH_ENDPOINTS = {
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  revoke: 'https://oauth2.googleapis.com/revoke',
  userInfo: 'https://openidconnect.googleapis.com/v1/userinfo',
} as const;

/**
 * True when the build is running against placeholder credentials. The UI
 * uses this to show a "Setup pending — real credentials required" notice
 * instead of letting users click Connect into a guaranteed-to-fail flow.
 */
export function isUsingPlaceholderCredentials(): boolean {
  return (
    GOOGLE_OAUTH_CLIENT_ID.startsWith('PLACEHOLDER') ||
    GOOGLE_OAUTH_CLIENT_SECRET.startsWith('PLACEHOLDER')
  );
}
