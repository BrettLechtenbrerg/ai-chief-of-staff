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

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GoogleOAuth } from '../auth/google-oauth';

/** Root holding the per-brand profile.json files (single source of truth). */
const BRAND_PROFILES_ROOT = path.join(os.homedir(), 'dev', '_brand-profiles');

/** The read-only Search Console scope this tool requires. */
const SEARCH_CONSOLE_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

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
const ROW_LIMIT = 25;
/** Search Console data lags ~2–3 days; offset the window end so we don't query
 * a tail of guaranteed-empty days. */
const DATA_LAG_DAYS = 3;

interface BrandSite {
  slug: string;
  shortName: string;
  /** Property string normalized for the API: URL-prefix form WITH trailing slash. */
  siteUrl: string;
}

/** A single row as returned by searchAnalytics/query. */
interface SearchAnalyticsRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
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
    clicksPrev: number;
    clicksDeltaPct: number | null;
  } | null;
  topQueries: QueryStat[];
  topPages: PageStat[];
  /** Queries ranking on page 2 (position 11–20), sorted by impressions desc. */
  page2Opportunities: QueryStat[];
  notes: string[];
}

export interface FetchSeoDataInput {
  brandSlug?: 'pmma' | 'tsai' | 'brett' | 'all';
  days?: number;
}

export interface FetchSeoDataResult {
  ok: boolean;
  /** Present when the whole call short-circuits (auth/scope/config). */
  status?: 'not_connected' | 'missing_scope' | 'no_brands' | 'error';
  /** Human-readable summary the agent can relay verbatim if it wants. */
  message?: string;
  /** ISO dates describing the window actually queried. */
  window?: { startDate: string; endDate: string; days: number };
  brands?: BrandReport[];
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
    return {
      slug,
      shortName: parsed.shortName || slug.toUpperCase(),
      siteUrl: normalizeSiteUrl(url),
    };
  } catch {
    return null;
  }
}

/**
 * POST one searchAnalytics/query call. Returns rows, or a structured failure
 * the caller turns into a per-site note (e.g. 403 → account mismatch).
 */
async function querySearchAnalytics(
  accessToken: string,
  siteUrl: string,
  body: Record<string, unknown>,
): Promise<{ rows: SearchAnalyticsRow[] } | { error: string; status: number }> {
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
    siteUrl,
  )}/searchAnalytics/query`;
  let resp: Response;
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { error: `network error: ${(e as Error).message}`, status: 0 };
  }
  if (!resp.ok) {
    // Read a little of the body for context but never log it.
    let detail = '';
    try {
      detail = (await resp.text()).slice(0, 200);
    } catch {
      // ignore
    }
    return { error: detail || resp.statusText, status: resp.status };
  }
  const data = (await resp.json()) as { rows?: SearchAnalyticsRow[] };
  return { rows: data.rows ?? [] };
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

function sumClicks(rows: SearchAnalyticsRow[]): number {
  return rows.reduce((acc, r) => acc + (r.clicks ?? 0), 0);
}

function sumImpressions(rows: SearchAnalyticsRow[]): number {
  return rows.reduce((acc, r) => acc + (r.impressions ?? 0), 0);
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

/** Build the full report for one site. */
async function buildBrandReport(
  accessToken: string,
  site: BrandSite,
  window: { startDate: string; endDate: string; prevStartDate: string; prevEndDate: string },
): Promise<BrandReport> {
  const report: BrandReport = {
    slug: site.slug,
    shortName: site.shortName,
    siteUrl: site.siteUrl,
    totals: null,
    topQueries: [],
    topPages: [],
    page2Opportunities: [],
    notes: [],
  };

  // Current-window queries.
  const queryRes = await querySearchAnalytics(accessToken, site.siteUrl, {
    startDate: window.startDate,
    endDate: window.endDate,
    dimensions: ['query'],
    rowLimit: ROW_LIMIT,
  });
  if ('error' in queryRes) {
    report.notes.push(noteForApiError(site.shortName, queryRes.status, queryRes.error));
    return report;
  }

  // Previous-window queries (for week-over-week click delta).
  const prevRes = await querySearchAnalytics(accessToken, site.siteUrl, {
    startDate: window.prevStartDate,
    endDate: window.prevEndDate,
    dimensions: ['query'],
    rowLimit: ROW_LIMIT,
  });

  // Current-window pages.
  const pageRes = await querySearchAnalytics(accessToken, site.siteUrl, {
    startDate: window.startDate,
    endDate: window.endDate,
    dimensions: ['page'],
    rowLimit: ROW_LIMIT,
  });

  const queryRows = queryRes.rows;
  if (queryRows.length === 0) {
    report.notes.push(
      `${site.shortName}: no Search Console data yet for ${window.startDate}–${window.endDate} (property may be new — check back in a couple of weeks).`,
    );
    report.totals = {
      clicks: 0,
      impressions: 0,
      clicksPrev: 'error' in prevRes ? 0 : Math.round(sumClicks(prevRes.rows)),
      clicksDeltaPct: null,
    };
    return report;
  }

  const clicks = Math.round(sumClicks(queryRows));
  const impressions = Math.round(sumImpressions(queryRows));
  const clicksPrev = 'error' in prevRes ? 0 : Math.round(sumClicks(prevRes.rows));
  const clicksDeltaPct =
    clicksPrev > 0 ? Number((((clicks - clicksPrev) / clicksPrev) * 100).toFixed(1)) : null;

  report.totals = { clicks, impressions, clicksPrev, clicksDeltaPct };
  report.topQueries = queryRows.slice(0, 5).map(toQueryStat);

  // Page-2 opportunities: position 11–20, sorted by impressions desc (highest
  // potential to pull onto page 1 with a small content/title tweak).
  report.page2Opportunities = queryRows
    .map(toQueryStat)
    .filter((q) => q.position >= 11 && q.position <= 20)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 10);

  if ('error' in pageRes) {
    report.notes.push(
      `${site.shortName}: top-pages query failed (${pageRes.status}); query data is still above.`,
    );
  } else {
    report.topPages = pageRes.rows.slice(0, 5).map(toPageStat);
  }

  return report;
}

export async function fetchSeoData(input: FetchSeoDataInput): Promise<FetchSeoDataResult> {
  const days = Number.isFinite(input?.days) && (input?.days as number) > 0
    ? Math.floor(input!.days as number)
    : DEFAULT_DAYS;

  // Resolve which brands to report on.
  const requested =
    !input?.brandSlug || input.brandSlug === 'all'
      ? [...ALL_BRAND_SLUGS]
      : [input.brandSlug];

  const sites: BrandSite[] = [];
  const skippedNotes: string[] = [];
  for (const slug of requested) {
    const site = readBrandSite(slug);
    if (site) {
      sites.push(site);
    } else {
      skippedNotes.push(`Could not read a site URL for brand "${slug}" — profile missing or malformed.`);
    }
  }

  if (sites.length === 0) {
    return {
      ok: false,
      status: 'no_brands',
      message:
        'No brand sites could be resolved. ' + skippedNotes.join(' '),
    };
  }

  // Auth gate — graceful, never throws.
  const accessToken = await GoogleOAuth.getAccessToken();
  if (!accessToken) {
    return {
      ok: false,
      status: 'not_connected',
      message:
        'Google is not connected. Open Settings → Connections → Google and connect the account that owns the Search Console properties (personalmastery1@gmail.com), then re-run the SEO report.',
    };
  }
  if (!GoogleOAuth.hasSearchConsoleScope()) {
    return {
      ok: false,
      status: 'missing_scope',
      message:
        'Google is connected but the Search Console (read-only) permission has not been granted yet. Open Settings → Connections → Google → Reconnect, and approve the new "Search Console" permission Google shows. Until then, no SEO data can be pulled.',
    };
  }

  // Compute the two comparison windows. Search Console lags a few days, so the
  // window ends DATA_LAG_DAYS ago. The previous window is the equally-sized
  // block immediately before it (week-over-week / period-over-period).
  const end = new Date();
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

  const brands: BrandReport[] = [];
  for (const site of sites) {
    const report = await buildBrandReport(accessToken, site, window);
    brands.push(report);
  }

  // Attach any profile-resolution notes to the first brand so nothing is lost.
  if (skippedNotes.length > 0 && brands.length > 0) {
    brands[0].notes.push(...skippedNotes);
  }

  return {
    ok: true,
    window: { startDate: window.startDate, endDate: window.endDate, days },
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
      properties: {
        brandSlug: {
          type: 'string',
          enum: ['pmma', 'tsai', 'brett', 'all'],
          description:
            "Which brand to pull. 'pmma' = Personal Mastery Martial Arts, 'tsai' = Total Success AI, 'brett' = brettlechtenberg.com, 'all' = all three (default).",
        },
        days: {
          type: 'number',
          description:
            'Size of the reporting window in days (default 28). The previous equally-sized window is used for the week-over-week delta.',
        },
      },
      required: [],
    },
  };
}

export async function handleFetchSeoDataTool(input: unknown): Promise<string> {
  const result = await fetchSeoData((input as FetchSeoDataInput) ?? {});
  return JSON.stringify(result);
}
