#!/usr/bin/env node

/**
 * Installs the most recently built Mac .app into /Applications and relaunches it.
 *
 * Why this exists: we ship DMGs to GitHub Releases for testers, but used to
 * leave the locally-installed /Applications copy stale at whatever first
 * 1.0.0 build seeded it. Result: dev "had" all the new features in source
 * but the app on the launcher was the broken-signature build that hid from
 * the Dock and refused first-click launch. This script ends that drift.
 *
 * Usage:
 *   npm run install:local            # uses arch of this Mac
 *   npm run install:local -- arm64   # force Apple Silicon build
 *   npm run install:local -- x64     # force Intel build
 *
 * Requires: ./release/mac/ (x64) or ./release/mac-arm64/ from `dist:local`.
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PRODUCT_NAME = 'AI Chief of Staff';
const APPS_DIR = '/Applications';
const REPO_ROOT = path.resolve(__dirname, '..');

function log(msg) {
  console.log(`[install-local] ${msg}`);
}

function fail(msg) {
  console.error(`[install-local] ERROR: ${msg}`);
  process.exit(1);
}

function detectArch() {
  // Allow override via positional arg: `npm run install:local -- arm64`
  const argArch = process.argv[2];
  if (argArch === 'arm64' || argArch === 'x64') return argArch;
  if (argArch) fail(`Unknown arch "${argArch}" — use arm64 or x64`);
  return os.arch() === 'arm64' ? 'arm64' : 'x64';
}

function sourceAppPath(arch) {
  const dir = arch === 'arm64' ? 'mac-arm64' : 'mac';
  return path.join(REPO_ROOT, 'release', dir, `${PRODUCT_NAME}.app`);
}

function destAppPath() {
  return path.join(APPS_DIR, `${PRODUCT_NAME}.app`);
}

const arch = detectArch();
const src = sourceAppPath(arch);
const dest = destAppPath();

if (!fs.existsSync(src)) {
  fail(
    `No built app found at ${src}\n` +
      `  Run \`npm run dist:local\` first to produce a Mac build.`,
  );
}

// Kill any running instance so the file copy doesn't tangle with open file handles
log('Stopping any running instance...');
spawnSync('pkill', ['-f', PRODUCT_NAME], { stdio: 'ignore' });
// Give the OS a moment to release locks
spawnSync('sleep', ['2']);

// Remove the existing /Applications copy if present (could be a stub from a half-install)
if (fs.existsSync(dest)) {
  log(`Removing existing ${dest}`);
  fs.rmSync(dest, { recursive: true, force: true });
}

log(`Copying ${arch} build → ${dest}`);
// Use `cp -R` rather than fs.cpSync to preserve symlinks/perms exactly like Finder does
const cp = spawnSync('cp', ['-R', src, APPS_DIR], { stdio: 'inherit' });
if (cp.status !== 0) fail('cp -R failed');

log('Stripping quarantine attribute...');
spawnSync('xattr', ['-dr', 'com.apple.quarantine', dest], { stdio: 'ignore' });

// Symlink native deps that @flo/shared needs but aren't declared in
// vendor/flo-mcp-servers/package.json (better-sqlite3, bindings, file-uri-to-path).
// The main ACOS node_modules has them Electron-rebuilt; the bundled flo
// servers spawn via Electron's binary so they need to resolve to the same
// ABI-matched copy. Documented in vendor/VENDORED.md.
const vendorNm = path.join(
  dest,
  'Contents',
  'Resources',
  'vendor',
  'flo-mcp-servers',
  'node_modules',
);
const appNm = path.join(dest, 'Contents', 'Resources', 'app', 'node_modules');
if (fs.existsSync(vendorNm) && fs.existsSync(appNm)) {
  for (const pkg of ['better-sqlite3', 'bindings', 'file-uri-to-path']) {
    const target = path.join(appNm, pkg);
    const link = path.join(vendorNm, pkg);
    if (!fs.existsSync(target)) continue;
    try {
      fs.rmSync(link, { recursive: true, force: true });
      fs.symlinkSync(target, link, 'dir');
    } catch (err) {
      log(`Warning: could not symlink ${pkg}: ${err.message}`);
    }
  }
  log('Symlinked native deps for vendored Flo servers');
}

// Print verification info
try {
  const plist = path.join(dest, 'Contents', 'Info.plist');
  const version = execSync(
    `defaults read "${plist}" CFBundleShortVersionString`,
    { encoding: 'utf8' },
  ).trim();
  const bundleId = execSync(
    `defaults read "${plist}" CFBundleIdentifier`,
    { encoding: 'utf8' },
  ).trim();
  log(`Installed: ${PRODUCT_NAME} ${version} (${bundleId}) [${arch}]`);
} catch {
  log('Installed (could not read Info.plist for verification)');
}

log('Launching...');
spawnSync('open', [dest], { stdio: 'ignore' });
log('Done.');
