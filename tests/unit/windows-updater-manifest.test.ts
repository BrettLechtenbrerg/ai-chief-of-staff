import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const patcher = require('../../scripts/patch-latest-windows-yml.cjs') as {
  patchWindowsManifest(
    releaseDir: string,
    expectedTag?: string
  ): Promise<{ installer: string; sha512: string; size: number; version: string }>;
};

const temporaryDirectories: string[] = [];
const publicationWorkflow = fs.readFileSync(
  path.join(process.cwd(), '.github/workflows/publish-existing-release.yml'),
  'utf8'
);
const packageConfig = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
) as {
  build: { win: { target: Array<{ arch: string[] }> } };
};

function createReleaseDirectory(): string {
  const releaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acos-windows-manifest-'));
  temporaryDirectories.push(releaseDir);
  return releaseDir;
}

function writeStaleManifest(releaseDir: string): void {
  fs.writeFileSync(
    path.join(releaseDir, 'latest.yml'),
    [
      'version: 1.0.0-beta.23',
      'files:',
      '  - url: AI-Chief-of-Staff-1.0.0-beta.23-setup.exe',
      '    sha512: stale-universal',
      '    size: 100',
      '  - url: AI-Chief-of-Staff-1.0.0-beta.23-x64-setup.exe',
      '    sha512: stale-x64',
      '    size: 50',
      '  - url: AI-Chief-of-Staff-1.0.0-beta.23-arm64-setup.exe',
      '    sha512: stale-arm64',
      '    size: 40',
      'path: AI-Chief-of-Staff-1.0.0-beta.23-setup.exe',
      'sha512: stale-universal',
      "releaseDate: '2026-08-11T14:03:31.437Z'",
      '',
    ].join('\n')
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Windows x64 updater manifest', () => {
  it('removes unpublished universal and ARM64 assets and hashes the signed x64 installer', async () => {
    const releaseDir = createReleaseDirectory();
    const installer = 'AI-Chief-of-Staff-1.0.0-beta.23-x64-setup.exe';
    const installerBytes = Buffer.from('signed x64 installer fixture');
    fs.writeFileSync(path.join(releaseDir, installer), installerBytes);
    writeStaleManifest(releaseDir);

    const result = await patcher.patchWindowsManifest(releaseDir, 'v1.0.0-beta.23');
    const manifest = fs.readFileSync(path.join(releaseDir, 'latest.yml'), 'utf8');
    const expectedHash = crypto.createHash('sha512').update(installerBytes).digest('base64');

    expect(result).toMatchObject({
      installer,
      sha512: expectedHash,
      size: installerBytes.length,
      version: '1.0.0-beta.23',
    });
    expect(manifest.match(/- url:/g)).toHaveLength(1);
    expect(manifest).toContain(`- url: ${installer}`);
    expect(manifest).toContain(`path: ${installer}`);
    expect(manifest).toContain(`sha512: ${expectedHash}`);
    expect(manifest).not.toContain('arm64-setup.exe');
    expect(manifest).not.toContain('beta.23-setup.exe');
  });

  it('fails closed when the requested tag does not match the installer', async () => {
    const releaseDir = createReleaseDirectory();
    fs.writeFileSync(
      path.join(releaseDir, 'AI-Chief-of-Staff-1.0.0-beta.23-x64-setup.exe'),
      'installer'
    );
    writeStaleManifest(releaseDir);

    await expect(patcher.patchWindowsManifest(releaseDir, 'v1.0.0-beta.24')).rejects.toThrow(
      'does not match tag'
    );
  });

  it('fails closed when no x64 installer is present', async () => {
    const releaseDir = createReleaseDirectory();
    writeStaleManifest(releaseDir);

    await expect(patcher.patchWindowsManifest(releaseDir)).rejects.toThrow(
      'expected exactly one x64 installer'
    );
  });
});

describe('existing tag publication gate', () => {
  it('packages only Windows x64 and requires both real-device acceptance checks', () => {
    expect(packageConfig.build.win.target.every((target) => target.arch.join(',') === 'x64')).toBe(
      true
    );
    expect(publicationWorkflow).toContain('inputs.mac_acceptance_confirmed &&');
    expect(publicationWorkflow).toContain('inputs.windows_acceptance_confirmed');
    expect(publicationWorkflow).toContain('Prove source run built the exact immutable tag');
    expect(publicationWorkflow).toContain('patch-latest-windows-yml.cjs release');
    expect(publicationWorkflow).toContain('environment: release');
  });
});
