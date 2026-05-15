/**
 * Post-build script: adds .js extensions to relative imports in dist/
 * Required because tsc with module:"ES2022" + moduleResolution:"bundler"
 * emits ESM without file extensions, but Node ESM requires them.
 */
const fs = require('fs');
const path = require('path');

const distDir = path.resolve(__dirname, '..', 'dist');

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

// Match: import ... from './foo' or export ... from './foo' (no extension)
// Also handles dynamic import('./foo')
const importRe = /((?:import|export)\s+.*?\s+from\s+['"])(\.\.?\/[^'"]+?)(['"])/g;
const dynamicImportRe = /(import\s*\(\s*['"])(\.\.?\/[^'"]+?)(['"]\s*\))/g;

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  function replacer(match, prefix, specifier, suffix) {
    // Skip if already has extension
    if (/\.\w+$/.test(specifier)) return match;

    const dir = path.dirname(filePath);
    // Check if it's a directory with index.js
    const asDir = path.join(dir, specifier, 'index.js');
    if (fs.existsSync(asDir)) {
      changed = true;
      return `${prefix}${specifier}/index.js${suffix}`;
    }
    // Check if .js file exists
    const asFile = path.join(dir, specifier + '.js');
    if (fs.existsSync(asFile)) {
      changed = true;
      return `${prefix}${specifier}.js${suffix}`;
    }
    return match;
  }

  content = content.replace(importRe, replacer);
  content = content.replace(dynamicImportRe, replacer);

  if (changed) {
    fs.writeFileSync(filePath, content, 'utf8');
  }
}

const files = walk(distDir);
for (const file of files) {
  fixFile(file);
}
console.log(`[fix-esm-imports] Processed ${files.length} files`);
