/**
 * Unit tests for validateFirecrawlKey
 *
 * Mirrors the pattern used by browser-launcher.test.ts: swap global.fetch
 * with a vi.fn() in beforeEach, restore in afterEach. We exercise each
 * status-code branch (200 success, 401, 402, 429) plus the empty-key
 * short-circuit and the network-error catch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { validateFirecrawlKey } from '../../src/settings/validators';

describe('validateFirecrawlKey', () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns invalid when apiKey is empty', async () => {
    const result = await validateFirecrawlKey('');

    expect(result.valid).toBe(false);
    expect(result.error).toBe('API key is required');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns valid with remainingCredits + planCredits on 200 success', async () => {
    mockFetch.mockResolvedValue({
      status: 200,
      json: async () => ({
        success: true,
        data: { remainingCredits: 487, planCredits: 500 },
      }),
    });

    const result = await validateFirecrawlKey('fc-test-key');

    expect(result.valid).toBe(true);
    expect(result.remainingCredits).toBe(487);
    expect(result.planCredits).toBe(500);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.firecrawl.dev/v2/team/credit-usage',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer fc-test-key' },
      }),
    );
  });

  it('returns invalid with API-key hint on 401', async () => {
    mockFetch.mockResolvedValue({
      status: 401,
      json: async () => ({}),
    });

    const result = await validateFirecrawlKey('fc-bad-key');

    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid API key');
    expect(result.error).toContain('firecrawl.dev/app');
  });

  it('returns invalid with credit hint on 402', async () => {
    mockFetch.mockResolvedValue({
      status: 402,
      json: async () => ({}),
    });

    const result = await validateFirecrawlKey('fc-broke-key');

    expect(result.valid).toBe(false);
    expect(result.error).toContain('Out of Firecrawl credits');
  });

  it('returns invalid with rate-limit hint on 429', async () => {
    mockFetch.mockResolvedValue({
      status: 429,
      json: async () => ({}),
    });

    const result = await validateFirecrawlKey('fc-rl-key');

    expect(result.valid).toBe(false);
    expect(result.error).toContain('rate limit');
  });

  it('returns generic HTTP error for unexpected status codes', async () => {
    mockFetch.mockResolvedValue({
      status: 503,
      json: async () => ({}),
    });

    const result = await validateFirecrawlKey('fc-weird-key');

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Firecrawl returned HTTP 503');
  });

  it('catches network/fetch errors and surfaces the message', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await validateFirecrawlKey('fc-test-key');

    expect(result.valid).toBe(false);
    expect(result.error).toBe('ECONNREFUSED');
  });

  it('uses fallback message when caught value is not an Error', async () => {
    mockFetch.mockRejectedValue('socket dead');

    const result = await validateFirecrawlKey('fc-test-key');

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Connection failed');
  });
});
