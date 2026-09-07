/**
 * fetch_aeo_visibility — runs the monthly AEO/GEO citation measurement for one
 * of Brett's brands: asks ChatGPT, Perplexity, and Claude the brand's 25
 * permanent buyer questions and reports whether the brand was MENTIONED and
 * whether its domain was CITED as a source — plus which competitor sites got
 * cited instead (the earned-media to-do list).
 *
 * Division of labour (mirrors fetch_seo_data):
 *   - THIS TOOL does the mechanical part: read the brand's aeo.json prompt
 *     set (single source of truth, shared with the Visibility Edge web app),
 *     call the three engine APIs with bounded concurrency, score the answers,
 *     write a snapshot JSON + markdown report into the "AEO Operating System"
 *     Desktop folder, and return compact JSON.
 *   - THE AGENT does the judgment part: read that JSON and write the
 *     plain-English summary + prioritized to-do list.
 *
 * Credentials are read from encrypted main-process settings. Legacy JSON keys
 * are imported and removed by SettingsManager during startup. Missing keys are
 * skipped and never exposed to a renderer.
 *
 * Guardrail baked in: the prompt set is FROZEN (append-only). This tool never
 * modifies aeo.json. Comparability also requires matching metadata and coverage.
 */

import * as fs from 'fs';
import { createHash, randomUUID } from 'crypto';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';
import { SettingsManager } from '../settings/index.js';
import type { ToolProgressContext } from './diagnostics.js';

const BRAND_PROFILES_ROOT = path.join(os.homedir(), 'dev', '_brand-profiles');
const AEO_OS_ROOT = path.join(os.homedir(), 'Desktop', 'AEO Operating System');

const BRAND_SLUG_TO_FOLDER: Record<string, string> = {
  pmma: 'pmma',
  tsai: 'tsai',
  brett: 'brett-personal',
};

/** Where each brand's reports live inside the AEO Operating System folder. */
const BRAND_REPORT_DIR: Record<string, string> = {
  pmma: '08 - PMMA',
  tsai: '10 - TOTAL SUCCESS AI',
  brett: '11 - BRETT LECHTENBERG BRAND',
};

const ENGINES = ['openai', 'perplexity', 'anthropic'] as const;
type Engine = (typeof ENGINES)[number];
const ENGINE_NICE: Record<Engine, string> = {
  openai: 'OpenAI API',
  perplexity: 'Perplexity API',
  anthropic: 'Anthropic API',
};

/** How many API calls run at once. Keeps a 75-call run ~2–4 minutes. */
const CONCURRENCY = 4;

const AEO_CONFIG_SCHEMA = z
  .object({
    slug: z.string().min(1).max(32).regex(/^[a-z0-9-]+$/),
    name: z.string().min(1).max(100),
    shortName: z.string().min(1).max(50),
    domain: z.string().min(3).max(253)
      .transform((value) => value.toLowerCase().replace(/^www\./, '').replace(/\.$/, ''))
      .refine((value) => /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value), 'Invalid domain'),
    brandNames: z.array(z.string().min(1).max(100)).min(1).max(20),
    localSplit: z.number().int().min(0).max(25),
    prompts: z.array(z.string().min(3).max(500)).length(25),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.localSplit > value.prompts.length) {
      context.addIssue({ code: 'custom', path: ['localSplit'], message: 'localSplit exceeds prompts' });
    }
    if (new Set(value.prompts.map((prompt) => prompt.trim().toLowerCase())).size !== value.prompts.length) {
      context.addIssue({ code: 'custom', path: ['prompts'], message: 'Prompts must be unique' });
    }
  });
type AeoConfig = z.infer<typeof AEO_CONFIG_SCHEMA>;

interface Row {
  prompt: string;
  engine: Engine;
  mentioned: boolean;
  cited: boolean;
  sources: string[];
  error: string | null;
  returnedModel?: string;
}

interface MeasurementCoverage {
  requested: number; successful: number; failed: number;
  mentioned: number; cited: number;
  denominator: 'successful measurements';
  mentionRate: number | null; citeRate: number | null;
}
interface PromptCoverage {
  requested: number; observed: number; complete: number; partial: number; unobserved: number;
  mentioned: number; cited: number; mentionUnknown: number; citeUnknown: number;
  denominator: 'prompts with at least one successful engine observation';
  mentionRate: number | null; citeRate: number | null;
  /** Bounds over all requested prompts; incomplete negative observations remain unknown. */
  mentionRateBounds: { lower: number; upper: number } | null;
  citeRateBounds: { lower: number; upper: number } | null;
}
interface Summary {
  /** Compatibility aliases: any-engine observed prompt rates, NOT measurement rates. */
  mentionRate: number | null; citeRate: number | null;
  localCited: number; localTotal: number; infoCited: number; infoTotal: number;
  measurements: MeasurementCoverage;
  measurementSegments: { local: MeasurementCoverage; informational: MeasurementCoverage };
  perEngine: Partial<Record<Engine, MeasurementCoverage & { local: MeasurementCoverage; informational: MeasurementCoverage }>>;
  anyEngine: { overall: PromptCoverage; local: PromptCoverage; informational: PromptCoverage };
  topSources: [string, number][]; errors: number;
}
const DISCLAIMER = 'External API search-assisted proxy observations, not consumer-app rankings. Failures are unknown, not negatives. Rates use observed denominators; no model ranking is implied.';
const models = (): Record<Engine, string> => ({
  openai: process.env.OPENAI_MODEL || 'gpt-5-mini',
  perplexity: process.env.PERPLEXITY_MODEL || 'sonar',
  anthropic: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5',
});
interface RunMetadata {
  schemaVersion: 2; runVersion: 'aeo-api-proxy-v2'; promptSetVersion: 1;
  promptSetHash: string; prompts: string[]; configHash: string;
  requestedModels: Partial<Record<Engine, string>>;
  returnedModels: Partial<Record<Engine, string[]>>;
  disclaimer: string; coverage: MeasurementCoverage;
}
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function areAeoRunsComparable(a: unknown, b: unknown): boolean {
  const schema = z.object({
    schemaVersion: z.literal(2), runVersion: z.literal('aeo-api-proxy-v2'), promptSetVersion: z.literal(1),
    promptSetHash: z.string(), configHash: z.string(), prompts: z.array(z.string()),
    requestedModels: z.record(z.string(), z.string()), returnedModels: z.record(z.string(), z.array(z.string())),
    coverage: z.object({ requested: z.number().positive(), successful: z.number(), failed: z.literal(0) }),
  });
  const x = schema.safeParse(a), y = schema.safeParse(b);
  if (!x.success || !y.success) return false;
  for (const m of [x.data, y.data]) {
    const requestedEngines = Object.keys(m.requestedModels).sort();
    if (!requestedEngines.length || requestedEngines.some(key => !ENGINES.some(engine => engine === key)) ||
      JSON.stringify(requestedEngines) !== JSON.stringify(Object.keys(m.returnedModels).sort()) ||
      Object.values(m.returnedModels).some(values => !values.length || values.some(value => !value.trim())) ||
      !/^[a-f0-9]{64}$/.test(m.configHash)) return false;
    if (hash(m.prompts) !== m.promptSetHash || m.prompts.length !== 25 ||
        m.coverage.successful !== m.coverage.requested ||
        m.coverage.requested !== m.prompts.length * Object.keys(m.requestedModels).length) return false;
  }
  const canonical = (m: typeof x.data) => JSON.stringify({ ...m,
    requestedModels: Object.entries(m.requestedModels).sort(),
    returnedModels: Object.entries(m.returnedModels).sort().map(([e, v]) => [e, [...v].sort()]),
  });
  return canonical(x.data) === canonical(y.data);
}

const FETCH_AEO_INPUT_SCHEMA = z.object({ brandSlug: z.enum(['pmma', 'tsai', 'brett']) }).strict();

export interface FetchAeoVisibilityInput {
  brandSlug: 'pmma' | 'tsai' | 'brett';
}

export interface FetchAeoVisibilityResult {
  ok: boolean;
  status?: 'no_keys' | 'no_config' | 'error' | 'partial' | 'complete';
  metadata?: RunMetadata;
  message?: string;
  brand?: { slug: string; name: string; domain: string };
  enginesUsed?: string[];
  summary?: Summary;
  /** Prompts where the domain WAS cited — the wins to protect. */
  citedPrompts?: string[];
  /** Absolute paths of the files written for Brett's records. */
  reportFiles?: string[];
  persistenceError?: string;
}

export function parseAeoConfig(value: unknown): AeoConfig | null {
  const parsed = AEO_CONFIG_SCHEMA.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function readConfig(configPath: string): AeoConfig | null {
  try {
    return parseAeoConfig(JSON.parse(fs.readFileSync(configPath, 'utf8')));
  } catch {
    return null;
  }
}

function dedupeUrls(urls: string[]): string[] {
  const out: string[] = [];
  for (const u of urls) {
    try {
      const url = new URL(u);
      if (['http:', 'https:'].includes(url.protocol)) out.push(url.href);
    } catch {
      /* skip malformed */
    }
  }
  return [...new Set(out)];
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  signal?: AbortSignal
): Promise<Response> {
  signal?.throwIfAborted();
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const timeoutSignal = AbortSignal.timeout(30_000);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    try {
      const response = await fetch(url, { ...init, signal: requestSignal });
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) return response;
      await response.body?.cancel();
      lastError = new Error(`Provider returned retryable HTTP ${response.status}`);
    } catch (error) {
      if (signal?.aborted) throw new Error('AEO run cancelled', { cause: error });
      lastError = error;
      if (attempt === 2) throw error;
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error('AEO run cancelled'));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, 500 * 2 ** attempt);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }
  throw lastError instanceof Error ? lastError : new Error('Provider request failed');
}

export function isDomainOrSubdomain(url: string, domain: string): boolean {
  try {
    if (!['http:', 'https:'].includes(new URL(url).protocol)) return false;
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    const normalizedDomain = domain.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    return hostname === normalizedDomain || hostname.endsWith(`.${normalizedDomain}`);
  } catch {
    return false;
  }
}

function judge(
  text: string,
  sources: string[],
  domain: string,
  brandNames: string[]
): { mentioned: boolean; cited: boolean } {
  const t = (text || '').toLowerCase();
  const mentioned =
    brandNames.some((b) => t.includes(b.toLowerCase())) || t.includes(domain.toLowerCase());
  const cited = sources.some((url) => isDomainOrSubdomain(url, domain));
  return { mentioned, cited };
}

async function askOpenAI(
  key: string,
  prompt: string,
  signal?: AbortSignal,
  requestedModel?: string
): Promise<{ text: string; sources: string[]; returnedModel?: string }> {
  const r = await fetchWithRetry('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model: requestedModel ?? models().openai,
      tools: [{ type: 'web_search' }],
      input: prompt,
    }),
  }, signal);
  if (!r.ok) throw new Error('OpenAI ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const j = z.object({ model: z.string().optional(), status: z.literal('completed').optional(), output: z.array(z.object({
    content: z.array(z.object({ text: z.string().optional(), annotations: z.array(z.object({ url: z.string().optional() })).optional() })).optional(),
  })) }).parse(await r.json());
  let text = '';
  const urls: string[] = [];
  for (const item of j.output || []) {
    for (const c of item.content || []) {
      if (typeof c.text === 'string') text += c.text + '\n';
      for (const a of c.annotations || []) if (a.url) urls.push(a.url);
    }
  }
  if (!text.trim()) throw new Error('Provider returned no answer text');
  return { text, sources: dedupeUrls(urls), returnedModel: j.model };
}

async function askPerplexity(
  key: string,
  prompt: string,
  signal?: AbortSignal,
  requestedModel?: string
): Promise<{ text: string; sources: string[]; returnedModel?: string }> {
  const r = await fetchWithRetry('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model: requestedModel ?? models().perplexity,
      messages: [{ role: 'user', content: prompt }],
    }),
  }, signal);
  if (!r.ok) throw new Error('Perplexity ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const j = z.object({ model: z.string().optional(), choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
    citations: z.array(z.string()).optional(), search_results: z.array(z.object({ url: z.string().optional() })).optional(),
  }).parse(await r.json());
  const text = j.choices?.[0]?.message?.content || '';
  const urls = [
    ...(j.citations || []),
    ...((j.search_results || []).map((s) => s.url).filter(Boolean) as string[]),
  ];
  if (!text.trim()) throw new Error('Provider returned no answer text');
  return { text, sources: dedupeUrls(urls), returnedModel: j.model };
}

async function askAnthropic(
  key: string,
  prompt: string,
  signal?: AbortSignal,
  requestedModel?: string
): Promise<{ text: string; sources: string[]; returnedModel?: string }> {
  const r = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: requestedModel ?? models().anthropic,
      max_tokens: 1024,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      messages: [{ role: 'user', content: prompt }],
    }),
  }, signal);
  if (!r.ok) throw new Error('Anthropic ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const j = z.object({ model: z.string().optional(), content: z.array(z.object({
    type: z.string(), text: z.string().optional(), citations: z.array(z.object({ url: z.string().optional() })).optional(),
    content: z.unknown().optional(),
  })) }).parse(await r.json());
  let text = '';
  const urls: string[] = [];
  for (const block of j.content || []) {
    if (block.type === 'text') {
      text += (block.text || '') + '\n';
      for (const c of block.citations || []) if (c.url) urls.push(c.url);
    }
    if (block.type === 'web_search_tool_result') {
      if (!Array.isArray(block.content)) throw new Error('Provider web search failed or returned malformed results');
      for (const res of block.content) {
        const parsed = z.object({ url: z.string().optional() }).parse(res);
        if (parsed.url) urls.push(parsed.url);
      }
    }
  }
  if (!text.trim()) throw new Error('Provider returned no answer text');
  return { text, sources: dedupeUrls(urls), returnedModel: j.model };
}

const ASK: Record<
  Engine,
  (key: string, prompt: string, signal?: AbortSignal, requestedModel?: string) => Promise<{ text: string; sources: string[]; returnedModel?: string }>
> = {
  openai: askOpenAI,
  perplexity: askPerplexity,
  anthropic: askAnthropic,
};

export function summarize(rows: Row[], conf: AeoConfig): Summary {
  const ok = rows.filter((r) => !r.error);
  const engines = [...new Set(rows.map(r => r.engine))];
  const rate = (positive: number, total: number): number | null => total ? Math.round(100 * positive / total) : null;
  const measurements = (subset: Row[]): MeasurementCoverage => {
    const successful = subset.filter(r => !r.error);
    const mentioned = successful.filter(r => r.mentioned).length, cited = successful.filter(r => r.cited).length;
    return { requested: subset.length, successful: successful.length, failed: subset.length - successful.length,
      mentioned, cited, denominator: 'successful measurements',
      mentionRate: rate(mentioned, successful.length), citeRate: rate(cited, successful.length) };
  };
  const coverage = (prompts: string[]): PromptCoverage => {
    let observed = 0, complete = 0, mentioned = 0, cited = 0, mentionUnknown = 0, citeUnknown = 0;
    for (const prompt of prompts) {
      const answers = ok.filter(r => r.prompt === prompt);
      const full = engines.length > 0 && answers.length === engines.length;
      const mention = answers.some(r => r.mentioned), cite = answers.some(r => r.cited);
      if (answers.length) observed++;
      if (full) complete++;
      if (mention) mentioned++;
      if (cite) cited++;
      if (!full && !mention) mentionUnknown++;
      if (!full && !cite) citeUnknown++;
    }
    return { requested: prompts.length, observed, complete, partial: observed - complete, unobserved: prompts.length - observed,
      mentioned, cited, mentionUnknown, citeUnknown,
      denominator: 'prompts with at least one successful engine observation',
      mentionRate: rate(mentioned, observed), citeRate: rate(cited, observed),
      mentionRateBounds: observed ? { lower: Math.floor(100 * mentioned / prompts.length), upper: Math.ceil(100 * (mentioned + mentionUnknown) / prompts.length) } : null,
      citeRateBounds: observed ? { lower: Math.floor(100 * cited / prompts.length), upper: Math.ceil(100 * (cited + citeUnknown) / prompts.length) } : null };
  };
  const overall = coverage(conf.prompts), local = coverage(conf.prompts.slice(0, conf.localSplit)),
    informational = coverage(conf.prompts.slice(conf.localSplit));
  const hosts: Record<string, number> = {};
  for (const r of ok) {
    for (const u of r.sources) {
      try {
        const h = new URL(u).hostname.replace(/^www\./, '');
        if (!isDomainOrSubdomain(u, conf.domain)) hosts[h] = (hosts[h] || 0) + 1;
      } catch {
        /* skip */
      }
    }
  }
  const topSources = Object.entries(hosts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12) as [string, number][];
  return {
    mentionRate: overall.mentionRate, citeRate: overall.citeRate,
    localCited: local.cited, localTotal: local.observed, infoCited: informational.cited, infoTotal: informational.observed,
    measurements: measurements(rows),
    measurementSegments: {
      local: measurements(rows.filter(r => conf.prompts.indexOf(r.prompt) < conf.localSplit)),
      informational: measurements(rows.filter(r => conf.prompts.indexOf(r.prompt) >= conf.localSplit)),
    },
    perEngine: Object.fromEntries(engines.map(e => [e, {
      ...measurements(rows.filter(r => r.engine === e)),
      local: measurements(rows.filter(r => r.engine === e && conf.prompts.indexOf(r.prompt) < conf.localSplit)),
      informational: measurements(rows.filter(r => r.engine === e && conf.prompts.indexOf(r.prompt) >= conf.localSplit)),
    }])),
    anyEngine: { overall, local, informational }, topSources, errors: rows.length - ok.length,
  };
}

/** Run jobs with bounded concurrency, preserving order of results. */
async function runPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function atomicWriteFile(filePath: string, content: string): void {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, content, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try { fs.unlinkSync(temporaryPath); } catch { /* best effort cleanup */ }
    throw error;
  }
}

export async function fetchAeoVisibility(
  input: FetchAeoVisibilityInput,
  context?: ToolProgressContext,
  dependencies?: { config: unknown; keys: Record<Engine, string>; reportsRoot: string }
): Promise<FetchAeoVisibilityResult> {
  const parsedInput = FETCH_AEO_INPUT_SCHEMA.safeParse(input);
  if (!parsedInput.success) {
    return { ok: false, status: 'no_config', message: 'Invalid AEO input. Choose pmma, tsai, or brett.' };
  }
  const slug = parsedInput.data.brandSlug;
  const folder = BRAND_SLUG_TO_FOLDER[slug];
  if (!folder) {
    return {
      ok: false,
      status: 'no_config',
      message: `Unknown brand '${slug}'. Use pmma, tsai, or brett.`,
    };
  }

  const conf = dependencies ? parseAeoConfig(dependencies.config) : readConfig(path.join(BRAND_PROFILES_ROOT, folder, 'aeo.json'));
  if (!conf || conf.slug !== slug) {
    return {
      ok: false,
      status: 'no_config',
      message: `Missing or invalid aeo.json for ${slug} in ${path.join(BRAND_PROFILES_ROOT, folder)}.`,
    };
  }

  const keys: Record<Engine, string> = dependencies?.keys ?? {
    openai: SettingsManager.get('openai.apiKey'),
    perplexity: SettingsManager.get('perplexity.apiKey'),
    anthropic: SettingsManager.get('anthropic.apiKey'),
  };
  const engines = ENGINES.filter((engine) => keys[engine].trim());
  if (!engines.length) {
    return {
      ok: false,
      status: 'no_keys',
      message:
        'No AEO provider credentials are configured. Add an OpenAI, Perplexity, or Anthropic key in Settings.',
    };
  }

  const requestedModels = Object.fromEntries(engines.map(e => [e, models()[e]]));

  // Build the job list: every prompt × every available engine.
  const jobs: { prompt: string; engine: Engine }[] = [];
  for (const prompt of conf.prompts) for (const engine of engines) jobs.push({ prompt, engine });

  context?.onProgress?.(
    `AEO paid batch approved: ${jobs.length} provider requests across ${engines.length} engine(s).`
  );
  let completed = 0;
  const rows: Row[] = await runPool(jobs, CONCURRENCY, async ({ prompt, engine }) => {
    if (context?.signal?.aborted) throw new Error('AEO run cancelled');
    const row: Row = { prompt, engine, mentioned: false, cited: false, sources: [], error: null };
    try {
      const { text, sources, returnedModel } = await ASK[engine](keys[engine].trim(), prompt, context?.signal, requestedModels[engine]);
      const verdict = judge(text, sources, conf.domain, conf.brandNames);
      row.mentioned = verdict.mentioned;
      row.cited = verdict.cited;
      row.sources = sources;
      row.returnedModel = returnedModel;
    } catch (error) {
      if (context?.signal?.aborted) throw new Error('AEO run cancelled', { cause: error });
      row.error = String(error instanceof Error ? error.message : error).slice(0, 200);
    } finally {
      completed += 1;
      context?.onProgress?.(`AEO progress: ${completed}/${jobs.length} provider requests complete.`);
    }
    return row;
  });

  context?.signal?.throwIfAborted();
  const summary = summarize(rows, conf);
  const metadata: RunMetadata = { schemaVersion: 2, runVersion: 'aeo-api-proxy-v2', promptSetVersion: 1,
    promptSetHash: hash(conf.prompts), prompts: conf.prompts.slice(), configHash: hash(conf), requestedModels,
    returnedModels: Object.fromEntries(engines.map(e => [e, [...new Set(rows.filter(r => r.engine === e && !r.error && r.returnedModel).map(r => r.returnedModel!))].sort()])),
    disclaimer: DISCLAIMER, coverage: summary.measurements,
  };
  const citedPrompts = [...new Set(rows.filter((r) => r.cited).map((r) => r.prompt))];

  // Write the versioned snapshot + a markdown report; external importer compatibility is unverified.
  const stamp = new Date().toISOString().slice(0, 7); // YYYY-MM
  const reportDir = path.join(dependencies?.reportsRoot ?? AEO_OS_ROOT, BRAND_REPORT_DIR[slug], 'reports', stamp, randomUUID());
  const reportFiles: string[] = [];
  let persistenceError: string | undefined;
  try {
    fs.mkdirSync(reportDir, { recursive: true });
    const snapshot = {
      id: Date.now(),
      biz: slug,
      date: new Date().toISOString(),
      engines: engines.slice(),
      rows,
      summary,
      source: 'ai-chief-of-staff',
      metadata,
    };
    const snapPath = path.join(reportDir, 'aeo-snapshot.json');
    atomicWriteFile(snapPath, JSON.stringify(snapshot, null, 2));
    reportFiles.push(snapPath);

    const formatBounds = (value: PromptCoverage['mentionRateBounds']) => value ? `${value.lower}–${value.upper}%` : 'Unavailable';
    const md = [
      `# AEO Visibility — ${conf.name} — ${stamp}`,
      ``,
      `Engines: ${engines.map((e) => ENGINE_NICE[e]).join(', ')} · ${rows.length} checks · ${summary.errors} errors`,
      ``,
      `| Metric | Value |`,
      `|---|---|`,
      `| Any-engine mention rate (observed prompts) | ${summary.mentionRate === null ? 'Unavailable' : summary.mentionRate + '%'} |`,
      `| Any-engine citation rate (observed prompts) | ${summary.citeRate === null ? 'Unavailable' : summary.citeRate + '%'} |`,
      `| Any-engine mention bounds (all requested prompts) | ${formatBounds(summary.anyEngine.overall.mentionRateBounds)} |`,
      `| Any-engine citation bounds (all requested prompts) | ${formatBounds(summary.anyEngine.overall.citeRateBounds)} |`,
      `| Local observed prompts cited | ${summary.localCited}/${summary.localTotal} |`,
      `| Info observed prompts cited | ${summary.infoCited}/${summary.infoTotal} |`,
      ``,
      DISCLAIMER,
      `Status: ${summary.errors ? (summary.measurements.successful ? 'Partial' : 'Unavailable') : 'Complete'}`,
      `Requested / successful / failed measurements: ${summary.measurements.requested} / ${summary.measurements.successful} / ${summary.measurements.failed}`,
      '## Coverage and denominators (including per-engine observed rates)',
      '```json', JSON.stringify(summary, null, 2), '```',
      '## Reproducibility metadata', '```json', JSON.stringify(metadata, null, 2), '```',
      'Only compare fully covered runs with identical version, prompts, engines, requested/returned models and config; legacy runs are not comparable.',
      `## Other sources observed (not a ranking)`,
      ...(summary.topSources.length
        ? summary.topSources.map(([h, n]) => `- ${h} (${n}×)`)
        : ['- (none recorded)']),
      ``,
      `## Prompts where ${conf.shortName} WAS cited`,
      ...(citedPrompts.length
        ? citedPrompts.map((p) => `- ${p}`)
        : ['- (none observed; unavailable calls are not negatives)']),
      ``,
      `_Snapshot schema 2: external importers must support nullable rates and coverage metadata before importing or comparing._`,
    ].join('\n');
    const mdPath = path.join(reportDir, 'aeo-report.md');
    atomicWriteFile(mdPath, md);
    reportFiles.push(mdPath);
  } catch {
    persistenceError = 'Some report files could not be saved; returned observations remain available.';
  }

  return {
    ok: summary.errors === 0,
    status: summary.errors ? (summary.measurements.successful ? 'partial' : 'error') : 'complete',
    message: summary.errors ? 'API proxy observations incomplete; retain independent successful evidence. Missing observations are unknown.' : DISCLAIMER,
    metadata,
    brand: { slug, name: conf.name, domain: conf.domain },
    enginesUsed: engines.map((e) => ENGINE_NICE[e]),
    summary,
    citedPrompts,
    reportFiles,
    persistenceError,
  };
}

export function getFetchAeoVisibilityToolDefinition() {
  return {
    name: 'fetch_aeo_visibility',
    description:
      "Run the monthly AEO (AI-visibility) measurement for ONE of Brett's brands: queries the configured OpenAI, Perplexity, and Anthropic APIs with the brand's 25 permanent buyer questions and reports the mention rate (brand named in the answer), citation rate (brand's domain used as a source), the local-vs-informational split, and — most actionable — which other sites were cited (investigate their relevance; this is not a competitor ranking). This is a paid batch and requires explicit approval; run it once per month per brand, or when Brett asks. Results are also written to the 'AEO Operating System' Desktop folder (snapshot JSON + markdown). If it returns ok:false, relay the message to Brett verbatim. After a successful call: summarize in plain English — lead with the rates, then the top 3 'cited instead' sites as next actions, and provide the saved snapshot path (external import compatibility is not verified). These are external API proxies, NOT consumer-app rankings. Label observed denominators and requested coverage. Partial/error runs are not success; preserve independent evidence, never rank failed models. Never delta-compare historical runs unless areAeoRunsComparable metadata checks pass (full coverage required). NEVER edit the prompt list.",
    input_schema: {
      type: 'object' as const,
      properties: {
        brandSlug: {
          type: 'string',
          enum: ['pmma', 'tsai', 'brett'],
          description:
            "Which brand to measure. 'pmma' = Personal Mastery Martial Arts, 'tsai' = Total Success AI, 'brett' = brettlechtenberg.com. One brand per call (each run is 2–5 minutes); call again for the others.",
        },
      },
      required: ['brandSlug'],
    },
  };
}

export async function handleFetchAeoVisibilityTool(
  input: unknown,
  context?: ToolProgressContext
): Promise<string> {
  const parsed = FETCH_AEO_INPUT_SCHEMA.safeParse(input ?? {});
  if (!parsed.success) {
    return JSON.stringify({ ok: false, status: 'no_config', message: 'Invalid AEO input.' });
  }
  const result = await fetchAeoVisibility(parsed.data, context);
  return JSON.stringify(result);
}
