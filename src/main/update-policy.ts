import { app } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Temporary installer launch; never persists service settings or enables updates. */
export function isInstallValidationStartup(requested = process.env.ACOS_INSTALL_VALIDATION): boolean {
  if (requested === undefined) return false;
  if (requested !== '1' || getUpdateBlockReason() !== 'Updates disabled for this personal local build') {
    throw new Error('Install validation requires a verified personal build and explicit mode');
  }
  return true;
}

/** Durable packaged metadata, never a user setting or a process environment flag. */
export function getUpdateBlockReason(): string | null {
  try {
    const metadata: unknown = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8'));
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return 'Updates disabled: invalid build metadata';
    }
    if (!Object.prototype.hasOwnProperty.call(metadata, 'acosUpdatePolicy')) return null;
    const marker = (metadata as Record<string, unknown>).acosUpdatePolicy;
    return marker === 'personal-local-v1'
      ? 'Updates disabled for this personal local build'
      : 'Updates disabled: unknown or corrupt build update policy';
  } catch {
    return 'Updates disabled: build metadata could not be verified';
  }
}
