const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Verify if a DMG file is valid by attempting to attach it (macOS only)
 */
function isDmgValid(dmgPath) {
  try {
    execSync(`hdiutil verify "${dmgPath}"`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the architecture from a DMG filename
 */
function getArchFromFilename(filename) {
  if (filename.includes('arm64')) return 'arm64';
  if (filename.includes('x64')) return 'x64';
  if (!filename.includes('arm64')) return 'x64';
  return null;
}

/**
 * electron-builder afterAllArtifactBuild hook
 * Validates and rebuilds corrupted DMG files (macOS only)
 * On Windows, this is a no-op pass-through
 */
exports.default = async function(context) {
  const { outDir, artifactPaths } = context;

  // DMG validation is macOS-only — skip entirely on other platforms
  if (process.platform !== 'darwin') {
    console.log('[afterAllArtifactBuild] Non-macOS build, skipping DMG validation');
    return artifactPaths;
  }

  const { createDmg } = require('./createDmg.cjs');

  for (const artifactPath of artifactPaths) {
    if (!artifactPath.endsWith('.dmg')) {
      continue;
    }

    const filename = path.basename(artifactPath);
    console.log(`[afterAllArtifactBuild] Checking DMG: ${filename}`);

    const isValid = isDmgValid(artifactPath);
    const stats = fs.statSync(artifactPath);
    const sizeMB = stats.size / (1024 * 1024);

    if (isValid) {
      console.log(`[afterAllArtifactBuild] DMG valid: ${filename} (${sizeMB.toFixed(2)}MB)`);
      continue;
    }

    console.log(`[afterAllArtifactBuild] DMG corrupted: ${filename} - rebuilding...`);

    const arch = getArchFromFilename(filename);
    if (!arch) {
      console.error(`[afterAllArtifactBuild] Could not determine architecture for: ${filename}`);
      continue;
    }

    const possibleAppDirs = [
      path.join(outDir, `mac-${arch}`),
      path.join(outDir, arch === 'x64' ? 'mac' : `mac-${arch}`),
    ];

    let appPath = null;
    for (const appDir of possibleAppDirs) {
      const candidatePath = path.join(appDir, 'AI Chief of Staff.app');
      if (fs.existsSync(candidatePath)) {
        appPath = candidatePath;
        break;
      }
    }

    if (!appPath) {
      console.error(`[afterAllArtifactBuild] App not found for ${arch} in:`, possibleAppDirs);
      continue;
    }

    console.log(`[afterAllArtifactBuild] Using app: ${appPath}`);

    const backgroundPath = path.join(__dirname, 'background.png');
    const hasBackground = fs.existsSync(backgroundPath);

    try {
      createDmg(appPath, artifactPath, {
        volumeName: 'AI Chief of Staff',
        background: hasBackground ? backgroundPath : null,
        iconSize: 80,
        windowWidth: 540,
        windowHeight: 380,
        appX: 130,
        appY: 190,
        applicationsX: 410,
        applicationsY: 190,
      });

      const newStats = fs.statSync(artifactPath);
      const newSizeMB = newStats.size / (1024 * 1024);

      if (isDmgValid(artifactPath)) {
        console.log(`[afterAllArtifactBuild] Rebuilt DMG valid: ${filename} (${newSizeMB.toFixed(2)}MB)`);
      } else {
        console.error(`[afterAllArtifactBuild] Rebuilt DMG still invalid: ${filename}`);
      }
    } catch (error) {
      console.error(`[afterAllArtifactBuild] Failed to rebuild DMG:`, error.message);
    }
  }

  // Notarize + staple each DMG when a real Developer ID signing identity is
  // configured. electron-builder notarizes the inner .app inside the .zip
  // but doesn't notarize the outer .dmg wrappers — if we don't do this here,
  // Gatekeeper still works (the inner .app is notarized) but clients need
  // internet on first install for online verification. Stapled DMGs work
  // entirely offline.
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const configuredIdentity = pkg && pkg.build && pkg.build.mac && pkg.build.mac.identity;
  const realIdentityConfigured = (typeof configuredIdentity === 'string' && configuredIdentity.length > 0) || !!process.env.CSC_NAME || !!process.env.CSC_LINK;
  const keychainProfile = process.env.APPLE_KEYCHAIN_PROFILE || 'AC_PASSWORD';

  let stapledAtLeastOneDmg = false;
  if (realIdentityConfigured) {
    for (const artifactPath of artifactPaths) {
      if (!artifactPath.endsWith('.dmg')) continue;
      const filename = path.basename(artifactPath);

      // Skip if already stapled (idempotent re-runs)
      try {
        execSync(`xcrun stapler validate "${artifactPath}"`, { stdio: 'pipe' });
        console.log(`[afterAllArtifactBuild] DMG already stapled: ${filename}`);
        continue;
      } catch {
        // not stapled yet, proceed
      }

      console.log(`[afterAllArtifactBuild] Notarizing DMG: ${filename} (this takes 2–10 min at Apple)...`);
      try {
        execSync(
          `xcrun notarytool submit "${artifactPath}" --keychain-profile "${keychainProfile}" --wait`,
          { stdio: 'inherit' }
        );
        console.log(`[afterAllArtifactBuild] Stapling DMG: ${filename}`);
        execSync(`xcrun stapler staple "${artifactPath}"`, { stdio: 'inherit' });
        execSync(`xcrun stapler validate "${artifactPath}"`, { stdio: 'inherit' });
        console.log(`[afterAllArtifactBuild] DMG notarized + stapled: ${filename}`);
        stapledAtLeastOneDmg = true;
      } catch (error) {
        console.error(`[afterAllArtifactBuild] DMG notarize/staple failed for ${filename}:`, error.message);
        // Don't throw — the inner .app is still notarized, so Gatekeeper
        // online verification still works. Only offline first-launch is
        // affected, and we want the build artifacts to remain available.
      }
    }
  }

  // Stapling adds bytes to the DMG — electron-builder wrote latest-mac.yml
  // BEFORE we stapled, so its DMG entries now have stale size + sha512.
  // Auto-updater would reject the file on integrity check. Parse the YAML,
  // recompute each stapled DMG's size + sha512, and re-serialize.
  //
  // History: this used to be a regex-replace. It hand-patched the `files:`
  // array entries fine, but missed the top-level `path:` + `sha512:` block
  // that electron-builder also emits for the "primary" download — so updates
  // shipped through three releases with a stale primary sha512 that we
  // patched by hand each time. The YAML parser fixes both at once and is
  // robust against any future filename character (parens, brackets, etc).
  if (stapledAtLeastOneDmg && process.platform === 'darwin') {
    const yamlPath = path.join(outDir, 'latest-mac.yml');
    if (fs.existsSync(yamlPath)) {
      console.log('[afterAllArtifactBuild] Patching latest-mac.yml DMG entries with stapled size + sha512...');
      const crypto = require('crypto');
      const yaml = require('js-yaml');
      const doc = yaml.load(fs.readFileSync(yamlPath, 'utf8'));

      // Build a lookup: filename -> { size, sha512 } for every stapled DMG.
      const updates = new Map();
      for (const artifactPath of artifactPaths) {
        if (!artifactPath.endsWith('.dmg')) continue;
        const filename = path.basename(artifactPath);
        const buf = fs.readFileSync(artifactPath);
        updates.set(filename, {
          size: buf.length,
          sha512: crypto.createHash('sha512').update(buf).digest('base64'),
        });
      }

      const patched = new Set();

      // Patch entries in the `files:` array.
      if (Array.isArray(doc.files)) {
        for (const entry of doc.files) {
          const update = entry && entry.url && updates.get(entry.url);
          if (update) {
            entry.sha512 = update.sha512;
            entry.size = update.size;
            patched.add(entry.url);
          }
        }
      }

      // Patch the top-level `path:` + `sha512:` block (the "primary" download).
      // electron-builder doesn't emit a top-level `size:` for this block, so we
      // only update `sha512` here — the size lives in the matching `files:` entry.
      if (doc.path && updates.has(doc.path)) {
        doc.sha512 = updates.get(doc.path).sha512;
        patched.add('(top-level path: ' + doc.path + ')');
      }

      fs.writeFileSync(
        yamlPath,
        yaml.dump(doc, { lineWidth: -1, noRefs: true, quotingType: "'" }),
      );

      for (const filename of updates.keys()) {
        if (patched.has(filename)) {
          console.log(`[afterAllArtifactBuild]   patched ${filename}`);
        } else {
          console.warn(`[afterAllArtifactBuild]   could not find ${filename} entry in latest-mac.yml`);
        }
      }
    }
  }

  return artifactPaths;
};
