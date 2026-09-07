import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { verifyPersonalPayload } = require('../../scripts/verify-personal-payload.cjs');
const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acos-payload-'));
  roots.push(root);
  const app = path.join(root, 'Contents/Resources/app');
  for (const relative of ['dist/main/update-policy.js','dist/main/updater.js','dist/finance/worker.js','src/finance/migrations/001-initial.sql']) {
    const file = path.join(app, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '');
  }
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'ai-chief-of-staff', acosUpdatePolicy: 'personal-local-v1' }));
  return { root, app };
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
describe('personal payload before Apple submission', () => {
  it('accepts runtime/migrations and contained relative symlinks', () => {
    const { root, app } = fixture();
    fs.symlinkSync('dist/main/updater.js', path.join(app, 'updater-link.js'));
    expect(verifyPersonalPayload(root).files).toBe(5);
  });
  it.each(['finance.db','memory.sqlite-wal','.env.production','session.jsonl','debug.log','.gg'])('blocks disallowed data/cache entry %s', name => {
    const { root, app } = fixture(); fs.writeFileSync(path.join(app, name), 'synthetic-only');
    expect(() => verifyPersonalPayload(root)).toThrow('disallowed');
  });
  it('rejects a link outside the bundle without reading its target contents', () => {
    const { root, app } = fixture(); fs.symlinkSync(os.tmpdir(), path.join(app, 'outside'));
    expect(() => verifyPersonalPayload(root)).toThrow('escapes');
  });
  it('refuses a missing personal updater marker', () => {
    const { root, app } = fixture(); fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'ai-chief-of-staff' }));
    expect(() => verifyPersonalPayload(root)).toThrow('guard missing');
  });
  it('requires the installed finance worker and migration', () => {
    const { root, app } = fixture(); fs.unlinkSync(path.join(app, 'dist/finance/worker.js'));
    expect(() => verifyPersonalPayload(root)).toThrow();
  });
  it('keeps the payload inspection between native verification and signing', () => {
    const source = fs.readFileSync(path.resolve('build/afterPack.cjs'), 'utf8');
    expect(source.indexOf('verifyPersonalPayload')).toBeGreaterThan(source.indexOf('verify-native-modules.cjs'));
    expect(source.indexOf('verifyPersonalPayload')).toBeLessThan(source.indexOf('realIdentityConfigured'));
    expect(source).toContain('verifyPersonalPayload(path.dirname(path.dirname(resourcesPath)))');
  });
});
