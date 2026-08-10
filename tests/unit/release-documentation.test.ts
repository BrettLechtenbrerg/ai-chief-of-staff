import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (name: string) => fs.readFileSync(path.join(root, name), 'utf8');

describe('beta.23 release documentation', () => {
  it('states the exact current Windows fallback asset and digest', () => {
    const digest = '7464181a0dbb60bdce8aa3b9948ba164898b326aff84703c94468cf919c46d6e';
    for (const document of [read('README.md'), read('RECOVERY.md'), read('docs/WINDOWS-TESTER-RESCUE.md')]) {
      expect(document).toContain('beta.20 x64');
      expect(document).toContain(digest);
    }
  });

  it('documents the explicit voice privacy and fallback architecture', () => {
    const voice = read('docs/VOICE.md');
    expect(voice).toContain('gpt-realtime-2.1');
    expect(voice).toContain('normal ACOS');
    expect(voice).toContain('never always-on');
    expect(voice).toContain('model tool arguments cannot authorize approval');
  });

  it('documents AEO paid-request and encrypted-credential behavior', () => {
    const aeo = read('docs/AEO-VISIBILITY.md');
    expect(aeo).toContain('up to 75 requests');
    expect(aeo).toContain('safeStorage');
    expect(aeo).toContain('fail closed');
    expect(aeo).toContain('30 seconds');
  });

  it('records release blockers instead of claiming beta.23 is public', () => {
    const recovery = read('RECOVERY.md');
    expect(recovery).toContain('Public release remains beta.22');
    expect(recovery).toContain('CERTIFICATE_P12');
    expect(recovery).toContain('WIN_CSC_LINK');
    expect(recovery).toContain('Do not tag or publish');
  });
});
