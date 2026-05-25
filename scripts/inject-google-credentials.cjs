#!/usr/bin/env node
/**
 * Build-time substitution of Google OAuth credentials.
 *
 * Reads ACOS_GOOGLE_CLIENT_ID / ACOS_GOOGLE_CLIENT_SECRET from:
 *   1. process.env (CI), then
 *   2. .env.production at the repo root (local dev), then
 *   3. .env.local at the repo root (last-resort dev override).
 *
 * Rewrites `dist/auth/google-credentials.js` so the compiled output bakes
 * the real values into the shipped Electron bundle. Source stays clean.
 *
 * Behavior:
 *   - If values are MISSING and BUILD_KIND === 'release' (set by dist:signed
 *     and dist:win), this script exits non-zero. Releases must not ship
 *     placeholders.
 *   - If values are MISSING in any other context (dist:local, plain `build`),
 *     the script logs a warning and leaves the placeholders in place so the
 *     dev build still compiles. The UI's `isUsingPlaceholderCredentials()`
 *     helper will show the "setup pending" notice.
 *   - Never logs the secret. Logs only the client_id (which is non-sensitive
 *     and visible in every OAuth URL anyway) and the prefix of the secret.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, 'dist', 'auth', 'google-credentials.js');

const PLACEHOLDER_ID = 'PLACEHOLDER_CLIENT_ID';
const PLACEHOLDER_SECRET = 'PLACEHOLDER_CLIENT_SECRET';

function loadDotenv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  const text = fs.readFileSync(file, 'utf8');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function resolveCredentials() {
  // process.env wins
  let id = process.env.ACOS_GOOGLE_CLIENT_ID || '';
  let secret = process.env.ACOS_GOOGLE_CLIENT_SECRET || '';

  // Fallback: .env.production at repo root
  if (!id || !secret) {
    const fromProd = loadDotenv(path.join(ROOT, '.env.production'));
    id = id || fromProd.ACOS_GOOGLE_CLIENT_ID || '';
    secret = secret || fromProd.ACOS_GOOGLE_CLIENT_SECRET || '';
  }

  // Fallback: .env.local
  if (!id || !secret) {
    const fromLocal = loadDotenv(path.join(ROOT, '.env.local'));
    id = id || fromLocal.ACOS_GOOGLE_CLIENT_ID || '';
    secret = secret || fromLocal.ACOS_GOOGLE_CLIENT_SECRET || '';
  }

  return { id, secret };
}

function maskSecret(s) {
  if (!s) return '(empty)';
  if (s.length < 8) return s[0] + '…';
  return s.slice(0, 8) + '…' + s.slice(-4);
}

function main() {
  if (!fs.existsSync(TARGET)) {
    console.error(`[inject-google-credentials] ${TARGET} not found. Did you run \`tsc\` first?`);
    process.exit(1);
  }

  const { id, secret } = resolveCredentials();
  const buildKind = process.env.BUILD_KIND || 'dev';

  if (!id || !secret) {
    const msg =
      `[inject-google-credentials] No ACOS_GOOGLE_CLIENT_ID / ACOS_GOOGLE_CLIENT_SECRET in env or .env.production / .env.local.`;
    if (buildKind === 'release') {
      console.error(msg + ' Refusing to build a RELEASE artifact with placeholder credentials.');
      process.exit(2);
    }
    console.warn(msg + ' Compiled output keeps placeholders — UI will show the "setup pending" notice.');
    return;
  }

  if (!id.endsWith('.apps.googleusercontent.com')) {
    console.error(`[inject-google-credentials] ACOS_GOOGLE_CLIENT_ID does not look like a Google client_id: ${id}`);
    process.exit(3);
  }
  if (!secret.startsWith('GOCSPX-')) {
    console.error(`[inject-google-credentials] ACOS_GOOGLE_CLIENT_SECRET does not look like a Google client_secret (expected GOCSPX- prefix).`);
    process.exit(4);
  }

  let js = fs.readFileSync(TARGET, 'utf8');

  // The compiled `process.env.X || 'PLACEHOLDER'` reduces to a known literal
  // pair in the JS output. Replace BOTH placeholder string literals.
  if (!js.includes(PLACEHOLDER_ID) || !js.includes(PLACEHOLDER_SECRET)) {
    console.error(
      `[inject-google-credentials] Expected placeholder literals not found in ${TARGET}. ` +
      `Either credentials were already injected, or the source was modified — aborting to avoid double-injection.`,
    );
    process.exit(5);
  }

  js = js.split(PLACEHOLDER_ID).join(id);
  js = js.split(PLACEHOLDER_SECRET).join(secret);

  fs.writeFileSync(TARGET, js);

  console.log(`[inject-google-credentials] Injected client_id=${id} secret=${maskSecret(secret)} into dist/auth/google-credentials.js`);
}

main();
