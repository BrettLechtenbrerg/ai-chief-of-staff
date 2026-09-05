/**
 * Live model discovery for the providers that expose a usable list endpoint —
 * Anthropic and OpenAI. The user triggers this from Settings ("Check for new
 * models"); anything new gets merged into the picker so freshly-released models
 * (e.g. a future Opus 4.8 or a new GPT) show up without an app update.
 *
 * Design notes:
 *   - Best-effort and non-throwing. If a provider's endpoint rejects the token
 *     (common with subscription/OAuth tokens, which may not authorize /v1/models)
 *     or times out, that provider simply contributes nothing — the curated list
 *     still stands. No regression, ever.
 *   - The niche providers (Kimi / GLM / Xiaomi / MiniMax / DeepSeek) have no
 *     reliable list endpoint, so they stay curated (one-line bumps when needed).
 *   - Routing for any discovered id is handled by inferProviderFromId() in
 *     providers.ts, so a new model is callable the moment it's selected.
 */

import { SettingsManager } from '../settings';
import { friendlyModelName, type ProviderType } from './providers';

export interface DiscoveredModel {
  id: string;
  name: string;
  provider: ProviderType;
}

/** Per-provider hard timeout so a hung endpoint can't freeze the UI. */
const DISCOVERY_TIMEOUT_MS = 15_000;

/**
 * OpenAI's model list is huge: embeddings, audio, image, moderation, AND the
 * entire historical chat back-catalog (gpt-3.5, gpt-4, gpt-4o, dated snapshots).
 * We only want CURRENT, user-facing chat models, so we apply three gates below:
 *   1. OPENAI_NONCHAT  — drop non-conversational model families outright.
 *   2. OPENAI_CURRENT  — keep only the current generation (gpt-5+ / codex /
 *                        o-series reasoning), so old gpt-3.5 / gpt-4* vanish.
 *   3. OPENAI_DATED    — drop pinned date/snapshot variants (e.g. -2025-08-07,
 *                        -0613); the floating alias is what people should pick.
 * gpt-5+ uses a digit-class so a future gpt-6 / gpt-10 appears automatically.
 */
const OPENAI_NONCHAT =
  /embedding|whisper|tts|dall-?e|image|audio|realtime|moderation|transcribe|babbage|davinci|ada|curie|search|similarity|edit/i;
const OPENAI_CURRENT = /^(gpt-(?:[5-9]|[1-9]\d)|codex|o[1-9])/i;
const OPENAI_DATED = /-\d{4}(?:-\d{2}-\d{2})?$/;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('discovery timeout')), ms)),
  ]);
}

/** Discover Anthropic (Claude) models via the SDK's models.list. */
async function discoverAnthropic(): Promise<DiscoveredModel[]> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');

  // API key takes priority; otherwise use the Claude Pro/Max OAuth token with
  // the same auth shape gg-ai uses for subscription requests.
  let client: InstanceType<typeof Anthropic> | null = null;
  const apiKey = SettingsManager.get('anthropic.apiKey');
  if (apiKey) {
    client = new Anthropic({ apiKey });
  } else if (SettingsManager.get('auth.method') === 'oauth') {
    const { ClaudeOAuth } = await import('../auth/oauth');
    const token = await ClaudeOAuth.getAccessToken();
    if (token) {
      client = new Anthropic({
        apiKey: null as unknown as string,
        authToken: token,
        defaultHeaders: {
          'user-agent': 'claude-cli/2.1.75',
          'x-app': 'cli',
          'anthropic-beta': 'oauth-2025-04-20',
        },
      });
    }
  }
  if (!client) return [];

  const out: DiscoveredModel[] = [];
  const page = await client.models.list({ limit: 100 });
  for (const m of page.data ?? []) {
    if (!m.id || !m.id.toLowerCase().startsWith('claude-')) continue;
    out.push({
      id: m.id,
      // Prefer the API's display_name when present, else derive one. Drop the
      // "Claude " prefix so it matches the curated "Opus 4.7" style.
      name:
        (m as { display_name?: string }).display_name?.replace(/^claude\s+/i, '') ||
        friendlyModelName(m.id),
      provider: 'anthropic',
    });
  }
  return out;
}

/** Discover OpenAI (GPT/Codex) chat models via the SDK's models.list. */
async function discoverOpenAI(): Promise<DiscoveredModel[]> {
  const { default: OpenAI } = await import('openai');

  let client: InstanceType<typeof OpenAI> | null = null;
  const apiKey = SettingsManager.get('openai.apiKey');
  if (apiKey) {
    client = new OpenAI({ apiKey });
  } else if (SettingsManager.get('openai.auth.method') === 'oauth') {
    const { OpenAIOAuth } = await import('../auth/openai-oauth');
    const token = await OpenAIOAuth.getAccessToken();
    if (token) client = new OpenAI({ apiKey: token });
  }
  if (!client) return [];

  const out: DiscoveredModel[] = [];
  const page = await client.models.list();
  for (const m of page.data ?? []) {
    const id = m.id;
    if (!id) continue;
    if (OPENAI_NONCHAT.test(id)) continue; // not a chat model
    if (!OPENAI_CURRENT.test(id)) continue; // old generation (gpt-3.5 / gpt-4*)
    if (OPENAI_DATED.test(id)) continue; // pinned snapshot — prefer the alias
    out.push({ id, name: friendlyModelName(id), provider: 'openai' });
  }
  return out;
}

/**
 * Run discovery across every provider that has a usable list endpoint. Each
 * provider is isolated: a failure or timeout in one never blocks the others,
 * and the overall call always resolves (never rejects).
 */
export async function discoverModels(): Promise<DiscoveredModel[]> {
  const providers: Array<() => Promise<DiscoveredModel[]>> = [discoverAnthropic, discoverOpenAI];
  const results: DiscoveredModel[] = [];

  await Promise.all(
    providers.map(async (fn) => {
      try {
        const r = await withTimeout(fn(), DISCOVERY_TIMEOUT_MS);
        if (Array.isArray(r)) results.push(...r);
      } catch (err) {
        console.warn('[ModelDiscovery] provider failed (kept curated list):', err);
      }
    }),
  );

  // De-dupe by id, first occurrence wins.
  const seen = new Set<string>();
  return results.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
}
