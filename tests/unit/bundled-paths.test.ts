/**
 * Unit tests for src/mcp/bundled-paths.ts.
 *
 * Verifies vendor-path resolution in dev mode (against the real on-disk
 * `vendor/` tree) and in simulated packaged mode (against a tmp dir
 * laid out like `Contents/Resources/vendor/`).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it, afterEach } from 'vitest';
import {
  resolveVendorRoot,
  resolveFloServerPath,
  resolveGhlMainPath,
  resolveGhlRequirementsPath,
  VENDOR_SUBDIRS,
} from '../../src/mcp/bundled-paths';

const PROJECT_ROOT = path.resolve(__dirname, '../..');

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
});

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundled-paths-test-'));
  tempDirs.push(dir);
  return dir;
}

function makeFakeBundle(): { resourcesPath: string } {
  const root = tmp();
  // Mimic Contents/Resources/vendor/...
  for (const id of Object.keys(VENDOR_SUBDIRS.flo.servers) as Array<keyof typeof VENDOR_SUBDIRS.flo.servers>) {
    const abs = path.join(root, 'vendor', VENDOR_SUBDIRS.flo.servers[id]);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '// stub\n');
  }
  const ghlMain = path.join(root, 'vendor', VENDOR_SUBDIRS.ghl.main);
  const ghlReq = path.join(root, 'vendor', VENDOR_SUBDIRS.ghl.requirements);
  fs.mkdirSync(path.dirname(ghlMain), { recursive: true });
  fs.writeFileSync(ghlMain, '# stub\n');
  fs.writeFileSync(ghlReq, 'httpx\n');
  return { resourcesPath: root };
}

describe('bundled-paths', () => {
  describe('dev mode (isPackaged=false)', () => {
    const deps = { isPackaged: false, resourcesPath: '', projectRoot: PROJECT_ROOT };

    it('resolveVendorRoot points at <projectRoot>/vendor', () => {
      expect(resolveVendorRoot(deps)).toBe(path.join(PROJECT_ROOT, 'vendor'));
    });

    it('resolves each Flo server against the real vendor tree', () => {
      for (const id of ['gmail', 'calendar', 'docs', 'bookmarks'] as const) {
        const p = resolveFloServerPath(deps, id);
        expect(fs.existsSync(p)).toBe(true);
        expect(p.endsWith(`${id}${path.sep}index.js`)).toBe(true);
      }
    });

    it('resolves the GHL main.py against the real vendor tree', () => {
      const p = resolveGhlMainPath(deps);
      expect(fs.existsSync(p)).toBe(true);
      expect(p.endsWith('main.py')).toBe(true);
    });
  });

  describe('packaged mode (isPackaged=true)', () => {
    it('resolveVendorRoot points at <resourcesPath>/vendor', () => {
      const { resourcesPath } = makeFakeBundle();
      const deps = { isPackaged: true, resourcesPath, projectRoot: '/should/be/ignored' };
      expect(resolveVendorRoot(deps)).toBe(path.join(resourcesPath, 'vendor'));
    });

    it('resolves all 4 Flo servers from the fake bundle', () => {
      const { resourcesPath } = makeFakeBundle();
      const deps = { isPackaged: true, resourcesPath, projectRoot: '/ignored' };
      for (const id of ['gmail', 'calendar', 'docs', 'bookmarks'] as const) {
        const p = resolveFloServerPath(deps, id);
        expect(p.startsWith(path.join(resourcesPath, 'vendor'))).toBe(true);
        expect(fs.existsSync(p)).toBe(true);
      }
    });

    it('resolveGhlRequirementsPath does not require the file to exist', () => {
      const { resourcesPath } = makeFakeBundle();
      const deps = { isPackaged: true, resourcesPath, projectRoot: '/ignored' };
      // requirements.txt exists in fake bundle.
      expect(fs.existsSync(resolveGhlRequirementsPath(deps))).toBe(true);
    });
  });

  describe('error surface', () => {
    it('throws a corrupt-install error when a Flo server is missing', () => {
      const empty = tmp();
      const deps = { isPackaged: true, resourcesPath: empty, projectRoot: '/ignored' };
      expect(() => resolveFloServerPath(deps, 'gmail')).toThrow(/corrupted|reinstall/i);
    });

    it('throws a corrupt-install error when GHL main.py is missing', () => {
      const empty = tmp();
      const deps = { isPackaged: true, resourcesPath: empty, projectRoot: '/ignored' };
      expect(() => resolveGhlMainPath(deps)).toThrow(/corrupted|reinstall/i);
    });
  });
});
