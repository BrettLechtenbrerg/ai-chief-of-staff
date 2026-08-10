import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`, 'utf8')),
    decryptString: vi.fn((value: Buffer) => value.toString('utf8').replace(/^encrypted:/, '')),
  },
}));

import { SettingsManager } from '../../src/settings/index.js';

let temporaryHome: string;
let previousHome: string | undefined;

beforeEach(() => {
  previousHome = process.env.HOME;
  temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), 'acos-settings-secret-'));
  process.env.HOME = temporaryHome;
});

afterEach(() => {
  SettingsManager.close();
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  fs.rmSync(temporaryHome, { recursive: true, force: true });
});

function initializeSettings(): string {
  const databasePath = path.join(temporaryHome, 'settings.db');
  SettingsManager.initialize(databasePath);
  return databasePath;
}

describe('settings secret boundary', () => {
  it('stores secrets encrypted and returns only boolean presence to renderers', () => {
    const databasePath = initializeSettings();
    const secret = 'sk-test-value-that-must-never-return';

    SettingsManager.setSecret('openai.apiKey', secret);

    expect(SettingsManager.getAllSafe()).not.toHaveProperty('openai.apiKey');
    expect(SettingsManager.getSecretPresence()['openai.apiKey']).toBe(true);

    const database = new Database(databasePath, { readonly: true });
    const row = database
      .prepare('SELECT value, encrypted FROM settings WHERE key = ?')
      .get('openai.apiKey') as { value: string; encrypted: number };
    database.close();
    expect(row.encrypted).toBe(1);
    expect(row.value).not.toContain(secret);

    SettingsManager.deleteSecret('openai.apiKey');
    expect(SettingsManager.getSecretPresence()['openai.apiKey']).toBe(false);
  });

  it('rejects unknown, public, empty, and oversized secret writes', () => {
    initializeSettings();

    expect(() => SettingsManager.setSecret('profile.name', 'private')).toThrow(/approved secret/i);
    expect(() => SettingsManager.setSecret('unknown.apiKey', 'private')).toThrow(
      /approved secret/i
    );
    expect(() => SettingsManager.setSecret('openai.apiKey', '')).toThrow(/deleteSecret/i);
    expect(() => SettingsManager.setSecret('openai.apiKey', 'x'.repeat(16 * 1024 + 1))).toThrow(
      /16 KiB/i
    );
  });

  it('imports app-data AEO credentials into encrypted settings and removes plaintext', () => {
    const legacyPath = path.join(temporaryHome, 'aeo-credentials.json');
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({
        openai: 'legacy-openai',
        perplexity: 'legacy-perplexity',
        anthropic: 'legacy-anthropic',
      })
    );

    initializeSettings();

    expect(fs.existsSync(legacyPath)).toBe(false);
    expect(SettingsManager.get('openai.apiKey')).toBe('legacy-openai');
    expect(SettingsManager.get('perplexity.apiKey')).toBe('legacy-perplexity');
    expect(SettingsManager.get('anthropic.apiKey')).toBe('legacy-anthropic');
    expect(SettingsManager.getAllSafe()).not.toHaveProperty('perplexity.apiKey');
  });

  it('keeps renderer source on presence/write/delete operations only', () => {
    const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
    const ipcSource = fs.readFileSync(
      path.join(projectRoot, 'src/main/ipc/settings-ipc.ts'),
      'utf8'
    );
    const preloadSource = fs.readFileSync(path.join(projectRoot, 'src/main/preload.ts'), 'utf8');
    const settingsUiSource = fs.readFileSync(
      path.join(projectRoot, 'ui/chat/settings-panel.js'),
      'utf8'
    );

    expect(ipcSource).not.toContain('RENDERER_ALLOWED_ENCRYPTED_KEYS');
    expect(ipcSource).toContain('SettingsManager.isSecretKey(key)');
    expect(ipcSource).toContain('definition.encrypted');
    expect(preloadSource).toContain('settings:getSecretPresence');
    expect(preloadSource).not.toContain("settings:getSecret'");
    expect(settingsUiSource).not.toMatch(/settings\.set\(['"][^'"]*(?:apiKey|Token|adminKey)/);
  });
});
