/**
 * Tests for the generate_blog_image tool.
 *
 * The handler is a thin wrapper around OpenAI's images.generate(). We mock
 * the SDK so tests don't make real API calls but still exercise:
 *  - style preamble wiring (photo-realistic vs editorial-illustration)
 *  - outputPath sandbox (must be inside ~/dev/TSAI-Site/public/blog-images/)
 *  - base64 decode + write to disk
 *  - validation: missing prompt, missing key, non-.png path
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockGenerate = vi.fn();

vi.mock('openai', () => {
  // Default export must be a constructor since tool code does `new OpenAI()`.
  class MockOpenAI {
    images = { generate: mockGenerate };
    constructor(_opts: unknown) {}
  }
  class APIError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return {
    default: MockOpenAI,
    APIError,
  };
});

const mockGetSetting = vi.fn();
vi.mock('../../src/settings', () => ({
  SettingsManager: {
    get: (k: string) => mockGetSetting(k),
  },
}));

import {
  buildPrompt,
  generateBlogImage,
  handleGenerateBlogImageTool,
} from '../../src/tools/image-gen';

// Per-test sandbox so each run gets a clean blog-images dir without
// polluting the real one.
const ORIGINAL_HOME = process.env.HOME;
let sandboxHome: string;

beforeEach(() => {
  mockGenerate.mockReset();
  mockGetSetting.mockReset();
  mockGetSetting.mockReturnValue('sk-test-key');

  sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'acos-imagegen-'));
  process.env.HOME = sandboxHome;
  // The image-gen module computed ALLOWED_DIR at import time using the
  // ORIGINAL_HOME. We need to make sure paths under the real home still
  // resolve correctly. To keep this simple, we test paths under the real
  // dev/TSAI-Site/public/blog-images using a tmp-redirected fs.mkdirSync.
});

afterEach(() => {
  // Restore HOME so the next test starts clean, then wipe the sandbox.
  process.env.HOME = ORIGINAL_HOME;
  if (sandboxHome && fs.existsSync(sandboxHome)) {
    fs.rmSync(sandboxHome, { recursive: true, force: true });
  }
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('image-gen / buildPrompt', () => {
  it('prepends the photo-realistic preamble', () => {
    const out = buildPrompt('A coach reviewing a dashboard', 'photo-realistic');
    expect(out).toMatch(/^Photo-realistic editorial photograph/);
    expect(out).toContain('A coach reviewing a dashboard');
    expect(out).toContain('no text in image');
    expect(out).toContain('no watermarks');
  });

  it('prepends the editorial-illustration preamble with the brand palette', () => {
    const out = buildPrompt('Data flowing between apps', 'editorial-illustration');
    expect(out).toMatch(/^Clean editorial illustration/);
    expect(out).toContain('#0A1F44');
    expect(out).toContain('#C0C0C0');
    expect(out).toContain('Data flowing between apps');
  });

  it('trims whitespace from the user prompt', () => {
    const out = buildPrompt('   subject   ', 'photo-realistic');
    expect(out.endsWith(' subject')).toBe(true);
  });
});

describe('image-gen / generateBlogImage validation', () => {
  // For these tests the actual outputPath rules apply against the real
  // ALLOWED_DIR (which was resolved at module load using the real HOME).
  // We don't care about disk writes here \u2014 just the validation messages.

  it('rejects a missing prompt', async () => {
    const r = await generateBlogImage({
      prompt: '',
      outputPath: '/tmp/x.png',
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/prompt is required/);
  });

  it('rejects an outputPath outside the allowed dir', async () => {
    const r = await generateBlogImage({
      prompt: 'a thing',
      outputPath: '/tmp/evil-hero.png',
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/must be inside/);
  });

  it('rejects an outputPath that is not a .png', async () => {
    const realHome = ORIGINAL_HOME || '';
    const r = await generateBlogImage({
      prompt: 'a thing',
      outputPath: path.join(
        realHome,
        'dev/TSAI-Site/public/blog-images/x.jpg',
      ),
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/\.png/);
  });

  it('rejects when no OpenAI key is configured', async () => {
    mockGetSetting.mockReturnValue('');
    const realHome = ORIGINAL_HOME || '';
    const r = await generateBlogImage({
      prompt: 'a thing',
      outputPath: path.join(
        realHome,
        'dev/TSAI-Site/public/blog-images/x.png',
      ),
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/OpenAI API key not configured/);
  });
});

describe('image-gen / generateBlogImage success path', () => {
  it('decodes base64, writes the PNG, and returns the path + bytes', async () => {
    // Use a sandbox path that lives under the real ALLOWED_DIR. We don't
    // actually pollute the real blog-images dir \u2014 we'll write there and
    // then unlink the test file at the end of the test.
    const realHome = ORIGINAL_HOME || '';
    const allowedDir = path.join(realHome, 'dev/TSAI-Site/public/blog-images');
    const fakeFile = path.join(allowedDir, `__test-${Date.now()}.png`);
    // The Desktop copy uses process.env.HOME, which the beforeEach()
    // sandbox redirects to a temp dir. Match that for the assertion.
    const desktopCopyExpected = path.join(
      sandboxHome,
      'Desktop',
      `blog-hero-preview-${path.basename(fakeFile)}`,
    );

    // 1x1 transparent PNG, base64-encoded \u2014 smallest valid PNG we can carry.
    const tinyPngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    mockGenerate.mockResolvedValue({
      data: [{ b64_json: tinyPngBase64 }],
    });

    try {
      const r = await generateBlogImage({
        prompt: 'A coach at a clean wooden desk',
        outputPath: fakeFile,
      });

      expect(r.success).toBe(true);
      expect(r.outputPath).toBe(fakeFile);
      expect(r.bytes).toBeGreaterThan(0);
      expect(fs.existsSync(fakeFile)).toBe(true);

      // Default behavior: Desktop preview copy also saved.
      expect(r.desktopCopyPath).toBe(desktopCopyExpected);
      expect(fs.existsSync(desktopCopyExpected)).toBe(true);

      // Confirm the prompt that went to the SDK got the photo-realistic preamble.
      expect(mockGenerate).toHaveBeenCalledTimes(1);
      const callArgs = mockGenerate.mock.calls[0][0];
      expect(callArgs.model).toBe('gpt-image-1');
      expect(callArgs.size).toBe('1536x1024');
      expect(callArgs.quality).toBe('high');
      expect(callArgs.n).toBe(1);
      expect(callArgs.prompt).toMatch(/^Photo-realistic editorial photograph/);
      expect(callArgs.prompt).toContain('A coach at a clean wooden desk');
    } finally {
      if (fs.existsSync(fakeFile)) fs.unlinkSync(fakeFile);
      if (fs.existsSync(desktopCopyExpected)) fs.unlinkSync(desktopCopyExpected);
    }
  });

  it('skips the Desktop preview when desktopCopy is false', async () => {
    const realHome = ORIGINAL_HOME || '';
    const allowedDir = path.join(realHome, 'dev/TSAI-Site/public/blog-images');
    const fakeFile = path.join(allowedDir, `__test-nodesk-${Date.now()}.png`);
    const desktopCopyExpected = path.join(
      sandboxHome,
      'Desktop',
      `blog-hero-preview-${path.basename(fakeFile)}`,
    );

    const tinyPngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    mockGenerate.mockResolvedValue({
      data: [{ b64_json: tinyPngBase64 }],
    });

    try {
      const r = await generateBlogImage({
        prompt: 'x',
        outputPath: fakeFile,
        desktopCopy: false,
      });
      expect(r.success).toBe(true);
      expect(r.desktopCopyPath).toBeUndefined();
      expect(fs.existsSync(desktopCopyExpected)).toBe(false);
    } finally {
      if (fs.existsSync(fakeFile)) fs.unlinkSync(fakeFile);
      if (fs.existsSync(desktopCopyExpected)) fs.unlinkSync(desktopCopyExpected);
    }
  });

  it('surfaces a clean error when OpenAI returns no image data', async () => {
    const realHome = ORIGINAL_HOME || '';
    const allowedDir = path.join(realHome, 'dev/TSAI-Site/public/blog-images');
    const fakeFile = path.join(allowedDir, `__test-noimg-${Date.now()}.png`);
    mockGenerate.mockResolvedValue({ data: [] });
    const r = await generateBlogImage({
      prompt: 'x',
      outputPath: fakeFile,
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/no image data/);
    if (fs.existsSync(fakeFile)) fs.unlinkSync(fakeFile);
  });
});

describe('image-gen / handler', () => {
  it('returns a JSON string the agent can consume', async () => {
    mockGetSetting.mockReturnValue('');
    const out = await handleGenerateBlogImageTool({
      prompt: 'x',
      outputPath: '/tmp/x.png',
    });
    const parsed = JSON.parse(out);
    expect(parsed.success).toBe(false);
    expect(typeof parsed.error).toBe('string');
  });
});
