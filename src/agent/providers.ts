/**
 * Shared provider configuration for LLM backends.
 * Single source of truth — imported by both coder mode (agent/index.ts)
 * and general/chat mode (chat-providers.ts).
 */

export type ProviderType =
  | 'anthropic'
  | 'moonshot'
  | 'glm'
  | 'xiaomi'
  | 'openai'
  | 'minimax'
  | 'deepseek';

export interface ProviderConfig {
  /** OpenAI-compatible base URL (used by gg-ai chat engine in General mode) */
  baseUrl?: string;
  /** Anthropic-compatible base URL (used by Claude Agent SDK subprocess in Coder mode) */
  sdkBaseUrl?: string;
}

export const PROVIDER_CONFIGS: Record<ProviderType, ProviderConfig> = {
  anthropic: {
    // No baseUrl = uses default Anthropic endpoint for both modes
  },
  moonshot: {
    // General mode: gg-ai uses OpenAI-compat endpoint (no baseUrl = gg-ai default /v1)
    // Coder mode: SDK subprocess needs the Anthropic-compat endpoint
    sdkBaseUrl: 'https://api.moonshot.ai/anthropic',
  },
  glm: {
    // General mode: no baseUrl — gg-ai's built-in GLM provider handles endpoint
    // selection with fallback (coding endpoint first, then regular).
    // Setting baseUrl would bypass this and break Coding Plan models like glm-5.1.
    // Coder mode: SDK subprocess needs the Anthropic-compat endpoint
    sdkBaseUrl: 'https://api.z.ai/api/anthropic',
  },
  xiaomi: {
    // General mode: gg-ai uses OpenAI-compat endpoint for Xiaomi models
    baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1',
  },
  openai: {
    // General mode: gg-ai uses OpenAI-compat endpoint (no baseUrl = gg-ai default)
    // Coder mode: SDK subprocess needs the Anthropic-compat endpoint
    sdkBaseUrl: 'https://api.openai.com/v1',
  },
  minimax: {
    // General mode: gg-ai uses Anthropic-compat endpoint for MiniMax models
    baseUrl: 'https://api.minimax.io/anthropic',
  },
  deepseek: {
    // General mode: gg-ai uses OpenAI-compat endpoint for DeepSeek models
    baseUrl: 'https://api.deepseek.com/v1',
  },
};

// Model to provider mapping
export const MODEL_PROVIDERS: Record<string, ProviderType> = {
  // Anthropic models
  'claude-fable-5-1': 'anthropic',
  'claude-fable-5': 'anthropic',
  'claude-opus-5': 'anthropic',
  'claude-sonnet-5': 'anthropic',
  'claude-opus-4-8': 'anthropic',
  'claude-opus-4-7': 'anthropic',
  'claude-opus-4-6': 'anthropic',
  'claude-opus-4-5-20251101': 'anthropic',
  'claude-sonnet-4-6': 'anthropic',
  'claude-haiku-4-5-20251001': 'anthropic',
  // Moonshot/Kimi models
  'kimi-k2.6': 'moonshot',
  // Z.AI GLM models
  'glm-5.1': 'glm',
  'glm-5-turbo': 'glm',
  'glm-4.7': 'glm',
  'glm-4.7-flash': 'glm',
  // Xiaomi/MiMo models
  'mimo-v2-pro': 'xiaomi',
  // OpenAI models
  'gpt-6-astra': 'openai',
  'gpt-5.6-sol': 'openai',
  'gpt-5.6-terra': 'openai',
  'gpt-5.6-luna': 'openai',
  'gpt-5.5': 'openai',
  'gpt-5.5-pro': 'openai',
  'gpt-5.4': 'openai',
  'gpt-5.4-mini': 'openai',
  'gpt-5.3-codex': 'openai',
  'codex-mini-latest': 'openai',
  // MiniMax models
  'MiniMax-M2.7': 'minimax',
  'MiniMax-M2.7-highspeed': 'minimax',
  // DeepSeek models
  'deepseek-v4-pro': 'deepseek',
  'deepseek-v4-flash': 'deepseek',
};

export function getProviderForModel(model: string): ProviderType {
  const exact = MODEL_PROVIDERS[model];
  if (exact) return exact;
  return inferProviderFromId(model);
}

/**
 * Infer the provider for a model id we don't have an explicit mapping for.
 * This is what lets newly-released models (e.g. a future `claude-opus-4-8` or
 * `gpt-5.6`) route correctly the moment they appear in the picker, instead of
 * blindly falling back to Anthropic. Prefix-based, ordered most-specific first.
 */
export function inferProviderFromId(model: string): ProviderType {
  const m = String(model || '').toLowerCase();
  if (m.startsWith('claude-') || m.startsWith('claude')) return 'anthropic';
  if (m.startsWith('gpt-') || m.startsWith('gpt') || m.startsWith('codex') || /^o[1-9]/.test(m))
    return 'openai';
  if (m.startsWith('kimi')) return 'moonshot';
  if (m.startsWith('glm')) return 'glm';
  if (m.startsWith('mimo')) return 'xiaomi';
  if (m.startsWith('minimax')) return 'minimax';
  if (m.startsWith('deepseek')) return 'deepseek';
  return 'anthropic';
}

/**
 * Best-effort human label for a model id that isn't in the curated list (i.e.
 * one returned by live discovery). Curated models keep their hand-written names;
 * this only has to be "good enough" for brand-new ids.
 */
export function friendlyModelName(id: string): string {
  const provider = inferProviderFromId(id);
  // Drop a trailing date stamp like -20251101 so 'claude-opus-4-5-20251101'
  // reads as 'Opus 4.5'.
  const base = String(id || '').replace(/-\d{8}$/, '');

  if (provider === 'anthropic') {
    // Any family name (opus / sonnet / haiku / fable / …) so future lines work.
    const match = base.match(/^claude-([a-z]+)-(.+)$/i);
    if (match) {
      const family = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
      const version = match[2].replace(/-/g, '.');
      return `${family} ${version}`;
    }
  }

  if (provider === 'openai') {
    if (/^codex/i.test(base)) return base.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    // Every word suffix becomes a capitalised word: gpt-5.4-mini → "GPT-5.4 Mini",
    // gpt-6-astra → "GPT-6 Astra", gpt-5.1-codex-max → "GPT-5.1 Codex Max".
    return base
      .replace(/^gpt-/i, 'GPT-')
      .replace(/-([a-z]+)\b/g, (_, w: string) => ` ${w.charAt(0).toUpperCase()}${w.slice(1)}`);
  }

  return base;
}
