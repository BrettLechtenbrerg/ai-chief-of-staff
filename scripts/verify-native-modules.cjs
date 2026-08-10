/**
 * electron-builder afterPack hook: verify every native module (.node) inside
 * the packed app matches the target platform + architecture.
 *
 * WHY THIS EXISTS (Jul 7 2026 incident): the beta.20 arm64 mac build shipped
 * with a WINDOWS PE DLL as better_sqlite3.node — the Docker dist:win build
 * had overwritten node_modules on the shared project dir, and the mac arm64
 * pack copied it verbatim. dlopen failed ('not a mach-o file'), the main
 * process crashed before IPC registration, and every Apple Silicon install
 * of beta.20 was bricked. This hook makes that class of bug fail the BUILD
 * instead of the user.
 *
 * Checks magic bytes directly (no `file` binary needed, works in Docker):
 *   Mach-O 64 LE:  CF FA ED FE  (+cputype: x86_64=0x01000007, arm64=0x0100000C)
 *   Mach-O fat:    CA FE BA BE / BE BA FE CA (universal — any arch OK)
 *   PE (Windows):  4D 5A + PE signature + COFF machine (x64=0x8664, arm64=0xAA64)
 *   ELF (Linux):   7F 45 4C 46
 */
'use strict';

const fs = require('fs');
const path = require('path');

const MACHO_CPUTYPE = { x64: 0x01000007, arm64: 0x0100000c };
const PE_MACHINE = { ia32: 0x014c, x64: 0x8664, armv7l: 0x01c4, arm64: 0xaa64 };

// Non-runtime artifacts that upstream packages leave in their build dirs.
// better-sqlite3's test_extension.node is only dlopen'd by its own test
// suite — it already ships (harmlessly) in the healthy Windows builds.
const IGNORED_BASENAMES = new Set(['test_extension.node']);
// electron-builder Arch enum: 0=ia32, 1=x64, 2=armv7l, 3=arm64, 4=universal
const ARCH_NAMES = ['ia32', 'x64', 'armv7l', 'arm64', 'universal'];

function findNodeFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) findNodeFiles(full, out);
    else if (entry.isFile() && entry.name.endsWith('.node')) out.push(full);
  }
  return out;
}

function describe(buf) {
  if (buf.length < 8) return { kind: 'too-short' };
  const magicLE = buf.readUInt32LE(0);
  const magicBE = buf.readUInt32BE(0);
  if (magicLE === 0xfeedfacf) {
    // 64-bit Mach-O little-endian: cputype at offset 4
    return { kind: 'macho', cputype: buf.readUInt32LE(4) };
  }
  if (magicBE === 0xcafebabe || magicBE === 0xbebafeca) {
    return { kind: 'macho-fat' };
  }
  if (buf[0] === 0x4d && buf[1] === 0x5a) {
    if (buf.length < 0x40) return { kind: 'pe-invalid' };
    const peOffset = buf.readUInt32LE(0x3c);
    if (
      peOffset > buf.length - 6 ||
      buf[peOffset] !== 0x50 ||
      buf[peOffset + 1] !== 0x45 ||
      buf[peOffset + 2] !== 0 ||
      buf[peOffset + 3] !== 0
    ) {
      return { kind: 'pe-invalid' };
    }
    return { kind: 'pe', machine: buf.readUInt16LE(peOffset + 4) };
  }
  if (magicBE === 0x7f454c46) return { kind: 'elf' };
  return { kind: 'unknown' };
}

/**
 * Multi-arch prebuild packages (sharp, prebuilds/ dirs, ...) legitimately ship
 * binaries for SEVERAL platforms/arches side by side and pick one at runtime.
 * Their paths self-describe the payload (e.g. @img/sharp-darwin-x64/...).
 * Policy:
 *   - path is labeled  → binary must match its OWN label (catches corruption
 *     like a PE file sitting in a darwin-arm64 dir), target is irrelevant.
 *   - path is unlabeled (better_sqlite3/build/Release/...) → binary must
 *     strictly match the build target platform + arch.
 */
function labelFromPath(file) {
  const p = file.toLowerCase();
  const platform = /darwin|macos/.test(p)
    ? 'darwin'
    : /win32|windows/.test(p)
      ? 'win32'
      : /linux/.test(p)
        ? 'linux'
        : null;
  if (!platform) return null;
  const archMatch = p.match(/arm64|x64|x86_64|ia32|armv7l/);
  const arch = archMatch ? (archMatch[0] === 'x86_64' ? 'x64' : archMatch[0]) : null;
  return { platform, arch };
}

function checkAgainst(info, platform, archName) {
  if (platform === 'darwin') {
    if (info.kind === 'macho-fat') return null; // universal — fine on any mac
    if (info.kind !== 'macho') {
      return `expected Mach-O for macOS, found ${info.kind.toUpperCase()}`;
    }
    if (!archName || archName === 'universal') return null;
    const expected = MACHO_CPUTYPE[archName];
    if (expected !== undefined && info.cputype !== expected) {
      const found =
        Object.keys(MACHO_CPUTYPE).find((k) => MACHO_CPUTYPE[k] === info.cputype) ||
        `cputype 0x${info.cputype.toString(16)}`;
      return `expected Mach-O ${archName}, found Mach-O ${found}`;
    }
    return null;
  }
  if (platform === 'win32') {
    if (info.kind !== 'pe') {
      return `expected Windows PE, found ${info.kind.toUpperCase()}`;
    }
    if (!archName || archName === 'universal') return null;
    const expected = PE_MACHINE[archName];
    if (expected !== undefined && info.machine !== expected) {
      const found =
        Object.keys(PE_MACHINE).find((name) => PE_MACHINE[name] === info.machine) ||
        `machine 0x${info.machine.toString(16)}`;
      return `expected Windows PE ${archName}, found Windows PE ${found}`;
    }
    return null;
  }
  if (platform === 'linux') {
    return info.kind === 'elf' ? null : `expected ELF, found ${info.kind.toUpperCase()}`;
  }
  return null; // unknown platform — don't block
}

function verifyFile(file, relPath, platform, archName) {
  const info = describe(fs.readFileSync(file));

  // Label from the path INSIDE the app only — the absolute output dir
  // (e.g. release/win-arm64-unpacked/) would leak wrong platform/arch tokens.
  const label = labelFromPath(relPath);
  if (label) {
    // Self-labeled prebuild — must match its own label.
    const problem = checkAgainst(info, label.platform, label.arch);
    return problem ? `${problem} (self-labeled prebuild)` : null;
  }
  // Unlabeled — must match the build target strictly.
  return checkAgainst(info, platform, archName);
}

exports.describe = describe;
exports.checkAgainst = checkAgainst;
exports.verifyFile = verifyFile;

exports.default = async function verifyNativeModules(context) {
  const platform = context.electronPlatformName; // 'darwin' | 'win32' | 'linux'
  const archName = ARCH_NAMES[context.arch] || String(context.arch);
  const appOutDir = context.appOutDir;

  const nodeFiles = findNodeFiles(appOutDir).filter(
    (f) => !IGNORED_BASENAMES.has(path.basename(f))
  );
  const failures = [];
  for (const file of nodeFiles) {
    const relPath = path.relative(appOutDir, file);
    const problem = verifyFile(file, relPath, platform, archName);
    if (problem) failures.push(`  ${relPath}: ${problem}`);
  }

  if (failures.length > 0) {
    throw new Error(
      `[verify-native-modules] ${platform}/${archName} pack contains wrong-platform native modules:\n` +
        failures.join('\n') +
        `\n\nFix: run 'npm run rebuild:native' (or a clean 'npm ci') before building. ` +
        `This check exists because beta.20 shipped a Windows DLL inside the arm64 mac app.`
    );
  }
  console.log(
    `[verify-native-modules] OK — ${nodeFiles.length} native module(s) verified for ${platform}/${archName}`
  );
};
