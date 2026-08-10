import { trustedHandle } from './trusted-ipc.js';
import { AgentManager } from '../../agent';
import { resolveAndPersistModel } from '../../agent/resolve-model';
import { SettingsManager, SETTINGS_SCHEMA } from '../../settings';
import { THEMES } from '../../settings/themes';
import { createTelegramBot } from '../../channels/telegram';
import { getWindow, getAllWindows } from '../windows';
import { setupBirthdayCronJobs } from '../birthday';
import type { IPCDependencies } from './types';

/**
 * Get available models based on configured API keys.
 * Single source of truth for the model list.
 */
export function getAvailableModels(): Array<{ id: string; name: string; provider: string }> {
  const models: Array<{ id: string; name: string; provider: string }> = [];
  const authMethod = SettingsManager.get('auth.method');
  const hasOAuth = authMethod === 'oauth' && SettingsManager.get('auth.oauthToken');
  const hasAnthropicKey = SettingsManager.get('anthropic.apiKey');
  if (hasOAuth || hasAnthropicKey) {
    models.push(
      { id: 'claude-opus-4-7', name: 'Opus 4.7', provider: 'anthropic' },
      { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6', provider: 'anthropic' },
      { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', provider: 'anthropic' }
    );
  }
  const hasMoonshotKey = SettingsManager.get('moonshot.apiKey');
  if (hasMoonshotKey) {
    models.push({ id: 'kimi-k2.6', name: 'Kimi K2.6', provider: 'moonshot' });
  }
  const hasGlmKey = SettingsManager.get('glm.apiKey');
  if (hasGlmKey) {
    models.push(
      { id: 'glm-5.1', name: 'GLM 5.1', provider: 'glm' },
      { id: 'glm-5-turbo', name: 'GLM 5 Turbo', provider: 'glm' },
      { id: 'glm-4.7', name: 'GLM 4.7', provider: 'glm' },
      { id: 'glm-4.7-flash', name: 'GLM 4.7 Flash', provider: 'glm' }
    );
  }
  const hasXiaomiKey = SettingsManager.get('xiaomi.apiKey');
  if (hasXiaomiKey) {
    models.push({ id: 'mimo-v2-pro', name: 'MiMo-V2-Pro', provider: 'xiaomi' });
  }
  const hasOpenAIKey = SettingsManager.get('openai.apiKey');
  const hasOpenAIOAuth = SettingsManager.get('openai.auth.method') === 'oauth';
  if (hasOpenAIKey || hasOpenAIOAuth) {
    models.push(
      { id: 'gpt-5.5', name: 'GPT-5.5', provider: 'openai' },
      { id: 'gpt-5.5-pro', name: 'GPT-5.5 Pro', provider: 'openai' },
      { id: 'gpt-5.4', name: 'GPT-5.4', provider: 'openai' },
      { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', provider: 'openai' },
      { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', provider: 'openai' },
      { id: 'codex-mini-latest', name: 'Codex Mini', provider: 'openai' }
    );
  }
  const hasMiniMaxKey = SettingsManager.get('minimax.apiKey');
  if (hasMiniMaxKey) {
    models.push(
      { id: 'MiniMax-M2.7', name: 'MiniMax M2.7', provider: 'minimax' },
      { id: 'MiniMax-M2.7-highspeed', name: 'MiniMax M2.7 Highspeed', provider: 'minimax' }
    );
  }
  const hasDeepSeekKey = SettingsManager.get('deepseek.apiKey');
  if (hasDeepSeekKey) {
    models.push(
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', provider: 'deepseek' },
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', provider: 'deepseek' }
    );
  }

  // Fold in any models found by live discovery ("Check for new models" in
  // Settings). Only surface a discovered model when the user is actually
  // authed for its provider, and never duplicate a curated id.
  const authedProviders = new Set(models.map((m) => m.provider));
  const known = new Set(models.map((m) => m.id));
  for (const m of getDiscoveredModels()) {
    if (!authedProviders.has(m.provider)) continue;
    if (known.has(m.id)) continue;
    known.add(m.id);
    models.push(m);
  }

  return sortModelsForDisplay(models);
}

/**
 * Order the model list for the picker: keep providers grouped (in the order
 * they first appear — Anthropic, then OpenAI, then the rest), keep each model
 * family together, and within a family list the newest version first
 * (Opus 4.8 → 4.7 → 4.6 …). Families are ordered by their newest member, so the
 * family with the latest model sits at the top of each provider block.
 */
function sortModelsForDisplay<T extends { name: string; provider: string }>(models: T[]): T[] {
  // Numeric version embedded in the display name, e.g. 'Opus 4.8' → [4, 8].
  const versionOf = (name: string): number[] => {
    const match = String(name).match(/(\d+(?:\.\d+)*)/);
    return match ? match[1].split('.').map(Number) : [];
  };
  // Family = the name with its version number stripped, e.g. 'GPT-5.5 Pro' → 'gpt- pro'.
  const familyOf = (name: string): string =>
    String(name)
      .replace(/\d+(?:\.\d+)*/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  // Compare two version arrays, newest first.
  const cmpVerDesc = (a: number[], b: number[]): number => {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const d = (b[i] ?? 0) - (a[i] ?? 0);
      if (d) return d;
    }
    return 0;
  };

  // First-seen provider order, and each family's newest version.
  const providerOrder: string[] = [];
  const familyMax = new Map<string, number[]>();
  for (const m of models) {
    if (!providerOrder.includes(m.provider)) providerOrder.push(m.provider);
    const key = `${m.provider}|${familyOf(m.name)}`;
    const ver = versionOf(m.name);
    const cur = familyMax.get(key);
    if (!cur || cmpVerDesc(ver, cur) < 0) familyMax.set(key, ver);
  }

  return [...models].sort((a, b) => {
    const pa = providerOrder.indexOf(a.provider);
    const pb = providerOrder.indexOf(b.provider);
    if (pa !== pb) return pa - pb;

    const fa = familyOf(a.name);
    const fb = familyOf(b.name);
    if (fa !== fb) {
      const d = cmpVerDesc(
        familyMax.get(`${a.provider}|${fa}`) ?? [],
        familyMax.get(`${b.provider}|${fb}`) ?? []
      );
      if (d) return d;
      return fa < fb ? -1 : 1;
    }

    const d = cmpVerDesc(versionOf(a.name), versionOf(b.name));
    if (d) return d;
    return a.name < b.name ? -1 : 1;
  });
}

/** Settings key holding the JSON cache of discovery results. */
const DISCOVERED_MODELS_KEY = 'models.discovered';

/** Read the cached discovered-model list (persisted across restarts). */
export function getDiscoveredModels(): Array<{ id: string; name: string; provider: string }> {
  try {
    const raw = SettingsManager.get(DISCOVERED_MODELS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m) =>
        m &&
        typeof m.id === 'string' &&
        typeof m.name === 'string' &&
        typeof m.provider === 'string'
    );
  } catch {
    return [];
  }
}

/**
 * Settings keys that affect which LLM provider is in use. Whenever any of
 * these change we re-resolve `agent.model` and restart the agent so the
 * picker, chat-engine, and provider routing all stay in sync. Without
 * this, adding a Kimi key (for example) when the default model is
 * `claude-opus-4-7` leaves the agent trying to call Anthropic with no key
 * and surfaces a confusing "No API key configured" error.
 */
const PROVIDER_CREDENTIAL_KEYS = new Set([
  'anthropic.apiKey',
  'openai.apiKey',
  'moonshot.apiKey',
  'glm.apiKey',
  'xiaomi.apiKey',
  'minimax.apiKey',
  'deepseek.apiKey',
  'auth.method',
  'auth.oauthToken',
  'openai.auth.method',
]);

const MAX_PUBLIC_SETTING_BYTES = 1024 * 1024;
const CHAT_API_URL = 'https://pocket-agent-chat-production.up.railway.app';
const CHAT_USERNAME_PATTERN = /^[a-z0-9-]{1,15}$/;

export function registerSettingsIPC(deps: IPCDependencies): void {
  const { getScheduler, setTelegramBot, getTelegramBot, WIN } = deps;

  const handleCredentialChange = async (key: string): Promise<void> => {
    if (!PROVIDER_CREDENTIAL_KEYS.has(key)) return;
    const previousModel = SettingsManager.get('agent.model');
    const resolvedModel = resolveAndPersistModel();
    const modelChanged = resolvedModel !== previousModel;
    try {
      await deps.restartAgent();
      console.log(`[Settings] Provider credential changed (${key}); agent restarted`);
    } catch (error) {
      console.error('[Settings] Failed to restart agent after credential change:', error);
    }
    if (modelChanged) {
      getWindow(WIN.CHAT)?.webContents.send('model:changed', resolvedModel);
      getWindow(WIN.SETTINGS)?.webContents.send('model:changed', resolvedModel);
    }
  };

  trustedHandle('settings:getAll', async () => SettingsManager.getAllSafe());
  trustedHandle('settings:getSecretPresence', async () => SettingsManager.getSecretPresence());

  trustedHandle('settings:getThemes', async () => THEMES);
  trustedHandle('settings:getSkin', async () => SettingsManager.get('ui.skin') || 'tsai');

  trustedHandle('settings:get', async (_, key: string) => {
    if (SettingsManager.isSecretKey(key))
      throw new Error('Secret settings cannot be read by a renderer');
    const definition = SETTINGS_SCHEMA.find((setting) => setting.key === key);
    if (!definition) throw new Error('Unknown setting');
    return SettingsManager.get(key);
  });

  trustedHandle('settings:set', async (_, key: string, value: string) => {
    try {
      const definition = SETTINGS_SCHEMA.find((setting) => setting.key === key);
      if (!definition) throw new Error('Unknown setting');
      if (definition.encrypted) throw new Error('Use the secret settings API for credentials');
      if (typeof value !== 'string') throw new Error('Setting value must be a string');
      if (Buffer.byteLength(value, 'utf8') > MAX_PUBLIC_SETTING_BYTES) {
        throw new Error('Setting exceeds the 1 MiB limit');
      }
      if (definition.validation && !definition.validation(value))
        throw new Error('Invalid setting value');
      SettingsManager.set(key, value);

      // Auto-setup birthday cron jobs when birthday is set
      if (key === 'profile.birthday') {
        await setupBirthdayCronJobs(value, getScheduler());
      }

      // Broadcast skin change to all open windows
      if (key === 'ui.skin') {
        for (const win of getAllWindows()) {
          win.webContents.send('skin:changed', value);
        }
      }

      // Broadcast chat username change to chat window — no restart required
      if (key === 'chat.username' && getWindow(WIN.CHAT)) {
        getWindow(WIN.CHAT)?.webContents.send('chat:usernameChanged', value);
      }

      await handleCredentialChange(key);

      // Instant Telegram toggle — no restart required
      if (key === 'telegram.enabled') {
        const enabled = value === 'true' || value === '1';
        if (enabled) {
          const token = SettingsManager.get('telegram.botToken');
          if (!getTelegramBot() && token) {
            const bot = createTelegramBot();
            if (bot) {
              bot.setOnMessageCallback((data) => {
                if (getWindow(WIN.CHAT)) {
                  getWindow(WIN.CHAT)?.webContents.send('telegram:message', {
                    userMessage: data.userMessage,
                    response: data.response,
                    chatId: data.chatId,
                    sessionId: data.sessionId,
                    hasAttachment: data.hasAttachment,
                    attachmentType: data.attachmentType,
                    wasCompacted: data.wasCompacted,
                    media: data.media,
                  });
                }
              });
              bot.setOnSessionLinkCallback(() => {
                if (getWindow(WIN.CHAT)) {
                  getWindow(WIN.CHAT)?.webContents.send('sessions:changed');
                }
              });
              await bot.start();
              setTelegramBot(bot);
              const scheduler = getScheduler();
              if (scheduler) scheduler.setTelegramBot(bot);
              console.log('[Main] Telegram started (live toggle)');
            }
          }
        } else {
          const telegramBot = getTelegramBot();
          if (telegramBot) {
            await telegramBot.stop();
            setTelegramBot(null);
            const scheduler = getScheduler();
            if (scheduler) scheduler.setTelegramBot(null);
            console.log('[Main] Telegram stopped (live toggle)');
          }
        }
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  trustedHandle('settings:delete', async (_, key: string) => {
    const definition = SETTINGS_SCHEMA.find((setting) => setting.key === key);
    if (!definition) throw new Error('Unknown setting');
    if (definition.encrypted) throw new Error('Use the secret settings API for credentials');
    return { success: SettingsManager.delete(key) };
  });

  trustedHandle('settings:setSecret', async (_, key: string, value: string) => {
    SettingsManager.setSecret(key, value);
    await handleCredentialChange(key);
    return { success: true };
  });

  trustedHandle('settings:deleteSecret', async (_, key: string) => {
    const success = SettingsManager.deleteSecret(key);
    await handleCredentialChange(key);
    return { success };
  });

  trustedHandle('settings:registerChatUsername', async (_, username: string) => {
    const normalized = typeof username === 'string' ? username.trim().toLowerCase() : '';
    if (!CHAT_USERNAME_PATTERN.test(normalized)) {
      return { success: false, error: 'Letters, numbers, and dashes only (max 15)' };
    }

    try {
      const oldUsername = SettingsManager.get('chat.username');
      const adminKey = SettingsManager.get('chat.adminKey');
      const response = await fetch(`${CHAT_API_URL}/api/register-username`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: normalized,
          oldUsername,
          ...(adminKey ? { adminKey } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return { success: false, error: 'Chat server error, try again later' };
      const data = (await response.json()) as { error?: string };
      if (data.error) {
        return {
          success: false,
          error: data.error === 'taken' ? 'Username taken, try another' : data.error,
        };
      }
      SettingsManager.set('chat.username', normalized);
      getWindow(WIN.CHAT)?.webContents.send('chat:usernameChanged', normalized);
      return { success: true, username: normalized };
    } catch (error) {
      console.error('[Settings] Chat username registration failed:', error);
      return { success: false, error: 'Could not reach chat server' };
    }
  });

  trustedHandle('settings:schema', async (_, category?: string) => {
    return SettingsManager.getSchema(category);
  });

  trustedHandle('settings:isFirstRun', async () => {
    return SettingsManager.isFirstRun();
  });

  trustedHandle('settings:resetOnboarding', async () => {
    SettingsManager.resetOnboarding();
    return { success: true };
  });

  trustedHandle('settings:initializeKeychain', async () => {
    return SettingsManager.initializeKeychain();
  });

  // Validation handlers
  trustedHandle('settings:validateAnthropic', async (_, key: string) => {
    return SettingsManager.validateAnthropicKey(key);
  });

  trustedHandle('settings:validateOpenAI', async (_, key: string) => {
    return SettingsManager.validateOpenAIKey(key);
  });

  trustedHandle('settings:validateDataForSEO', async (_, login: string, password: string) => {
    return SettingsManager.validateDataForSEOKey(login, password);
  });

  trustedHandle('settings:validateFirecrawl', async (_, apiKey: string) => {
    return SettingsManager.validateFirecrawlKey(apiKey);
  });

  trustedHandle('settings:validateTelegram', async (_, token: string) => {
    return SettingsManager.validateTelegramToken(token);
  });

  trustedHandle('settings:validateMoonshot', async (_, key: string) => {
    return SettingsManager.validateMoonshotKey(key);
  });

  trustedHandle('settings:validateGlm', async (_, key: string) => {
    return SettingsManager.validateGlmKey(key);
  });

  trustedHandle('settings:validateXiaomi', async (_, key: string) => {
    return SettingsManager.validateXiaomiKey(key);
  });

  trustedHandle('settings:validateMiniMax', async (_, key: string) => {
    return SettingsManager.validateMiniMaxKey(key);
  });

  trustedHandle('settings:validateDeepSeek', async (_, key: string) => {
    return SettingsManager.validateDeepSeekKey(key);
  });

  // Validate an already-stored key (reads real key from backend, never sent to renderer)
  trustedHandle('settings:validateStoredKey', async (_, provider: string) => {
    const keyMap: Record<string, string> = {
      anthropic: 'anthropic.apiKey',
      openai: 'openai.apiKey',
      moonshot: 'moonshot.apiKey',
      glm: 'glm.apiKey',
      xiaomi: 'xiaomi.apiKey',
      minimax: 'minimax.apiKey',
      deepseek: 'deepseek.apiKey',
      telegram: 'telegram.botToken',
    };
    const settingKey = keyMap[provider];
    if (!settingKey) return { valid: false, error: 'Unknown provider' };

    const storedKey = SettingsManager.get(settingKey);
    if (!storedKey) return { valid: false, error: 'No key saved — enter one first' };

    switch (provider) {
      case 'anthropic':
        return SettingsManager.validateAnthropicKey(storedKey);
      case 'openai':
        return SettingsManager.validateOpenAIKey(storedKey);
      case 'moonshot':
        return SettingsManager.validateMoonshotKey(storedKey);
      case 'glm':
        return SettingsManager.validateGlmKey(storedKey);
      case 'xiaomi':
        return SettingsManager.validateXiaomiKey(storedKey);
      case 'minimax':
        return SettingsManager.validateMiniMaxKey(storedKey);
      case 'deepseek':
        return SettingsManager.validateDeepSeekKey(storedKey);
      case 'telegram':
        return SettingsManager.validateTelegramToken(storedKey);
      default:
        return { valid: false, error: 'Unknown provider' };
    }
  });

  trustedHandle('settings:getAvailableModels', async () => {
    return getAvailableModels();
  });

  // Live model discovery — triggered by the "Check for new models" button.
  // Queries Anthropic + OpenAI, merges anything new into the persisted cache,
  // and returns how many new ids were added plus the refreshed model list.
  trustedHandle('settings:discoverModels', async () => {
    try {
      const { discoverModels } = await import('../../agent/model-discovery.js');
      const found = await discoverModels();

      // Replace results PER PROVIDER rather than accumulating forever: any
      // provider that returned models has its cached entries fully replaced (so
      // models that vanish upstream, or that a tightened filter now excludes,
      // drop out cleanly). Providers that returned nothing this run keep their
      // previously-discovered entries, so a single timeout never wipes them.
      const existing = getDiscoveredModels();
      const refreshedProviders = new Set<string>(found.map((m) => m.provider));
      const kept = existing.filter((m) => !refreshedProviders.has(m.provider));

      const prevIds = new Set(existing.map((m) => m.id));
      const added = found.filter((m) => !prevIds.has(m.id)).length;

      const merged = [...kept, ...found];
      SettingsManager.set(DISCOVERED_MODELS_KEY, JSON.stringify(merged));

      return { ok: true, added, discovered: found.length, models: getAvailableModels() };
    } catch (err) {
      console.error('[Settings] discoverModels failed:', err);
      return {
        ok: false,
        added: 0,
        discovered: 0,
        models: getAvailableModels(),
        error: err instanceof Error ? err.message : 'Discovery failed',
      };
    }
  });

  // Customize - System prompt (read-only, developer-controlled content only)
  trustedHandle('customize:getSystemPrompt', async () => {
    return AgentManager.getDeveloperPrompt() || '';
  });

  // Customize - Agent modes (read-only, for system prompt tab)
  trustedHandle('customize:getAgentModes', async () => {
    const { getAllModes } = await import('../../agent/agent-modes.js');
    return getAllModes().map((m) => ({
      id: m.id,
      name: m.name,
      icon: m.icon,
      systemPrompt: m.systemPrompt,
      description: m.description,
    }));
  });

  // Location and timezone lookup
  trustedHandle('location:lookup', async (_, query: string) => {
    if (!query || query.length < 2) return [];
    const cityTimezones = await import('city-timezones');
    const results = cityTimezones.lookupViaCity(query);
    return results
      .slice(0, 10)
      .map((r: { city: string; country: string; timezone: string; province?: string }) => ({
        city: r.city,
        country: r.country,
        province: r.province || '',
        timezone: r.timezone,
        display: r.province ? `${r.city}, ${r.province}, ${r.country}` : `${r.city}, ${r.country}`,
      }));
  });

  trustedHandle('timezone:list', async () => {
    try {
      const timezones = Intl.supportedValuesOf('timeZone');
      return timezones;
    } catch {
      return [
        'America/New_York',
        'America/Chicago',
        'America/Denver',
        'America/Los_Angeles',
        'America/Toronto',
        'America/Vancouver',
        'America/Mexico_City',
        'America/Sao_Paulo',
        'Europe/London',
        'Europe/Paris',
        'Europe/Berlin',
        'Europe/Rome',
        'Europe/Madrid',
        'Europe/Amsterdam',
        'Europe/Stockholm',
        'Europe/Moscow',
        'Asia/Tokyo',
        'Asia/Shanghai',
        'Asia/Hong_Kong',
        'Asia/Singapore',
        'Asia/Seoul',
        'Asia/Bangkok',
        'Asia/Jakarta',
        'Asia/Kolkata',
        'Asia/Dubai',
        'Asia/Jerusalem',
        'Australia/Sydney',
        'Australia/Melbourne',
        'Australia/Perth',
        'Pacific/Auckland',
        'Pacific/Honolulu',
        'Pacific/Fiji',
        'Africa/Cairo',
        'Africa/Johannesburg',
        'Africa/Lagos',
      ];
    }
  });
}
