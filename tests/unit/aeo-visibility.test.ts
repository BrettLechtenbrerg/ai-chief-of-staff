import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  atomicWriteFile,
  fetchWithRetry,
  isDomainOrSubdomain,
  parseAeoConfig,
  summarize,
  fetchAeoVisibility,
  areAeoRunsComparable,
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
      .mockResolvedValueOnce(new globalThis.Response('retry', { status: 429 }))
      .mockResolvedValueOnce(new globalThis.Response('{}', { status: 200 }));

    const pending = fetchWithRetry('https://provider.example', { method: 'POST' });
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toMatchObject({ status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops after three retryable responses', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new globalThis.Response('unavailable', { status: 503 }));

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

describe('AEO coverage regression', () => {
  it('separates observed measurements from any-engine prompts and unknown negatives', () => {
    const conf = parseAeoConfig(validConfig)!;
    const rows = prompts.flatMap((prompt, i) => (['openai', 'perplexity'] as const).map(engine => ({
      prompt, engine, mentioned: i === 0 && engine === 'openai', cited: i === 0 && engine === 'openai',
      sources: [], error: i === 0 && engine === 'openai' ? null : 'inert failure',
    })));
    const summary = summarize(rows, conf);
    expect(summary.measurements).toMatchObject({ requested: 50, successful: 1, failed: 49, citeRate: 100 });
    expect(summary.anyEngine.overall).toMatchObject({ requested: 25, observed: 1, complete: 0, partial: 1, cited: 1, citeUnknown: 24 });
    expect(summary.localTotal).toBe(1);
    expect(summary.infoTotal).toBe(0);
    expect(summary.anyEngine.informational.citeRate).toBeNull();
    expect(summary.anyEngine.overall.citeRateBounds).toEqual({ lower: 4, upper: 100 });
    expect(summary.anyEngine.overall.mentionRateBounds).toEqual({ lower: 4, upper: 100 });
    expect(summary.anyEngine.local.citeRateBounds).toEqual({ lower: 10, upper: 100 });
    expect(summary.anyEngine.informational.citeRateBounds).toBeNull();
  });
});

describe('AEO synthetic transport and persisted coverage', () => {
  async function run(mode: 'success' | 'partial' | 'failure' | 'malformed' = 'success') {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'acos-aeo-flow-'));
    const transport = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const body = JSON.parse(String(init?.body));
      const openai = String(url).includes('openai');
      const prompt = openai ? body.input : body.messages[0].content;
      if (mode === 'failure' || (mode === 'partial' && (!openai || prompt === prompts[24]))) {
        return new globalThis.Response('inert rejection', { status: 400 });
      }
      if (mode === 'malformed') return new globalThis.Response(openai ? '{' : JSON.stringify({ choices: [{ message: { content: 'TSAI' } }], citations: [42] }));
      const positive = prompt === prompts[0] && openai;
      return new globalThis.Response(JSON.stringify(openai ? {
        model: 'returned-openai', output: [{ content: [{ text: positive ? 'TSAI' : 'Other answer',
          annotations: positive ? [{ url: 'https://totalsuccessai.com/evidence' }] : [] }] }],
      } : { model: 'returned-perplexity', choices: [{ message: { content: 'Other answer' } }], citations: ['https://competitor.example/source', 'javascript:bad'] }));
    });
    const deps = { config: validConfig, keys: { openai: 'inert', perplexity: 'inert', anthropic: '' }, reportsRoot: directory };
    try {
      const result = await fetchAeoVisibility({ brandSlug: 'tsai' }, undefined, deps);
      const snapshot = JSON.parse(fs.readFileSync(result.reportFiles![0], 'utf8'));
      const report = fs.readFileSync(result.reportFiles![1], 'utf8');
      return { result, snapshot, report, calls: transport.mock.calls.length };
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }

  it('retains meaningful all-success aliases but distinguishes any-engine and measurement rates', async () => {
    const { result, snapshot, report, calls } = await run();
    expect(calls).toBe(50);
    expect(result).toMatchObject({ ok: true, status: 'complete' });
    expect(result.summary).toMatchObject({ citeRate: 4, mentionRate: 4, measurements: { citeRate: 2, successful: 50, failed: 0 },
      perEngine: { openai: { citeRate: 4 }, perplexity: { citeRate: 0 } },
      anyEngine: { overall: { complete: 25, partial: 0, citeUnknown: 0 }, local: { observed: 10, requested: 10, citeRate: 10 }, informational: { observed: 15, requested: 15, citeRate: 0 } } });
    expect(snapshot.metadata).toEqual(result.metadata);
    expect(snapshot.metadata).toMatchObject({ schemaVersion: 2, prompts, returnedModels: { openai: ['returned-openai'], perplexity: ['returned-perplexity'] } });
    expect(snapshot.metadata.promptSetHash).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.rows[0].sources).toEqual(['https://totalsuccessai.com/evidence']);
    expect(report).toContain('not consumer-app rankings');
    expect(areAeoRunsComparable(snapshot.metadata, result.metadata)).toBe(true);
    for (const patch of [{ schemaVersion: 1 }, { runVersion: 'old' }, { promptSetVersion: 2 }, { prompts: [...prompts].reverse() }, { promptSetHash: 'different' }, { configHash: 'different' },
      { requestedModels: { openai: 'different' } }, { returnedModels: {} }, { coverage: { requested: 50, successful: 49, failed: 1 } }]) {
      expect(areAeoRunsComparable(result.metadata, { ...result.metadata, ...patch })).toBe(false);
    }
    expect(areAeoRunsComparable({}, result.metadata)).toBe(false);
    for (const returnedModels of [{}, { openai: [], perplexity: [] }]) {
      const unknownModels = { ...result.metadata, returnedModels };
      expect(areAeoRunsComparable(unknownModels, unknownModels)).toBe(false);
    }
    expect(result.summary!.anyEngine.overall.citeRateBounds).toEqual({ lower: 4, upper: 4 });
    expect(report).toContain('Any-engine citation bounds (all requested prompts)');
  });

  it('keeps independent evidence, requested coverage and consistent local/info observed denominators', async () => {
    const { result } = await run('partial');
    expect(result).toMatchObject({ ok: false, status: 'partial', citedPrompts: [prompts[0]] });
    expect(result.summary).toMatchObject({ measurements: { requested: 50, successful: 24, failed: 26 },
      perEngine: { perplexity: { citeRate: null, mentionRate: null } }, localTotal: 10, infoTotal: 14,
      measurementSegments: { local: { requested: 20, successful: 10, failed: 10 }, informational: { requested: 30, successful: 14, failed: 16 } },
      anyEngine: { overall: { observed: 24, complete: 0, partial: 24, unobserved: 1, citeUnknown: 24 },
        informational: { requested: 15, observed: 14 } } });
    expect(areAeoRunsComparable(result.metadata, result.metadata)).toBe(false);
  });

  it.each(['failure', 'malformed'] as const)('makes %s unavailable, never a zero score', async mode => {
    const { result, report } = await run(mode);
    expect(result).toMatchObject({ ok: false, status: 'error', summary: { citeRate: null, mentionRate: null,
      measurements: { requested: 50, successful: 0, failed: 50, citeRate: null },
      anyEngine: { overall: { observed: 0, unobserved: 25, citeUnknown: 25 }, local: { citeRate: null }, informational: { citeRate: null } } } });
    expect(report).toContain('Unavailable');
    expect(report).not.toContain('null%');
    expect(result.summary!.anyEngine.overall.citeRateBounds).toBeNull();
    expect(result.summary!.anyEngine.overall.mentionRateBounds).toBeNull();
  });

  it('validates Anthropic citations and retains returned-model and source evidence', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'acos-aeo-anthropic-'));
    const deps = { config: validConfig, keys: { openai: '', perplexity: '', anthropic: 'inert' }, reportsRoot: directory };
    const transport = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new globalThis.Response(JSON.stringify({ model: 'returned-claude', content: [
      { type: 'text', text: 'TSAI', citations: [{ url: 'https://totalsuccessai.com/a' }] },
      { type: 'web_search_tool_result', content: [{ url: 'https://other.example/a' }] },
    ] })));
    try {
      const result = await fetchAeoVisibility({ brandSlug: 'tsai' }, undefined, deps);
      expect(result).toMatchObject({ ok: true, summary: { citeRate: 100, topSources: [['other.example', 25]] }, metadata: { returnedModels: { anthropic: ['returned-claude'] } } });
      transport.mockImplementation(async () => new globalThis.Response(JSON.stringify({ content: [{ type: 'text', text: 'TSAI', citations: [{ url: 42 }] }] })));
      expect(await fetchAeoVisibility({ brandSlug: 'tsai' }, undefined, deps)).toMatchObject({ ok: false, summary: { citeRate: null } });
      transport.mockImplementation(async () => new globalThis.Response(JSON.stringify({ content: [
        { type: 'text', text: 'TSAI' },
        { type: 'web_search_tool_result', content: { type: 'web_search_tool_result_error', error_code: 'unavailable' } },
      ] })));
      expect(await fetchAeoVisibility({ brandSlug: 'tsai' }, undefined, deps)).toMatchObject({ ok: false, summary: { mentionRate: null, citeRate: null } });
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });

  it('does not score an explicitly incomplete OpenAI response as a successful observation', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'acos-aeo-incomplete-'));
    const deps = { config: validConfig, keys: { openai: 'inert', perplexity: '', anthropic: '' }, reportsRoot: directory };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new globalThis.Response(JSON.stringify({
      status: 'incomplete', output: [{ content: [{ text: 'TSAI' }] }],
    })));
    try {
      expect(await fetchAeoVisibility({ brandSlug: 'tsai' }, undefined, deps)).toMatchObject({
        ok: false, summary: { mentionRate: null, citeRate: null, measurements: { successful: 0, failed: 25 } },
      });
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });

  it('never overwrites prior run artifacts and cancels without a success artifact', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'acos-aeo-distinct-'));
    const deps = { config: validConfig, keys: { openai: 'inert', perplexity: '', anthropic: '' }, reportsRoot: directory };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new globalThis.Response(JSON.stringify({ output: [{ content: [{ text: 'TSAI' }] }] })));
    try {
      const first = await fetchAeoVisibility({ brandSlug: 'tsai' }, undefined, deps);
      const original = fs.readFileSync(first.reportFiles![0], 'utf8');
      const second = await fetchAeoVisibility({ brandSlug: 'tsai' }, undefined, deps);
      expect(first.reportFiles![0]).not.toBe(second.reportFiles![0]);
      expect(fs.readFileSync(first.reportFiles![0], 'utf8')).toBe(original);
      const controller = new AbortController(); controller.abort();
      await expect(fetchAeoVisibility({ brandSlug: 'tsai' }, { signal: controller.signal }, deps)).rejects.toThrow();
      expect(fs.readFileSync(first.reportFiles![0], 'utf8')).toBe(original);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
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
