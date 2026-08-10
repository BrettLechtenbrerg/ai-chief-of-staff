import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, '../..');
const uiDir = path.join(projectRoot, 'ui');
const htmlFiles = fs
  .readdirSync(uiDir)
  .filter((name) => name.endsWith('.html'))
  .sort();

function readHtml(name: string): string {
  return fs.readFileSync(path.join(uiDir, name), 'utf8');
}

describe('renderer executable sources', () => {
  it('does not allow or load remote executable code', () => {
    for (const name of htmlFiles) {
      const html = readHtml(name);
      expect(html, `${name} must not reference jsDelivr`).not.toMatch(/cdn\.jsdelivr\.net/i);
      expect(html, `${name} must not load a remote script`).not.toMatch(
        /<script\b[^>]*\bsrc=["']https?:\/\//i
      );
      expect(html, `${name} must not import a remote module`).not.toMatch(
        /\b(?:import|export)\s+[\s\S]*?\bfrom\s*["']https?:\/\//i
      );

      const csp = html.match(
        /<meta\s+http-equiv=["']Content-Security-Policy["']\s+content=(["'])(.*?)\1/i
      )?.[2];
      expect(csp, `${name} must define CSP`).toBeTruthy();
      const scriptPolicy = csp
        ?.split(';')
        .map((directive) => directive.trim())
        .find((directive) => directive.startsWith('script-src'));
      expect(scriptPolicy, `${name} must define script-src`).toBeTruthy();
      expect(scriptPolicy, `${name} script-src must remain local`).not.toMatch(/https?:|\*/i);
    }
  });

  it('resolves every local script and stylesheet from packaged inputs', () => {
    for (const name of htmlFiles) {
      const html = readHtml(name);
      const assetPattern = /<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["'][^>]*>/gi;
      for (const match of html.matchAll(assetPattern)) {
        const source = match[1];
        if (/^(?:https?:|data:|#)/i.test(source)) continue;
        expect(
          fs.existsSync(path.resolve(uiDir, source)),
          `${name} references missing local asset ${source}`
        ).toBe(true);
      }
    }
  });

  it('pins renderer dependencies to audited versions', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
    ) as { dependencies: Record<string, string> };

    expect(packageJson.dependencies).toMatchObject({
      '@formkit/auto-animate': '0.9.0',
      dompurify: '3.4.13',
      marked: '18.0.9',
      notyf: '3.10.0',
    });
  });
});
