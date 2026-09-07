import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

const roots: string[] = [];
const id = 'synthetic.apps.googleusercontent.com';
const credential = 'GOCSPX-synthetic-only-X9Q2';
function run(clientId: string, secretValue: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acos-build-credentials-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.mkdirSync(path.join(root, 'dist/auth'), { recursive: true });
  fs.copyFileSync(path.resolve('scripts/inject-google-credentials.cjs'), path.join(root, 'scripts/inject-google-credentials.cjs'));
  const target = path.join(root, 'dist/auth/google-credentials.js');
  const original = "globalThis.fixture = {id:'PLACEHOLDER_CLIENT_ID', credential:'PLACEHOLDER_CLIENT_SECRET'};";
  fs.writeFileSync(target, original);
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/inject-google-credentials.cjs')], {
    cwd: root, encoding: 'utf8', timeout: 5000,
    env: { HOME: root, BUILD_KIND: 'release', ACOS_GOOGLE_CLIENT_ID: clientId, ACOS_GOOGLE_CLIENT_SECRET: secretValue },
  });
  return { ...result, compiled: fs.readFileSync(target, 'utf8'), original };
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
describe('build-time OAuth credential handling (synthetic only)', () => {
  it('injects values without printing credentials or fragments', () => {
    const result = run(id, credential);
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).not.toContain(id);
    expect(result.stdout + result.stderr).not.toContain(credential.slice(0, 8));
    expect(result.stdout + result.stderr).not.toContain(credential.slice(-4));
    const context = { fixture: {} };
    vm.runInNewContext(result.compiled, context);
    expect(context.fixture).toEqual({ id, credential });
  });
  it('keeps quotes, backslashes and newlines as literal data', () => {
    const value = "GOCSPX-synthetic's\\note\n";
    const result = run(id, value);
    expect(result.status).toBe(0);
    const context = { fixture: {} };
    vm.runInNewContext(result.compiled, context);
    expect(context.fixture).toEqual({ id, credential: value });
  });
  it('does not echo an invalid identifier and leaves output unchanged', () => {
    const invalid = 'synthetic-invalid-private-value';
    const result = run(invalid, credential);
    expect(result.status).toBe(3);
    expect(result.stdout + result.stderr).not.toContain(invalid);
    expect(result.compiled).toBe(result.original);
  });
  it('continues refusing missing release credentials without altering output', () => {
    const result = run('', '');
    expect(result.status).toBe(2);
    expect(result.compiled).toBe(result.original);
  });
});
