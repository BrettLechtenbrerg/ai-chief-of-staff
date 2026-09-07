/**
 * fetch_seo_data — pulls real Google Search Console search-analytics data for
 * Brett's brand sites (PMMA, TSAI, brettlechtenberg.com) so the agent can turn
 * it into a plain-English "what's working / what to fix this week" report.
 *
 * Division of labour (mirrors write_daily_posting_packet):
 *   - THIS TOOL does the mechanical, untrustworthy-to-guess part: read the
 *     brand profiles for site URLs, call the Search Console REST API read-only,
 *     and compute clean aggregates (totals + week-over-week deltas, top
 *     queries, top pages, page-2 opportunities). It returns compact JSON.
 *   - THE AGENT does the judgment part: read that JSON and write the prose
 *     summary + prioritized to-do list, then deliver it via send_telegram_message.
 *
 * Safety: only the two read-only Search Console endpoints are ever called; the
 * tool never writes to Google or to the live sites. The site list is restricted
 * to the known brand profiles — the model cannot pass an arbitrary siteUrl. No
 * tokens or secrets are ever logged.
 *
 * Graceful degradation (the first ~2–4 weeks before data/scope exist):
 *   - Google not connected            → friendly "connect Google" note.
 *   - webmasters.readonly not granted → "reconnect and approve Search Console".
 *   - property new / no rows yet      → per-site "no data yet" note.
 * None of these throw; the cron still delivers something useful.
 */

import { computeSeoReportActions, SEO_REPORT_VERSION, type SeoReportAction } from './seo-report-definition';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GoogleOAuth } from '../auth/google-oauth';
import {
  floTokenExists,
  floHasSearchConsoleScope,
  getFloAccessToken,
} from '../auth/flo-google-token';

/** Root holding the per-brand profile.json files (single source of truth). */
const BRAND_PROFILES_ROOT = path.join(os.homedir(), 'dev', '_brand-profiles');

/**
 * Slug the model may pass → the brand-profile folder name. We expose short,
 * memorable slugs ('brett') and map them to the real folder ('brett-personal').
 */
const BRAND_SLUG_TO_FOLDER: Record<string, string> = {
  pmma: 'pmma',
  tsai: 'tsai',
  brett: 'brett-personal',
};

/** All brands, in report order, when brandSlug is 'all' or omitted. */
const ALL_BRAND_SLUGS = ['pmma', 'tsai', 'brett'] as const;

const DEFAULT_DAYS = 28;
const ROW_LIMIT = 250;
const MAX_DETAIL_ROWS = 1000;
const MAX_RESPONSE_BYTES = 2_000_000;
/** Search Console data lags ~2–3 days; offset the window end so we don't query
 * a tail of guaranteed-empty days. */
const DATA_LAG_DAYS = 3;

interface BrandSite {
  slug: string;
  shortName: string;
  /** Property string normalized for the API: URL-prefix form WITH trailing slash. */
  siteUrl: string;
  /**
   * Both the www and non-www URL-prefix variants (trailing slash), in priority
   * order. Search Console properties are registered inconsistently — e.g. PMMA
   * is registered as `personalmasterymartialarts.com` (no www) while the brand
   * profile and live site use `www`. We try each candidate until one returns
   * data (or a non-access error), so a www/non-www mismatch never silently
   * yields an empty report.
   */
  siteUrlCandidates: string[];
}

/** A single row as returned by searchAnalytics/query. */
interface SearchAnalyticsRow {
  keys?: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface QueryStat {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface PageStat {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface BrandReport {
  slug: string;
  shortName: string;
  siteUrl: string;
  /** null when this site has no data / couldn't be read; see `notes`. */
  totals: {
    clicks: number;
    impressions: number;
    clicksPrev: number | null;
    clicksDeltaPct: number | null;
    ctr: number;
    position: number;
    impressionsPrev: number | null;
  } | null;
  topQueries: QueryStat[];
  topPages: PageStat[];
  /** Queries ranking on page 2 (position 11–20), sorted by impressions desc. */
  page2Opportunities: QueryStat[];
  notes: string[];
  status: 'available' | 'no_data' | 'unavailable' | 'partial';
  errors: Array<{ source: string; kind: string; status: number }>;
  coverage: Record<string, { rows: number; truncated: boolean; complete: boolean }>;
  aggregationTypes: Record<string, string>;
  changes: Record<string, Array<{ key: string; clicks: number; clicksPrev: number; clicksDelta: number }>>;
}

export interface FetchSeoDataInput {
  brandSlug?: 'pmma' | 'tsai' | 'brett' | 'all';
  days?: number;
}

export interface FetchSeoDataResult {
  ok: boolean;
  /** Present when the whole call short-circuits (auth/scope/config). */
  status?: 'not_connected' | 'missing_scope' | 'no_brands' | 'error' | 'timed_out' | 'canceled' | 'partial' | 'all_failed';
  /** Human-readable summary the agent can relay verbatim if it wants. */
  message?: string;
  /** ISO dates describing the window actually queried. */
  window?: { startDate: string; endDate: string; prevStartDate: string; prevEndDate: string; days: number; timeZone: string; dataState: string; cutoffDays: number };
  brands?: BrandReport[];
  definitionVersion?: string;
  actions?: SeoReportAction[];
}

/** Internal execution controls, never part of the model schema. */
export interface SeoFetchOptions { signal?: AbortSignal; requestTimeoutMs?: number; runTimeoutMs?: number }
class SeoRun {
  readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  readonly requestTimeout: number;
  readonly end: number;
  private active = 0;
  private requests = 0;
  private rows = 0;
  private queue: Array<() => void> = [];
  private timer: ReturnType<typeof setTimeout>;
  private external?: AbortSignal;
  private cancel = () => this.controller.abort('canceled');
  constructor(options: SeoFetchOptions) {
    this.requestTimeout = Math.max(1, Math.min(options.requestTimeoutMs ?? 15_000, 15_000));
    const duration = Math.max(1, Math.min(options.runTimeoutMs ?? 90_000, 90_000));
    this.end = Date.now() + duration;
    this.external = options.signal;
    this.timer = setTimeout(() => this.controller.abort('timed_out'), duration);
    this.external?.addEventListener('abort', this.cancel, { once: true });
    if (this.external?.aborted) this.cancel();
    this.signal.addEventListener('abort', () => { for (const resume of this.queue.splice(0)) resume(); }, { once: true });
  }
  check() { if (this.signal.aborted) throw new Error(String(this.signal.reason)); }
  async slot<T>(work: () => Promise<T>): Promise<T> {
    this.check();
    if (this.active >= 4) await new Promise<void>(resolve => this.queue.push(resolve));
    this.check();
    this.active++;
    try { return await work(); }
    finally { this.active--; this.queue.shift()?.(); }
  }
  request() { this.check(); if (++this.requests > 90) throw new Error('budget_exhausted'); }
  acceptRows(count: number) { this.check(); if (this.rows + count > 12_006) throw new Error('budget_exhausted'); this.rows += count; }
  async token(work: () => Promise<string | null>) {
    const timer = setTimeout(() => this.controller.abort('timed_out'), this.requestTimeout);
    try { this.check(); return await abortable(work(), this.signal); }
    finally { clearTimeout(timer); }
  }
  dispose() { clearTimeout(this.timer); this.external?.removeEventListener('abort', this.cancel); }
}
/** Race even transports/token refresh APIs that ignore AbortSignal. Late values are discarded. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new Error(String(signal.reason))); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    promise.then(value => { signal.removeEventListener('abort', abort); if (!signal.aborted) resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
async function delay(ms: number, signal: AbortSignal) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await abortable(new Promise<void>(resolve => { timer = setTimeout(resolve, ms); }), signal); }
  finally { clearTimeout(timer); }
}

/** YYYY-MM-DD in UTC for a Date. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Normalize a profile's site URL to the exact Search Console URL-prefix
 * property string: it MUST end with a trailing slash, or the API returns 403.
 * Our profiles store the URL without one.
 */
function normalizeSiteUrl(url: string): string {
  const trimmed = url.trim();
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

/**
 * Produce both the www and non-www URL-prefix property candidates (trailing
 * slash, www variant first), deduped. Lets us tolerate inconsistent Search
 * Console property registration without changing the brand profile's site.url
 * (which other features — blog links etc. — depend on).
 */
function siteUrlCandidates(url: string): string[] {
  const normalized = normalizeSiteUrl(url);
  let host: string;
  try {
    host = new URL(normalized).host;
  } catch {
    return [normalized];
  }
  const withWww = host.startsWith('www.')
    ? normalized
    : normalized.replace(`://${host}`, `://www.${host}`);
  const noWww = host.startsWith('www.')
    ? normalized.replace(`://${host}`, `://${host.slice(4)}`)
    : normalized;
  // www first (matches our profiles + most live sites), then bare domain.
  return Array.from(new Set([withWww, noWww]));
}

/**
 * Read a brand profile and return its site identity, or null if the profile
 * is missing/malformed/has no site URL (skipped with a note rather than thrown).
 */
function readBrandSite(slug: string): BrandSite | null {
  const folder = BRAND_SLUG_TO_FOLDER[slug];
  if (!folder) return null;
  const profilePath = path.join(BRAND_PROFILES_ROOT, folder, 'profile.json');
  try {
    const raw = fs.readFileSync(profilePath, 'utf8');
    const parsed = JSON.parse(raw) as {
      shortName?: string;
      site?: { url?: string };
    };
    const url = parsed.site?.url;
    if (!url || typeof url !== 'string') return null;
    if (url.length > 2048) return null;
    const property = new URL(url);
    if (!['https:', 'http:'].includes(property.protocol) || property.username || property.password || property.search || property.hash) return null;
    const candidates = siteUrlCandidates(url);
    return {
      slug,
      shortName: typeof parsed.shortName === 'string' ? parsed.shortName.slice(0, 100) : slug.toUpperCase(),
      siteUrl: candidates[0],
      siteUrlCandidates: candidates,
    };
  } catch {
    return null;
  }
}

/**
 * POST one searchAnalytics/query call. Returns rows, or a structured failure
 * the caller turns into a per-site note (e.g. 403 → account mismatch).
 */
async function querySearchAnalyticsOnce(
  accessToken: string,
  siteUrl: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<{ rows: SearchAnalyticsRow[]; aggregationType: string } | { error: string; status: number; retryAfter?: number }> {
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
    siteUrl,
  )}/searchAnalytics/query`;
  let resp: Response;
  try {
    resp = await abortable(fetch(endpoint, {
      signal,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }).then(response => { if (signal.aborted) { void response.body?.cancel().catch(() => undefined); throw new Error('canceled'); } return response; }), signal);
  } catch (error) {
    const code = (error as { cause?: { code?: string }; code?: string })?.cause?.code ?? (error as { code?: string })?.code;
    return { error: signal.aborted ? String(signal.reason) : ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code ?? '') ? 'transient_network' : 'network', status: 0 };
  }
  if (!resp.ok) {
    void resp.body?.cancel().catch(() => undefined);
    const retry = resp.headers.get('retry-after');
    const retryAfter = retry === null ? undefined : /^\d+(\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now());
    return { retryAfter, error: resp.status === 403 || resp.status === 401 ? 'permission' : resp.status === 404 ? 'missing_property' : 'http', status: resp.status };
  }
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let complete = false;
  try {
    // Bound the actual stream, not just Content-Length or the parsed row count.
    reader = resp.body?.getReader();
    if (!reader) throw new Error('empty body');
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await abortable(reader.read(), signal);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { throw new Error('oversize'); }
      chunks.push(part.value);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const dimensions = body.dimensions as string[];
    const allowedAggregation = body.aggregationType === 'auto' ? ['auto', 'byPage'] : [body.aggregationType];
    if (!data || typeof data !== 'object' || Array.isArray(data) || !allowedAggregation.includes(data.responseAggregationType)) throw new Error('aggregation');
    if (data.metadata != null && (typeof data.metadata !== 'object' || Array.isArray(data.metadata) ||
      Object.hasOwn(data.metadata, 'first_incomplete_date') || Object.hasOwn(data.metadata, 'first_incomplete_hour'))) throw new Error('incomplete final data');
    const rows = data.rows === undefined ? [] : data.rows;
    if (!Array.isArray(rows) || rows.length > Number(body.rowLimit)) throw new Error('rows');
    const seen = new Set<string>();
    for (const row of rows) {
      if (!row || typeof row !== 'object') throw new Error('row');
      const keys = row.keys === undefined ? [] : row.keys;
      if (!Array.isArray(keys) || keys.length !== dimensions.length || keys.some((key: unknown) => typeof key !== 'string' || !key.length || key.length > 8192)) throw new Error('keys');
      if (dimensions[0] === 'page') {
        const page = new URL(keys[0]);
        if (!['http:', 'https:'].includes(page.protocol) || page.username || page.password) throw new Error('page');
      }
      const identity = JSON.stringify(keys);
      if (seen.has(identity)) throw new Error('duplicate');
      seen.add(identity);
      if (![row.clicks, row.impressions].every(n => Number.isSafeInteger(n) && n >= 0) || row.clicks > row.impressions) throw new Error('counts');
      if (!Number.isFinite(row.ctr) || row.ctr < 0 || row.ctr > 1 || Math.abs(row.ctr - (row.impressions ? row.clicks / row.impressions : 0)) > 0.00001) throw new Error('ctr');
      if (!Number.isFinite(row.position) || row.position < (row.impressions ? 1 : 0) || row.position > 1_000_000) throw new Error('position');
    }
    if (signal.aborted) throw new Error('canceled');
    complete = true;
    return { rows, aggregationType: data.responseAggregationType };
  } catch {
    return { error: signal.aborted ? String(signal.reason) : 'invalid_response', status: 502 };
  } finally {
    if (!complete) void reader?.cancel().catch(() => undefined);
    reader?.releaseLock();
  }
}


async function querySearchAnalytics(token: string, siteUrl: string, body: Record<string, unknown>, run: SeoRun) {
  try {
    return await run.slot(async () => {
      for (let attempt = 0; ; attempt++) {
        run.request();
        const controller = new AbortController();
        const abort = () => controller.abort(run.signal.reason);
        run.signal.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(() => controller.abort('timed_out'), run.requestTimeout);
        let result;
        try { result = await querySearchAnalyticsOnce(token, siteUrl, body, controller.signal); }
        finally { clearTimeout(timer); run.signal.removeEventListener('abort', abort); }
        run.check();
        if (!('error' in result)) { run.acceptRows(result.rows.length); return result; }
        const retryable = result.error === 'transient_network' || result.error === 'http' && (result.status === 429 || result.status >= 500);
        if (!retryable || attempt >= 2) return result;
        const wait = Math.max(500 * 2 ** attempt, result.retryAfter !== undefined && !Number.isNaN(result.retryAfter) ? result.retryAfter : 0);
        if (Date.now() + wait >= run.end) return { error: 'timed_out', status: 0 };
        await delay(wait, run.signal);
      }
    });
  } catch (error) {
    const kind = error instanceof Error && ['canceled', 'timed_out', 'budget_exhausted'].includes(error.message) ? error.message : 'network';
    return { error: kind, status: 0 };
  }
}

function toQueryStat(row: SearchAnalyticsRow): QueryStat {
  return {
    query: row.keys?.[0] ?? '',
    clicks: Math.round(row.clicks ?? 0),
    impressions: Math.round(row.impressions ?? 0),
    ctr: Number(((row.ctr ?? 0) * 100).toFixed(2)),
    position: Number((row.position ?? 0).toFixed(1)),
  };
}

function toPageStat(row: SearchAnalyticsRow): PageStat {
  return {
    page: row.keys?.[0] ?? '',
    clicks: Math.round(row.clicks ?? 0),
    impressions: Math.round(row.impressions ?? 0),
    ctr: Number(((row.ctr ?? 0) * 100).toFixed(2)),
    position: Number((row.position ?? 0).toFixed(1)),
  };
}

/** Map a non-OK API result into a friendly per-site note. */
function noteForApiError(shortName: string, status: number, detail: string): string {
  if (status === 403) {
    return `${shortName}: this Google account can't read this property (403). Connect the Google account that owns the Search Console property, or add the connected account as a user on it.`;
  }
  if (status === 404) {
    return `${shortName}: property not found in Search Console (404). Make sure the URL-prefix property exists for this exact site URL.`;
  }
  if (status === 0) {
    return `${shortName}: couldn't reach Google (${detail}). Will retry next run.`;
  }
  return `${shortName}: Search Console returned ${status}. ${detail}`.trim();
}

/**
 * Pick the URL-prefix property variant (www vs non-www) that this account can
 * actually read, by issuing a cheap query against each candidate. Returns the
 * working URL plus its rows, or the last error if none worked. Avoids a
 * www/non-www mismatch silently producing an empty report.
 */
async function resolveWorkingProperty(
  accessToken: string,
  site: BrandSite,
  window: { startDate: string; endDate: string },
  run: SeoRun,
): Promise<
  | { siteUrl: string; rows: SearchAnalyticsRow[]; aggregationType: string }
  | { error: string; status: number }
> {
  let lastError: { error: string; status: number } = {
    error: 'no candidates',
    status: 0,
  };
  for (const candidate of site.siteUrlCandidates) {
    const res = await querySearchAnalytics(accessToken, candidate, {
      startDate: window.startDate,
      endDate: window.endDate,
      dimensions: [],
      aggregationType: 'byProperty',
      dataState: 'final',
      rowLimit: 1,
    }, run);
    if (!('error' in res)) {
      return { siteUrl: candidate, rows: res.rows, aggregationType: res.aggregationType };
    }
    lastError = res;
    // 403 (no access) / 404 (not found) → try the other variant. Any other
    // status (network, quota) is unlikely to differ by variant, so stop.
    if (res.status !== 403 && res.status !== 404) break;
  }
  return lastError;
}

/** Detail rows are bounded evidence, never additive property totals. */
async function queryDetails(token: string, siteUrl: string, dates: { startDate: string; endDate: string }, dimension: 'query' | 'page', run: SeoRun) {
  const rows: SearchAnalyticsRow[] = [];
  const seen = new Set<string>();
  let aggregationType: string | null = null;
  for (let startRow = 0; startRow < MAX_DETAIL_ROWS; startRow += ROW_LIMIT) {
    const result = await querySearchAnalytics(token, siteUrl, {
      startDate: dates.startDate, endDate: dates.endDate,
      dimensions: [dimension], aggregationType: dimension === 'page' ? 'auto' : 'byProperty',
      dataState: 'final', rowLimit: ROW_LIMIT, startRow,
    }, run);
    if ('error' in result) return { rows, truncated: false, aggregationType, error: result };
    if (aggregationType !== null && aggregationType !== result.aggregationType) return { rows, truncated: false, aggregationType, error: { error: 'aggregation_changed', status: 502 } };
    aggregationType = result.aggregationType;
    for (const row of result.rows) {
      const key = row.keys![0];
      if (seen.has(key)) return { rows, truncated: false, aggregationType, error: { error: 'invalid_response', status: 502 } };
      seen.add(key);
      rows.push(row);
    }
    if (result.rows.length < ROW_LIMIT) return { rows, truncated: false, aggregationType };
  }
  return { rows, truncated: true, aggregationType };
}

function emptyReport(slug: string, shortName = slug.toUpperCase(), siteUrl = ''): BrandReport {
  return { slug, shortName, siteUrl, totals: null, topQueries: [], topPages: [], page2Opportunities: [],
    notes: [], status: 'unavailable', errors: [], coverage: {}, aggregationTypes: {}, changes: {} };
}

/** Resolve candidates sequentially, then fetch independent sources concurrently. */
async function buildBrandReport(
  accessToken: string,
  site: BrandSite,
  window: { startDate: string; endDate: string; prevStartDate: string; prevEndDate: string },
  run: SeoRun,
): Promise<BrandReport> {
  const report = emptyReport(site.slug, site.shortName, site.siteUrl);
  const fail = (source: string, error: { error: string; status: number }) => {
    report.errors.push({ source, kind: error.error, status: error.status });
    report.notes.push(noteForApiError(site.shortName, error.status, error.error));
  };
  const current = await resolveWorkingProperty(accessToken, site, window, run);
  if ('error' in current) { fail('totals.current', current); return report; }
  report.siteUrl = current.siteUrl;
  report.aggregationTypes['totals.current'] = current.aggregationType;
  const previousDates = { startDate: window.prevStartDate, endDate: window.prevEndDate };
  const previousWork = querySearchAnalytics(accessToken, report.siteUrl, {
    ...previousDates, dimensions: [], aggregationType: 'byProperty', dataState: 'final', rowLimit: 1,
  }, run);
  const detailWork = (['query', 'page'] as const).map(dimension => Promise.all([
    queryDetails(accessToken, report.siteUrl, window, dimension, run),
    queryDetails(accessToken, report.siteUrl, previousDates, dimension, run),
  ]));
  const previous = await previousWork;
  if ('error' in previous) fail('totals.previous', previous);
  else report.aggregationTypes['totals.previous'] = previous.aggregationType;
  const total = current.rows[0];
  const prior = 'error' in previous ? undefined : previous.rows[0];
  report.status = total ? 'available' : 'no_data';
  if (total) {
    report.totals = {
      clicks: total.clicks, impressions: total.impressions, ctr: total.ctr * 100, position: total.position,
      clicksPrev: prior?.clicks ?? null, impressionsPrev: prior?.impressions ?? null,
      clicksDeltaPct: prior && prior.clicks > 0 ? Number(((total.clicks - prior.clicks) / prior.clicks * 100).toFixed(1)) : null,
    };
  } else report.notes.push('No finalized property data for the current period; this is not an observed zero.');
  if (!prior && !('error' in previous)) report.notes.push('No finalized property data for the previous period.');
  report.notes.push('Query and page rows are separate top-row evidence, not additive property totals. Coverage.complete means pagination finished, not exhaustive search coverage. At most 1000 rows per dimension/period are fetched; displayed lists are top subsets. Omitted/anonymized rows cannot be recovered by pagination. Changes compare only keys observed in both exact periods, not missing keys as zero. No query-to-page mapping is measured.');
  for (const dimension of ['query', 'page'] as const) {
    const [now, before] = await detailWork[dimension === 'query' ? 0 : 1];
    for (const [period, result] of [['current', now], ['previous', before]] as const) {
      const source = `${dimension}.${period}`;
      report.coverage[source] = { rows: result.rows.length, truncated: result.truncated, complete: !result.error && !result.truncated };
      if (result.aggregationType !== null) report.aggregationTypes[source] = result.aggregationType;
      if (result.error) fail(source, result.error);
    }
    const sorted = [...now.rows].sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions || (a.keys![0] < b.keys![0] ? -1 : 1));
    if (dimension === 'query') {
      report.topQueries = sorted.slice(0, 5).map(toQueryStat);
      report.page2Opportunities = sorted.filter(r => r.position >= 11 && r.position <= 20)
        .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks || (a.keys![0] < b.keys![0] ? -1 : 1)).slice(0, 10).map(toQueryStat);
    } else report.topPages = sorted.slice(0, 5).map(toPageStat);
    // Missing detail keys are unknown, NOT zero: compare only observed pairs.
    const priorByKey = new Map(before.rows.map(r => [r.keys![0], r]));
    const changes = now.rows.flatMap(r => {
      const p = priorByKey.get(r.keys![0]);
      return p ? [{ key: r.keys![0], clicks: r.clicks, clicksPrev: p.clicks, clicksDelta: r.clicks - p.clicks }] : [];
    });
    for (const direction of ['rising', 'falling'] as const) {
      report.changes[`${dimension}.${direction}`] = changes.filter(r => direction === 'rising' ? r.clicksDelta > 0 : r.clicksDelta < 0)
        .sort((a, b) => (direction === 'rising' ? b.clicksDelta - a.clicksDelta : a.clicksDelta - b.clicksDelta) || (a.key < b.key ? -1 : 1)).slice(0, 5);
    }
  }
  if (report.errors.length) report.status = 'partial';
  return report;
}

export async function fetchSeoData(input: FetchSeoDataInput, options: SeoFetchOptions = {}): Promise<FetchSeoDataResult> {
  const run = new SeoRun(options);
  try {
    run.check();
    const result = await fetchSeoDataRun(input, run);
    // Cancellation can arrive between the inner result and this continuation.
    const finalized = run.signal.aborted ? { ...result, ok: false, status: run.signal.reason } : result;
    return { ...finalized, definitionVersion: SEO_REPORT_VERSION, actions: computeSeoReportActions(finalized) };
  }
  catch { return { ok: false, status: run.signal.aborted ? run.signal.reason : 'error', message: 'SEO fetch did not complete.' }; }
  finally { run.dispose(); }
}
async function fetchSeoDataRun(input: FetchSeoDataInput, run: SeoRun): Promise<FetchSeoDataResult> {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['brandSlug', 'days'].includes(key)) ||
      (input.brandSlug !== undefined && !['all', ...ALL_BRAND_SLUGS].includes(input.brandSlug)) ||
      (input.days !== undefined && (!Number.isInteger(input.days) || input.days < 1 || input.days > 365))) {
    return { ok: false, status: 'error', message: 'Invalid input: use a known brand and an integer days value from 1 to 365.' };
  }
  const days = input.days ?? DEFAULT_DAYS;

  // Resolve which brands to report on.
  const requested =
    !input?.brandSlug || input.brandSlug === 'all'
      ? [...ALL_BRAND_SLUGS]
      : [input.brandSlug];

  const sites: BrandSite[] = [];
  const skippedNotes: string[] = [];
  const missing: BrandReport[] = [];
  for (const slug of requested) {
    const site = readBrandSite(slug);
    if (site) {
      sites.push(site);
    } else {
      const report = emptyReport(slug);
      report.errors.push({ source: 'profile', kind: 'missing_or_invalid_property', status: 0 });
      report.notes.push('Profile missing or invalid; property data unavailable.');
      missing.push(report);
      skippedNotes.push(`Could not read a site URL for brand "${slug}" — profile missing or malformed.`);
    }
  }

  if (sites.length === 0) {
    return {
      ok: false,
      status: 'no_brands',
      brands: missing,
      message:
        'No brand sites could be resolved. ' + skippedNotes.join(' '),
    };
  }

  // Auth gate — graceful, never throws. Two possible Google token sources:
  //   1. ACOS's own OAuth (what testers use): <userData>/google-tokens.json
  //   2. The legacy flo token (Brett's personal machine): ~/.flo/tokens.json
  // We prefer ACOS's own token when it has the Search Console scope, and fall
  // back to the flo token otherwise. This lets the SEO report work on Brett's
  // flo-based setup WITHOUT converting it to the new system (which has broken
  // things before), while still working out-of-the-box for testers.
  const acosConnected = GoogleOAuth.getStatus().connected;
  const acosHasScope = acosConnected && GoogleOAuth.hasSearchConsoleScope();

  let accessToken: string | null = null;
  if (acosHasScope) {
    accessToken = await run.token(() => GoogleOAuth.getAccessToken());
  } else if (floTokenExists() && floHasSearchConsoleScope()) {
    accessToken = await run.token(() => getFloAccessToken());
  }

  if (!accessToken) {
    // Distinguish "nothing connected at all" from "connected but missing scope"
    // so the message tells Brett exactly what to do.
    const anyGoogleConnected = acosConnected || floTokenExists();
    if (!anyGoogleConnected) {
      return {
        ok: false,
        status: 'not_connected',
        message:
          'Google is not connected. Connect the Google account that owns the Search Console properties (brett@brettlechtenberg.com), then re-run the SEO report.',
      };
    }
    return {
      ok: false,
      status: 'missing_scope',
      message:
        'Google is connected but the Search Console (read-only) permission has not been granted yet. ' +
        'On Brett\'s machine: re-run flo authentication (cd ~/flo-assistant && node scripts/authenticate.js) and approve the new Search Console permission. ' +
        'For tester builds: Settings → Connections → Google → Reconnect and approve "Search Console". ' +
        'Until then, no SEO data can be pulled.',
    };
  }

  // Compute the two comparison windows. Search Console lags a few days, so the
  // window ends DATA_LAG_DAYS ago. The previous window is the equally-sized
  // block immediately before it (week-over-week / period-over-period).
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  // Calendar arithmetic on a UTC surrogate avoids both local-zone and DST drift.
  const end = new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - DATA_LAG_DAYS);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const prevEnd = new Date(start);
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setUTCDate(prevStart.getUTCDate() - (days - 1));

  const window = {
    startDate: isoDate(start),
    endDate: isoDate(end),
    prevStartDate: isoDate(prevStart),
    prevEndDate: isoDate(prevEnd),
  };

  const brands: BrandReport[] = [...missing, ...await Promise.all(sites.map(site => buildBrandReport(accessToken, site, window, run)))];

  // Attach any profile-resolution notes to the first brand so nothing is lost.
  if (skippedNotes.length > 0 && brands.length > 0) {
    brands[0].notes.push(...skippedNotes);
  }

  brands.sort((a, b) => requested.indexOf(a.slug as typeof requested[number]) - requested.indexOf(b.slug as typeof requested[number]));
  return {
    ok: !run.signal.aborted && brands.some(b => b.status !== 'unavailable'),
    status: run.signal.aborted ? run.signal.reason : brands.every(b => b.status === 'unavailable') ? (brands.some(b => b.errors.some(e => e.kind === 'timed_out')) ? 'timed_out' : 'all_failed') : brands.some(b => b.status === 'partial' || b.status === 'unavailable') ? 'partial' : undefined,
    message: brands.every(b => b.status === 'unavailable') ? 'SEO data unavailable for every requested property.' : undefined,
    window: { ...window, days, timeZone: 'America/Los_Angeles', dataState: 'final', cutoffDays: DATA_LAG_DAYS },
    brands,
  };
}

export function getFetchSeoDataToolDefinition() {
  return {
    name: 'fetch_seo_data',
    description:
      "Pull real Google Search Console search-analytics data (read-only) for Brett's brand sites — PMMA, TSAI, and brettlechtenberg.com — and return clean JSON: total clicks & impressions with week-over-week delta, top queries, top pages, and page-2 opportunities (queries ranking position 11–20, the best near-wins). Use this to write the weekly SEO report. It NEVER changes Google or the live sites. If Google isn't connected or the Search Console permission hasn't been granted, it returns ok:false with a `status` and a `message` you should relay to Brett (tell him to approve the permission in Settings → Connections). New properties may legitimately have no data yet — surfaced per-site in `notes`. After calling, summarize each site in plain English and end with a prioritized cross-site to-do list.",
    input_schema: {
      type: 'object' as const,
      additionalProperties: false,
      properties: {
        brandSlug: {
          type: 'string',
          enum: ['pmma', 'tsai', 'brett', 'all'],
          description:
            "Which brand to pull. 'pmma' = Personal Mastery Martial Arts, 'tsai' = Total Success AI, 'brett' = brettlechtenberg.com, 'all' = all three (default).",
        },
        days: {
          type: 'integer',
          minimum: 1,
          maximum: 365,
          description:
            'Size of the reporting window in days (default 28). The previous equally-sized window is used for the week-over-week delta.',
        },
      },
      required: [],
    },
  };
}

export async function handleFetchSeoDataTool(input: unknown, options: SeoFetchOptions = {}): Promise<string> {
  const result = await fetchSeoData((input as FetchSeoDataInput) ?? {}, options);
  return JSON.stringify(result);
}
