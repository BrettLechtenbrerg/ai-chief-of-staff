#!/usr/bin/env node
/**
 * Post-build patcher for release/latest-mac.yml.
 *
 * Why this exists:
 * electron-builder writes `latest-mac.yml` AFTER our `afterAllArtifactBuild`
 * hook returns — clobbering whatever the hook patched. Three releases shipped
 * with stale DMG sha512/size as a result. The permanent fix is to run the
 * same patcher AGAIN, as a separate process, AFTER electron-builder fully
 * exits. That's this script.
 *
 * Wired into `dist:signed` so it always runs.
 *
 * What it does:
 * 1. Read release/latest-mac.yml.
 * 2. For every `.dmg` artifact in release/, recompute size + sha512 from the
 *    bytes on disk (which reflect the stapled state).
 * 3. Patch entries in `files:[]` whose `url` matches a DMG filename.
 * 4. Patch the top-level `path:` + `sha512:` (the "primary" download).
 * 5. Write the YAML back if anything changed. Verify by re-reading and
 *    asserting every patched entry's sha512 matches the file on disk.
 *
 * Safe to run repeatedly — it's idempotent and exits 0 with a no-op message
 * if the YAML is already correct.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yaml = require('js-yaml');

const releaseDir = path.join(__dirname, '..', 'release');
const yamlPath = path.join(releaseDir, 'latest-mac.yml');

if (!fs.existsSync(yamlPath)) {
  console.log(`[patch-latest-mac-yml] ${yamlPath} not found — nothing to patch.`);
  process.exit(0);
}

const doc = yaml.load(fs.readFileSync(yamlPath, 'utf8'));

// Build lookup: filename -> { size, sha512 } from actual DMG bytes on disk.
const dmgs = fs
  .readdirSync(releaseDir)
  .filter((f) => f.endsWith('.dmg'))
  .map((f) => {
    const buf = fs.readFileSync(path.join(releaseDir, f));
    return {
      filename: f,
      size: buf.length,
      sha512: crypto.createHash('sha512').update(buf).digest('base64'),
    };
  });

if (dmgs.length === 0) {
  console.log('[patch-latest-mac-yml] no .dmg files in release/ — nothing to patch.');
  process.exit(0);
}

const updates = new Map(dmgs.map((d) => [d.filename, d]));

let changed = 0;
const patched = new Set();

// Patch entries in `files:` array.
if (Array.isArray(doc.files)) {
  for (const entry of doc.files) {
    const u = entry && entry.url && updates.get(entry.url);
    if (!u) continue;
    if (entry.sha512 !== u.sha512 || entry.size !== u.size) {
      entry.sha512 = u.sha512;
      entry.size = u.size;
      changed++;
    }
    patched.add(entry.url);
  }
}

// Patch top-level `path:` + `sha512:` (primary download).
if (doc.path && updates.has(doc.path)) {
  const u = updates.get(doc.path);
  if (doc.sha512 !== u.sha512) {
    doc.sha512 = u.sha512;
    changed++;
  }
  patched.add('(top-level path: ' + doc.path + ')');
}

if (changed === 0) {
  console.log('[patch-latest-mac-yml] YAML already matches stapled bytes — no changes needed.');
  process.exit(0);
}

fs.writeFileSync(
  yamlPath,
  yaml.dump(doc, { lineWidth: -1, noRefs: true, quotingType: "'" }),
);

console.log(`[patch-latest-mac-yml] patched ${changed} field(s) in latest-mac.yml:`);
for (const f of patched) console.log(`  ${f}`);

// Verify: re-read the YAML and assert every patched entry matches disk.
const verify = yaml.load(fs.readFileSync(yamlPath, 'utf8'));
let verifyFailed = false;

const checks = [];
if (Array.isArray(verify.files)) {
  for (const entry of verify.files) {
    if (entry && entry.url && updates.has(entry.url)) {
      const u = updates.get(entry.url);
      checks.push({ label: entry.url, got: entry.sha512, want: u.sha512 });
    }
  }
}
if (verify.path && updates.has(verify.path)) {
  const u = updates.get(verify.path);
  checks.push({ label: '(top-level)', got: verify.sha512, want: u.sha512 });
}

for (const c of checks) {
  if (c.got !== c.want) {
    console.error(`[patch-latest-mac-yml] VERIFY FAIL for ${c.label}: got ${c.got}, want ${c.want}`);
    verifyFailed = true;
  }
}

if (verifyFailed) {
  console.error('[patch-latest-mac-yml] verification failed — aborting.');
  process.exit(1);
}

console.log(`[patch-latest-mac-yml] verified ${checks.length} sha512 entries match disk bytes.`);
