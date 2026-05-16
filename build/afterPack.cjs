const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * electron-builder afterPack hook to reduce app size
 * Removes unused platform binaries and locale files
 * Supports macOS and Windows builds
 */
exports.default = async function(context) {
  const appOutDir = context.appOutDir;
  const arch = context.arch === 1 ? 'x64' : 'arm64'; // 1 = x64, 3 = arm64
  const platform = process.platform;

  console.log(`[afterPack] Cleaning up for ${platform}-${arch}...`);

  // Determine resource paths based on platform
  let resourcesPath, appPath;

  if (platform === 'darwin') {
    resourcesPath = path.join(appOutDir, 'AI Chief of Staff.app', 'Contents', 'Resources');
    appPath = path.join(resourcesPath, 'app');
  } else {
    // Windows / Linux: flat structure
    resourcesPath = path.join(appOutDir, 'resources');
    appPath = path.join(resourcesPath, 'app');
  }

  // 1. Remove unused ripgrep platform binaries (~41MB savings)
  const ripgrepPath = path.join(appPath, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'vendor', 'ripgrep');
  if (fs.existsSync(ripgrepPath)) {
    const platformMap = {
      darwin: `${arch}-darwin`,
      win32: `${arch}-win32`,
      linux: `${arch}-linux`,
    };
    const keepPlatform = platformMap[platform] || `${arch}-${platform}`;
    const entries = fs.readdirSync(ripgrepPath);

    for (const entry of entries) {
      const entryPath = path.join(ripgrepPath, entry);
      const stat = fs.statSync(entryPath);

      if (stat.isDirectory() && entry !== keepPlatform) {
        console.log(`[afterPack] Removing ripgrep/${entry}`);
        fs.rmSync(entryPath, { recursive: true, force: true });
      }
    }
  }

  // 2. Remove unused locale files (keep only en) - macOS only (.lproj)
  if (platform === 'darwin' && fs.existsSync(resourcesPath)) {
    const localeFiles = fs.readdirSync(resourcesPath).filter(f => f.endsWith('.lproj') && f !== 'en.lproj');
    for (const locale of localeFiles) {
      const localePath = path.join(resourcesPath, locale);
      console.log(`[afterPack] Removing locale ${locale}`);
      fs.rmSync(localePath, { recursive: true, force: true });
    }
  }

  // 3. Remove unnecessary files from node_modules
  const nodeModulesPath = path.join(appPath, 'node_modules');
  if (fs.existsSync(nodeModulesPath)) {
    cleanDirectory(nodeModulesPath, ['.md', '.markdown']);
  }

  console.log('[afterPack] Cleanup complete');

  // 4. macOS only: apply a proper ad-hoc codesign if electron-builder skipped
  //    signing (i.e. local unsigned builds). Without this the bundle keeps the
  //    linker's default ad-hoc signature with Identifier=Electron and an
  //    unsealed Info.plist, which Finder shows as a 'no entry' icon and
  //    macOS refuses to launch. We bind Info.plist, seal resources, and set
  //    the correct bundle identifier from package.json.
  if (platform === 'darwin') {
    const appBundle = path.join(appOutDir, 'AI Chief of Staff.app');
    const entitlements = path.join(__dirname, 'entitlements.mac.plist');
    const bundleId = 'com.totalsuccessai.ai-chief-of-staff';

    // If a real Apple Developer ID Application identity is configured in
    // electron-builder (via package.json build.mac.identity OR the
    // CSC_NAME env var), electron-builder will sign with the real cert
    // AFTER this afterPack hook. Skip the ad-hoc step entirely so we
    // don't waste time signing a bundle that's about to be re-signed.
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const configuredIdentity = pkg && pkg.build && pkg.build.mac && pkg.build.mac.identity;
    const realIdentityConfigured = (typeof configuredIdentity === 'string' && configuredIdentity.length > 0) || !!process.env.CSC_NAME || !!process.env.CSC_LINK;
    if (realIdentityConfigured) {
      console.log('[afterPack] real Apple Developer ID identity configured — electron-builder will sign; skipping ad-hoc step');
      return;
    }

    // Detect: if electron-builder already applied a non-linker signature, skip.
    let needsResign = true;
    try {
      const out = execSync(`codesign -dv "${appBundle}" 2>&1`).toString();
      // A real (or properly re-signed) bundle has Identifier=<bundleId> AND
      // Info.plist entries=N (i.e. plist IS bound). Linker-default signature
      // shows Identifier=Electron and 'Info.plist=not bound'.
      if (out.includes(`Identifier=${bundleId}`) && !out.includes('Info.plist=not bound')) {
        needsResign = false;
      }
    } catch {
      // codesign -dv exits non-zero on unsigned bundles; treat as needing resign
    }

    if (needsResign) {
      console.log('[afterPack] applying ad-hoc codesign with proper identifier...');
      try {
        execSync(
          `codesign --force --deep --sign - ` +
            `--entitlements "${entitlements}" ` +
            `--identifier "${bundleId}" ` +
            `"${appBundle}"`,
          { stdio: 'inherit' }
        );
        // Strip quarantine attributes that might have been set by tools that
        // touched the bundle in /private/var or similar.
        execSync(`xattr -cr "${appBundle}"`, { stdio: 'inherit' });
        // Verify
        const verify = execSync(`codesign --verify --deep --strict "${appBundle}" 2>&1 || true`).toString();
        if (verify.trim()) {
          console.warn('[afterPack] codesign verify output:', verify.trim());
        } else {
          console.log('[afterPack] codesign verified OK');
        }
      } catch (err) {
        console.error('[afterPack] codesign step failed:', err.message);
        throw err;
      }
    } else {
      console.log('[afterPack] bundle already properly signed, skipping re-sign');
    }
  }
};

function cleanDirectory(dir, extensions) {
  if (!fs.existsSync(dir)) return;

  let removed = 0;
  const walk = (currentPath) => {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        // Remove test/docs directories
        if (['test', 'tests', '__tests__', 'docs', 'example', 'examples', '.github'].includes(entry.name)) {
          fs.rmSync(fullPath, { recursive: true, force: true });
          removed++;
          continue;
        }
        walk(fullPath);
      } else if (entry.isFile()) {
        // Remove markdown files (except LICENSE)
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext) && !entry.name.toLowerCase().includes('license')) {
          fs.unlinkSync(fullPath);
          removed++;
        }
      }
    }
  };

  walk(dir);
  if (removed > 0) {
    console.log(`[afterPack] Removed ${removed} unnecessary files/directories`);
  }
}
