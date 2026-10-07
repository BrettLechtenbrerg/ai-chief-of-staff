import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Brand content folders ("buckets"): a _brand-profiles/{slug}/profile.json may
 * name a `contentFolder` such as "~/Desktop/TSAI - Total Success AI/Blogs &
 * Social Posts". Profiles are local files but are treated as untrusted input:
 * only a leading "~/" is expanded, and the real path (symlinks resolved) must
 * be an existing directory strictly inside the real ~/Desktop. Anything else
 * returns null so callers fall back to the Desktop inbox folders.
 *
 * Pure Node (no Electron imports) so it stays unit-testable.
 */

/** Subfolder of a content folder that holds daily posting packets. */
export const PACKETS_SUBFOLDER = 'Daily Posting Packets';

function currentHome(): string {
  return process.env.HOME || os.homedir();
}

export function resolveContentFolder(raw: unknown, home: string = currentHome()): string | null {
  if (typeof raw !== 'string' || !raw.startsWith('~/') || raw.includes('\0')) return null;
  const rest = raw.slice(2);
  if (rest.split(/[\\/]+/).some((part) => part === '..' || part === '.')) return null;
  try {
    const desktop = fs.realpathSync.native(path.join(home, 'Desktop'));
    const real = fs.realpathSync.native(path.join(home, rest));
    const relative = path.relative(desktop, real);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    if (!fs.statSync(real).isDirectory()) return null;
    return real;
  } catch {
    return null;
  }
}

/** Profiles root for a given home (default ~/dev/_brand-profiles). */
export function brandProfilesRoot(home: string = currentHome()): string {
  return path.join(home, 'dev', '_brand-profiles');
}

/** Validated content folder for a brand slug, or null (unknown slug, no field, invalid). */
export function getBrandContentFolder(
  brandSlug: string,
  home: string = currentHome(),
  root: string = brandProfilesRoot(home)
): string | null {
  if (typeof brandSlug !== 'string' || !/^[a-z0-9][a-z0-9-]*$/i.test(brandSlug)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, brandSlug, 'profile.json'), 'utf-8')) as unknown;
    if (!raw || typeof raw !== 'object') return null;
    return resolveContentFolder((raw as { contentFolder?: unknown }).contentFolder, home);
  } catch {
    return null;
  }
}

/**
 * Validated shared video folder (`videoFolder` in `<root>/settings.json`), or
 * null when the file, the field or the folder is missing or invalid. Video
 * Studio then falls back to ~/Desktop/Videos.
 */
export function getVideoFolder(
  home: string = currentHome(),
  root: string = brandProfilesRoot(home)
): string | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, 'settings.json'), 'utf-8')) as unknown;
    if (!raw || typeof raw !== 'object') return null;
    return resolveContentFolder((raw as { videoFolder?: unknown }).videoFolder, home);
  } catch {
    return null;
  }
}

/** Every validated content folder across all profiles under `root`. */
export function listBrandContentFolders(
  home: string = currentHome(),
  root: string = brandProfilesRoot(home)
): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const folders = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => getBrandContentFolder(entry.name, home, root))
    .filter((folder): folder is string => folder !== null);
  return [...new Set(folders)];
}

/**
 * First base name ("<base>", "<base> (2)"…) for which none of `<base><suffix>`
 * exists in `dir`, so related files keep one shared name and nothing existing
 * is overwritten.
 */
export function uniqueBaseName(dir: string, base: string, suffixes: readonly string[]): string {
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? base : `${base} (${n})`;
    if (!suffixes.some((suffix) => fs.existsSync(path.join(dir, `${candidate}${suffix}`)))) return candidate;
  }
  throw new Error(`Too many existing files named ${base} in ${dir}`);
}
