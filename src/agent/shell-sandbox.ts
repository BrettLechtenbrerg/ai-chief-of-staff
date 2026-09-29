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
import { execFileSync } from 'child_process';
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
  /**
   * Only for an owner-approved command made solely of git/gh steps (see
   * isGitHubCredentialCommand): lets git/gh read their own login (gh config and
   * the login keychain) so push and PR creation work. Never set otherwise.
   */
  allowGitCredentials?: boolean;
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
    // Git identity and aliases (name, email, credential-helper name; no secrets),
    // read-only, so git works with HOME set to the real home folder.
    `(allow file-read* (literal ${sbplString(path.join(home, '.gitconfig'))}) (subpath ${sbplString(path.join(home, '.config', 'git'))}))`,
  ];
  if (options.allowNetwork && options.allowGitCredentials) {
    lines.push(
      `(allow file-read* (subpath ${sbplString(path.join(home, '.config', 'gh'))}) (subpath ${sbplString(path.join(library, 'Keychains'))}))`
    );
  }
  if (!options.allowNetwork) {
    lines.push(
      '(deny network-outbound)',
      '(allow network-outbound (remote ip "localhost:*"))',
      `(deny process-exec ${HANDOFF_EXECUTABLES.map((file) => `(literal ${sbplString(file)})`).join(' ')})`
    );
  }
  return lines.join('\n');
}

/**
 * True when every step of a command is `cd`, `gh`, or a git network step
 * (push/fetch/ls-remote), with no pipes, substitutions or redirections that
 * could hand the credentials to another program. Only such commands may use
 * the owner's GitHub login. `git add`/`commit` run first as a normal offline
 * command: they read repo settings (filters) that could run other programs.
 */
export function isGitHubCredentialCommand(command: string): boolean {
  // Substitution runs code even inside double quotes: reject it anywhere.
  if (typeof command !== 'string' || /[`]|\$\(/.test(command)) return false;
  // Quoted text (commit messages, PR bodies) is data, not shell syntax.
  const bare = command
    .replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, 'Q')
    .replace(/\s2>&1(?=\s|$)/g, ' ')
    .replace(/&&/g, ';');
  if (/['"|<>&\n]/.test(bare)) return false;
  // Ways to make git/gh run another program: -c/--config-env overrides,
  // aliases, gh extensions.
  if (/(?:^|\s)(?:-c|--config-env\b)|\balias\b|\bextensions?\b/.test(bare)) return false;
  const steps = bare.split(';').map((step) => step.trim());
  return (
    steps.some((step) => /^(?:git|gh)\s/.test(step)) &&
    steps.every((step) => /^(?:cd\s+\S|git\s+(?:push|fetch|ls-remote)(?:\s|$)|gh\s)/.test(step))
  );
}

let trustedHelpers: Array<[string, string]> | undefined;

/**
 * The owner's own credential helpers, from the user/system git config only.
 * The agent's shell can edit a repo's .git/config, so a repo-level helper is
 * never trusted with the login.
 */
function trustedCredentialHelpers(): Array<[string, string]> {
  if (trustedHelpers) return trustedHelpers;
  try {
    const listing = execFileSync('/usr/bin/git', ['config', '--list', '--show-scope', '-z'], {
      cwd: '/',
      env: { PATH: '/usr/bin:/bin', HOME: os.homedir() },
      encoding: 'utf8',
      timeout: 5_000,
    });
    trustedHelpers = listing
      .split('\0')
      .filter(Boolean)
      .flatMap((entry, index, all) => (index % 2 === 0 ? [[entry, all[index + 1] ?? '']] : []))
      .filter(([scope]) => scope !== 'local' && scope !== 'worktree' && scope !== 'command')
      .map(([, keyValue]) => {
        const split = keyValue.indexOf('\n');
        return split < 0 ? [keyValue, ''] : [keyValue.slice(0, split), keyValue.slice(split + 1)];
      })
      .filter((pair): pair is [string, string] => /^credential\.(?:.+\.)?helper$/i.test(pair[0]));
  } catch {
    trustedHelpers = [];
  }
  return trustedHelpers;
}

/**
 * Git settings for a command that can reach the login. Command-scope settings
 * are read last, so they override anything planted in the repo: no hooks, no
 * fsmonitor, https only, and the helper list reset to the owner's own.
 */
function gitCredentialOverrides(): Record<string, string> {
  const settings: Array<[string, string]> = [
    ['core.hooksPath', '/dev/null'],
    ['core.fsmonitor', 'false'],
    ['core.sshCommand', 'false'],
    ['core.askPass', ''],
    ['protocol.allow', 'never'],
    ['protocol.https.allow', 'always'],
    ['credential.helper', ''],
    ...trustedCredentialHelpers(),
  ];
  const env: Record<string, string> = { GIT_CONFIG_COUNT: String(settings.length) };
  settings.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = value;
  });
  return env;
}

// Runs before every git/gh step that can reach the login. Repo settings can
// point git at a proxy, turn off TLS checks or add URL-specific helpers that the
// overrides above cannot cover, and the agent's shell can edit them, so any
// repo-level key outside this plain list refuses the step.
const REPO_CONFIG_GUARD = `__acos_repo_ok() {
  local scope kv key
  while IFS= read -r -d '' scope && IFS= read -r -d '' kv; do
    case "$scope" in local|worktree) ;; *) continue ;; esac
    key="\${kv%%$'\\n'*}"
    case "$key" in
      core.repositoryformatversion|core.filemode|core.bare|core.logallrefupdates|core.ignorecase|core.precomposeunicode|core.symlinks) ;;
      remote.*.url|remote.*.fetch|remote.*.pushurl|branch.*.remote|branch.*.merge|branch.*.pushremote) ;;
      user.name|user.email|credential.username|init.defaultbranch|pull.rebase|push.autosetupremote|lfs.repositoryformatversion) ;;
      *) echo "Blocked: this repo's .git/config sets '$key', which is not allowed while the GitHub login is in use." >&2; return 1 ;;
    esac
  done < <(command git config --list --show-scope -z 2>/dev/null)
}
git() { __acos_repo_ok && command git "$@"; }
gh() { __acos_repo_ok && command gh "$@"; }`;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Rewrite a shell command so it runs inside the sandbox with a clean
 * environment. The result is itself a bash command string, so it works for
 * `bash -c`, exec() and background process managers alike.
 */
export function sandboxShellCommand(command: string, options: ShellSandboxOptions): string {
  // With the GitHub login in reach, settings planted in the repo cannot run
  // anything or pick the credential helper (see gitCredentialOverrides).
  const gitOverrides = options.allowNetwork && options.allowGitCredentials ? gitCredentialOverrides() : {};
  const assignments = Object.entries({ ...options.env, ...gitOverrides, TERM: 'dumb' }).map(
    ([key, value]) => `${key}=${shellQuote(value)}`
  );
  return [
    'exec /usr/bin/env -i',
    ...assignments,
    SANDBOX_EXEC,
    '-p',
    shellQuote(buildShellSandboxProfile(options)),
    '/bin/bash -c',
    shellQuote(options.allowNetwork && options.allowGitCredentials ? `${REPO_CONFIG_GUARD}\n${command}` : command),
  ].join(' ');
}
