import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { parseOffice } from 'officeparser';

const temporaryFiles: string[] = [];

afterEach(() => {
  for (const file of temporaryFiles.splice(0)) fs.rmSync(file, { force: true });
});

describe('security-upgraded document and image dependencies', () => {
  it('extracts text through officeparser 7 AST output', async () => {
    const rtfPath = path.join(os.tmpdir(), `acos-office-${Date.now()}.rtf`);
    temporaryFiles.push(rtfPath);
    fs.writeFileSync(rtfPath, '{\\rtf1\\ansi Patched office parser smoke test}');
    const ast = await parseOffice(rtfPath);
    expect(ast.toText()).toContain('Patched office parser smoke test');
  });

  it('encodes and decodes an image through patched sharp/libvips', async () => {
    const png = await sharp({
      create: { width: 2, height: 3, channels: 4, background: '#2468ac' },
    })
      .png()
      .toBuffer();
    expect(await sharp(png).metadata()).toMatchObject({ width: 2, height: 3, format: 'png' });
  });

  it('loads the patched PDF.js legacy Node entry point', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    expect(pdfjs.version).toBe('6.2.108');
    expect(pdfjs.getDocument).toBeTypeOf('function');
  });

  it('resolves only patched production package versions', () => {
    const lockfile = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package-lock.json'), 'utf8')
    );
    expect(lockfile.packages['node_modules/pdfjs-dist'].version).toBe('6.2.108');
    expect(lockfile.packages['node_modules/sharp'].version).toBe('0.35.3');
    expect(lockfile.packages['node_modules/officeparser'].version).toBe('7.5.1');
    expect(lockfile.packages['node_modules/officeparser/node_modules/pdfjs-dist']).toBeUndefined();
  });
});
