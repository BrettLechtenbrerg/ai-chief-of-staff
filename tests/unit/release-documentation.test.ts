import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (name: string) => fs.readFileSync(path.join(root, name), 'utf8');

describe('beta.23 release documentation', () => {
  it('states the exact current Windows fallback asset and digest', () => {
    const digest = '7464181a0dbb60bdce8aa3b9948ba164898b326aff84703c94468cf919c46d6e';
    for (const document of [
      read('README.md'),
      read('RECOVERY.md'),
      read('docs/WINDOWS-TESTER-RESCUE.md'),
    ]) {
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

  it('records verified beta.23 evidence and its Windows acceptance blocker', () => {
    const recovery = read('RECOVERY.md');
    expect(recovery).toContain('Public release remains beta.22');
    expect(recovery).toContain('Azure Artifact Signing');
    expect(recovery).toContain('acos-windows-release');
    expect(recovery).toContain('31490076731');
    expect(recovery).toContain('31493333399');
    expect(recovery).toContain('31497949376');
    expect(recovery).toContain('676aad7d359b47cf7afd4fb683c955f01623f67c399f96ab96be09bd04b91df1');
    expect(recovery).toContain('protected by GitHub OIDC and the `release` environment');
    expect(recovery).toContain('Beta.23 failed real Windows chat acceptance');
    expect(recovery).toContain('Settings correctly showed OpenAI OAuth as Connected');
    expect(recovery).toContain('Immutable annotated tag `v1.0.0-beta.25`');
    expect(recovery).toContain('31603383781');
    expect(recovery).toContain('000d155d0db1e4eb32fde692e8f9fa262245088b5406e989969f3b3d1e69acaa');
    expect(recovery).toContain('`v1.0.0-beta.24` was abandoned');
  });

  it('documents deferred ASAR/fuse work and immutable runtime connectors', () => {
    const audit = read('docs/SECURITY-RELEASE-AUDIT-2026-08-10.md');
    expect(audit).toContain('deferred to beta.24');
    expect(audit).toContain('dataforseo-mcp-server@2.9.11');
    expect(audit).toContain('firecrawl-mcp@3.23.8');
    expect(audit).toContain('mcp-remote@0.1.38');
  });
});
