/**
 * Claude Code route — Claude via the owner's Max subscription.
 *
 * The app never touches Anthropic credentials on this route. It drives the
 * unmodified Claude Code binary the owner installed and signed in to
 * (`claude login`), the same way the Agent SDK does. Personal builds only:
 * public builds must bring their own API key.
 *
 * This module is dependency-free so settings/IPC code can import it without
 * loading the Agent SDK.
 */

import { execFile } from 'node:child_process';
import { accessSync, constants, realpathSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { delimiter, join } from 'node:path';
import { SettingsManager } from '../settings';

export const CLAUDE_CODE_AUTH_METHOD = 'claude-code';

/** Runs when the owner chose Claude Code and no API key overrides it. */
export function isClaudeCodeRoute(): boolean {
  return (
    !SettingsManager.get('anthropic.apiKey') &&
    SettingsManager.get('auth.method') === CLAUDE_CODE_AUTH_METHOD
  );
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Locate the installed Claude Code binary. An explicit setting wins; otherwise
 * the usual install locations, then PATH. Packaged apps launched from Finder
 * get a bare PATH, so the fixed locations come first.
 */
export function resolveClaudeCodeExecutable(): string | null {
  const configured = SettingsManager.get('claudeCode.executable').trim();
  const home = homedir();
  const candidates = configured
    ? [configured]
    : [
        join(home, '.local', 'bin', 'claude'),
        join(home, '.npm-global', 'bin', 'claude'),
        '/opt/homebrew/bin/claude',
        '/usr/local/bin/claude',
        ...(process.env.PATH ?? '').split(delimiter).filter(Boolean).map((dir) => join(dir, 'claude')),
      ];
  for (const candidate of candidates) {
    if (!isExecutable(candidate)) continue;
    try {
      return realpathSync(candidate);
    } catch {
      return candidate;
    }
  }
  return null;
}

export interface ClaudeCodeStatus {
  executable: string | null;
  version: string | null;
  loggedIn: boolean;
  /** Human-readable reason when the route cannot be used. */
  problem: string | null;
}

function run(executable: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      { timeout: timeoutMs, env: claudeCodeEnv(), maxBuffer: 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(String(stdout)))
    );
  });
}

/**
 * Process environment for Claude Code. Allowlist only: it needs HOME and USER
 * to find the owner's Keychain sign-in (USER comes from the OS, since a
 * Finder-launched app may not have it) plus the basics to run; none of the
 * app's own environment (and never an Anthropic key, which would override the
 * subscription) is passed through.
 */
export function claudeCodeEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    HOME: homedir(),
    USER: userInfo().username,
    LOGNAME: userInfo().username,
    PATH: ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(delimiter),
    TMPDIR: tmpdir(),
    LANG: process.env.LANG || 'en_US.UTF-8',
    SHELL: process.env.SHELL || '/bin/zsh',
    TERM: 'dumb',
    NO_COLOR: '1',
    CLAUDE_AGENT_SDK_CLIENT_APP: 'ai-chief-of-staff',
  };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  return env;
}

/** Check binary presence, version and sign-in state (read-only, no model call). */
export async function getClaudeCodeStatus(): Promise<ClaudeCodeStatus> {
  const executable = resolveClaudeCodeExecutable();
  if (!executable) {
    return {
      executable: null,
      version: null,
      loggedIn: false,
      problem: 'Claude Code is not installed. Install it, then run `claude login` in Terminal.',
    };
  }
  let version: string | null;
  try {
    version = (await run(executable, ['--version'], 10_000)).trim() || null;
  } catch (error) {
    return {
      executable,
      version: null,
      loggedIn: false,
      problem: `Claude Code failed to start: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  try {
    const parsed: unknown = JSON.parse(await run(executable, ['auth', 'status'], 10_000));
    const loggedIn =
      typeof parsed === 'object' && parsed !== null && (parsed as { loggedIn?: unknown }).loggedIn === true;
    return {
      executable,
      version,
      loggedIn,
      problem: loggedIn ? null : 'Claude Code is not signed in. Run `claude login` in Terminal.',
    };
  } catch {
    return { executable, version, loggedIn: false, problem: 'Could not read Claude Code sign-in state.' };
  }
}

/** Turn a Claude Code failure into the one action the owner can take. */
export function explainClaudeCodeError(message: string): string {
  if (/authenticat|oauth|not logged in|\/login|expired/i.test(message)) {
    return 'Claude Code sign-in has expired. Run `claude login` in Terminal, then try again.';
  }
  if (/not found|ENOENT|failed to launch|failed to spawn/i.test(message)) {
    return 'Claude Code binary is missing or could not start. Check Settings › LLM › Claude Code.';
  }
  return message;
}
