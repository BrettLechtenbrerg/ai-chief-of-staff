#!/usr/bin/env node
// Local Mac installation only. Never repair or re-sign sealed bundle contents.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { spawnSync, spawn } = require('node:child_process');
const PRODUCT = 'AI Chief of Staff';
const ID = 'com.totalsuccessai.ai-chief-of-staff';
const POLICY = 'personal-local-v1';
const executable = (bundle) => path.join(bundle, 'Contents/MacOS', PRODUCT);
const metadata = (bundle) => JSON.parse(fs.readFileSync(path.join(bundle, 'Contents/Resources/app/package.json'), 'utf8'));

function command(file, args) {
  const result = spawnSync(file, args, { encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${path.basename(file)} verification/operation failed`);
  return `${result.stdout || ''}${result.stderr || ''}`;
}

// Includes all paths, modes, bytes and symlink targets; rejects escaping links.
function manifest(root) {
  const hash = createHash('sha256');
  function walk(relative) {
    const full = path.join(root, relative);
    const stat = fs.lstatSync(full);
    const entry = [relative, stat.mode];
    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(full);
      const resolved = fs.realpathSync(full);
      if (!resolved.startsWith(`${fs.realpathSync(root)}${path.sep}`)) throw new Error('Bundle symlink escapes bundle');
      entry.push('link', target);
    } else if (stat.isDirectory()) {
      entry.push('directory');
    } else if (stat.isFile()) {
      entry.push('file', createHash('sha256').update(fs.readFileSync(full)).digest('hex'));
    } else throw new Error('Unsupported bundle file type');
    hash.update(JSON.stringify(entry));
    if (stat.isDirectory()) for (const name of fs.readdirSync(full).sort()) walk(path.join(relative, name));
  }
  walk('');
  return hash.digest('hex');
}

function validateCandidate(bundle, arch, run = command) {
  if (!['x64', 'arm64'].includes(arch)) throw new Error('Unsupported architecture');
  if (fs.lstatSync(bundle).isSymbolicLink()) throw new Error('Bundle must not be a symlink');
  const pkg = metadata(bundle);
  if (pkg.acosUpdatePolicy !== POLICY) throw new Error('Required acosUpdatePolicy:personal-local-v1 marker missing');
  if (pkg.name !== 'ai-chief-of-staff' || pkg.main !== 'dist/main/index.js') throw new Error('Unexpected app identity/entrypoint');
  for (const relative of ['Contents/Info.plist', `Contents/MacOS/${PRODUCT}`, 'Contents/Resources/app/dist/main/index.js', 'Contents/Resources/app/dist/main/preload.js', 'Contents/Resources/app/ui/chat.html']) {
    if (!fs.statSync(path.join(bundle, relative)).isFile()) throw new Error(`Required file missing: ${relative}`);
  }
  const plist = path.join(bundle, 'Contents/Info.plist');
  if (run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', plist]).trim() !== ID) throw new Error('Wrong bundle identifier');
  if (run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', plist]).trim() !== PRODUCT) throw new Error('Wrong bundle executable');
  run('/usr/bin/lipo', [executable(bundle), '-verify_arch', arch === 'x64' ? 'x86_64' : 'arm64']);
  // Apple trust + pinned existing team/identifier: no unsigned/ad-hoc fallback.
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '-R', `=anchor apple generic and identifier "${ID}" and certificate leaf[subject.OU] = "2HQTY95NHD"`, bundle]);
  const signature = run('/usr/bin/codesign', ['-dv', '--verbose=4', bundle]);
  if (!signature.includes('TeamIdentifier=2HQTY95NHD') || !signature.includes('Authority=Developer ID Application:') || /Signature=adhoc/.test(signature)) throw new Error('Valid Developer ID signature required');
  run('/usr/sbin/spctl', ['--assess', '--type', 'execute', bundle]);
  return pkg;
}

function processIdentity(pid, run = command) {
  try {
    const value = run('/bin/ps', ['-p', String(pid), '-ww', '-o', 'uid=', '-o', 'lstart=', '-o', 'comm=']).trim();
    const match = /^(\d+)\s+(.{24})\s+(.+)$/.exec(value);
    return match ? { pid, uid: Number(match[1]), start: match[2], executable: match[3] } : null;
  } catch { return null; }
}
function processCensus(run = command) {
  // One bounded census: per-PID lookup failures must not masquerade as exit.
  const output = run('/bin/ps', ['-axww', '-o', 'pid=', '-o', 'uid=', '-o', 'lstart=', '-o', 'comm=']).trim();
  if (!output) throw new Error('Cannot establish process state');
  const processes = output.split('\n').map((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.{24})\s+(.+)$/.exec(line);
    if (!match) throw new Error('Cannot parse process state; refusing replacement');
    return { pid: Number(match[1]), uid: Number(match[2]), start: match[3], executable: match[4] };
  });
  return processes;
}
function ownedProcesses(bundle, run = command) {
  const matches = processCensus(run).filter((p) => p.executable === executable(bundle) || p.executable.startsWith(`${bundle}/Contents/Frameworks/`));
  if (matches.some((p) => p.uid !== process.getuid())) throw new Error('Installed app is running under another user; refusing replacement');
  return matches;
}
function sameProcess(a, b) {
  return !!b && a.pid === b.pid && a.uid === b.uid && a.start === b.start && a.executable === b.executable;
}
async function waitUntil(check, timeout, interval = 100) {
  const deadline = Date.now() + timeout;
  while (!await check()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for process exit/readiness; no forced kill');
    // Poll an observed condition, never assume a delay means shutdown completed.
    await new Promise((resolve) => setTimeout(resolve, Math.min(interval, Math.max(1, deadline - Date.now()))));
  }
}
async function gracefulStop(bundle, transport, timeout) {
  const owned = transport.processes(bundle);
  for (const p of owned.filter((p) => p.executable === executable(bundle))) {
    if (sameProcess(p, transport.identity(p.pid))) transport.signal(p.pid, 'SIGTERM');
  }
  await waitUntil(() => transport.processes(bundle).length === 0, timeout);
}

// Capture observations privately: raw defaults/launchctl output may contain private values.
function observeOS(file, args) {
  return spawnSync(file, args, { encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
}
function assertLegacyQuiescent(bundle, probe = observeOS, home = os.homedir(), uid = process.getuid()) {
  const observe = (file, args) => {
    let result;
    try { result = probe(file, args); } catch { throw new Error('Cannot establish legacy updater state'); }
    if (!result || result.error || !Number.isInteger(result.status) || typeof result.stdout !== 'string' || typeof result.stderr !== 'string') throw new Error('Cannot establish legacy updater state');
    return result;
  };
  const processes = processCensus((file, args) => {
    const result = observe(file, args);
    if (result.status !== 0 || result.stderr.trim()) throw new Error('Cannot establish process state');
    return result.stdout;
  });
  if (processes.some((p) => p.executable === executable(bundle) || p.executable.startsWith(`${bundle}/Contents/Frameworks/`))) throw new Error('Legacy app is running; do NOT quit it through this installer');
  if (processes.some((p) => /ShipIt|Squirrel|\/Updater(?:\s|$)/i.test(p.executable))) throw new Error('Possible updater executor; reconcile before migration');
  // Fast-user-switching sessions have their own GUI jobs and preferences. Root's
  // loginwindow is the login screen, not another logged-in user's session.
  if (processes.some((p) => path.basename(p.executable) === 'loginwindow' && p.uid !== 0 && p.uid !== uid)) throw new Error('Multi-user legacy migration refused: other GUI user state is not covered');
  const label = `${ID}.ShipIt`;
  const domains = [[`gui/${uid}`, `user gui: ${uid}`], [`user/${uid}`, `uid: ${uid}`], ['system', 'system']];
  for (const [domain, description] of domains) {
    const result = observe('/bin/launchctl', ['print', `${domain}/${label}`]);
    const expected = `Could not find service "${label}" in domain for ${description}`;
    // Observed on this Mac: the exact absence diagnostic prefixed with "Bad request.".
    const absent = result.stderr.trim() === expected || result.stderr.trim() === `Bad request.\n${expected}`;
    if (result.status !== 113 || result.stdout.trim() || !absent) throw new Error('Cannot establish exact ShipIt launchd job absence; reconcile before migration');
  }
  // lstat distinguishes ENOENT from unreadable state (and treats symlinks as present).
  try {
    fs.lstatSync(path.join(home, 'Library/Caches', label, 'ShipItState.plist'));
    throw new Error('Native ShipIt state present; reconcile before migration');
  } catch (error) { if (error.code !== 'ENOENT') throw new Error('Native ShipIt state present or unreadable; reconcile before migration'); }
  for (const key of ['SQRLInstallerOwnedBundle', 'SQRLShipItInstallationAttempts']) {
    const result = observe('/usr/bin/defaults', ['-currentHost', 'read', label, key]);
    // defaults prefixes diagnostics with a timestamp/process header on macOS.
    const diagnostic = result.stderr.trim().replace(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+ defaults\[\d+:\w+\]\s*/, '');
    if (result.status !== 1 || result.stdout.trim() || diagnostic !== `The domain/default pair of (${label}, ${key}) does not exist`) throw new Error('Native ShipIt preferences present or unverified; reconcile before migration');
  }
}
function defaultTransport(probe = observeOS, home = os.homedir()) {
  return {
    validate: validateCandidate,
    copy: (source, stage) => command('/usr/bin/ditto', [source, stage]),
    rename: (from, to) => fs.renameSync(from, to),
    processes: ownedProcesses,
    identity: processIdentity,
    signal: (pid, signal) => process.kill(pid, signal),
    // Running legacy can hold install-on-quit state; stopped legacy also needs
    // authoritative native-job absence, not merely an empty cache or no PID.
    assertNoPendingUpdate: (bundle) => {
      if (!fs.existsSync(bundle)) throw new Error('Installed bundle is missing; cannot establish prior updater state. Reconcile before installation, do not bypass');
      let pkg;
      try { pkg = metadata(bundle); } catch { throw new Error('Installed update policy unreadable; refusing replacement'); }
      if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg) || (Object.hasOwn(pkg, 'acosUpdatePolicy') && pkg.acosUpdatePolicy !== POLICY)) throw new Error('Installed update policy invalid; refusing replacement');
      if (pkg.acosUpdatePolicy !== POLICY) {
        assertLegacyQuiescent(bundle, probe, home);
        return 'stopped-legacy';
      }
      validateCandidate(bundle, os.arch());
      const jobs = command('/bin/ps', ['-axo', 'comm=']);
      if (/ShipIt|Squirrel|\/Updater(?:\s|$)/i.test(jobs)) throw new Error('Possible queued updater helper; reconcile before installation, do not bypass');
    },
    launch: async (bundle) => {
      if (metadata(bundle).acosInstallValidation !== 1) throw new Error('Candidate lacks guarded install validation');
      const child = spawn(executable(bundle), [], { stdio: 'ignore', env: { ...process.env, ACOS_INSTALL_VALIDATION: '1' } });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      child.unref();
      return child.pid;
    },
    healthy: (bundle, pid, started, version) => {
      const identity = processIdentity(pid);
      if (!identity || identity.uid !== process.getuid() || identity.executable !== executable(bundle)) return false;
      try {
        const file = path.join(os.homedir(), 'Library/Application Support/ai-chief-of-staff/startup-health.json');
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.size > 4096 || stat.mtimeMs < started) return false;
        const health = JSON.parse(fs.readFileSync(file, 'utf8'));
        return health.validationStartup === true && Date.parse(health.startedAt) >= started && health.version === version && health.ipcRegistered === true && health.sqliteLoaded === true && health.initializationComplete === true && health.error === null;
      } catch { return false; }
    },
  };
}

async function install(options, transport = defaultTransport()) {
  const { source, destination, arch, launch = false, validateOnly = true, timeout = 30000 } = options;
  if (!validateOnly && !launch) throw new Error('Installation requires explicit --launch; use --validate-only/--no-launch for inert validation');
  const parent = validateOnly ? os.tmpdir() : path.dirname(destination);
  const lock = `${destination}.install-lock`;
  if (!validateOnly) fs.mkdirSync(lock, { mode: 0o700 }); // concurrent/crashed jobs fail closed
  let job;
  let previous;
  let switched = false;
  let launchAttempted = false;
  try {
    job = fs.mkdtempSync(path.join(parent, '.acos-install-'));
    fs.chmodSync(job, 0o700);
    const stage = path.join(job, `${PRODUCT}.app`);
    const pkg = transport.validate(source, arch);
    if (!validateOnly && pkg.acosInstallValidation !== 1) throw new Error('Candidate lacks guarded install validation');
    const before = manifest(source);
    transport.copy(source, stage);
    if (manifest(source) !== before || manifest(stage) !== before) throw new Error('Staged copy integrity mismatch');
    transport.validate(stage, arch);
    if (validateOnly) return { status: 'validated-not-installed', manifest: before };
    if (path.resolve(source) === path.resolve(destination) || fs.lstatSync(path.dirname(destination)).isSymbolicLink()) throw new Error('Unsafe installation path');
    if (fs.existsSync(destination) && fs.lstatSync(destination).isSymbolicLink()) throw new Error('Installed bundle is a symlink');
    const priorState = transport.assertNoPendingUpdate(destination);
    // Never signal legacy, even if it starts after the first observation.
    if (priorState !== 'stopped-legacy') await gracefulStop(destination, transport, timeout);
    // Recheck after actual exit, before the first rename.
    transport.assertNoPendingUpdate(destination);
    if (fs.existsSync(destination)) {
      previous = path.join(job, 'previous.app');
      transport.rename(destination, previous);
    }
    transport.rename(stage, destination);
    switched = true;
    transport.validate(destination, arch);
    if (manifest(destination) !== before) throw new Error('Installed copy integrity mismatch');
    const started = Date.now();
    launchAttempted = true;
    const pid = await transport.launch(destination);
    await waitUntil(() => transport.healthy(destination, pid, started, pkg.version), timeout);
    return { status: 'installed-ready', rollback: previous || null, job };
  } catch (error) {
    if (switched) {
      try {
        if (launchAttempted) await gracefulStop(destination, transport, timeout);
        transport.rename(destination, path.join(job, 'failed.app'));
        if (previous) transport.rename(previous, destination);
      } catch {
        throw new Error(`Installation failed; automatic rollback blocked (no forced kill). Preserve all bundles; recovery directory: ${job}`);
      }
    } else if (previous && fs.existsSync(previous) && !fs.existsSync(destination)) {
      try { transport.rename(previous, destination); } catch { throw new Error(`Rollback rename failed; original retained at ${previous}`); }
    }
    throw error;
  } finally {
    // Never delete a job holding the sole previous/failed bundle. Crash leftovers are inspectable.
    if (validateOnly && job) fs.rmSync(job, { recursive: true, force: true });
    if (!validateOnly) fs.rmdirSync(lock);
  }
}

function parseArgs(args) {
  let arch = os.arch();
  let source;
  let installRequested = false;
  let launch = false;
  let validationRequested = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['x64', 'arm64'].includes(arg)) arch = arg;
    else if (arg === '--source') { source = args[++i]; if (!source || source.startsWith('--')) throw new Error('--source requires a bundle path'); }
    else if (arg === '--install') installRequested = true;
    else if (arg === '--launch') launch = true;
    else if (arg === '--validate-only' || arg === '--no-launch') validationRequested = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (validationRequested && (installRequested || launch)) throw new Error('Validation/no-launch cannot be combined with install/launch');
  if (installRequested !== launch) throw new Error('Use --install --launch together; automatic services stay paused during validation');
  return { arch, source: path.resolve(source || path.join(__dirname, '..', 'release/personal', arch === 'arm64' ? 'mac-arm64' : 'mac', `${PRODUCT}.app`)), destination: `/Applications/${PRODUCT}.app`, validateOnly: !installRequested, launch };
}
module.exports = { install, manifest, validateCandidate, gracefulStop, processIdentity, ownedProcesses, sameProcess, parseArgs, defaultTransport, assertLegacyQuiescent };
if (require.main === module) {
  Promise.resolve().then(() => {
    if (process.platform !== 'darwin') throw new Error('This installer is macOS-only; Windows/Linux packaging paths are unchanged');
    return install(parseArgs(process.argv.slice(2)));
  }).then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(`[install-local] ${error.message}`); process.exitCode = 1; });
}
