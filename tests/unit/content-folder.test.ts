/**
 * Brand content buckets: contentFolder parsing (untrusted profile input),
 * daily packets landing in "<bucket>/Daily Posting Packets/", and the agent
 * file sandbox reaching the bucket. Fake HOME in a temp dir; no network.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  resolveContentFolder,
  getBrandContentFolder,
  listBrandContentFolders,
  uniqueBaseName,
} from '../../src/utils/content-folder';
import { writeDailyPostingPacket } from '../../src/tools/daily-posting-packet';
import { getPublishProfile } from '../../src/main/brand-profiles';
import { validateAgentFilePath } from '../../src/agent/tool-sandbox';

const ORIGINAL_HOME = process.env.HOME;
const BUCKET = 'TSAI - Total Success AI/Blogs & Social Posts';
let home: string;
let bucket: string;
let outside: string;

function writeProfile(slug: string, profile: Record<string, unknown>): void {
  const dir = path.join(home, 'dev', '_brand-profiles', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'profile.json'), JSON.stringify({ slug, ...profile }));
}

beforeEach(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'acos-bucket-')));
  process.env.HOME = home;
  bucket = path.join(home, 'Desktop', BUCKET);
  fs.mkdirSync(bucket, { recursive: true });
  outside = path.join(home, 'Documents', 'Elsewhere');
  fs.mkdirSync(outside, { recursive: true });
});

afterEach(() => {
  process.env.HOME = ORIGINAL_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

describe('resolveContentFolder', () => {
  it('accepts an existing ~/ folder inside Desktop', () => {
    expect(resolveContentFolder(`~/Desktop/${BUCKET}`, home)).toBe(bucket);
  });

  it('rejects missing, non-string, relative, absolute and dot-dot values', () => {
    for (const bad of [undefined, null, 42, '', 'Desktop/x', bucket, `~/Desktop/${BUCKET}/../../Documents/Elsewhere`, '~/Desktop/../Documents/Elsewhere']) {
      expect(resolveContentFolder(bad, home)).toBeNull();
    }
  });

  it('rejects Desktop itself, folders outside Desktop, missing folders and files', () => {
    fs.writeFileSync(path.join(home, 'Desktop', 'note.txt'), 'x');
    expect(resolveContentFolder('~/Desktop', home)).toBeNull();
    expect(resolveContentFolder('~/Documents/Elsewhere', home)).toBeNull();
    expect(resolveContentFolder('~/Desktop/Nope', home)).toBeNull();
    expect(resolveContentFolder('~/Desktop/note.txt', home)).toBeNull();
  });

  it('rejects a symlink inside Desktop that escapes it', () => {
    fs.symlinkSync(outside, path.join(home, 'Desktop', 'Sneaky'));
    expect(resolveContentFolder('~/Desktop/Sneaky', home)).toBeNull();
  });
});

describe('brand profile lookup', () => {
  it('returns the bucket for a valid profile and null for missing/invalid ones', () => {
    writeProfile('tsai', { contentFolder: `~/Desktop/${BUCKET}` });
    writeProfile('pmma', {});
    writeProfile('evil', { contentFolder: '~/Documents/Elsewhere' });
    expect(getBrandContentFolder('tsai', home)).toBe(bucket);
    expect(getBrandContentFolder('pmma', home)).toBeNull();
    expect(getBrandContentFolder('evil', home)).toBeNull();
    expect(getBrandContentFolder('../tsai', home)).toBeNull();
    expect(listBrandContentFolders(home)).toEqual([bucket]);
  });

  it('exposes the validated folder on the publish profile', () => {
    writeProfile('tsai', { contentFolder: `~/Desktop/${BUCKET}` });
    writeProfile('evil', { contentFolder: '~/Documents/Elsewhere' });
    const root = path.join(home, 'dev', '_brand-profiles');
    expect(getPublishProfile('tsai', root)!.contentFolder).toBe(bucket);
    expect(getPublishProfile('evil', root)!.contentFolder).toBe('');
  });

  it('uniqueBaseName never reuses an existing name', () => {
    fs.writeFileSync(path.join(bucket, 'a — hero.png'), 'x');
    expect(uniqueBaseName(bucket, 'a', ['.md', ' — hero.png'])).toBe('a (2)');
    expect(uniqueBaseName(bucket, 'b', ['.md'])).toBe('b');
  });
});

describe('daily posting packet destination', () => {
  function input(brandSlug: string) {
    const hero = path.join(home, 'hero-src.png');
    fs.writeFileSync(hero, 'png');
    return {
      brandSlug,
      brandShortName: 'TSAI',
      postSlug: 'my-post',
      postTitle: 'My Post',
      blogUrl: 'https://example.com/blog/my-post',
      blogBackend: 'github-next' as const,
      date: '2026-10-07',
      heroPath: hero,
      sections: [{ platformKey: 'facebookBusiness', displayName: 'Facebook', postBody: 'Hi' }],
    };
  }

  it('lands in <bucket>/Daily Posting Packets/ and never overwrites', async () => {
    writeProfile('tsai', { contentFolder: `~/Desktop/${BUCKET}` });
    const first = await writeDailyPostingPacket(input('tsai'));
    expect(first.success).toBe(true);
    expect(first.packetPath).toBe(path.join(bucket, 'Daily Posting Packets', '2026-10-07 — my-post.md'));
    expect(fs.existsSync(first.heroPath!)).toBe(true);
    const second = await writeDailyPostingPacket(input('tsai'));
    expect(second.packetPath).toBe(path.join(bucket, 'Daily Posting Packets', '2026-10-07 — my-post (2).md'));
  });

  it('falls back to ~/Desktop/Daily Postings/<Brand>/ without a valid bucket', async () => {
    writeProfile('tsai', { contentFolder: '~/Documents/Elsewhere' });
    const result = await writeDailyPostingPacket(input('tsai'));
    expect(result.packetPath).toBe(path.join(home, 'Desktop', 'Daily Postings', 'TSAI', '2026-10-07 — my-post.md'));
    const noProfile = await writeDailyPostingPacket(input('nobody'));
    expect(path.dirname(noProfile.packetPath!)).toBe(path.join(home, 'Desktop', 'Daily Postings', 'TSAI'));
  });
});

describe('agent file sandbox', () => {
  it('lets the agent write into a bucket post folder under the home grant', () => {
    const target = path.join(bucket, '2026-10-07-my-post', 'blog-post.md');
    expect(validateAgentFilePath(target, home, [home]).allowed).toBe(true);
  });
});
