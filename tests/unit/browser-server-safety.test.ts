/**
 * Unit tests for src/mcp/browser-server.ts — browser URL safety gate
 *
 * Verifies that handleBrowser() refuses to navigate to dangerous URLs
 * (file://, chrome://, about:) BEFORE attempting to connect to Chrome,
 * and that safe URLs proceed to puppeteer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoist mocks for puppeteer-core ─────────────────────────────────────────
const { mockGoto, mockUrl, mockTitle, mockConnect, mockRead, mockCapture } = vi.hoisted(() => ({
  mockGoto: vi.fn(),
  mockUrl: vi.fn(() => 'https://example.com/loaded'),
  mockTitle: vi.fn(async () => 'Example'),
  mockConnect: vi.fn(),
  mockRead: vi.fn(async () => 'synthetic text'),
  mockCapture: vi.fn(async () => 'synthetic image'),
}));

vi.mock('puppeteer-core', () => {
  const fakePage = {
    goto: mockGoto,
    evaluate: mockRead,
    screenshot: mockCapture,
    url: mockUrl,
    title: mockTitle,
    isClosed: () => false,
  };
  const fakeBrowser = {
    connected: true,
    pages: vi.fn(async () => [fakePage]),
    newPage: vi.fn(async () => fakePage),
  };
  mockConnect.mockResolvedValue(fakeBrowser);
  return {
    default: { connect: mockConnect },
  };
});

// Ensure the auto-start guard treats this as a test environment
process.env.VITEST = 'true';

// ── Import the module under test ──────────────────────────────────────────
import { handleBrowser } from '../../src/mcp/browser-server';

describe('browser-server handleBrowser — dangerous URLs are blocked', () => {
  beforeEach(() => {
    mockGoto.mockReset();
    mockUrl.mockReturnValue('https://example.com/loaded');
    mockRead.mockClear();mockCapture.mockClear();
    mockConnect.mockClear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const dangerousUrls: Array<[string, string]> = [
    ['file://', 'file:///etc/passwd'],
    ['chrome://', 'chrome://settings'],
    ['about:', 'about:config'],
    ['single-slash local file', 'file:/tmp/synthetic-finance-fixture.txt'],
    ['whitespace-prefixed local file', '  file:///tmp/synthetic-finance-fixture.txt'],
    ['data scheme', 'data:text/plain,synthetic'],
    ['script scheme', 'javascript:'],
    ['malformed URL', 'not an absolute URL'],
  ];

  for (const [label, url] of dangerousUrls) {
    it(`blocks navigate to ${label} URL`, async () => {
      const result = await handleBrowser({ action: 'navigate', url });
      const parsed = JSON.parse(result) as {
        blocked?: boolean;
        error?: string;
        url?: string;
      };

      expect(parsed.blocked).toBe(true);
      expect(parsed.error).toMatch(/blocked/i);
      expect(parsed.url).toBe(url);

      // puppeteer.goto must NEVER be reached
      expect(mockGoto).not.toHaveBeenCalled();
      // We must not even attempt to connect to Chrome for blocked URLs
      expect(mockConnect).not.toHaveBeenCalled();
    });
  }

  it.each(['screenshot','extract'])('blocks already-open local content for %s',async(action)=>{
    mockUrl.mockReturnValue('file:///tmp/synthetic-finance.html');
    const result=JSON.parse(await handleBrowser({action}));
    expect(result.error).toContain('blocked');expect(result).not.toHaveProperty('data');expect(result).not.toHaveProperty('screenshot_base64');
    expect(mockRead).not.toHaveBeenCalled();expect(mockCapture).not.toHaveBeenCalled();
  });

  it('returns a url-required error for empty navigate', async () => {
    const result = await handleBrowser({ action: 'navigate', url: '' });
    const parsed = JSON.parse(result) as { error?: string };
    expect(parsed.error).toMatch(/url required/i);
    expect(mockGoto).not.toHaveBeenCalled();
  });

  it('allows safe https URLs to proceed to puppeteer', async () => {
    mockGoto.mockResolvedValueOnce(undefined);
    const result = await handleBrowser({
      action: 'navigate',
      url: 'https://example.com',
    });
    const parsed = JSON.parse(result) as { success?: boolean; url?: string };

    expect(parsed.success).toBe(true);
    expect(mockGoto).toHaveBeenCalledOnce();
    expect(mockGoto).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ waitUntil: 'domcontentloaded' })
    );
  });
});
