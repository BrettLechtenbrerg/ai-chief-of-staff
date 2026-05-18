#!/usr/bin/env node
/**
 * Pre-test check for native modules.
 *
 * Mirror of scripts/check-native.cjs (which targets Electron's Node ABI for
 * `npm run dev` / packaged builds). This one targets the SYSTEM Node ABI that
 * vitest runs on. Without it, every test importing better-sqlite3 fails with
 * `NODE_MODULE_VERSION` or `slice is not valid mach-o file` because the binary
 * on disk was built for Electron's bundled Node.
 *
 * The two checks are complementary:
 *   - `pretest`     -> this script  -> rebuilds for system Node if needed
 *   - `preelectron` -> check-native -> rebuilds for Electron if needed
 *
 * So `npm test` and `npm run dev` auto-heal each other's binary, and the
 * developer never has to think about ABI.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const testScript = path.join(__dirname, '_test-sqlite-node.cjs');

try {
  fs.writeFileSync(
    testScript,
    `
    try {
      // Loading the JS shim is lazy — the .node binding only opens when we
      // actually instantiate a Database. We need to force the dlopen so the
      // ABI mismatch surfaces here instead of inside vitest.
      const Database = require('better-sqlite3');
      const db = new Database(':memory:');
      db.close();
      process.exit(0);
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
  `,
  );

  // Run it with SYSTEM node (the same binary vitest will use).
  execSync(`node ${testScript}`, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10000,
  });

  console.log('[check-native-for-tests] better-sqlite3 OK for system Node');
} catch (error) {
  const stderr = error.stderr || error.message || '';

  const needsRebuild =
    stderr.includes('NODE_MODULE_VERSION') ||
    stderr.includes('was compiled against') ||
    stderr.includes('not valid mach-o file') ||
    stderr.includes('invalid ELF header') ||
    stderr.includes('is not a valid Win32 application');

  if (needsRebuild) {
    console.log('[check-native-for-tests] better-sqlite3 needs rebuild for system Node...');

    try {
      execSync('npx node-gyp rebuild --release', {
        stdio: 'inherit',
        cwd: path.join(__dirname, '..', 'node_modules', 'better-sqlite3'),
      });
      console.log('[check-native-for-tests] Rebuild complete');
    } catch (rebuildError) {
      console.error('[check-native-for-tests] Rebuild failed:', rebuildError.message);
      process.exit(1);
    }
  } else {
    // Some other error — let vitest surface it with a real stack trace.
    console.log('[check-native-for-tests] Check inconclusive, continuing...');
  }
} finally {
  try {
    fs.unlinkSync(testScript);
  } catch {}
}
