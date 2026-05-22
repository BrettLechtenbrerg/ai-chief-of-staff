/**
 * API Key Validators - Test API keys by making lightweight requests
 */

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface TelegramValidationResult extends ValidationResult {
  botInfo?: unknown;
}

export interface DataForSEOValidationResult extends ValidationResult {
  /** Account balance in USD, when validation succeeds. */
  balance?: number;
}

interface ApiKeyValidationConfig {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: unknown;
  /** Extract error message from response JSON (defaults to data.error?.message) */
  extractError?: (data: Record<string, unknown>) => string;
  /** Custom success check (defaults to response.ok) */
  isSuccess?: (response: Response, data: Record<string, unknown>) => boolean;
}

/**
 * Generic API key validation helper.
 * Makes a test request and returns whether the key is valid.
 */
async function validateApiKey(config: ApiKeyValidationConfig): Promise<ValidationResult> {
  try {
    const fetchOptions: RequestInit = {
      method: config.method,
      headers: config.headers,
    };

    if (config.body) {
      fetchOptions.body = JSON.stringify(config.body);
    }

    const response = await fetch(config.url, fetchOptions);

    if (config.isSuccess) {
      const data = (await response.json()) as Record<string, unknown>;
      if (config.isSuccess(response, data)) {
        return { valid: true };
      }
      const errorMsg = config.extractError
        ? config.extractError(data)
        : ((data.error as Record<string, unknown>)?.message as string) || 'Invalid API key';
      return { valid: false, error: errorMsg };
    }

    if (response.ok) {
      return { valid: true };
    }

    const data = (await response.json()) as Record<string, unknown>;
    const errorMsg = config.extractError
      ? config.extractError(data)
      : ((data.error as Record<string, unknown>)?.message as string) || 'Invalid API key';
    return { valid: false, error: errorMsg };
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : 'Connection failed' };
  }
}

/**
 * Validate an Anthropic API key by making a test call
 */
export async function validateAnthropicKey(apiKey: string): Promise<ValidationResult> {
  return validateApiKey({
    url: 'https://api.anthropic.com/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Hi' }],
    },
  });
}

/**
 * Validate an OpenAI API key by listing models
 */
export async function validateOpenAIKey(apiKey: string): Promise<ValidationResult> {
  return validateApiKey({
    url: 'https://api.openai.com/v1/models',
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
}

/**
 * Validate a Telegram bot token
 */
export async function validateTelegramToken(token: string): Promise<TelegramValidationResult> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = (await response.json()) as Record<string, unknown>;

    if (data.ok) {
      return { valid: true, botInfo: data.result };
    }

    return { valid: false, error: (data.description as string) || 'Invalid token' };
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : 'Connection failed' };
  }
}

/**
 * Validate a Moonshot/Kimi API key by making a test call
 */
export async function validateMoonshotKey(apiKey: string): Promise<ValidationResult> {
  return validateApiKey({
    url: 'https://api.moonshot.ai/anthropic/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'anthropic-version': '2023-06-01',
    },
    body: {
      model: 'kimi-k2.6',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Hi' }],
    },
  });
}

/**
 * Validate a Z.AI GLM API key by making a test call
 */
export async function validateGlmKey(apiKey: string): Promise<ValidationResult> {
  return validateApiKey({
    url: 'https://api.z.ai/api/anthropic/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'anthropic-version': '2023-06-01',
    },
    body: {
      model: 'glm-5.1',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Hi' }],
    },
  });
}

/**
 * Validate a Xiaomi API key by making a test call
 */
export async function validateXiaomiKey(apiKey: string): Promise<ValidationResult> {
  return validateApiKey({
    url: 'https://token-plan-sgp.xiaomimimo.com/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: {
      model: 'mimo-v2-pro',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Hi' }],
    },
  });
}

/**
 * Validate a MiniMax API key by making a test call
 */
export async function validateMiniMaxKey(apiKey: string): Promise<ValidationResult> {
  return validateApiKey({
    url: 'https://api.minimax.io/anthropic/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'anthropic-version': '2023-06-01',
    },
    body: {
      model: 'MiniMax-M2.7',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Hi' }],
    },
  });
}

/**
 * Validate a DataForSEO login + API password by hitting the user_data
 * endpoint (a free GET that returns account balance + limits).
 *
 * DataForSEO uses HTTP Basic auth: `Authorization: Basic base64(login:password)`.
 * Note: the API password is NOT the same as the dashboard login password —
 * it's a separate secret shown on the API Access page in the DataForSEO
 * dashboard. The walkthrough UI surfaces this distinction to testers.
 *
 * DataForSEO returns HTTP 200 even for application errors and conveys the
 * real status via the JSON body's top-level `status_code` field. A
 * successful response has `status_code === 20000`. We pull the balance
 * from `tasks[0].result[0].money.balance` for display in the UI.
 */
export async function validateDataForSEOKey(
  login: string,
  password: string,
): Promise<DataForSEOValidationResult> {
  if (!login || !password) {
    return { valid: false, error: 'Login and API password are both required' };
  }
  try {
    const credentials = Buffer.from(`${login}:${password}`).toString('base64');
    const response = await fetch('https://api.dataforseo.com/v3/appendix/user_data', {
      method: 'GET',
      headers: { Authorization: `Basic ${credentials}` },
    });

    if (response.status === 401) {
      return {
        valid: false,
        error: 'Invalid login or API password. Make sure you\u2019re using your API password (not your dashboard login password).',
      };
    }

    const data = (await response.json()) as Record<string, unknown>;
    const statusCode = data.status_code as number | undefined;
    if (statusCode !== 20000) {
      const statusMessage = (data.status_message as string) || 'DataForSEO rejected the request';
      return { valid: false, error: statusMessage };
    }

    const tasks = data.tasks as Array<Record<string, unknown>> | undefined;
    const firstTask = tasks?.[0];
    const result = (firstTask?.result as Array<Record<string, unknown>> | undefined)?.[0];
    const money = result?.money as Record<string, unknown> | undefined;
    const balance = typeof money?.balance === 'number' ? (money.balance as number) : undefined;

    return { valid: true, balance };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    };
  }
}

/**
 * Validate a DeepSeek API key by making a test call
 */
export async function validateDeepSeekKey(apiKey: string): Promise<ValidationResult> {
  return validateApiKey({
    url: 'https://api.deepseek.com/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: {
      model: 'deepseek-v4-flash',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Hi' }],
    },
  });
}
