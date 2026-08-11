#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const INSTALLER_PATTERN = /^AI-Chief-of-Staff-(.+)-x64-setup\.exe$/;

function parseManifestValue(source, key) {
  const match = source.match(new RegExp(`^${key}:\\s*['\"]?([^'\"\\r\\n]+)['\"]?\\s*$`, 'm'));
  return match?.[1]?.trim() || null;
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    const input = fs.createReadStream(filePath);
    input.on('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('base64')));
  });
}

async function patchWindowsManifest(releaseDir, expectedTag) {
  const manifestPath = path.join(releaseDir, 'latest.yml');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`[patch-latest-windows-yml] missing updater manifest: ${manifestPath}`);
  }

  const installers = fs
    .readdirSync(releaseDir)
    .filter((filename) => INSTALLER_PATTERN.test(filename));
  if (installers.length !== 1) {
    throw new Error(
      `[patch-latest-windows-yml] expected exactly one x64 installer in ${releaseDir}, found ${installers.length}`
    );
  }

  const installer = installers[0];
  const version = installer.match(INSTALLER_PATTERN)[1];
  const normalizedExpectedTag = expectedTag?.replace(/^v/, '');
  if (normalizedExpectedTag && version !== normalizedExpectedTag) {
    throw new Error(
      `[patch-latest-windows-yml] installer version ${version} does not match tag ${expectedTag}`
    );
  }

  const originalManifest = fs.readFileSync(manifestPath, 'utf8');
  const originalVersion = parseManifestValue(originalManifest, 'version');
  if (originalVersion !== version) {
    throw new Error(
      `[patch-latest-windows-yml] manifest version ${originalVersion || '(missing)'} does not match installer ${version}`
    );
  }

  const installerPath = path.join(releaseDir, installer);
  const { size } = fs.statSync(installerPath);
  const sha512 = await hashFile(installerPath);
  const releaseDate =
    parseManifestValue(originalManifest, 'releaseDate') || new Date().toISOString();
  const patchedManifest = [
    `version: ${version}`,
    'files:',
    `  - url: ${installer}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    `path: ${installer}`,
    `sha512: ${sha512}`,
    `releaseDate: '${releaseDate}'`,
    '',
  ].join('\n');

  const temporaryPath = `${manifestPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, patchedManifest, { encoding: 'utf8', mode: 0o644 });
  fs.renameSync(temporaryPath, manifestPath);

  const verifiedManifest = fs.readFileSync(manifestPath, 'utf8');
  const urls = [...verifiedManifest.matchAll(/^\s*- url:\s*(.+)$/gm)].map((match) =>
    match[1].trim()
  );
  if (
    urls.length !== 1 ||
    urls[0] !== installer ||
    parseManifestValue(verifiedManifest, 'path') !== installer ||
    parseManifestValue(verifiedManifest, 'sha512') !== sha512
  ) {
    throw new Error('[patch-latest-windows-yml] verification failed after atomic manifest write');
  }

  console.log(
    `[patch-latest-windows-yml] OK — latest.yml contains only ${installer} (${size} bytes)`
  );
  return { installer, manifestPath, sha512, size, version };
}

exports.parseManifestValue = parseManifestValue;
exports.patchWindowsManifest = patchWindowsManifest;

if (require.main === module) {
  const releaseDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'release'));
  patchWindowsManifest(releaseDir, process.argv[3]).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
