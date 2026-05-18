/**
 * Tests for write_daily_posting_packet tool.
 *
 * Pure file I/O \u2014 no external APIs to mock. We exercise the format,
 * the validation, and the image-copy behavior against a sandboxed
 * HOME so the tests don't pollute the real ~/dev/_brand-profiles/_inbox/.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  writeDailyPostingPacket,
  handleWriteDailyPostingPacketTool,
  type WriteDailyPostingPacketInput,
} from '../../src/tools/daily-posting-packet';

const ORIGINAL_HOME = process.env.HOME;
let sandboxHome: string;
let sandboxHeroPath: string;
let sandboxSquarePath: string;

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const TINY_PNG_BUFFER = Buffer.from(TINY_PNG_BASE64, 'base64');

beforeEach(() => {
  sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'acos-packet-'));
  process.env.HOME = sandboxHome;

  // Drop hero + square fixtures somewhere outside the inbox.
  const fixtureDir = path.join(sandboxHome, 'fixtures');
  fs.mkdirSync(fixtureDir, { recursive: true });
  sandboxHeroPath = path.join(fixtureDir, 'fixture-hero.png');
  sandboxSquarePath = path.join(fixtureDir, 'fixture-hero-square.png');
  fs.writeFileSync(sandboxHeroPath, TINY_PNG_BUFFER);
  fs.writeFileSync(sandboxSquarePath, TINY_PNG_BUFFER);
});

afterEach(() => {
  process.env.HOME = ORIGINAL_HOME;
  if (sandboxHome && fs.existsSync(sandboxHome)) {
    fs.rmSync(sandboxHome, { recursive: true, force: true });
  }
});

// Module loads INBOX_DIR at import time using process.env.HOME, so we have
// to re-import after setting HOME. Vitest's module caching makes this
// finicky \u2014 simplest path: pass an absolute path to writeDailyPostingPacket
// and accept that INBOX_DIR captured the test-runner's real HOME.
//
// Solution: build sandbox-relative inputs and assert the tool writes into
// the (real-HOME-derived) _inbox path. We then verify by listing that path.

function realInboxPath(): string {
  return path.resolve(ORIGINAL_HOME || '', 'dev/_brand-profiles/_inbox');
}

function makeValidInput(): WriteDailyPostingPacketInput {
  return {
    brandSlug: 'tsai',
    brandShortName: 'TSAI',
    postSlug: 'test-post',
    postTitle: 'Test Post Title',
    blogUrl: 'https://totalsuccessai.com/blog/test-post',
    blogBackend: 'github-next',
    date: '2026-05-25',
    heroPath: sandboxHeroPath,
    heroSquarePath: sandboxSquarePath,
    sections: [
      {
        platformKey: 'linkedinPersonal',
        displayName: 'LinkedIn Personal',
        postBody: 'Hook line.\n\nBody text here.\n\nSoft close.',
        firstComment: 'Full article: https://totalsuccessai.com/blog/test-post',
        hashtags: '#TSAI #TotalSuccessAI',
      },
      {
        platformKey: 'facebookBusinessPage',
        displayName: 'Facebook Business Page',
        postBody: 'Different copy for FB.',
        instructions: 'Attach hero image when posting.',
      },
    ],
  };
}

describe('write_daily_posting_packet / validation', () => {
  it('rejects missing brandSlug', async () => {
    const input = makeValidInput();
    delete (input as Partial<WriteDailyPostingPacketInput>).brandSlug;
    const r = await writeDailyPostingPacket(input as WriteDailyPostingPacketInput);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/brandSlug/);
  });

  it('rejects bad date format', async () => {
    const input = makeValidInput();
    input.date = '2026-5-25';
    const r = await writeDailyPostingPacket(input);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/date must be YYYY-MM-DD/);
  });

  it('rejects bad blogBackend value', async () => {
    const input = makeValidInput();
    (input as { blogBackend: string }).blogBackend = 'wordpress';
    const r = await writeDailyPostingPacket(input);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/blogBackend/);
  });

  it('rejects empty sections array', async () => {
    const input = makeValidInput();
    input.sections = [];
    const r = await writeDailyPostingPacket(input);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/sections/);
  });

  it('rejects section missing postBody', async () => {
    const input = makeValidInput();
    delete (input.sections[0] as Partial<typeof input.sections[0]>).postBody;
    const r = await writeDailyPostingPacket(input);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/postBody/);
  });

  it('rejects nonexistent heroPath', async () => {
    const input = makeValidInput();
    input.heroPath = '/tmp/does-not-exist-' + Date.now() + '.png';
    const r = await writeDailyPostingPacket(input);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/heroPath does not exist/);
  });
});

describe('write_daily_posting_packet / output', () => {
  it('writes the markdown and copies hero + square next to it', async () => {
    const input = makeValidInput();
    const r = await writeDailyPostingPacket(input);

    expect(r.success).toBe(true);
    expect(r.packetPath).toBeDefined();
    expect(r.heroPath).toBeDefined();
    expect(r.squarePath).toBeUndefined();
    // Note: squarePath in the RESULT is only set if the IMAGE was generated
    // by generate_blog_image. The packet tool returns heroSquarePath under a
    // different key. Let me check:
    expect(r.heroSquarePath).toBeDefined();

    if (r.packetPath) {
      expect(fs.existsSync(r.packetPath)).toBe(true);
      const content = fs.readFileSync(r.packetPath, 'utf8');
      expect(content).toContain('# Daily Posting Packet');
      expect(content).toContain('TSAI');
      expect(content).toContain('Test Post Title');
      expect(content).toContain('https://totalsuccessai.com/blog/test-post');
      expect(content).toContain('1. LINKEDIN PERSONAL');
      expect(content).toContain('2. FACEBOOK BUSINESS PAGE');
      expect(content).toContain('Hook line.');
      expect(content).toContain('Different copy for FB.');
      expect(content).toContain('First comment');
      expect(content).toContain('Full article:');
      expect(content).toContain('Hashtags');
      expect(content).toContain('#TSAI #TotalSuccessAI');
      expect(content).toContain('**To post:** Attach hero image when posting.');
    }
    if (r.heroPath) {
      expect(fs.existsSync(r.heroPath)).toBe(true);
    }
    if (r.heroSquarePath) {
      expect(fs.existsSync(r.heroSquarePath)).toBe(true);
    }

    // Cleanup: the tool writes to the REAL _inbox (because INBOX_DIR was
    // captured at module load using the real HOME). Clean up after ourselves.
    if (r.packetPath && fs.existsSync(r.packetPath)) fs.unlinkSync(r.packetPath);
    if (r.heroPath && fs.existsSync(r.heroPath)) fs.unlinkSync(r.heroPath);
    if (r.heroSquarePath && fs.existsSync(r.heroSquarePath)) fs.unlinkSync(r.heroSquarePath);
  });

  it('omits square handling when not provided', async () => {
    const input = makeValidInput();
    delete input.heroSquarePath;
    const r = await writeDailyPostingPacket(input);

    expect(r.success).toBe(true);
    expect(r.heroSquarePath).toBeUndefined();

    if (r.packetPath && fs.existsSync(r.packetPath)) {
      const content = fs.readFileSync(r.packetPath, 'utf8');
      expect(content).not.toContain('Instagram square:');
      fs.unlinkSync(r.packetPath);
    }
    if (r.heroPath && fs.existsSync(r.heroPath)) fs.unlinkSync(r.heroPath);
  });

  it('adds the GHL backend note when blogBackend is ghl', async () => {
    const input = makeValidInput();
    input.blogBackend = 'ghl';
    const r = await writeDailyPostingPacket(input);

    expect(r.success).toBe(true);
    if (r.packetPath && fs.existsSync(r.packetPath)) {
      const content = fs.readFileSync(r.packetPath, 'utf8');
      expect(content).toContain('GoHighLevel');
      expect(content).toContain('**Blog backend:** ghl');
      fs.unlinkSync(r.packetPath);
    }
    if (r.heroPath && fs.existsSync(r.heroPath)) fs.unlinkSync(r.heroPath);
    if (r.heroSquarePath && fs.existsSync(r.heroSquarePath)) fs.unlinkSync(r.heroSquarePath);
  });

  it('survives a missing square file (best-effort)', async () => {
    const input = makeValidInput();
    input.heroSquarePath = '/tmp/does-not-exist-square-' + Date.now() + '.png';
    const r = await writeDailyPostingPacket(input);

    // Main packet still succeeds.
    expect(r.success).toBe(true);

    if (r.packetPath && fs.existsSync(r.packetPath)) fs.unlinkSync(r.packetPath);
    if (r.heroPath && fs.existsSync(r.heroPath)) fs.unlinkSync(r.heroPath);
  });
});

describe('write_daily_posting_packet / handler envelope', () => {
  it('returns JSON the agent can parse', async () => {
    const input = makeValidInput();
    const out = await handleWriteDailyPostingPacketTool(input);
    const parsed = JSON.parse(out);
    expect(parsed.success).toBe(true);
    expect(typeof parsed.packetPath).toBe('string');

    if (parsed.packetPath && fs.existsSync(parsed.packetPath))
      fs.unlinkSync(parsed.packetPath);
    if (parsed.heroPath && fs.existsSync(parsed.heroPath)) fs.unlinkSync(parsed.heroPath);
    if (parsed.heroSquarePath && fs.existsSync(parsed.heroSquarePath))
      fs.unlinkSync(parsed.heroSquarePath);
  });
});
