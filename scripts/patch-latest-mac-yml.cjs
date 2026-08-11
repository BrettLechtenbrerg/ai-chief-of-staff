#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ARTIFACT_PATTERN = /^AI-Chief-of-Staff-(.+)-(x64|arm64)(-mac\.zip|\.dmg)$/;
const REQUIRED_VARIANTS = ['x64-mac.zip', 'arm64-mac.zip', 'x64.dmg', 'arm64.dmg'];

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

async function patchMacManifest(releaseDir, expectedTag) {
  const manifestPath = path.join(releaseDir, 'latest-mac.yml');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`[patch-latest-mac-yml] missing updater manifest: ${manifestPath}`);
  }

  const matchedArtifacts = fs
    .readdirSync(releaseDir)
    .map((filename) => ({ filename, match: filename.match(ARTIFACT_PATTERN) }))
    .filter((artifact) => artifact.match);
  const byVariant = new Map(
    matchedArtifacts.map(({ filename, match }) => [
      `${match[2]}${match[3]}`,
      { filename, version: match[1] },
    ])
  );
  const missingVariants = REQUIRED_VARIANTS.filter((variant) => !byVariant.has(variant));
  if (matchedArtifacts.length !== REQUIRED_VARIANTS.length || missingVariants.length > 0) {
    throw new Error(
      `[patch-latest-mac-yml] expected exactly x64/arm64 ZIP and DMG artifacts; missing: ${missingVariants.join(', ') || 'none'}, matched: ${matchedArtifacts.length}`
    );
  }

  const versions = new Set(matchedArtifacts.map(({ match }) => match[1]));
  if (versions.size !== 1) {
    throw new Error('[patch-latest-mac-yml] Mac artifacts do not share one version');
  }
  const version = [...versions][0];
  const normalizedExpectedTag = expectedTag?.replace(/^v/, '');
  if (normalizedExpectedTag && version !== normalizedExpectedTag) {
    throw new Error(
      `[patch-latest-mac-yml] artifact version ${version} does not match tag ${expectedTag}`
    );
  }

  const originalManifest = fs.readFileSync(manifestPath, 'utf8');
  const originalVersion = parseManifestValue(originalManifest, 'version');
  if (originalVersion !== version) {
    throw new Error(
      `[patch-latest-mac-yml] manifest version ${originalVersion || '(missing)'} does not match artifacts ${version}`
    );
  }

  const artifacts = [];
  for (const variant of REQUIRED_VARIANTS) {
    const { filename } = byVariant.get(variant);
    const artifactPath = path.join(releaseDir, filename);
    artifacts.push({
      filename,
      sha512: await hashFile(artifactPath),
      size: fs.statSync(artifactPath).size,
    });
  }

  const primary = artifacts[0];
  const releaseDate =
    parseManifestValue(originalManifest, 'releaseDate') || new Date().toISOString();
  const lines = [`version: ${version}`, 'files:'];
  for (const artifact of artifacts) {
    lines.push(
      `  - url: ${artifact.filename}`,
      `    sha512: ${artifact.sha512}`,
      `    size: ${artifact.size}`
    );
  }
  lines.push(
    `path: ${primary.filename}`,
    `sha512: ${primary.sha512}`,
    `releaseDate: '${releaseDate}'`,
    ''
  );

  const temporaryPath = `${manifestPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, lines.join('\n'), { encoding: 'utf8', mode: 0o644 });
  fs.renameSync(temporaryPath, manifestPath);

  const verifiedManifest = fs.readFileSync(manifestPath, 'utf8');
  const urls = [...verifiedManifest.matchAll(/^\s*- url:\s*(.+)$/gm)].map((match) =>
    match[1].trim()
  );
  if (
    urls.length !== artifacts.length ||
    artifacts.some((artifact, index) => urls[index] !== artifact.filename) ||
    parseManifestValue(verifiedManifest, 'path') !== primary.filename ||
    parseManifestValue(verifiedManifest, 'sha512') !== primary.sha512
  ) {
    throw new Error('[patch-latest-mac-yml] verification failed after atomic manifest write');
  }

  console.log(
    `[patch-latest-mac-yml] OK — verified ${artifacts.length} updater entries against final artifact bytes`
  );
  return { artifacts, manifestPath, version };
}

exports.parseManifestValue = parseManifestValue;
exports.patchMacManifest = patchMacManifest;

if (require.main === module) {
  const releaseDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'release'));
  patchMacManifest(releaseDir, process.argv[3]).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
