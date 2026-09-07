import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../', import.meta.url));
const pkg = require('../../package.json');
const personal = require('../../build/personal.cjs');
const { createTransformer } = require('app-builder-lib/out/fileTransformer.js');

describe('personal packaging contract (inert; no packaging)', () => {
  it('embeds the durable marker using the installed builder package transformer, without modifying source', async () => {
    const source = readFileSync(join(root, 'package.json'), 'utf8');
    const transform = createTransformer(root, personal, personal.extraMetadata);
    const packaged = JSON.parse(await transform(join(root, 'package.json')));
    expect(packaged.acosUpdatePolicy).toBe('personal-local-v1');
    expect(packaged.acosInstallValidation).toBe(1);
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(source);
    expect(pkg).not.toHaveProperty('acosUpdatePolicy');
    expect(pkg.build.extraMetadata).toBeUndefined();
    const beta = JSON.parse(await createTransformer(root, pkg.build, pkg.build.extraMetadata)(join(root, 'package.json')));
    expect(beta).not.toHaveProperty('acosUpdatePolicy');
  });

  it('disables publishing, isolates output, and preserves every signing/verification hook', () => {
    expect(pkg.scripts['dist:personal']).toBe('npm run build && electron-builder --mac --config build/personal.cjs --publish never');
    expect(personal.publish).toBeNull();
    expect(personal.directories.output).toBe('release/personal');
    expect(personal.mac).toEqual(pkg.build.mac);
    expect(personal.mac.identity).toBe('Brett Lechtenberg (2HQTY95NHD)');
    expect(personal.mac.hardenedRuntime).toBe(true);
    expect(personal.mac.notarize).toBe(true);
    expect(personal.afterPack).toBe(pkg.build.afterPack);
    expect(personal.afterAllArtifactBuild).toBe(pkg.build.afterAllArtifactBuild);
    for (const [name, command] of Object.entries(pkg.scripts)) {
      if (name !== 'dist:personal') expect(command).not.toContain('personal.cjs');
    }
  });

  it('gates automatic services and reports the temporary mode without persisting settings', () => {
    const main = readFileSync(join(root, 'src/main/index.ts'), 'utf8');
    expect(main).toContain('const validationStartup = isInstallValidationStartup();');
    expect(main).toMatch(/if \(!validationStartup\) \{\s*getMCPManager\(\)/);
    expect(main).toContain("if (!validationStartup && SettingsManager.getBoolean('scheduler.enabled'))");
    expect(main).toContain("!validationStartup && SettingsManager.getBoolean('telegram.enabled')");
    expect(main).toContain("!validationStartup && SettingsManager.getBoolean('browser.enabled')");
    expect(main).toMatch(/if \(!validationStartup\) \{\s*refreshDiscoveredModels\(\)/);
    for (const event of ['resume', 'unlock-screen']) {
      expect(main).toContain(`powerMonitor.on('${event}', () => {\n      if (validationStartup) return;`);
    }
    expect(main).toContain('validationStartup ? configuredModel : resolveAndPersistModel()');
    expect(main).toContain('const startupHealth = {\n  validationStartup,');
    expect(main).toContain('Automatic services are paused for this launch.');
    const installer = readFileSync(join(root, 'scripts/install-local.cjs'), 'utf8');
    expect(installer).toContain("env: { ...process.env, ACOS_INSTALL_VALIDATION: '1' }");
    expect(installer).toContain('return health.validationStartup === true &&');
  });

  it('guards the main startup route independently of the updater entrypoint', () => {
    const main = readFileSync(join(root, 'src/main/index.ts'), 'utf8');
    expect(main).toMatch(/if \(app\.isPackaged && getUpdateBlockReason\(\) === null\) \{\s*initializeUpdater\(\)/);
  });
});
