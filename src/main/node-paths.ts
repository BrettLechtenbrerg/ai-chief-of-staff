import path from 'path';
import fs from 'fs';
import { app } from 'electron';

const IS_WINDOWS = process.platform === 'win32';
const HOME_DIR = process.env.HOME || process.env.USERPROFILE || '';

/**
 * Scan a directory for version subdirectories containing a bin/ folder.
 * Used by nvm, n, and nvm-windows to find installed Node versions.
 */
function scanVersionBins(versionsDir: string, binSubdir = 'bin'): string[] {
  const paths: string[] = [];
  try {
    if (fs.existsSync(versionsDir)) {
      for (const entry of fs.readdirSync(versionsDir)) {
        const binPath = path.join(versionsDir, entry, binSubdir);
        if (fs.existsSync(binPath)) {
          paths.push(binPath);
        }
      }
    }
  } catch {
    // Ignore errors reading directory
  }
  return paths;
}

/**
 * Detect Node.js paths from all common Unix version managers.
 * Covers: nvm, fnm, volta, asdf, nodenv, n, mise
 */
function detectNodeManagerPaths(): string[] {
  const paths: string[] = [];

  // nvm: ~/.nvm/versions/node/*/bin
  paths.push(...scanVersionBins(path.join(HOME_DIR, '.nvm/versions/node')));

  // fnm: ~/.fnm/aliases/default/bin or ~/.local/share/fnm/aliases/default/bin
  const fnmPaths = [
    path.join(HOME_DIR, '.fnm/aliases/default/bin'),
    path.join(HOME_DIR, '.local/share/fnm/aliases/default/bin'),
  ];
  for (const p of fnmPaths) {
    if (fs.existsSync(p)) paths.push(p);
  }

  // volta: ~/.volta/bin
  const voltaBin = path.join(HOME_DIR, '.volta/bin');
  if (fs.existsSync(voltaBin)) paths.push(voltaBin);

  // asdf: ~/.asdf/shims
  const asdfShims = path.join(HOME_DIR, '.asdf/shims');
  if (fs.existsSync(asdfShims)) paths.push(asdfShims);

  // nodenv: ~/.nodenv/shims
  const nodenvShims = path.join(HOME_DIR, '.nodenv/shims');
  if (fs.existsSync(nodenvShims)) paths.push(nodenvShims);

  // n: /usr/local/n/versions/node/*/bin, also $N_PREFIX/bin
  paths.push(...scanVersionBins('/usr/local/n/versions/node'));
  const nPrefix = process.env.N_PREFIX;
  if (nPrefix) {
    const nPrefixBin = path.join(nPrefix, 'bin');
    if (fs.existsSync(nPrefixBin)) paths.push(nPrefixBin);
  }

  // mise: ~/.local/share/mise/shims
  const miseShims = path.join(HOME_DIR, '.local/share/mise/shims');
  if (fs.existsSync(miseShims)) paths.push(miseShims);

  return paths;
}

/**
 * Detect Node.js paths from common Windows version managers.
 * Covers: nvm-windows, fnm, volta, scoop, chocolatey, nodist
 */
function detectWindowsNodePaths(): string[] {
  const paths: string[] = [];
  const appData = process.env.APPDATA || path.join(HOME_DIR, 'AppData', 'Roaming');
  const localAppData = process.env.LOCALAPPDATA || path.join(HOME_DIR, 'AppData', 'Local');

  // nvm-windows: %APPDATA%\nvm\* (version directories contain node.exe directly)
  paths.push(...scanVersionBins(path.join(appData, 'nvm'), '.'));

  // fnm: %APPDATA%\fnm\aliases\default
  const fnmDefault = path.join(appData, 'fnm', 'aliases', 'default');
  if (fs.existsSync(fnmDefault)) paths.push(fnmDefault);

  // volta: %APPDATA%\Volta\bin or %LOCALAPPDATA%\Volta\bin
  const voltaPaths = [path.join(appData, 'Volta', 'bin'), path.join(localAppData, 'Volta', 'bin')];
  for (const p of voltaPaths) {
    if (fs.existsSync(p)) paths.push(p);
  }

  // scoop: ~/scoop/shims
  const scoopShims = path.join(HOME_DIR, 'scoop', 'shims');
  if (fs.existsSync(scoopShims)) paths.push(scoopShims);

  // chocolatey: C:\ProgramData\chocolatey\bin
  const chocoBin = 'C:\\ProgramData\\chocolatey\\bin';
  if (fs.existsSync(chocoBin)) paths.push(chocoBin);

  // nodist: %APPDATA%\nodist\bin
  const nodistBin = path.join(appData, 'nodist', 'bin');
  if (fs.existsSync(nodistBin)) paths.push(nodistBin);

  return paths;
}

// Cache detected paths at module load
export const cachedNodeManagerPaths = IS_WINDOWS
  ? detectWindowsNodePaths()
  : detectNodeManagerPaths();

/**
 * Fix PATH for packaged Electron apps.
 * Adds common tool directories and detected Node version manager paths.
 */
export function fixPathForPackagedApp(): void {
  if (!app.isPackaged) return;

  if (IS_WINDOWS) {
    // Windows: ensure common tool directories are on PATH
    const winPaths = [
      path.join(HOME_DIR, 'AppData', 'Roaming', 'npm'),
      path.join(HOME_DIR, '.local', 'bin'),
      'C:\\Program Files\\nodejs',
      'C:\\Program Files\\Git\\cmd',
      ...cachedNodeManagerPaths,
    ].join(';');
    process.env.PATH = winPaths + ';' + (process.env.PATH || '');
  } else {
    // macOS / Linux: node/npm binaries aren't in PATH when launched from Finder
    const fixedPath = [
      '/opt/homebrew/bin', // Apple Silicon Homebrew
      '/usr/local/bin', // Intel Homebrew / standard location
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
      ...cachedNodeManagerPaths, // All version managers (nvm, fnm, volta, asdf, etc.)
      HOME_DIR + '/.local/bin',
    ].join(':');
    process.env.PATH = fixedPath + ':' + (process.env.PATH || '');
  }
  if (cachedNodeManagerPaths.length > 0) {
    console.log('[Main] Detected Node paths:', cachedNodeManagerPaths.join(', '));
  }
  console.log('[Main] Fixed PATH for packaged app');
}
