/**
 * Preload ↔ UI Contract Smoke Test
 *
 * Verifies that every `window.pocketAgent.*` call in the UI HTML files
 * maps to an actual path exposed by the preload script.
 *
 * This catches the exact class of bug where the preload API is restructured
 * (e.g. flat → namespaced) but an HTML file still references the old shape,
 * or vice-versa.  The test is platform-independent — it runs on macOS CI
 * but catches issues that would manifest on any OS (Windows, Linux, etc.).
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Parse the preload source to extract the `namespace.method` paths
 * from the contextBridge.exposeInMainWorld call.
 *
 * Uses the TypeScript `declare global` block which is cleaner to parse
 * and must stay in sync with the runtime object (enforced by tsc).
 *
 * Looks for the pattern:
 *   pocketAgent: {
 *     namespace: {
 *       method: (...) => ...;
 *     };
 *   }
 */
function parsePreloadAPI(source: string): Set<string> {
  const paths = new Set<string>();

  // Strategy: find top-level namespaces and their methods from the
  // contextBridge.exposeInMainWorld object literal.
  //
  // We match lines like:
  //   agent: {           → start of 'agent' namespace
  //     send: (...)      → method 'agent.send'
  //   },                 → end of namespace
  //
  // This is simpler and more reliable than a full parser because
  // the preload follows a strict 2-level structure.

  // Find the contextBridge call
  const cbMatch = source.match(
    /contextBridge\.exposeInMainWorld\(\s*['"]pocketAgent['"]\s*,\s*\{/
  );
  if (!cbMatch || cbMatch.index === undefined) {
    throw new Error('Could not find contextBridge.exposeInMainWorld call in preload');
  }

  const startIdx = cbMatch.index + cbMatch[0].length;

  // Extract the full object body by matching braces
  let depth = 1;
  let endIdx = startIdx;
  for (let i = startIdx; i < source.length && depth > 0; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    endIdx = i;
  }

  const objectBody = source.slice(startIdx, endIdx);

  // Parse with a two-pass approach:
  // 1. Split into top-level namespace blocks (depth-1 properties whose value is '{')
  // 2. Within each namespace block, find method names (properties at depth 2)

  let currentNamespace = '';
  let braceDepth = 0;

  for (const line of objectBody.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

    // Count braces on this line (outside strings)
    let opens = 0;
    let closes = 0;
    let inString = false;
    let strChar = '';
    for (const ch of trimmed) {
      if (inString) {
        if (ch === strChar) inString = false;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        inString = true;
        strChar = ch;
        continue;
      }
      if (ch === '{') opens++;
      if (ch === '}') closes++;
    }

    // Detect namespace start: `name: {` at depth 0
    if (braceDepth === 0 && opens > closes) {
      const nsMatch = trimmed.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:\s*\{/);
      if (nsMatch) {
        currentNamespace = nsMatch[1];
      }
    }

    // Detect method/property at depth 1 (inside a namespace)
    if (braceDepth === 1 && currentNamespace) {
      // Match: `methodName: (args) =>` or `methodName: ipcRenderer.invoke(...)`
      // But NOT parameter-like lines inside arrow function bodies
      const methodMatch = trimmed.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:\s*(.)/);
      if (methodMatch) {
        const name = methodMatch[1];
        const nextChar = methodMatch[2];
        // Accept if followed by '(' (arrow fn params), a letter (ipcRenderer, process, etc.)
        // Reject if followed by '{' (sub-object) or if the name looks like a parameter
        // (parameters won't appear at the start of a line at depth 1 with `:` after them
        // in well-formatted code, but filter out common false positives)
        // Skip common false positives: parameter/type names that appear on
        // their own line inside multi-line function signatures
        const falsePositiveNames = new Set([
          'callback', '_event', 'listener', 'type', 'status',
        ]);
        const isArrowOrCall = nextChar === '(' || /[a-zA-Z_$]/.test(nextChar);
        if (isArrowOrCall && !falsePositiveNames.has(name)) {
          paths.add(`${currentNamespace}.${name}`);
        }
      }
    }

    braceDepth += opens - closes;

    // When we return to depth 0, we've left the namespace
    if (braceDepth === 0) {
      currentNamespace = '';
    }
  }

  return paths;
}

/**
 * Extract all `window.pocketAgent.X.Y` paths from HTML source.
 * Returns unique dotted paths (without 'window.pocketAgent.' prefix).
 * Handles optional chaining (`?.`).
 */
function extractUIAPICalls(html: string): Set<string> {
  const calls = new Set<string>();

  const regex =
    /window\.pocketAgent\??\.([a-zA-Z_$][a-zA-Z0-9_$]*)\??\.([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    calls.add(`${match[1]}.${match[2]}`);
  }

  return calls;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Preload ↔ UI API Contract', () => {
  const preloadPath = path.resolve(__dirname, '../../src/main/preload.ts');
  const uiDir = path.resolve(__dirname, '../../ui');

  const preloadSource = fs.readFileSync(preloadPath, 'utf-8');
  const preloadAPI = parsePreloadAPI(preloadSource);

  // Sanity: verify parser output
  it('parses preload API with a reasonable number of endpoints', () => {
    expect(preloadAPI.size).toBeGreaterThan(30);
    // Spot-check known paths
    expect(preloadAPI.has('agent.send')).toBe(true);
    expect(preloadAPI.has('agent.stop')).toBe(true);
    expect(preloadAPI.has('agent.restart')).toBe(true);
    expect(preloadAPI.has('settings.getAll')).toBe(true);
    expect(preloadAPI.has('settings.get')).toBe(true);
    expect(preloadAPI.has('settings.set')).toBe(true);
    expect(preloadAPI.has('app.openSettings')).toBe(true);
    expect(preloadAPI.has('app.getPlatform')).toBe(true);
    expect(preloadAPI.has('themes.list')).toBe(true);
    expect(preloadAPI.has('themes.getSkin')).toBe(true);
    expect(preloadAPI.has('events.onModelChanged')).toBe(true);
    expect(preloadAPI.has('sessions.list')).toBe(true);
    expect(preloadAPI.has('updater.checkForUpdates')).toBe(true);
  });

  // Core test: every API call in UI files must exist in preload
  const htmlFiles = fs.readdirSync(uiDir).filter((f) => f.endsWith('.html'));

  for (const htmlFile of htmlFiles) {
    it(`${htmlFile}: all pocketAgent calls match preload API`, () => {
      const html = fs.readFileSync(path.join(uiDir, htmlFile), 'utf-8');
      const uiCalls = extractUIAPICalls(html);

      if (uiCalls.size === 0) return; // file doesn't use the API

      const missingPaths: string[] = [];
      for (const apiPath of uiCalls) {
        if (!preloadAPI.has(apiPath)) {
          missingPaths.push(apiPath);
        }
      }

      if (missingPaths.length > 0) {
        expect.fail(
          `${htmlFile} references ${missingPaths.length} API path(s) not in preload:\n` +
            missingPaths.map((p) => `  • window.pocketAgent.${p}`).join('\n') +
            '\n\nAvailable preload paths:\n' +
            [...preloadAPI]
              .sort()
              .map((p) => `  ✓ ${p}`)
              .join('\n')
        );
      }
    });
  }

  // Detect stale flat API calls (pre-namespace era: window.pocketAgent.send())
  for (const htmlFile of htmlFiles) {
    it(`${htmlFile}: no flat (non-namespaced) pocketAgent calls`, () => {
      const html = fs.readFileSync(path.join(uiDir, htmlFile), 'utf-8');

      // Match window.pocketAgent.X( where X is NOT a known namespace
      // This catches old-style flat calls like window.pocketAgent.send(...)
      const knownNamespaces = new Set([
        'agent', 'attachments', 'sessions', 'facts', 'soul', 'dailyLogs',
        'app', 'customize', 'location', 'cron', 'settings', 'validate',
        'auth', 'themes', 'chat', 'commands', 'updater', 'browser',
        'ios', 'shell', 'permissions', 'events',
      ]);

      const flatCallRegex = /window\.pocketAgent\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
      const flatCalls: string[] = [];
      let match;
      while ((match = flatCallRegex.exec(html)) !== null) {
        const name = match[1];
        // If it's not a namespace name, it's a flat call (old API)
        if (!knownNamespaces.has(name)) {
          flatCalls.push(name);
        }
      }

      if (flatCalls.length > 0) {
        const unique = [...new Set(flatCalls)];
        expect.fail(
          `${htmlFile} uses ${unique.length} flat (non-namespaced) pocketAgent call(s):\n` +
            unique.map((n) => `  • window.pocketAgent.${n}()`).join('\n') +
            '\n\nThese should be updated to use the namespaced API (e.g. window.pocketAgent.agent.send())'
        );
      }
    });
  }

  // Informational: warn about preload endpoints not used by any UI file
  it('preload API has no orphan endpoints (warning only)', () => {
    const allUICalls = new Set<string>();
    for (const htmlFile of htmlFiles) {
      const html = fs.readFileSync(path.join(uiDir, htmlFile), 'utf-8');
      for (const call of extractUIAPICalls(html)) {
        allUICalls.add(call);
      }
    }

    const unusedPaths: string[] = [];
    for (const apiPath of preloadAPI) {
      if (!allUICalls.has(apiPath)) {
        unusedPaths.push(apiPath);
      }
    }

    if (unusedPaths.length > 0) {
      console.warn(
        `[preload-ui-contract] ${unusedPaths.length} preload endpoint(s) not referenced by any UI file:\n` +
          unusedPaths.map((p) => `  ⚠ ${p}`).join('\n')
      );
    }
  });
});
