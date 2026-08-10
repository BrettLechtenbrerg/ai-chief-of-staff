import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const rescue = fs.readFileSync(path.join(root, 'scripts/tester-rescue.ps1'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/build.yml'), 'utf8');

describe('Windows tester rescue collector', () => {
  it('collects architecture, signature, updater, native, SQLite, IPC, and log evidence', () => {
    expect(rescue).toContain('Get-CimInstance Win32_OperatingSystem');
    expect(rescue).toContain('Get-AuthenticodeSignature');
    expect(rescue).toContain('Get-PeMachine');
    expect(rescue).toContain('app-update.yml');
    expect(rescue).toContain('better-sqlite3');
    expect(rescue).toContain('SQLite load OK');
    expect(rescue).toContain('startup-health.json');
    expect(rescue).toContain('main.log');
  });

  it('redacts sensitive log values and never copies the SQLite database', () => {
    expect(rescue).toContain('<API_KEY_REDACTED>');
    expect(rescue).toContain('Bearer <REDACTED>');
    expect(rescue).toContain('<EMAIL_REDACTED>');
    expect(rescue).not.toMatch(/Copy-Item\s+\$database/i);
    expect(rescue).not.toMatch(/Compress-Archive[^\n]+ai-chief-of-staff\.db/i);
  });

  it('is executed by the native Windows CI job and published beside the installer', () => {
    expect(workflow).toContain('Verify tester rescue collector on Windows runner');
    expect(workflow).toContain('./scripts/tester-rescue.ps1');
    expect(workflow).toContain('release/tester-rescue.ps1');
  });
});
