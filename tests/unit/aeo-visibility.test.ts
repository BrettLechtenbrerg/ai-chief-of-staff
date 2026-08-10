import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  atomicWriteFile,
  fetchWithRetry,
  isDomainOrSubdomain,
  parseAeoConfig,
} from '../../src/tools/aeo-visibility.js';

const prompts = Array.from({ length: 25 }, (_, index) => `Permanent buyer question number ${index + 1}?`);
const validConfig = {
  slug: 'tsai',
  name: 'Total Success AI',
  shortName: 'TSAI',
  domain: 'www.TotalSuccessAI.com.',
  brandNames: ['Total Success AI', 'TSAI'],
  localSplit: 10,
  prompts,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('AEO config and citation validation', () => {
  it('accepts and normalizes a complete frozen 25-prompt config', () => {
    const parsed = parseAeoConfig(validConfig);
    expect(parsed?.domain).toBe('totalsuccessai.com');
    expect(parsed?.prompts).toHaveLength(25);
  });

  it('rejects missing, extra, duplicate, malformed, and oversized config', () => {
    expect(parseAeoConfig({ ...validConfig, prompts: prompts.slice(0, 24) })).toBeNull();
    expect(parseAeoConfig({ ...validConfig, prompts: [...prompts.slice(0, 24), prompts[0]] })).toBeNull();
    expect(parseAeoConfig({ ...validConfig, domain: 'https://totalsuccessai.com' })).toBeNull();
    expect(parseAeoConfig({ ...validConfig, unexpected: true })).toBeNull();
    expect(parseAeoConfig({ ...validConfig, name: 'x'.repeat(101) })).toBeNull();
  });

  it('matches only the exact normalized hostname or a real subdomain', () => {
    expect(isDomainOrSubdomain('https://totalsuccessai.com/article', 'totalsuccessai.com')).toBe(true);
    expect(isDomainOrSubdomain('https://www.totalsuccessai.com/', 'totalsuccessai.com')).toBe(true);
    expect(isDomainOrSubdomain('https://news.totalsuccessai.com/', 'totalsuccessai.com')).toBe(true);
    expect(isDomainOrSubdomain('https://totalsuccessai.com.evil.example/', 'totalsuccessai.com')).toBe(false);
    expect(isDomainOrSubdomain('https://evil-totalsuccessai.com/', 'totalsuccessai.com')).toBe(false);
    expect(isDomainOrSubdomain('not a URL', 'totalsuccessai.com')).toBe(false);
  });
});

describe('AEO provider reliability', () => {
  it('retries 429/5xx responses with bounded backoff', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('retry', { status: 429 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const pending = fetchWithRetry('https://provider.example', { method: 'POST' });
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toMatchObject({ status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops after three retryable responses', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('unavailable', { status: 503 }));

    const pending = fetchWithRetry('https://provider.example', { method: 'POST' });
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(pending).resolves.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('aborts provider work when the tool signal is cancelled', async () => {
    const controller = new AbortController();
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      })
    );
    const pending = fetchWithRetry('https://provider.example', {}, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow(/cancelled/i);
  });
});

describe('AEO report writes', () => {
  it('atomically replaces a report with private file permissions', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'acos-aeo-report-'));
    const reportPath = path.join(directory, 'report.json');
    try {
      atomicWriteFile(reportPath, 'first');
      atomicWriteFile(reportPath, 'second');
      expect(fs.readFileSync(reportPath, 'utf8')).toBe('second');
      expect(fs.readdirSync(directory)).toEqual(['report.json']);
      if (process.platform !== 'win32') expect(fs.statSync(reportPath).mode & 0o777).toBe(0o600);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
