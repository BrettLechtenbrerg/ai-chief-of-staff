const fs = require('node:fs');
const path = require('node:path');

// Runs after packing and native verification, before signing/notarization uploads.
function verifyPersonalPayload(bundle) {
  const root = fs.realpathSync(bundle);
  let files = 0;
  let entries = 0;
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (++entries > 250000) throw new Error('Personal payload inspection limit exceeded');
      const full = path.join(directory, entry.name);
      if (/^\.env(?:\.|$)|\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm|journal))?$|\.(?:jsonl|log)$/i.test(entry.name) || ['.gg', '.git'].includes(entry.name)) {
        throw new Error('Personal payload contains a disallowed private-data/cache file; upload blocked');
      }
      if (entry.isSymbolicLink()) {
        if (!fs.realpathSync(full).startsWith(root + path.sep)) throw new Error('Personal payload symlink escapes bundle; upload blocked');
      } else if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files++;
      else throw new Error('Personal payload contains an unsupported file type');
    }
  }
  walk(root);
  const metadata = path.join(root, 'Contents/Resources/app/package.json');
  if (fs.statSync(metadata).size > 1048576) throw new Error('Packaged metadata exceeds limit');
  const pkg = JSON.parse(fs.readFileSync(metadata, 'utf8'));
  if (pkg.name !== 'ai-chief-of-staff' || pkg.acosUpdatePolicy !== 'personal-local-v1') throw new Error('Personal payload identity/update guard missing');
  for (const file of ['dist/main/update-policy.js', 'dist/main/updater.js', 'dist/finance/worker.js', 'src/finance/migrations/001-initial.sql']) {
    if (!fs.statSync(path.join(root, 'Contents/Resources/app', file)).isFile()) throw new Error('Required personal runtime file missing');
  }
  return { files, entries };
}
module.exports = { verifyPersonalPayload };
