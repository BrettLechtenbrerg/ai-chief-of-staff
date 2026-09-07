import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { install, manifest, validateCandidate, gracefulStop, parseArgs, defaultTransport, ownedProcesses } = require('../../scripts/install-local.cjs');
const roots: string[] = [];
const product = 'AI Chief of Staff';
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acos-installer-test-'));
  roots.push(root);
  const source = path.join(root, 'candidate.app');
  const destination = path.join(root, 'installed.app');
  for (const bundle of [source, destination]) {
    for (const file of ['Contents/Info.plist', `Contents/MacOS/${product}`, 'Contents/Resources/app/dist/main/index.js', 'Contents/Resources/app/dist/main/preload.js', 'Contents/Resources/app/ui/chat.html']) {
      fs.mkdirSync(path.dirname(path.join(bundle, file)), { recursive: true });
      fs.writeFileSync(path.join(bundle, file), bundle === source ? 'new' : 'original unsigned bytes');
    }
    fs.writeFileSync(path.join(bundle, 'Contents/Resources/app/package.json'), JSON.stringify({ name: 'ai-chief-of-staff', main: 'dist/main/index.js', version: '1.2.3', acosUpdatePolicy: 'personal-local-v1', acosInstallValidation: 1 }));
  }
  const run = vi.fn((file: string, args: string[]): string => {
    if (file.endsWith('PlistBuddy')) return args[1].includes('Identifier') ? 'com.totalsuccessai.ai-chief-of-staff' : product;
    if (args.includes('-dv')) return 'TeamIdentifier=2HQTY95NHD\nAuthority=Developer ID Application: Brett';
    return '';
  });
  const transport = {
    validate: (bundle: string, arch: string) => validateCandidate(bundle, arch, run),
    copy: vi.fn((from: string, to: string) => fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true })),
    rename: vi.fn((from: string, to: string) => fs.renameSync(from, to)),
    processes: vi.fn((): { pid: number; uid: number; start: string; executable: string }[] => []),
    identity: vi.fn(), signal: vi.fn(), assertNoPendingUpdate: vi.fn(),
    launch: vi.fn(async () => 123), healthy: vi.fn(() => true),
  };
  return { root, source, destination, transport, run, options: { source, destination, arch: 'x64', validateOnly: false, launch: true, timeout: 5 } };
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
describe('local installer, inert filesystem/process transport', () => {
  it('defaults to no-launch validation and rejects ambiguous launch flags', () => {
    expect(parseArgs([])).toMatchObject({ validateOnly: true, launch: false });
    expect(parseArgs(['--no-launch'])).toMatchObject({ validateOnly: true });
    expect(parseArgs(['--install', '--launch'])).toMatchObject({ validateOnly: false, launch: true });
    expect(() => parseArgs(['--install'])).toThrow();
    expect(() => parseArgs(['--no-launch', '--launch'])).toThrow();
  });
  it.each([['x64', 'x86_64'], ['arm64', 'arm64']])('puts the executable before lipo verification for %s', (arch, nativeArch) => {
    const f = fixture();
    validateCandidate(f.source, arch, f.run);
    expect(f.run).toHaveBeenCalledWith('/usr/bin/lipo', [path.join(f.source, `Contents/MacOS/${product}`), '-verify_arch', nativeArch]);
  });
  it('marks the pinned codesign requirement as literal text, not a filename', () => {
    const f = fixture(); validateCandidate(f.source, 'x64', f.run);
    expect(f.run).toHaveBeenCalledWith('/usr/bin/codesign', ['--verify', '--deep', '--strict', '-R', '=anchor apple generic and identifier "com.totalsuccessai.ai-chief-of-staff" and certificate leaf[subject.OU] = "2HQTY95NHD"', f.source]);
  });
  it('refuses an older personal candidate before replacing or launching anything', async () => {
    const f = fixture();
    const file = path.join(f.source, 'Contents/Resources/app/package.json');
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete pkg.acosInstallValidation;
    fs.writeFileSync(file, JSON.stringify(pkg));
    const before = manifest(f.destination);
    await expect(install(f.options, f.transport)).rejects.toThrow('guarded install validation');
    expect(manifest(f.destination)).toBe(before);
    expect(f.transport.rename).not.toHaveBeenCalled();
    expect(f.transport.launch).not.toHaveBeenCalled();
    await expect(defaultTransport().launch(f.source)).rejects.toThrow('guarded install validation');
  });
  it('successful switch preserves exact unsigned original and verifies health', async () => {
    const f = fixture(); const old = manifest(f.destination);
    const result = await install(f.options, f.transport);
    expect(result.status).toBe('installed-ready');
    expect(manifest(result.rollback)).toBe(old);
    expect(manifest(f.destination)).toBe(manifest(f.source));
    expect(f.transport.healthy).toHaveBeenCalledWith(f.destination, 123, expect.any(Number), '1.2.3');
  });
  it('staged validation refusal leaves installed bundle untouched', async () => {
    const f = fixture(); const old = manifest(f.destination);
    const validate = f.transport.validate;
    f.transport.validate = (bundle, arch) => { if (bundle !== f.source) throw new Error('stage rejected'); return validate(bundle, arch); };
    await expect(install(f.options, f.transport)).rejects.toThrow('stage rejected');
    expect(manifest(f.destination)).toBe(old);
    expect(f.transport.signal).not.toHaveBeenCalled();
    expect(f.transport.rename).not.toHaveBeenCalled();
  });
  it.each(['copy-error', 'corrupt-copy'])('%s cannot touch the old bundle', async (mode) => {
    const f = fixture(); const old = manifest(f.destination);
    f.transport.copy.mockImplementation((from, to) => {
      if (mode === 'copy-error') throw new Error('copy failed');
      fs.cpSync(from, to, { recursive: true }); fs.writeFileSync(path.join(to, 'unexpected'), 'corruption');
    });
    await expect(install(f.options, f.transport)).rejects.toThrow();
    expect(manifest(f.destination)).toBe(old);
    expect(f.transport.rename).not.toHaveBeenCalled();
  });
  it('refused shutdown times out without forced kill or replacement', async () => {
    const f = fixture(); const old = manifest(f.destination);
    const p = { pid: 123, uid: 501, start: 'unique start', executable: path.join(f.destination, `Contents/MacOS/${product}`) };
    f.transport.processes.mockReturnValue([p]); f.transport.identity.mockReturnValue(p);
    await expect(install(f.options, f.transport)).rejects.toThrow('Timed out');
    expect(f.transport.signal.mock.calls).toEqual([[123, 'SIGTERM']]);
    expect(manifest(f.destination)).toBe(old); expect(f.transport.rename).not.toHaveBeenCalled();
  });
  it('waits for observed exit and never signals a recycled identity', async () => {
    const f = fixture();
    const p = { pid: 123, uid: 501, start: 'old', executable: path.join(f.destination, `Contents/MacOS/${product}`) };
    f.transport.processes.mockReturnValueOnce([p]).mockReturnValue([]);
    f.transport.identity.mockReturnValue({ ...p, start: 'new' });
    await gracefulStop(f.destination, f.transport, 5);
    expect(f.transport.signal).not.toHaveBeenCalled();
  });
  it('ignores unrelated same-name processes by exact path and uid', () => {
    const f = fixture();
    const run = () => [
      `11 ${process.getuid!()} Sat Sep  5 12:00:00 2026 /elsewhere/AI Chief of Staff`,
      `12 ${process.getuid!()} Sat Sep  5 12:00:00 2026 ${path.join(f.destination, `Contents/MacOS/${product}`)}`,
    ].join('\n');
    expect(ownedProcesses(f.destination, run).map((p: { pid: number }) => p.pid)).toEqual([12]);
  });
  it('refuses unavailable or malformed process census rather than assuming exit', () => {
    const f = fixture();
    expect(() => ownedProcesses(f.destination, () => '')).toThrow('Cannot establish process state');
    expect(() => ownedProcesses(f.destination, () => 'unparseable')).toThrow('Cannot parse process state');
    expect(() => ownedProcesses(f.destination, () => { throw new Error('ps failed'); })).toThrow('ps failed');
  });
  it.each(['launch', 'health', 'rename'])('%s failure automatically restores original', async (mode) => {
    const f = fixture(); const old = manifest(f.destination);
    if (mode === 'launch') f.transport.launch.mockRejectedValue(new Error('launch failure'));
    if (mode === 'health') f.transport.healthy.mockReturnValue(false);
    if (mode === 'rename') f.transport.rename.mockImplementationOnce((from, to) => fs.renameSync(from, to)).mockImplementationOnce(() => { throw new Error('rename failed'); });
    await expect(install(f.options, f.transport)).rejects.toThrow();
    expect(manifest(f.destination)).toBe(old);
  });
  it('retains both bundles when failed app refuses graceful rollback shutdown', async () => {
    const f = fixture(); const old = manifest(f.destination);
    f.transport.launch.mockImplementation(async () => {
      f.transport.processes.mockReturnValue([{ pid: 123, uid: 501, start: 'new', executable: path.join(f.destination, `Contents/MacOS/${product}`) }]);
      return 123;
    });
    f.transport.healthy.mockReturnValue(false);
    await expect(install(f.options, f.transport)).rejects.toThrow('automatic rollback blocked');
    const job = fs.readdirSync(f.root).find((name) => name.startsWith('.acos-install-'))!;
    expect(manifest(path.join(f.root, job, 'previous.app'))).toBe(old);
    expect(fs.existsSync(f.destination)).toBe(true);
  });
  it('repeated validation jobs use unique staging and never launch or inspect updater state', async () => {
    const f = fixture(); const old = manifest(f.destination);
    for (let i = 0; i < 2; i++) await install({ ...f.options, validateOnly: true, launch: false }, f.transport);
    expect(f.transport.copy.mock.calls[0][1]).not.toBe(f.transport.copy.mock.calls[1][1]);
    expect(f.transport.launch).not.toHaveBeenCalled(); expect(f.transport.assertNoPendingUpdate).not.toHaveBeenCalled();
    expect(manifest(f.destination)).toBe(old);
  });
  it.each(['wrong-marker', 'unsigned', 'adhoc'])('denies %s candidates before copy', async (mode) => {
    const f = fixture();
    if (mode === 'wrong-marker') fs.writeFileSync(path.join(f.source, 'Contents/Resources/app/package.json'), '{}');
    else f.run.mockImplementation((file, args) => {
      if (file.endsWith('PlistBuddy')) return args[1].includes('Identifier') ? 'com.totalsuccessai.ai-chief-of-staff' : product;
      if (file.endsWith('codesign') && mode === 'unsigned') throw new Error('unsigned');
      return 'Signature=adhoc';
    });
    await expect(install(f.options, f.transport)).rejects.toThrow();
    expect(f.transport.copy).not.toHaveBeenCalled(); expect(f.transport.rename).not.toHaveBeenCalled();
  });
  function legacyFixture() {
    const f = fixture();
    fs.writeFileSync(path.join(f.destination, 'Contents/Resources/app/package.json'), '{}');
    const uid = process.getuid!();
    const label = 'com.totalsuccessai.ai-chief-of-staff.ShipIt';
    const census = `1 0 Sat Sep  5 12:00:00 2026 /sbin/launchd`;
    const probe = vi.fn((file: string, args: string[]) => {
      if (file === '/bin/ps') return { status: 0, stdout: census, stderr: '' };
      if (file === '/bin/launchctl') {
        const description = args[1].startsWith('gui/') ? `user gui: ${uid}` : args[1].startsWith('user/') ? `uid: ${uid}` : 'system';
        return { status: 113, stdout: '', stderr: `Could not find service "${label}" in domain for ${description}\n` };
      }
      return { status: 1, stdout: '', stderr: `2026-09-05 12:00:00.123 defaults[123:456]\nThe domain/default pair of (${label}, ${args[3]}) does not exist\n` };
    });
    f.transport.assertNoPendingUpdate.mockImplementation((bundle: string) => defaultTransport(probe, f.root).assertNoPendingUpdate(bundle));
    return { ...f, probe, census, uid, label };
  }
  it.each(['', 'Bad request.\n'])('allows proven stopped legacy with native prefix %j and repeats observations', async (prefix) => {
    const f = legacyFixture(); const old = manifest(f.destination);
    const original = f.probe.getMockImplementation()!;
    f.probe.mockImplementation((file, args) => {
      const result = original(file, args);
      return file === '/bin/launchctl' ? { ...result, stderr: prefix + result.stderr } : result;
    });
    const result = await install(f.options, f.transport);
    expect(result.status).toBe('installed-ready');
    expect(manifest(result.rollback)).toBe(old);
    expect(f.transport.signal).not.toHaveBeenCalled();
    expect(f.transport.assertNoPendingUpdate).toHaveBeenCalledTimes(2);
    expect(f.probe.mock.calls.filter(([file]) => file === '/bin/launchctl').map(([, args]) => args[1])).toEqual(
      [0, 1].flatMap(() => [`gui/${f.uid}/${f.label}`, `user/${f.uid}/${f.label}`, `system/${f.label}`]),
    );
    expect(f.probe.mock.invocationCallOrder.at(-1)).toBeLessThan(f.transport.rename.mock.invocationCallOrder[0]);
  });
  it.each(['running', 'queued', 'malformed', 'permission', 'wrong-service', 'wrong-domain', 'bad-request-only', 'wrong-exit', 'unexpected-output', 'other-user', 'executor', 'state', 'preferences', 'attempts-preference', 'preferences-permission', 'probe-error'])('refuses legacy %s without quit or replacement', async (mode) => {
    const f = legacyFixture(); const old = manifest(f.destination);
    const original = f.probe.getMockImplementation()!;
    f.probe.mockImplementation((file, args) => {
      if (mode === 'probe-error') throw new Error('private probe failure');
      if (file === '/bin/ps') {
        if (mode === 'malformed') return { status: 0, stdout: 'bad census', stderr: '' };
        const extra = mode === 'running' ? `${f.uid} Sat Sep  5 12:00:00 2026 ${path.join(f.destination, `Contents/MacOS/${product}`)}`
          : mode === 'other-user' ? `${f.uid + 1} Sat Sep  5 12:00:00 2026 /System/Library/CoreServices/loginwindow.app/Contents/MacOS/loginwindow`
            : mode === 'executor' ? `${f.uid + 1} Sat Sep  5 12:00:00 2026 /unrelated/ShipIt` : '';
        if (extra) return { status: 0, stdout: `${f.census}\n12 ${extra}`, stderr: '' };
      }
      if (file === '/bin/launchctl') {
        if (mode === 'queued') return { status: 0, stdout: 'registered job without pid', stderr: '' };
        if (mode === 'permission') return { status: 113, stdout: '', stderr: 'Operation not permitted' };
        if (mode === 'bad-request-only') return { status: 113, stdout: '', stderr: 'Bad request.' };
        if (mode === 'wrong-exit') return { ...original(file, args), status: 1 };
        if (mode === 'unexpected-output') return { ...original(file, args), stdout: 'unverified job state' };
        if (mode === 'wrong-service' || mode === 'wrong-domain') return { ...original(file, args), stderr: original(file, args).stderr.replace(mode === 'wrong-service' ? f.label : 'domain for', 'unrelated') };
      }
      if (file === '/usr/bin/defaults') {
        if (mode === 'preferences' || (mode === 'attempts-preference' && args[3] === 'SQRLShipItInstallationAttempts')) return { status: 0, stdout: 'PRIVATE value', stderr: '' };
        if (mode === 'preferences-permission') return { status: 1, stdout: '', stderr: 'PRIVATE permission failure' };
      }
      return original(file, args);
    });
    if (mode === 'state') {
      const state = path.join(f.root, 'Library/Caches', f.label, 'ShipItState.plist');
      fs.mkdirSync(path.dirname(state), { recursive: true }); fs.writeFileSync(state, '{"private":"value"}');
    }
    const failure = await install(f.options, f.transport).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toMatch(/state|running|job absence|executor|Multi-user|preferences/);
    expect(failure.message).not.toMatch(/PRIVATE|private probe/);
    expect(f.transport.signal).not.toHaveBeenCalled(); expect(f.transport.rename).not.toHaveBeenCalled();
    expect(manifest(f.destination)).toBe(old);
  });
  it('refuses a legacy restart or queued job found by the final recheck without signaling', async () => {
    for (const mode of ['running', 'queued']) {
      const f = legacyFixture(); const old = manifest(f.destination);
      const original = f.probe.getMockImplementation()!;
      let censuses = 0;
      f.probe.mockImplementation((file, args) => {
        if (file === '/bin/ps') censuses++;
        if (censuses === 2 && mode === 'running' && file === '/bin/ps') return { status: 0, stdout: `${f.census}\n12 ${f.uid} Sat Sep  5 12:00:00 2026 ${path.join(f.destination, `Contents/MacOS/${product}`)}`, stderr: '' };
        if (censuses === 2 && mode === 'queued' && file === '/bin/launchctl') return { status: 0, stdout: 'queued', stderr: '' };
        return original(file, args);
      });
      await expect(install(f.options, f.transport)).rejects.toThrow();
      expect(f.transport.signal).not.toHaveBeenCalled(); expect(f.transport.rename).not.toHaveBeenCalled();
      expect(manifest(f.destination)).toBe(old);
    }
  });
  it('restores stopped legacy after failed candidate launch but never launches legacy', async () => {
    const f = legacyFixture(); const old = manifest(f.destination);
    f.transport.launch.mockRejectedValue(new Error('launch failure'));
    await expect(install(f.options, f.transport)).rejects.toThrow('launch failure');
    expect(manifest(f.destination)).toBe(old);
    expect(f.transport.launch).toHaveBeenCalledTimes(1);
  });
  it.each(['unreadable', 'unknown-marker'])('refuses %s installed policy before OS observation', async (mode) => {
    const f = legacyFixture();
    fs.writeFileSync(path.join(f.destination, 'Contents/Resources/app/package.json'), mode === 'unreadable' ? '{' : '{"acosUpdatePolicy":"unknown"}');
    await expect(install(f.options, f.transport)).rejects.toThrow('Installed update policy');
    expect(f.probe).not.toHaveBeenCalled(); expect(f.transport.signal).not.toHaveBeenCalled();
    expect(f.transport.rename).not.toHaveBeenCalled();
  });
  it('has no CLI quiescence bypass', () => {
    expect(() => parseArgs(['--skip-updater-check'])).toThrow('Unknown option');
  });
});
