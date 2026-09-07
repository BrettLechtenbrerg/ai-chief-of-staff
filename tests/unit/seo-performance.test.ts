import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ token: vi.fn(async () => 'inert'), scope: vi.fn(() => true), read: vi.fn(() => JSON.stringify({ site: { url: 'https://example.test' } })) }));
vi.mock('fs', () => ({ readFileSync: mocks.read }));
vi.mock('../../src/auth/google-oauth', () => ({ GoogleOAuth: { getStatus: () => ({ connected: true }), hasSearchConsoleScope: mocks.scope, getAccessToken: mocks.token } }));
vi.mock('../../src/auth/flo-google-token', () => ({ floTokenExists: () => true, floHasSearchConsoleScope: () => true, getFloAccessToken: mocks.token }));
import { fetchSeoData } from '../../src/tools/seo-report';
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); mocks.token.mockReset().mockResolvedValue('inert'); mocks.scope.mockReturnValue(true); mocks.read.mockReset().mockReturnValue(JSON.stringify({ site: { url: 'https://example.test' } })); });
function response(init: RequestInit) {
  const b = JSON.parse(init.body as string);
  return new Response(JSON.stringify({ rows: b.dimensions.length ? [] : [{ clicks: 10, impressions: 100, ctr: 0.1, position: 12 }], responseAggregationType: b.aggregationType }));
}
it('synthetic fixed 20ms transport benchmark of actual fetchSeoData', async () => {
  const samples: number[] = []; let max = 0; let count = 0; let active = 0;
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    count++; max = Math.max(max, ++active);
    await new Promise(r => setTimeout(r, 20)); active--;
    return response(init);
  });
  for (let i = 0; i < 3; i++) { const start = performance.now(); expect((await fetchSeoData({})).ok).toBe(true); samples.push(Math.round(performance.now() - start)); }
  console.log('SEO synthetic benchmark', { samples, max, count });
  expect(count).toBe(54);
  expect(max).toBe(4);
});
it.each(['network', 'body', 'token', 'fallback-token'])('bounds stalled %s and cleans timers', async mode => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  if (mode.includes('token')) mocks.token.mockImplementation(() => new Promise(() => {}));
  if (mode === 'fallback-token') mocks.scope.mockReturnValue(false);
  vi.stubGlobal('fetch', mode === 'network' ? vi.fn(() => new Promise(() => {})) : vi.fn(async () => new Response(new ReadableStream({ cancel }))));
  const pending = fetchSeoData({ brandSlug: 'pmma' }, { requestTimeoutMs: 20 });
  await vi.advanceTimersByTimeAsync(25);
  const result = await pending;
  expect(result.ok).toBe(false); expect(result.status).toBe('timed_out');
  if (mode === 'body') expect(cancel).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it.each(['before', 'network', 'body', 'token', 'queued'])('cancels %s without late success or queued fetches', async mode => {
  vi.useFakeTimers(); const controller = new AbortController(); const cancel = vi.fn();
  const signals: AbortSignal[] = []; let finish: ((value: string) => void) | undefined;
  if (mode === 'token') mocks.token.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const transport = vi.fn(async (_url: string, init: RequestInit) => {
    signals.push(init.signal!);
    if (mode === 'queued' && transport.mock.calls.length <= 3) return response(init);
    if (mode === 'body') return new Response(new ReadableStream({ cancel }));
    return new Promise<Response>(() => {});
  });
  vi.stubGlobal('fetch', transport);
  if (mode === 'before') controller.abort();
  const pending = fetchSeoData({}, { signal: controller.signal });
  await vi.advanceTimersByTimeAsync(1);
  controller.abort();
  const count = transport.mock.calls.length;
  const result = await pending; finish?.('late-inert-token');
  await vi.advanceTimersByTimeAsync(100);
  expect(result.ok).toBe(false); expect(result.status).toBe('canceled');
  expect(transport).toHaveBeenCalledTimes(count);
  expect(signals.filter(s => s.aborted).length).toBe(mode === 'queued' ? count - 3 : count);
  if (mode === 'body') expect(cancel).toHaveBeenCalledTimes(3);
  if (mode === 'before' || mode === 'token') expect(count).toBe(0);
  if (mode === 'queued') expect(count).toBe(7);
  expect(vi.getTimerCount()).toBe(0);
});
it.each([429, 500, 401, 403])('bounds retries and honors delay for HTTP %s', async status => {
  vi.useFakeTimers(); const times: number[] = [];
  const transport = vi.fn(async (_url: string, init: RequestInit) => {
    times.push(Date.now());
    if (transport.mock.calls.length <= (status === 403 ? 2 : 3)) return new Response('private-provider-body', { status, headers: status === 429 ? { 'Retry-After': '2' } : {} });
    return response(init);
  });
  vi.stubGlobal('fetch', transport);
  const pending = fetchSeoData({ brandSlug: 'pmma' });
  await vi.advanceTimersByTimeAsync(5000);
  const result = await pending;
  expect(result.status).toBe('all_failed');
  expect(times).toHaveLength(status === 401 ? 1 : status === 403 ? 2 : 3);
  if (status === 429) expect(times.slice(1).map((t, i) => t - times[i])).toEqual([2000, 2000]);
  if (status === 500) expect(times.slice(1).map((t, i) => t - times[i])).toEqual([500, 1000]);
  expect(JSON.stringify(result)).not.toContain('private-provider-body');
  expect(vi.getTimerCount()).toBe(0);
});
it('never retries earlier than Retry-After when it exceeds remaining run budget', async () => {
  vi.useFakeTimers(); const transport = vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '120' } }));
  vi.stubGlobal('fetch', transport);
  const result = await fetchSeoData({ brandSlug: 'pmma' });
  expect(result.status).toBe('timed_out'); expect(transport).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
it('keeps valid totals on a whole-run timeout of independent detail work', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => JSON.parse(init.body as string).dimensions.length ? new Promise<Response>(() => {}) : response(init));
  const pending = fetchSeoData({}, { runTimeoutMs: 20 });
  await vi.advanceTimersByTimeAsync(25);
  const result = await pending;
  expect(result.status).toBe('timed_out'); expect(result.ok).toBe(false);
  expect(result.brands!.every(b => b.totals?.clicks === 10 && b.status === 'partial')).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it('enforces whole-run request budget under repeated transient responses', async () => {
  vi.useFakeTimers(); const attempts = new Map<string, number>(); let count = 0;
  let profile = 0; mocks.read.mockImplementation(() => JSON.stringify({ site: { url: `https://brand${++profile}.test` } }));
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    count++; const b = JSON.parse(init.body as string); const key = `${url}-${init.body}`;
    const attempt = (attempts.get(key) ?? 0) + 1; attempts.set(key, attempt);
    if (b.dimensions.length && attempt % 3 !== 0) return new Response('', { status: 500 });
    if (!b.dimensions.length) return response(init);
    const rows = Array.from({ length: 250 }, (_, i) => ({ keys: [b.dimensions[0] === 'page' ? `https://example.test/${b.startRow + i}` : `q${b.startRow + i}`], clicks: 1, impressions: 10, ctr: 0.1, position: 12 }));
    return new Response(JSON.stringify({ rows, responseAggregationType: b.aggregationType }));
  });
  const pending = fetchSeoData({}); await vi.advanceTimersByTimeAsync(90000); const result = await pending;
  expect(count).toBe(90);
  expect(result.status).toBe('partial');
  expect(result.brands!.some(b => b.errors.some(e => e.kind === 'budget_exhausted'))).toBe(true);
  expect(result.brands!.every(b => Object.values(b.coverage).every(c => c.rows <= 1000))).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it('retries only explicitly transient network failures and can recover', async () => {
  vi.useFakeTimers(); let count = 0;
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => { if (++count === 1) throw Object.assign(new Error('private'), { cause: { code: 'ECONNRESET' } }); return response(init); });
  const pending = fetchSeoData({ brandSlug: 'pmma' }); await vi.advanceTimersByTimeAsync(501);
  expect((await pending).ok).toBe(true); expect(count).toBe(7); expect(vi.getTimerCount()).toBe(0);
});
it('cancels and unlocks oversized and failed streams without retrying invalid responses', async () => {
  const cancel = vi.fn(); const streams: ReadableStream[] = [];
  const transport = vi.fn(async () => { const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(2_000_001)); }, cancel }); streams.push(stream); return new Response(stream); });
  vi.stubGlobal('fetch', transport);
  expect((await fetchSeoData({ brandSlug: 'pmma' })).status).toBe('all_failed');
  expect(transport).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalledOnce(); expect(streams[0].locked).toBe(false);
});
it('keeps each dimension pagination in increasing order across globally concurrent brands', async () => {
  const pages = new Map<string, number[]>(); let profile = 0;
  mocks.read.mockImplementation(() => JSON.stringify({ site: { url: `https://brand${++profile}.test` } }));
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const b = JSON.parse(init.body as string); if (!b.dimensions.length) return response(init);
    const key = `${url}-${b.dimensions[0]}-${b.startDate}`; const seen = pages.get(key) ?? []; seen.push(b.startRow); pages.set(key, seen);
    const rows = Array.from({ length: b.startRow ? 1 : 250 }, (_, i) => ({ keys: [b.dimensions[0] === 'page' ? `https://example.test/${b.startRow + i}` : `q${b.startRow + i}`], clicks: 1, impressions: 10, ctr: 0.1, position: 12 }));
    return new Response(JSON.stringify({ rows, responseAggregationType: b.aggregationType }));
  });
  const result = await fetchSeoData({}); expect(result.ok).toBe(true);
  expect(pages.size).toBe(12); expect([...pages.values()].every(p => JSON.stringify(p) === '[0,250]')).toBe(true);
  expect(result.brands!.map(b => b.slug)).toEqual(['pmma', 'tsai', 'brett']);
});
