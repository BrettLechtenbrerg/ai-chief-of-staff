import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), fetch: vi.fn() }));
vi.mock('fs', () => ({ readFileSync: mocks.read }));
vi.mock('../../src/auth/google-oauth', () => ({ GoogleOAuth: {
  getStatus: () => ({ connected: true }), hasSearchConsoleScope: () => true,
  getAccessToken: async () => 'inert-token',
} }));
vi.mock('../../src/auth/flo-google-token', () => ({
  floTokenExists: () => false, floHasSearchConsoleScope: () => false, getFloAccessToken: async () => null,
}));
import { fetchSeoData } from '../../src/tools/seo-report';
const row = (keys: string[] = [], clicks = 10, impressions = 100) => ({ keys, clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: impressions ? 12 : 0 });
function provider(count = 301) {
  mocks.fetch.mockImplementation(async (_url, init) => {
    const b = JSON.parse(init.body);
    const dimension = b.dimensions[0];
    const rows = dimension ? Array.from({ length: count }, (_, i) => row([dimension === 'page' ? `https://example.test/${i}` : `query-${i}`], 1, 10)).slice(b.startRow ?? 0, (b.startRow ?? 0) + b.rowLimit) : [row([], 900, 9000)];
    return new globalThis.Response(JSON.stringify({ rows, responseAggregationType: dimension === 'page' ? 'byPage' : 'byProperty' }));
  });
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-03-10T06:30:00Z'));
  mocks.read.mockReturnValue(JSON.stringify({ shortName: 'Example', site: { url: 'https://example.test' } }));
  vi.stubGlobal('fetch', mocks.fetch); provider();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('SEO authoritative property reporting', () => {
  it.each([
    ['2026-03-10T06:30:00Z', '2026-03-06'], // still March 9 in PDT
    ['2026-11-02T07:30:00Z', '2026-10-29'], // still November 1 in PST
    ['2026-01-02T07:30:00Z', '2025-12-29'],
    ['2024-03-03T07:30:00Z', '2024-02-28'],
  ])('uses Pacific inclusive calendar windows at %s', async (time, end) => {
    vi.setSystemTime(new Date(time));
    const result = await fetchSeoData({ brandSlug: 'pmma', days: 28 });
    expect(result.window?.endDate).toBe(end);
    const w = result.window!;
    const distance = (a: string, b: string) => (Date.parse(a) - Date.parse(b)) / 86400000;
    expect(distance(w.endDate, w.startDate)).toBe(27);
    expect(distance(w.prevEndDate, w.prevStartDate)).toBe(27);
    expect(distance(w.startDate, w.prevEndDate)).toBe(1);
  });
  it('uses auto for page grouping and preserves returned aggregation metadata', async () => {
    const result = await fetchSeoData({ brandSlug: 'pmma' });
    const bodies = mocks.fetch.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(bodies.filter(b => b.dimensions[0] === 'page').every(b => b.aggregationType === 'auto')).toBe(true);
    expect(result.brands![0].aggregationTypes).toMatchObject({
      'totals.current': 'byProperty', 'totals.previous': 'byProperty',
      'page.current': 'byPage', 'page.previous': 'byPage', 'query.current': 'byProperty',
    });
  });
  it('accepts empty finalized-data metadata without inventing incomplete dates', async () => {
    mocks.fetch.mockImplementation(async (_url, init) => {
      const b = JSON.parse(init.body);
      return new globalThis.Response(JSON.stringify({ rows: [], responseAggregationType: b.aggregationType, metadata: {} }));
    });
    const result = await fetchSeoData({ brandSlug: 'pmma' });
    expect(result.brands![0].status).toBe('no_data');
    expect(result.brands![0].errors).toEqual([]);
  });

  it('caps detail pagination at four 250-row requests per dimension/period', async () => {
    provider(1500);
    const result = await fetchSeoData({ brandSlug: 'pmma' });
    expect(mocks.fetch).toHaveBeenCalledTimes(18);
    expect(Object.values(result.brands![0].coverage).every(c => c.rows === 1000 && c.truncated && !c.complete)).toBe(true);
    const bodies = mocks.fetch.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(Math.max(...bodies.map(b => b.startRow ?? 0))).toBe(750);
  });
  it('rejects malformed provider page URLs while retaining valid property totals', async () => {
    mocks.fetch.mockImplementation(async (_url, init) => {
      const b = JSON.parse(init.body);
      const rows = b.dimensions[0] === 'page' ? [row(['https://'])] : b.dimensions.length ? [] : [row()];
      return new globalThis.Response(JSON.stringify({ rows, responseAggregationType: b.aggregationType }));
    });
    const report = (await fetchSeoData({ brandSlug: 'pmma' })).brands![0];
    expect(report.status).toBe('partial');
    expect(report.totals?.clicks).toBe(10);
    expect(report.topPages).toEqual([]);
    expect(report.errors.some(e => e.source === 'page.current' && e.kind === 'invalid_response')).toBe(true);
  });
  it('retains sparse data without claiming missing detail is zero', async () => {
    provider(1);
    const result = await fetchSeoData({ brandSlug: 'pmma' });
    expect(result.brands![0].topQueries).toHaveLength(1);
    expect(result.brands![0].changes['query.falling']).toEqual([]);
    expect(result.brands![0].totals?.position).toBe(12);
    expect(result.brands![0].totals?.ctr).toBe(10);
  });
  it.each([{ rows: [] }, { rows: [row([], 0, 0)] }])('distinguishes empty totals from measured zero: %j', async ({ rows }) => {
    mocks.fetch.mockImplementation(async (_url, init) => {
      const b = JSON.parse(init.body);
      return new globalThis.Response(JSON.stringify({ rows: b.dimensions.length ? [] : rows, responseAggregationType: b.aggregationType }));
    });
    const r = (await fetchSeoData({ brandSlug: 'pmma' })).brands![0];
    expect(r.status).toBe(rows.length ? 'available' : 'no_data');
    expect(r.totals?.clicks ?? null).toBe(rows.length ? 0 : null);
  });
  it.each([
    { rows: null, responseAggregationType: 'byProperty' },
    { rows: [{ ...row(), keys: null }], responseAggregationType: 'byProperty' },
    { rows: [row()], responseAggregationType: 'byPage' },
    { rows: [row(['unexpected'])], responseAggregationType: 'byProperty' },
    { rows: [{ ...row(), clicks: -1 }], responseAggregationType: 'byProperty' },
    { rows: [{ ...row(), impressions: 1.5 }], responseAggregationType: 'byProperty' },
    { rows: [{ ...row(), ctr: 2 }], responseAggregationType: 'byProperty' },
    { rows: [{ ...row(), position: null }], responseAggregationType: 'byProperty' },
    { rows: [row()], responseAggregationType: 'byProperty', metadata: { first_incomplete_date: '2026-03-01' } },
  ])('rejects invalid authoritative responses', async response => {
    mocks.fetch.mockResolvedValue(new globalThis.Response(JSON.stringify(response)));
    const result = await fetchSeoData({ brandSlug: 'pmma' });
    expect(result.ok).toBe(false);
    expect(result.brands![0].totals).toBeNull();
    expect(result.brands![0].errors[0].kind).toBe('invalid_response');
  });
  it('distinguishes permission and all-failed from zero', async () => {
    mocks.fetch.mockImplementation(async () => new globalThis.Response('not exposed', { status: 403 }));
    const result = await fetchSeoData({});
    expect(result.ok).toBe(false);
    expect(result.brands).toHaveLength(3);
    expect(result.brands!.every(b => b.totals === null && b.errors[0].kind === 'permission')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('not exposed');
  });
  it('retains missing property entries in partial reports', async () => {
    mocks.read.mockImplementation((p: string) => {
      if (p.includes('/tsai/')) throw new Error('inert missing profile');
      return JSON.stringify({ site: { url: 'https://example.test' } });
    });
    const result = await fetchSeoData({});
    expect(result.ok).toBe(true);
    expect(result.brands).toHaveLength(3);
    expect(result.brands!.find(b => b.slug === 'tsai')?.status).toBe('unavailable');
  });
  it('retains all missing profiles as unavailable', async () => {
    mocks.read.mockReturnValue('{}');
    const result = await fetchSeoData({});
    expect(result.status).toBe('no_brands');
    expect(result.brands).toHaveLength(3);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('does not turn a previous-period permission failure into zero', async () => {
    mocks.fetch.mockImplementation(async (_url, init) => {
      const b = JSON.parse(init.body);
      if (!b.dimensions.length && b.startDate < '2026-02-07') return new globalThis.Response('', { status: 403 });
      return new globalThis.Response(JSON.stringify({ rows: b.dimensions.length ? [] : [row()], responseAggregationType: b.aggregationType }));
    });
    const report = (await fetchSeoData({ brandSlug: 'pmma' })).brands![0];
    expect(report.status).toBe('partial');
    expect(report.totals?.clicksPrev).toBeNull();
    expect(report.totals?.clicksDeltaPct).toBeNull();
  });
  it.each([0, -1, 1.5, 366, NaN, Infinity])('rejects invalid days %s before transport', async days => {
    expect((await fetchSeoData({ days })).ok).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('rejects unknown brands and invalid profile URLs', async () => {
    expect((await fetchSeoData({ brandSlug: 'unknown' } as never)).ok).toBe(false);
    mocks.read.mockReturnValue(JSON.stringify({ site: { url: 'file:///etc/example' } }));
    expect((await fetchSeoData({ brandSlug: 'pmma' })).status).toBe('no_brands');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('reports query/page rising and falling only for paired observations', async () => {
    mocks.fetch.mockImplementation(async (_url, init) => {
      const b = JSON.parse(init.body);
      const previous = b.startDate < '2026-02-07';
      const key = (s: string) => b.dimensions[0] === 'page' ? `https://example.test/${s}` : s;
      const rows = b.dimensions.length ? [row([key('rising')], previous ? 1 : 9), row([key('falling')], previous ? 9 : 1), row([key(previous ? 'gone' : 'new')])] : [row()];
      return new globalThis.Response(JSON.stringify({ rows, responseAggregationType: b.aggregationType }));
    });
    const r = (await fetchSeoData({ brandSlug: 'pmma' })).brands![0];
    expect(r.changes['query.rising']).toEqual([{ key: 'rising', clicks: 9, clicksPrev: 1, clicksDelta: 8 }]);
    expect(r.changes['page.falling'][0].clicksDelta).toBe(-8);
    expect(Object.values(r.changes).flat()).toHaveLength(4);
  });
  it.each(['invalid-json', 'oversize', 'network', 'duplicate'])('handles %s without fabricating detail totals', async mode => {
    if (mode === 'network') mocks.fetch.mockRejectedValue(new Error('inert network error'));
    else mocks.fetch.mockImplementation(async (_url, init) => {
      const b = JSON.parse(init.body);
      if (mode === 'invalid-json') return new globalThis.Response('{');
      if (mode === 'oversize') return new globalThis.Response(' '.repeat(2_000_001));
      return new globalThis.Response(JSON.stringify({ rows: b.dimensions.length ? [row(['same']), row(['same'])] : [row()], responseAggregationType: b.aggregationType }));
    });
    const r = (await fetchSeoData({ brandSlug: 'pmma' })).brands![0];
    expect(r.status).toBe(mode === 'duplicate' ? 'partial' : 'unavailable');
    expect(r.errors.length).toBeGreaterThan(0);
    if (mode === 'duplicate') expect(r.totals?.clicks).toBe(10);
    else expect(r.totals).toBeNull();
  });
  it('does not call a top-query subset the property total (>250 distinct queries)', async () => {
    const result = await fetchSeoData({ brandSlug: 'pmma' });
    expect(result.brands?.[0].totals?.clicks).toBe(900);
    expect(result.brands?.[0].totals?.impressions).toBe(9000);
    const bodies = mocks.fetch.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(bodies.every(b => !('prevStartDate' in b) && !('prevEndDate' in b))).toBe(true);
    expect(bodies.filter(b => b.dimensions.length === 0)).toHaveLength(2);
    expect(bodies.filter(b => b.dimensions.length === 0).every(b => b.aggregationType === 'byProperty' && b.dataState === 'final')).toBe(true);
  });
});
