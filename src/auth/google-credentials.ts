/**
 * TSAI Google Cloud project OAuth credentials.
 *
 * The real `client_id` and `client_secret` for the `tsai-ai-chief-of-staff`
 * Desktop OAuth client are NEVER committed to source. They are injected at
 * build time by `scripts/inject-google-credentials.cjs`, which reads either
 *   - process env (`ACOS_GOOGLE_CLIENT_ID`, `ACOS_GOOGLE_CLIENT_SECRET`), or
 *   - a gitignored `.env.production` file at the repo root,
 * and rewrites the compiled `dist/auth/google-credentials.js` so the values
 * are baked into the shipped Electron bundle.
 *
 * Why this dance: the repo is PUBLIC. Google's own Desktop-app OAuth docs
 * acknowledge that the client_secret cannot be kept confidential on user
 * devices (PKCE is the real protection) — but a secret committed to a public
 * GitHub repo is still scanned, indexed, and auto-revoked by Google's
 * abuse-detection. So: placeholders in source, real values in the artifact.
 *
 * To set up locally:
 *   1. `cp .env.production.example .env.production`
 *   2. Fill in the values from the Desktop-app OAuth client JSON
 *      (Google Cloud Console → APIs & Services → Credentials).
 *   3. `npm run build` — `inject-google-credentials.cjs` runs automatically.
 *   4. `dist:signed` / `dist:local` / `dist:win` all pick up the injected values.
 *
 * Scopes mirror `flo-assistant/shared/src/oauth.ts` lines 5–12 so the four
 * bundled Flo MCP servers (gmail / calendar / docs / bookmarks) accept the
 * tokens unchanged once their oauth.ts honors FLO_TOKEN_PATH / FLO_CREDENTIALS_PATH.
 */

// These two constants are rewritten in-place in the compiled output by
// scripts/inject-google-credentials.cjs. At source time they MUST stay as
// PLACEHOLDER_* strings so GitHub Secret Scanning never flags a push.
export const GOOGLE_OAUTH_CLIENT_ID =
  process.env.ACOS_GOOGLE_CLIENT_ID || 'PLACEHOLDER_CLIENT_ID';

export const GOOGLE_OAUTH_CLIENT_SECRET =
  process.env.ACOS_GOOGLE_CLIENT_SECRET || 'PLACEHOLDER_CLIENT_SECRET';

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
