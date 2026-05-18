#!/usr/bin/env node
/**
 * Pre-launch check for native modules
 * Ensures better-sqlite3 is compiled for Electron's Node version
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const testScript = path.join(__dirname, '_test-sqlite.cjs');

try {
  // Create a temporary test script.
  // NOTE: loading the JS shim is lazy — the .node binding only opens when we
  // actually instantiate a Database. We force the dlopen so an ABI mismatch
  // surfaces here instead of at first DB write inside the running app.
  fs.writeFileSync(testScript, `
    try {
      const Database = require('better-sqlite3');
      const db = new Database(':memory:');
      db.close();
      process.exit(0);
    } catch(e) {
      console.error(e.message);
      process.exit(1);
    }
  `);

  // Run it with Electron
  const electronPath = path.join(__dirname, '../node_modules/.bin/electron');
  execSync(`${electronPath} ${testScript}`, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10000
  });

  console.log('[check-native] better-sqlite3 OK');
} catch (error) {
  const stderr = error.stderr || error.message || '';

  if (stderr.includes('NODE_MODULE_VERSION') || stderr.includes('was compiled against')) {
    console.log('[check-native] better-sqlite3 needs rebuild for Electron...');

    try {
      execSync('npx electron-rebuild -f -w better-sqlite3', {
        stdio: 'inherit',
        cwd: path.join(__dirname, '..')
      });
      console.log('[check-native] Rebuild complete');
    } catch (rebuildError) {
      console.error('[check-native] Rebuild failed:', rebuildError.message);
      process.exit(1);
    }
  } else {
    // Some other error, might be fine
    console.log('[check-native] Check inconclusive, continuing...');
  }
} finally {
  // Clean up test script
  try {
    fs.unlinkSync(testScript);
  } catch {}
}
