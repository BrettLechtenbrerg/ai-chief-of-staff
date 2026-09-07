// Reusable personal packaging contract. Do not add this marker to source metadata.
// Keep all normal signing, notarization, native verification and artifact hooks.
const { build } = require('../package.json');
module.exports = {
  ...build,
  publish: null,
  directories: { ...build.directories, output: 'release/personal' },
  extraMetadata: { ...build.extraMetadata, acosUpdatePolicy: 'personal-local-v1', acosInstallValidation: 1 },
};
