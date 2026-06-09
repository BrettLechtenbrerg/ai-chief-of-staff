import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Reader for the ~/dev/_brand-profiles publishing profiles. Each subfolder
 * with a profile.json describes WHERE a brand's content publishes (site repo,
 * blog backend, content/image dirs, URL templates). In-app brands link to a
 * profile via `brands.profile_slug`; the Content Writer recipe uses the
 * linked profile to publish approved posts into the brand's site repo.
 *
 * Pure Node (fs/path/os, no Electron imports) so it stays unit-testable.
 */

/** Root holding the per-brand profile.json files (single source of truth). */
const PROFILES_ROOT = path.join(os.homedir(), 'dev', '_brand-profiles');

/** The publish-relevant slice of a _brand-profiles/{slug}/profile.json. */
export interface PublishProfile {
  slug: string;
  name: string;
  shortName: string;
  /** e.g. 'github-next' — only github-next profiles are publishable in-repo. */
  blogBackend: string;
  blogIndexUrl: string;
  /** e.g. 'https://www.totalsuccessai.com/blog/{slug}' */
  postUrlTemplate: string;
  /** Absolute path to the site repo on this machine ('' if not specified). */
  localRepoPath: string;
  /** Repo-relative dir for post markdown, e.g. 'content/blog'. */
  contentDir: string;
  /** Repo-relative dir for hero images, e.g. 'public/blog-images'. */
  imageDir: string;
  /** Whether localRepoPath exists on this machine right now. */
  repoExists: boolean;
}

/** Shape of the raw profile.json fields we read (everything optional). */
interface RawProfile {
  slug?: string;
  name?: string;
  shortName?: string;
  site?: { localRepoPath?: string };
  blog?: {
    backend?: string;
    blogIndexUrl?: string;
    postUrlTemplate?: string;
    contentDir?: string;
    imageDir?: string;
  };
}

function readProfile(root: string, dirName: string): PublishProfile | null {
  const profilePath = path.join(root, dirName, 'profile.json');
  let raw: RawProfile;
  try {
    raw = JSON.parse(fs.readFileSync(profilePath, 'utf-8')) as RawProfile;
  } catch {
    // Missing or malformed profile.json — skip this folder.
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;

  const localRepoPath = raw.site?.localRepoPath ?? '';
  return {
    slug: raw.slug || dirName,
    name: raw.name ?? dirName,
    shortName: raw.shortName ?? raw.name ?? dirName,
    blogBackend: raw.blog?.backend ?? '',
    blogIndexUrl: raw.blog?.blogIndexUrl ?? '',
    postUrlTemplate: raw.blog?.postUrlTemplate ?? '',
    localRepoPath,
    contentDir: raw.blog?.contentDir ?? '',
    imageDir: raw.blog?.imageDir ?? '',
    repoExists: !!localRepoPath && fs.existsSync(localRepoPath),
  };
}

/**
 * List all publishing profiles under `root` (default ~/dev/_brand-profiles).
 * Folders without a parseable profile.json are skipped; a missing root
 * returns [] (testers don't have the profiles dir at all).
 */
export function listPublishProfiles(root: string = PROFILES_ROOT): PublishProfile[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const profiles: PublishProfile[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const profile = readProfile(root, entry.name);
    if (profile) profiles.push(profile);
  }
  profiles.sort((a, b) => a.name.localeCompare(b.name));
  return profiles;
}

/**
 * Look up a single publishing profile by slug (folder name or profile.json
 * slug field). Returns null when absent or malformed.
 */
export function getPublishProfile(
  slug: string,
  root: string = PROFILES_ROOT
): PublishProfile | null {
  if (!slug) return null;
  return listPublishProfiles(root).find((p) => p.slug === slug) ?? null;
}
