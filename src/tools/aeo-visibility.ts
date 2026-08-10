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
 * modifies aeo.json — measurement stays comparable month over month.
 */

import * as fs from 'fs';
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
  openai: 'ChatGPT',
  perplexity: 'Perplexity',
  anthropic: 'Claude',
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
}

interface Summary {
  mentionRate: number;
  citeRate: number;
  localCited: number;
  localTotal: number;
  infoCited: number;
  infoTotal: number;
  /** [hostname, timesCited] sorted desc — the competitor-source hit list. */
  topSources: [string, number][];
  errors: number;
}

const FETCH_AEO_INPUT_SCHEMA = z.object({ brandSlug: z.enum(['pmma', 'tsai', 'brett']) }).strict();

export interface FetchAeoVisibilityInput {
  brandSlug: 'pmma' | 'tsai' | 'brett';
}

export interface FetchAeoVisibilityResult {
  ok: boolean;
  status?: 'no_keys' | 'no_config' | 'error';
  message?: string;
  brand?: { slug: string; name: string; domain: string };
  enginesUsed?: string[];
  summary?: Summary;
  /** Prompts where the domain WAS cited — the wins to protect. */
  citedPrompts?: string[];
  /** Absolute paths of the files written for Brett's records. */
  reportFiles?: string[];
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
      out.push(new URL(u).href);
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
    });
  }
  throw lastError instanceof Error ? lastError : new Error('Provider request failed');
}

export function isDomainOrSubdomain(url: string, domain: string): boolean {
  try {
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
  signal?: AbortSignal
): Promise<{ text: string; sources: string[] }> {
  const r = await fetchWithRetry('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5-mini',
      tools: [{ type: 'web_search' }],
      input: prompt,
    }),
  }, signal);
  if (!r.ok) throw new Error('OpenAI ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const j = (await r.json()) as {
    output?: { content?: { text?: string; annotations?: { url?: string }[] }[] }[];
  };
  let text = '';
  const urls: string[] = [];
  for (const item of j.output || []) {
    for (const c of item.content || []) {
      if (typeof c.text === 'string') text += c.text + '\n';
      for (const a of c.annotations || []) if (a.url) urls.push(a.url);
    }
  }
  return { text, sources: dedupeUrls(urls) };
}

async function askPerplexity(
  key: string,
  prompt: string,
  signal?: AbortSignal
): Promise<{ text: string; sources: string[] }> {
  const r = await fetchWithRetry('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model: process.env.PERPLEXITY_MODEL || 'sonar',
      messages: [{ role: 'user', content: prompt }],
    }),
  }, signal);
  if (!r.ok) throw new Error('Perplexity ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const j = (await r.json()) as {
    choices?: { message?: { content?: string } }[];
    citations?: string[];
    search_results?: { url?: string }[];
  };
  const text = j.choices?.[0]?.message?.content || '';
  const urls = [
    ...(j.citations || []),
    ...((j.search_results || []).map((s) => s.url).filter(Boolean) as string[]),
  ];
  return { text, sources: dedupeUrls(urls) };
}

async function askAnthropic(
  key: string,
  prompt: string,
  signal?: AbortSignal
): Promise<{ text: string; sources: string[] }> {
  const r = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5',
      max_tokens: 1024,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      messages: [{ role: 'user', content: prompt }],
    }),
  }, signal);
  if (!r.ok) throw new Error('Anthropic ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const j = (await r.json()) as {
    content?: {
      type?: string;
      text?: string;
      citations?: { url?: string }[];
      content?: { url?: string }[] | unknown;
    }[];
  };
  let text = '';
  const urls: string[] = [];
  for (const block of j.content || []) {
    if (block.type === 'text') {
      text += (block.text || '') + '\n';
      for (const c of block.citations || []) if (c.url) urls.push(c.url);
    }
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const res of block.content as { url?: string }[]) {
        if (res.url) urls.push(res.url);
      }
    }
  }
  return { text, sources: dedupeUrls(urls) };
}

const ASK: Record<
  Engine,
  (key: string, prompt: string, signal?: AbortSignal) => Promise<{ text: string; sources: string[] }>
> = {
  openai: askOpenAI,
  perplexity: askPerplexity,
  anthropic: askAnthropic,
};

function summarize(rows: Row[], conf: AeoConfig): Summary {
  const ok = rows.filter((r) => !r.error);
  const byPrompt: Record<string, { mentioned: boolean; cited: boolean }> = {};
  for (const r of ok) {
    const p = (byPrompt[r.prompt] = byPrompt[r.prompt] || { mentioned: false, cited: false });
    if (r.mentioned) p.mentioned = true;
    if (r.cited) p.cited = true;
  }
  const prompts = Object.keys(byPrompt);
  const n = prompts.length || 1;
  const mentionRate = Math.round((100 * prompts.filter((p) => byPrompt[p].mentioned).length) / n);
  const citeRate = Math.round((100 * prompts.filter((p) => byPrompt[p].cited).length) / n);
  const localPrompts = conf.prompts.slice(0, conf.localSplit);
  const infoPrompts = conf.prompts.slice(conf.localSplit);
  const localCited = localPrompts.filter((p) => byPrompt[p]?.cited).length;
  const infoCited = infoPrompts.filter((p) => byPrompt[p]?.cited).length;
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
    mentionRate,
    citeRate,
    localCited,
    localTotal: localPrompts.length,
    infoCited,
    infoTotal: infoPrompts.length,
    topSources,
    errors: rows.length - ok.length,
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
  context?: ToolProgressContext
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

  const conf = readConfig(path.join(BRAND_PROFILES_ROOT, folder, 'aeo.json'));
  if (!conf || conf.slug !== slug) {
    return {
      ok: false,
      status: 'no_config',
      message: `Missing or invalid aeo.json for ${slug} in ${path.join(BRAND_PROFILES_ROOT, folder)}.`,
    };
  }

  const keys: Record<Engine, string> = {
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
      const { text, sources } = await ASK[engine](keys[engine].trim(), prompt, context?.signal);
      const verdict = judge(text, sources, conf.domain, conf.brandNames);
      row.mentioned = verdict.mentioned;
      row.cited = verdict.cited;
      row.sources = sources;
    } catch (error) {
      if (context?.signal?.aborted) throw new Error('AEO run cancelled', { cause: error });
      row.error = String(error instanceof Error ? error.message : error).slice(0, 200);
    } finally {
      completed += 1;
      context?.onProgress?.(`AEO progress: ${completed}/${jobs.length} provider requests complete.`);
    }
    return row;
  });

  const summary = summarize(rows, conf);
  const citedPrompts = [...new Set(rows.filter((r) => r.cited).map((r) => r.prompt))];

  // Write the snapshot (web-app-compatible shape) + a markdown report.
  const stamp = new Date().toISOString().slice(0, 7); // YYYY-MM
  const reportDir = path.join(AEO_OS_ROOT, BRAND_REPORT_DIR[slug], 'reports', stamp);
  const reportFiles: string[] = [];
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
    };
    const snapPath = path.join(reportDir, 'aeo-snapshot.json');
    atomicWriteFile(snapPath, JSON.stringify(snapshot, null, 2));
    reportFiles.push(snapPath);

    const md = [
      `# AEO Visibility — ${conf.name} — ${stamp}`,
      ``,
      `Engines: ${engines.map((e) => ENGINE_NICE[e]).join(', ')} · ${rows.length} checks · ${summary.errors} errors`,
      ``,
      `| Metric | Value |`,
      `|---|---|`,
      `| Mention rate | ${summary.mentionRate}% |`,
      `| Citation rate | ${summary.citeRate}% |`,
      `| Local prompts cited | ${summary.localCited}/${summary.localTotal} |`,
      `| Info prompts cited | ${summary.infoCited}/${summary.infoTotal} |`,
      ``,
      `## Who got cited instead (earned-media targets)`,
      ...(summary.topSources.length
        ? summary.topSources.map(([h, n]) => `- ${h} (${n}×)`)
        : ['- (none recorded)']),
      ``,
      `## Prompts where ${conf.shortName} WAS cited`,
      ...(citedPrompts.length
        ? citedPrompts.map((p) => `- ${p}`)
        : ['- (none yet — normal at baseline)']),
      ``,
      `_Import aeo-snapshot.json into the Visibility Edge scorecard (Scorecard → Import) to keep the canonical record._`,
    ].join('\n');
    const mdPath = path.join(reportDir, 'aeo-report.md');
    atomicWriteFile(mdPath, md);
    reportFiles.push(mdPath);
  } catch {
    // Report writing is best-effort; the measurement result still returns.
  }

  return {
    ok: true,
    brand: { slug, name: conf.name, domain: conf.domain },
    enginesUsed: engines.map((e) => ENGINE_NICE[e]),
    summary,
    citedPrompts,
    reportFiles,
  };
}

export function getFetchAeoVisibilityToolDefinition() {
  return {
    name: 'fetch_aeo_visibility',
    description:
      "Run the monthly AEO (AI-visibility) measurement for ONE of Brett's brands: asks ChatGPT, Perplexity, and Claude the brand's 25 permanent buyer questions and reports the mention rate (brand named in the answer), citation rate (brand's domain used as a source), the local-vs-informational split, and — most actionable — which competitor sites got cited instead (that list is the earned-media to-do list). Takes 2–5 minutes and costs a few cents; run it once per month per brand, or when Brett asks. Results are also written to the 'AEO Operating System' Desktop folder (snapshot JSON + markdown). If it returns ok:false, relay the message to Brett verbatim. After a successful call: summarize in plain English — lead with the rates, then the top 3 'cited instead' sites as next actions, and remind that the snapshot can be imported into the Visibility Edge scorecard. NEVER edit the prompt list — it is frozen so months stay comparable.",
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
