import { readFileSync } from 'fs';
import vm from 'vm';
import { describe, it, expect, vi } from 'vitest';
import { getSeoReportDefinition, computeSeoReportActions } from '../../src/tools/seo-report-definition';
import { buildSeoWeeklyReportPrompt, setupSeoCronJobs } from '../../src/main/seo-crons';
import type { FetchSeoDataResult } from '../../src/tools/seo-report';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('../../src/main/ipc/trusted-ipc.js', () => ({ trustedHandle: (name: string, fn: (...args: unknown[]) => unknown) => handlers.set(name, fn) }));
vi.mock('../../src/main/brand-profiles', () => ({ listPublishProfiles: vi.fn() }));
import { registerBrandsIPC } from '../../src/main/ipc/brands-ipc';

function fixture(): FetchSeoDataResult {
  return { ok: true, window: { startDate: '2026-08-01', endDate: '2026-08-28', prevStartDate: '2026-07-04', prevEndDate: '2026-07-31', days: 28, timeZone: 'America/Los_Angeles', dataState: 'final', cutoffDays: 3 }, brands: [{
    slug: 'pmma', shortName: 'PMMA', siteUrl: 'https://example.com/', status: 'available', notes: [], errors: [], changes: {},
    totals: { clicks: 5, impressions: 100, clicksPrev: null, impressionsPrev: null, clicksDeltaPct: null, ctr: 5, position: 12 },
    topQueries: [], topPages: [{ page: 'https://example.com/observed', clicks: 2, impressions: 500, ctr: 0.4, position: 12 }],
    page2Opportunities: Array.from({ length: 8 }, (_, i) => ({ query: `query ${i}`, clicks: i, impressions: 100 + i, ctr: 1, position: 15 })),
    coverage: { 'page.current': { rows: 1, complete: true, truncated: false }, 'query.current': { rows: 8, complete: true, truncated: false } },
    aggregationTypes: { 'page.current': 'byPage', 'query.current': 'byProperty' },
  }] };
}

describe('shared SEO report contract', () => {
  it('executes manual UI against mock trusted IPC with exact cron parity', async () => {
    registerBrandsIPC({ getMemory: () => null } as never);
    const input = { value: '' };
    const send = vi.fn();
    const context = vm.createContext({ console, setTimeout, document: { getElementById: (id: string) => id === 'message-input' ? input : null }, window: { pocketAgent: {
      seoReport: { getDefinition: (scope: unknown) => handlers.get('seoReport:getDefinition')!({}, scope) },
      sessions: { list: async () => [{ id: 'report', name: 'SEO Report' }] },
    } }, switchSession: async () => {}, sendMessage: send });
    vm.runInContext(readFileSync(new URL('../../ui/chat/seo-report-panel.js', import.meta.url), 'utf8'), context);
    await vm.runInContext('startSeoReport()', context);
    expect(input.value).toBe(buildSeoWeeklyReportPrompt());
    expect(input.value).toBe(getSeoReportDefinition().prompt);
    expect(send).toHaveBeenCalledOnce();
    expect(() => handlers.get('seoReport:getDefinition')!({}, { brandSlug: 'evil' })).toThrow();
  });
  it.each([{ brandSlug: 'evil' }, { days: 0 }, { days: 366 }, { days: 1.5 }, { days: '28' }, { extra: true }, null])('rejects invalid scope %j', input => {
    expect(() => getSeoReportDefinition(input as never)).toThrow();
  });
  it('preserves customized and disabled legacy routines, seeds only missing', async () => {
    const existing = [{ name: 'seo_weekly_report', prompt: 'My custom report', enabled: false }];
    const scheduler = { getAllJobs: () => existing, createJob: vi.fn(), deleteJob: vi.fn() };
    await setupSeoCronJobs(scheduler as never);
    expect(existing[0].prompt).toBe('My custom report');
    expect(scheduler.deleteJob).not.toHaveBeenCalled();
    expect(scheduler.createJob.mock.calls.map(c => c[0])).toEqual(['seo_daily_reviews', 'seo_monthly_local']);
    const fresh = { getAllJobs: () => [], createJob: vi.fn() };
    await setupSeoCronJobs(fresh as never);
    expect(fresh.createJob.mock.calls[0][2]).toBe(getSeoReportDefinition().prompt);
  });
  it('ranks at most five observed evidence actions with citations and no query mapping', () => {
    const result = fixture();
    const actions = computeSeoReportActions(result);
    expect(actions).toHaveLength(5);
    expect(actions[0].pageUrl).toBe('https://example.com/observed');
    expect(actions[1].evidence).toBe('query 7');
    expect(actions[1]).not.toHaveProperty('pageUrl');
    expect(actions[1].citation.window).toEqual(result.window);
    expect(actions[1].citation.sourceUrl).toContain(encodeURIComponent('https://example.com/'));
  });
  it.each(['https://evil.com/a', 'javascript:alert(1)', 'https://user:pass@example.com/a'])('rejects unsafe or foreign page %s', page => {
    const result = fixture(); result.brands![0].topPages[0].page = page;
    expect(computeSeoReportActions(result).every(a => a.kind === 'query')).toBe(true);
  });
  it.each(['javascript:alert(1)', 'https://user:pass@example.com/', 'sc-domain:evil/path'])('rejects invalid property citation %s', property => {
    const result = fixture(); result.brands![0].siteUrl = property;
    expect(computeSeoReportActions(result)).toEqual([]);
  });
  it('retains sound evidence from a partial brand without ranking failed sources', () => {
    const result = fixture(); result.status = 'partial'; result.brands![0].status = 'partial';
    result.brands![0].errors.push({ source: 'page.current', kind: 'timed_out', status: 0 });
    expect(computeSeoReportActions(result)).toHaveLength(5);
    expect(computeSeoReportActions(result).every(a => a.kind === 'query')).toBe(true);
  });
  it('does not rank incomplete sources, missing metrics, or canceled results as zero', () => {
    const result = fixture();
    result.brands![0].coverage['query.current'].complete = false;
    result.brands![0].topPages[0].impressions = undefined as never;
    expect(computeSeoReportActions(result)).toEqual([]);
    expect(computeSeoReportActions({ ...fixture(), status: 'canceled' })).toEqual([]);
    result.brands![0].totals = null;
    expect(computeSeoReportActions(result)).toEqual([]);
  });
});
