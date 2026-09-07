import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

interface ProcessIdentity { pid: number; parent: number; group: number; started: string }
async function processTable(): Promise<ProcessIdentity[]> {
  const { stdout } = await execFileAsync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,lstart='], { timeout: 3000, maxBuffer: 2 * 1024 * 1024 });
  return stdout.split('\n').flatMap((line) => {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/);
    return m ? [{ pid: Number(m[1]), parent: Number(m[2]), group: Number(m[3]), started: m[4] }] : [];
  });
}

/** macOS personal-build runner; signals only its own verified process identities. */
export async function runVideoJobProcess(
  script: string, workspace: string, job: string,
  options: { signal?: AbortSignal; onProgress?: (message: string) => void; timeoutMs?: number } = {},
): Promise<{ ok: boolean; cancelled: boolean }> {
  options.signal?.throwIfAborted();
  if (process.platform !== 'darwin') throw new Error('This local renderer adapter requires macOS compatibility validation on other platforms');
  // macOS denies executing setuid ps inside some outer test sandboxes. Refuse
  // before launching anything unless owned-process discovery is available.
  await processTable();
  options.signal?.throwIfAborted();
  const child = spawn(process.execPath, [script, workspace, job], {
    cwd: workspace, detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    // Do not inherit provider tokens, NODE_OPTIONS, loaders or shell startup hooks.
    env: { HOME: process.env.HOME, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR: '/private/tmp', ELECTRON_RUN_AS_NODE: '1' },
  });
  let stopped = false;
  let settled = false;
  let buffer = '';
  let lastProgress = '';
  let forceTimer: ReturnType<typeof setTimeout> | undefined;
  let teardown: Promise<void> | undefined;
  const signalGroup = (pid: number, signal: 'SIGTERM' | 'SIGKILL'): void => {
    try { process.kill(-pid, signal); } catch (error) { if ((error as { code?: string })?.code !== 'ESRCH') throw error; }
  };
  const stop = (): void => {
    if (stopped || settled) return;
    stopped = true;
    teardown = (async () => {
      if (!child.pid) return;
      // Remotion detaches Chrome into a separate group. Capture actual ancestry
      // before stopping the worker; never trust a tool-output-supplied PID.
      const table = await processTable();
      const owned = new Set([child.pid]);
      let added = true;
      while (added) {
        added = false;
        for (const p of table) if (owned.has(p.parent) && !owned.has(p.pid)) { owned.add(p.pid); added = true; }
      }
      const groups = table.filter((p) => owned.has(p.pid) && p.pid === p.group);
      for (const p of groups) signalGroup(p.pid, 'SIGTERM');
      await new Promise<void>((resolve, reject) => {
        forceTimer = setTimeout(() => {
          void (async () => {
            const current = await processTable();
            for (const group of groups) {
              const member = current.find((p) => p.group === group.group && table.some((old) => owned.has(old.pid) && old.pid === p.pid && old.started === p.started));
              if (member) signalGroup(group.group, 'SIGKILL');
            }
          })().then(resolve, reject);
        }, 1500);
      });
    })();
    // If discovery fails later, first let the worker close its own Chrome group.
    // Still report the error: do not claim descendant cleanup was verified.
    teardown = teardown.catch(async (error) => {
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => { forceTimer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 1500); });
      throw error;
    });
    void teardown.catch(() => {});
  };
  const timer = setTimeout(stop, options.timeoutMs ?? 20 * 60 * 1000);
  options.signal?.addEventListener('abort', stop, { once: true });
  if (options.signal?.aborted) stop();
  child.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    if (buffer.length > 64 * 1024) { stop(); buffer = ''; return; }
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (!line.startsWith('ACOS_VIDEO ')) continue;
      try {
        const value: unknown = JSON.parse(line.slice(11));
        if (!value || typeof value !== 'object') continue;
        const event = value as Record<string, unknown>;
        if (!['bundling', 'preview', 'rendering', 'verifying'].includes(String(event.stage)) || typeof event.percent !== 'number' || !Number.isFinite(event.percent)) continue;
        const progress = `${event.stage} ${Math.max(0, Math.min(100, Math.floor(event.percent)))}%`;
        if (progress !== lastProgress) { lastProgress = progress; options.onProgress?.(progress); }
      } catch { stop(); }
    }
  });
  // Drain without forwarding composition logs or private props to chat diagnostics.
  child.stderr?.on('data', () => {});
  try {
    const ok = await new Promise<boolean>((resolve) => {
      child.once('error', () => resolve(false));
      child.once('close', (code) => resolve(code === 0));
    });
    settled = true;
    await teardown;
    return { ok: ok && !stopped, cancelled: stopped };
  } finally {
    clearTimeout(timer);
    if (forceTimer) clearTimeout(forceTimer);
    options.signal?.removeEventListener('abort', stop);
  }
}
