import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const patcher = require('../../scripts/patch-latest-mac-yml.cjs') as {
  patchMacManifest(
    releaseDir: string,
    expectedTag?: string
  ): Promise<{
    artifacts: Array<{ filename: string; sha512: string; size: number }>;
    version: string;
  }>;
};

const temporaryDirectories: string[] = [];
const artifactNames = [
  'AI-Chief-of-Staff-1.0.0-beta.23-x64-mac.zip',
  'AI-Chief-of-Staff-1.0.0-beta.23-arm64-mac.zip',
  'AI-Chief-of-Staff-1.0.0-beta.23-x64.dmg',
  'AI-Chief-of-Staff-1.0.0-beta.23-arm64.dmg',
];

function createReleaseDirectory(): string {
  const releaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acos-mac-manifest-'));
  temporaryDirectories.push(releaseDir);
  fs.writeFileSync(
    path.join(releaseDir, 'latest-mac.yml'),
    [
      'version: 1.0.0-beta.23',
      'files:',
      ...artifactNames.flatMap((filename) => [
        `  - url: ${filename}`,
        '    sha512: stale',
        '    size: 1',
      ]),
      `path: ${artifactNames[0]}`,
      'sha512: stale',
      "releaseDate: '2026-08-11T14:13:51.118Z'",
      '',
    ].join('\n')
  );
  return releaseDir;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('macOS updater manifest', () => {
  it('rehashes every final ZIP and stapled DMG byte and preserves the x64 ZIP primary', async () => {
    const releaseDir = createReleaseDirectory();
    for (const [index, filename] of artifactNames.entries()) {
      fs.writeFileSync(path.join(releaseDir, filename), `final signed artifact ${index}`);
    }

    const result = await patcher.patchMacManifest(releaseDir, 'v1.0.0-beta.23');
    const manifest = fs.readFileSync(path.join(releaseDir, 'latest-mac.yml'), 'utf8');

    expect(result.version).toBe('1.0.0-beta.23');
    expect(result.artifacts).toHaveLength(4);
    expect(manifest.match(/- url:/g)).toHaveLength(4);
    expect(manifest).toContain(`path: ${artifactNames[0]}`);
    for (const [index, filename] of artifactNames.entries()) {
      const bytes = Buffer.from(`final signed artifact ${index}`);
      const sha512 = crypto.createHash('sha512').update(bytes).digest('base64');
      expect(manifest).toContain(`- url: ${filename}`);
      expect(manifest).toContain(`sha512: ${sha512}`);
      expect(manifest).toContain(`size: ${bytes.length}`);
    }
  });

  it('fails closed when an architecture artifact is missing', async () => {
    const releaseDir = createReleaseDirectory();
    for (const filename of artifactNames.slice(0, -1)) {
      fs.writeFileSync(path.join(releaseDir, filename), 'artifact');
    }

    await expect(patcher.patchMacManifest(releaseDir)).rejects.toThrow('arm64.dmg');
  });
});
