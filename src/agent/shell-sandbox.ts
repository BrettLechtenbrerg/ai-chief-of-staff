/**
 * OS-enforced shell sandbox (macOS Seatbelt via /usr/bin/sandbox-exec).
 *
 * Every agent shell command (foreground, background and shell_command) is
 * rewritten to run inside a profile that the kernel enforces, so a
 * prompt-injected command cannot reach credentials or the network no matter how
 * it is spelled (python, node, string concatenation, etc.):
 *
 * - Hidden home entries (~/.flo, ~/.config/gh, ~/.gg, ~/.ssh, ~/.zshrc…) and
 *   ~/Library (keychains, browser profiles, other apps' tokens, LaunchAgents)
 *   are unreadable and unwritable. ~/Library/Caches, iCloud Drive and the
 *   caller's approved roots under ~/Library (the app workspace/attachments)
 *   stay usable.
 * - Without owner approval, all outbound network is denied except loopback IP,
 *   including DNS and Unix sockets (Docker/daemon side doors). Commands that
 *   leave the machine only run with network after an approval (tool-policy).
 * - Without approval, helpers that hand work to an unsandboxed process
 *   (open, osascript, launchctl, crontab, at, shortcuts, automator) are denied.
 * - The environment is rebuilt from scratch, so no inherited API keys reach
 *   the command (this also covers background processes).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

const HANDOFF_EXECUTABLES = [
  '/usr/bin/open',
  '/usr/bin/osascript',
  '/bin/launchctl',
  '/usr/bin/crontab',
  '/usr/bin/at',
  '/usr/bin/batch',
  '/usr/bin/shortcuts',
  '/usr/bin/automator',
];

export interface ShellSandboxOptions {
  cwd: string;
  /**
   * Roots the agent may use; any that live under ~/Library are re-allowed. The
   * caller must drop private locations first (a project folder set to
   * ~/Library itself would otherwise re-open it).
   */
  approvedRoots: readonly string[];
  /** Only true after the owner approved an outbound command. */
  allowNetwork: boolean;
  /** Complete environment for the command; nothing else is inherited. */
  env: Readonly<Record<string, string>>;
  home?: string;
}

export function shellSandboxAvailable(): boolean {
  return process.platform === 'darwin' && fs.existsSync(SANDBOX_EXEC);
}

/** Seatbelt string literal. Paths never legitimately contain quotes or backslashes. */
function sbplString(value: string): string {
  if (/["\\\0\n]/.test(value)) throw new Error('Unsupported character in sandbox path');
  return `"${value}"`;
}

function sbplRegexPrefix(value: string): string {
  if (/["\\\0\n]/.test(value)) throw new Error('Unsupported character in sandbox path');
  return value.replace(/[.*+?^${}()|[\]]/g, '\\$&');
}

function realpathOrSelf(candidate: string): string {
  try {
    return fs.realpathSync(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

export function buildShellSandboxProfile(options: ShellSandboxOptions): string {
  const home = realpathOrSelf(options.home ?? os.homedir());
  const library = path.join(home, 'Library');
  const libraryAllowed = [
    path.join(library, 'Caches'),
    path.join(library, 'Mobile Documents'),
    ...options.approvedRoots
      .map(realpathOrSelf)
      .filter((root) => root.startsWith(`${library}${path.sep}`)),
  ];

  const lines = [
    '(version 1)',
    '(allow default)',
    // Secrets and persistence locations.
    `(deny file-read* file-write* (regex #"^${sbplRegexPrefix(home)}/\\."))`,
    `(deny file-read* file-write* (subpath ${sbplString(library)}))`,
    ...[...new Set(libraryAllowed)].map((root) => `(allow file-read* file-write* (subpath ${sbplString(root)}))`),
    '(deny file-write* (subpath "/Applications"))',
  ];
  if (!options.allowNetwork) {
    lines.push(
      '(deny network-outbound)',
      '(allow network-outbound (remote ip "localhost:*"))',
      `(deny process-exec ${HANDOFF_EXECUTABLES.map((file) => `(literal ${sbplString(file)})`).join(' ')})`
    );
  }
  return lines.join('\n');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Rewrite a shell command so it runs inside the sandbox with a clean
 * environment. The result is itself a bash command string, so it works for
 * `bash -c`, exec() and background process managers alike.
 */
export function sandboxShellCommand(command: string, options: ShellSandboxOptions): string {
  const assignments = Object.entries({ ...options.env, TERM: 'dumb' }).map(
    ([key, value]) => `${key}=${shellQuote(value)}`
  );
  return [
    'exec /usr/bin/env -i',
    ...assignments,
    SANDBOX_EXEC,
    '-p',
    shellQuote(buildShellSandboxProfile(options)),
    '/bin/bash -c',
    shellQuote(command),
  ].join(' ');
}
