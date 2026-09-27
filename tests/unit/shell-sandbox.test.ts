import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentTool } from '@kenkaiiii/gg-agent';
import {
  buildShellSandboxProfile,
  sandboxShellCommand,
  shellSandboxAvailable,
} from '../../src/agent/shell-sandbox.js';
import { attachToolPolicy, guardToolWithApproval, type ToolExecutionContext } from '../../src/agent/tool-policy.js';
import {
  createRestrictedToolOperations,
  guardNativeToolScope,
  restrictedShellEnvironment,
} from '../../src/agent/tool-sandbox.js';
import { ApprovalManager } from '../../src/security/approval-manager.js';

describe('shell sandbox profile', () => {
  const home = '/Users/example';
  const env = { PATH: '/usr/bin:/bin', HOME: '/tmp/work' };

  it('denies network and hand-off helpers unless the command was approved for network', () => {
    const offline = buildShellSandboxProfile({ cwd: '/tmp/work', approvedRoots: [], allowNetwork: false, env, home });
    expect(offline).toContain('(deny network-outbound)');
    expect(offline).toContain('(allow network-outbound (remote ip "localhost:*"))');
    expect(offline).toContain('(literal "/usr/bin/osascript")');
    expect(offline).toContain('(literal "/bin/launchctl")');

    const online = buildShellSandboxProfile({ cwd: '/tmp/work', approvedRoots: [], allowNetwork: true, env, home });
    expect(online).not.toContain('network-outbound');
    expect(online).not.toContain('process-exec');
  });

  it('always hides credential folders and re-allows only approved roots inside ~/Library', () => {
    const workspace = `${home}/Library/Application Support/ai-chief-of-staff/workspace`;
    const profile = buildShellSandboxProfile({ cwd: workspace, approvedRoots: [workspace, `${home}/dev`], allowNetwork: true, env, home });
    expect(profile).toContain(`(deny file-read* file-write* (regex #"^/Users/example/\\."))`);
    expect(profile).toContain(`(deny file-read* file-write* (subpath "${home}/Library"))`);
    expect(profile).toContain(`(allow file-read* file-write* (subpath "${workspace}"))`);
    expect(profile).not.toContain(`(subpath "${home}/dev")`);
  });

  it('rejects paths that could break out of the profile syntax', () => {
    expect(() =>
      buildShellSandboxProfile({ cwd: '/tmp/a"b', approvedRoots: ['/Users/example/Library/x"y'], allowNetwork: false, env, home })
    ).toThrow();
  });

  it('rebuilds the environment from scratch and quotes the command', () => {
    const wrapped = sandboxShellCommand(`echo 'it''s'`, { cwd: '/tmp/work', approvedRoots: [], allowNetwork: false, env, home });
    expect(wrapped.startsWith('exec /usr/bin/env -i ')).toBe(true);
    expect(wrapped).toContain(`/bin/bash -c 'echo '\\''it'\\'''\\''s'\\'''`);
  });
});

describe.skipIf(!shellSandboxAvailable())('shell sandbox enforcement (macOS)', () => {
  let root: string;
  let fakeHome: string;
  let workspace: string;
  let execution: ToolExecutionContext;
  const context = { signal: new AbortController().signal, toolCallId: 'sandbox-e2e' };

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'acos-shell-sandbox-')));
    fakeHome = path.join(root, 'home');
    workspace = path.join(fakeHome, 'work');
    fs.mkdirSync(path.join(fakeHome, '.secret'), { recursive: true });
    fs.mkdirSync(path.join(fakeHome, 'Library', 'Keychains'), { recursive: true });
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(fakeHome, '.secret', 'token.txt'), 'SYNTHETIC_TOKEN_VALUE');
    fs.writeFileSync(path.join(fakeHome, 'Library', 'Keychains', 'login.txt'), 'SYNTHETIC_KEYCHAIN');
    vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    execution = { sessionId: 'sandbox-e2e', channel: 'cron:sandbox-test', cwd: workspace, approvedRoots: [workspace] };
    ApprovalManager.setNotifier(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function guardedBash(): Promise<AgentTool> {
    const { createTools } = await import('@kenkaiiii/ggcoder');
    const { tools } = createTools(workspace, { operations: createRestrictedToolOperations(workspace, [workspace]) });
    const bash = attachToolPolicy(tools.find((tool) => tool.name === 'bash')!, 'native');
    guardNativeToolScope(bash, execution);
    return guardToolWithApproval(bash, execution);
  }

  it('runs ordinary local work unattended', async () => {
    const bash = await guardedBash();
    const result = String(await bash.execute({ command: 'echo hello > out.txt && cat out.txt' }, context));
    expect(result).toContain('hello');
    expect(fs.readFileSync(path.join(workspace, 'out.txt'), 'utf8')).toBe('hello\n');
    expect(bash.description).toContain('macOS sandbox');
  });

  it('blocks credential reads even when the path is hidden from text checks', async () => {
    const bash = await guardedBash();
    const hidden = String(await bash.execute({ command: 'cat "$(dirname "$PWD")/.secret/token.txt"' }, context));
    expect(hidden).not.toContain('SYNTHETIC_TOKEN_VALUE');
    expect(hidden).toContain('Operation not permitted');
    // Split word: the text-level credential filter would stop the plain spelling first.
    const library = String(await bash.execute({ command: 'cat "$(dirname "$PWD")/Library/Key""chains/login.txt"' }, context));
    expect(library).not.toContain('SYNTHETIC_KEYCHAIN');
    expect(library).toContain('Operation not permitted');
  });

  it('blocks network from interpreters and hand-off helpers without approval', async () => {
    const bash = await guardedBash();
    // TEST-NET-1 is unroutable: unsandboxed this would time out, sandboxed it is refused at once.
    const python = String(await bash.execute({
      command: `python3 -c "import socket; socket.create_connection(('192.0.2.1', 443), timeout=2)"`,
    }, context));
    expect(python).toMatch(/Operation not permitted|PermissionError/);
    const dns = String(await bash.execute({ command: `python3 -c "import socket; socket.gethostbyname('example.com')"` }, context));
    expect(dns).toMatch(/gaierror|not known/);
    // Octal escapes hide the absolute path from the text checks; the kernel still refuses it.
    const osa = String(await bash.execute({ command: `"$(printf '\\057usr\\057bin\\057osascript')" -e 'return 1'` }, context));
    expect(osa).toContain('Operation not permitted');
  });

  it('sends network commands to approval instead of running them', async () => {
    const bash = await guardedBash();
    for (const command of ['curl https://example.com', 'npm install left-pad', 'git pull', 'open https://example.com']) {
      expect(String(await bash.execute({ command }, context)), command).toContain('requires user approval');
    }
  });

  it('gives network only to a command the owner approved at the desktop', async () => {
    execution = { ...execution, channel: 'desktop' };
    const approvals: string[] = [];
    ApprovalManager.setNotifier((request) => {
      approvals.push(request.toolName);
      queueMicrotask(() => ApprovalManager.resolve(request.id, 'approve', 'ui'));
      return true;
    });
    const bash = await guardedBash();
    // Unroutable TEST-NET-1 address: sandboxed it fails instantly with EPERM,
    // with network it can only time out.
    const result = String(await bash.execute({ command: 'curl -sS --max-time 1 http://192.0.2.1/' }, context));
    expect(approvals).toEqual(['bash']);
    expect(result).not.toContain('Operation not permitted');
    expect(result).toMatch(/timed out|Timeout/i);
  });

  it('does not re-open a private ~/Library folder when the project folder is set to it', async () => {
    const keychains = path.join(fakeHome, 'Library', 'Keychains');
    execution = { ...execution, cwd: keychains, approvedRoots: [keychains] };
    const { createTools } = await import('@kenkaiiii/ggcoder');
    const { tools } = createTools(keychains, { operations: createRestrictedToolOperations(keychains, [keychains]) });
    const bash = attachToolPolicy(tools.find((tool) => tool.name === 'bash')!, 'native');
    guardNativeToolScope(bash, execution);
    guardToolWithApproval(bash, execution);
    const result = String(await bash.execute({ command: 'cat login.txt' }, context));
    expect(result).not.toContain('SYNTHETIC_KEYCHAIN');
    expect(result).toContain('Operation not permitted');
  });

  it('strips inherited secrets even for background-style launches', () => {
    const wrapped = sandboxShellCommand('echo "secret=${ACOS_TEST_SECRET:-none} home=$HOME"', {
      cwd: workspace,
      approvedRoots: [workspace],
      allowNetwork: false,
      env: restrictedShellEnvironment(workspace),
    });
    // Mirrors the installed ProcessManager, which spawns with the full process env.
    const result = spawnSync('bash', ['-c', wrapped], {
      cwd: workspace,
      env: { ...process.env, ACOS_TEST_SECRET: 'must-not-leak' },
      encoding: 'utf8',
    });
    expect(result.stdout.trim()).toBe(`secret=none home=${workspace}`);
  });
});
