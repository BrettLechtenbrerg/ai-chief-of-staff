import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { listPublishProfiles, getPublishProfile } from '../../src/main/brand-profiles';

describe('brand-profiles (~/dev/_brand-profiles reader)', () => {
  let root: string;
  let repoDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-profiles-test-'));
    // A real directory to stand in for a cloned site repo.
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-profiles-repo-'));

    // Valid profile #1 — repo exists locally.
    fs.mkdirSync(path.join(root, 'tsai'));
    fs.writeFileSync(
      path.join(root, 'tsai', 'profile.json'),
      JSON.stringify({
        slug: 'tsai',
        name: 'Total Success AI',
        shortName: 'TSAI',
        site: { localRepoPath: repoDir },
        blog: {
          backend: 'github-next',
          blogIndexUrl: 'https://www.totalsuccessai.com/blog',
          postUrlTemplate: 'https://www.totalsuccessai.com/blog/{slug}',
          contentDir: 'content/blog',
          imageDir: 'public/blog-images',
        },
      })
    );

    // Valid profile #2 — repo path points at nothing on this machine.
    fs.mkdirSync(path.join(root, 'pmma'));
    fs.writeFileSync(
      path.join(root, 'pmma', 'profile.json'),
      JSON.stringify({
        slug: 'pmma',
        name: 'Personal Mastery Martial Arts',
        shortName: 'PMMA',
        site: { localRepoPath: '/nonexistent/path/to/PMMA-Site' },
        blog: {
          backend: 'github-next',
          blogIndexUrl: 'https://www.personalmasterymartialarts.com/blog',
          postUrlTemplate: 'https://www.personalmasterymartialarts.com/blog/{slug}',
          contentDir: 'content/blog',
          imageDir: 'public/blog-images',
        },
      })
    );

    // Malformed JSON — must be skipped, not crash the listing.
    fs.mkdirSync(path.join(root, 'broken'));
    fs.writeFileSync(path.join(root, 'broken', 'profile.json'), '{ not valid json !!');

    // Directory without profile.json (e.g. _inbox) — skipped.
    fs.mkdirSync(path.join(root, '_inbox'));

    // Stray file at the root (e.g. README.md) — ignored.
    fs.writeFileSync(path.join(root, 'README.md'), '# profiles');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  describe('listPublishProfiles', () => {
    it('returns only folders with parseable profile.json files', () => {
      const profiles = listPublishProfiles(root);
      expect(profiles).toHaveLength(2);
      expect(profiles.map((p) => p.slug).sort()).toEqual(['pmma', 'tsai']);
    });

    it('maps the publish-relevant fields from profile.json', () => {
      const tsai = listPublishProfiles(root).find((p) => p.slug === 'tsai')!;
      expect(tsai.name).toBe('Total Success AI');
      expect(tsai.shortName).toBe('TSAI');
      expect(tsai.blogBackend).toBe('github-next');
      expect(tsai.blogIndexUrl).toBe('https://www.totalsuccessai.com/blog');
      expect(tsai.postUrlTemplate).toBe('https://www.totalsuccessai.com/blog/{slug}');
      expect(tsai.localRepoPath).toBe(repoDir);
      expect(tsai.contentDir).toBe('content/blog');
      expect(tsai.imageDir).toBe('public/blog-images');
    });

    it('sets repoExists per the local filesystem', () => {
      const profiles = listPublishProfiles(root);
      expect(profiles.find((p) => p.slug === 'tsai')!.repoExists).toBe(true);
      expect(profiles.find((p) => p.slug === 'pmma')!.repoExists).toBe(false);
    });

    it('returns [] when the root does not exist (testers without the dir)', () => {
      expect(listPublishProfiles(path.join(root, 'no-such-dir'))).toEqual([]);
    });
  });

  describe('getPublishProfile', () => {
    it('returns the matching profile by slug', () => {
      const p = getPublishProfile('tsai', root);
      expect(p).not.toBeNull();
      expect(p!.name).toBe('Total Success AI');
    });

    it('returns null for unknown, malformed, or empty slugs', () => {
      expect(getPublishProfile('nope', root)).toBeNull();
      expect(getPublishProfile('broken', root)).toBeNull();
      expect(getPublishProfile('', root)).toBeNull();
    });
  });
});
