'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const vendorDirectory = path.join(root, 'vendor', 'flo-mcp-servers');
const npmCli = process.env.npm_execpath;
if (!npmCli || !fs.existsSync(npmCli)) {
  throw new Error('npm_execpath is unavailable; cannot install locked vendor dependencies.');
}
const result = spawnSync(
  process.execPath,
  [npmCli, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
  { cwd: vendorDirectory, stdio: 'inherit' }
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);

const oauthPath = path.join(
  vendorDirectory,
  'node_modules',
  '@flo',
  'shared',
  'dist',
  'oauth.js'
);
const oauthSource = fs.readFileSync(oauthPath, 'utf8');
if (!oauthSource.includes('ACOS vendor patch') || !oauthSource.includes('FLO_TOKEN_PATH')) {
  throw new Error('Reproducible Flo shared OAuth patch is missing after vendor install.');
}
console.log('[install-vendor-deps] Locked Flo MCP runtime dependencies installed and verified.');
