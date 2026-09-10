import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';

const settings = new Map<string, string>();
vi.mock('../../src/settings', () => ({
  SettingsManager: { get: (key: string) => settings.get(key) ?? '' },
}));

import {
  claudeCodeEnv,
  explainClaudeCodeError,
  getClaudeCodeStatus,
  isClaudeCodeRoute,
  resolveClaudeCodeExecutable,
} from '../../src/agent/claude-code-route';

let dir: string;
beforeEach(() => {
  settings.clear();
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'acos-claude-code-')));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('isClaudeCodeRoute', () => {
  it('is on only when chosen and no API key overrides it', () => {
    expect(isClaudeCodeRoute()).toBe(false);
    settings.set('auth.method', 'claude-code');
    expect(isClaudeCodeRoute()).toBe(true);
    settings.set('anthropic.apiKey', 'sk-ant-x');
    expect(isClaudeCodeRoute()).toBe(false);
  });
});

describe('claudeCodeEnv', () => {
  it('strips every Anthropic credential and identifies the app', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-secret';
    process.env.ANTHROPIC_AUTH_TOKEN = 'tok';
    process.env.CLAUDE_CODE_USE_BEDROCK = '1';
    process.env.ACOS_TEST_APP_SECRET = 'private';
    const env = claudeCodeEnv();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
    delete process.env.ACOS_TEST_APP_SECRET;
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
    expect(env.ACOS_TEST_APP_SECRET).toBeUndefined();
    expect(Object.values(env).every((value) => typeof value === 'string')).toBe(true);
    expect(env.CLAUDE_AGENT_SDK_CLIENT_APP).toBe('ai-chief-of-staff');
    expect(env.HOME).toBe(process.env.HOME);
    // Claude Code needs USER to locate its Keychain entry; the app may lack it when Finder-launched.
    expect(env.USER).toBe(userInfo().username);
  });
});

describe('resolveClaudeCodeExecutable', () => {
  it('prefers the configured path and ignores non-executables', () => {
    const missing = join(dir, 'nope');
    settings.set('claudeCode.executable', missing);
    expect(resolveClaudeCodeExecutable()).toBeNull();
    const bin = join(dir, 'claude');
    writeFileSync(bin, '#!/bin/sh\necho 2.0.0\n');
    chmodSync(bin, 0o755);
    settings.set('claudeCode.executable', bin);
    expect(resolveClaudeCodeExecutable()).toBe(bin);
  });
});

describe('getClaudeCodeStatus', () => {
  it('reports version and sign-in from the binary without calling a model', async () => {
    const bin = join(dir, 'claude');
    writeFileSync(
      bin,
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "2.1.0 (Claude Code)"; exit 0; fi\n' +
        'if [ "$1" = "auth" ]; then echo \'{"loggedIn":false}\'; exit 0; fi\nexit 1\n'
    );
    chmodSync(bin, 0o755);
    settings.set('claudeCode.executable', bin);
    await expect(getClaudeCodeStatus()).resolves.toEqual({
      executable: bin,
      version: '2.1.0 (Claude Code)',
      loggedIn: false,
      problem: 'Claude Code is not signed in. Run `claude login` in Terminal.',
    });
  });

  it('explains a missing install', async () => {
    settings.set('claudeCode.executable', join(dir, 'absent'));
    await expect(getClaudeCodeStatus()).resolves.toMatchObject({ executable: null, loggedIn: false, problem: /not installed/ });
  });
});

describe('explainClaudeCodeError', () => {
  it('maps auth and launch failures to owner actions and leaves others alone', () => {
    expect(explainClaudeCodeError('Failed to authenticate: OAuth session expired')).toMatch(/claude login/);
    expect(explainClaudeCodeError('spawn ENOENT')).toMatch(/Settings/);
    expect(explainClaudeCodeError('rate limited')).toBe('rate limited');
  });
});
