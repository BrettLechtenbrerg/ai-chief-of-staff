/**
 * send_telegram_message tool \u2014 lets the agent send arbitrary Telegram
 * messages mid-conversation. Used by the weekly blog cron to ping Brett
 * with the PR URL when the post is ready for review.
 *
 * The Telegram bot itself is a singleton owned by the main process
 * (src/main/index.ts holds the `telegramBot` reference). We can't import
 * that directly from a tool without circular dependencies, so the main
 * process injects the bot via `setTelegramBotForTools()` at startup, and
 * the tool reads it from this module's private state.
 *
 * Allowed chat IDs come from `telegram.allowedUserIds` in Settings \u2014 same
 * gate the inbound message middleware uses. The agent CANNOT send to
 * arbitrary chat IDs; it can only send to people already authorized to
 * receive ACOS messages.
 */

import { SettingsManager } from '../settings';

// Minimal interface so we don't have to import the full TelegramBot class
// (which would create a circular dependency through the channels module).
export interface TelegramSender {
  sendMessage(chatId: number, text: string): Promise<boolean>;
}

let _bot: TelegramSender | null = null;

/** Injected by main process at startup (or when the bot reconnects). */
export function setTelegramBotForTools(bot: TelegramSender | null): void {
  _bot = bot;
}

export interface SendTelegramInput {
  /**
   * Numeric Telegram chat ID. If omitted, sends to every chat in
   * `telegram.allowedUserIds`. Most blog-cron uses will omit this.
   */
  chatId?: number | string;
  /** Message body. Plain text. Telegram-flavored Markdown is NOT parsed. */
  text: string;
}

export interface SendTelegramResult {
  success: boolean;
  sentTo: number[];
  error?: string;
}

/**
 * Parse the comma-separated `telegram.allowedUserIds` setting into a list
 * of numeric chat IDs.
 */
function getAllowedChatIds(): number[] {
  const raw = SettingsManager.get('telegram.allowedUserIds');
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => parseInt(s, 10))
    .filter((n) => !isNaN(n));
}

export async function sendTelegram(input: SendTelegramInput): Promise<SendTelegramResult> {
  if (!input || typeof input.text !== 'string' || input.text.trim().length === 0) {
    return { success: false, sentTo: [], error: 'text is required' };
  }
  if (!_bot) {
    return {
      success: false,
      sentTo: [],
      error:
        'Telegram bot is not running. Check Settings \u2192 Telegram for a valid bot token, then Reboot the agent.',
    };
  }

  // Build the recipient list.
  let recipients: number[];
  if (input.chatId !== undefined) {
    const chatId =
      typeof input.chatId === 'string' ? parseInt(input.chatId, 10) : input.chatId;
    if (!Number.isFinite(chatId)) {
      return { success: false, sentTo: [], error: 'chatId must be a number' };
    }
    const allowed = getAllowedChatIds();
    if (allowed.length > 0 && !allowed.includes(chatId)) {
      return {
        success: false,
        sentTo: [],
        error: `chatId ${chatId} is not in telegram.allowedUserIds`,
      };
    }
    recipients = [chatId];
  } else {
    recipients = getAllowedChatIds();
    if (recipients.length === 0) {
      return {
        success: false,
        sentTo: [],
        error:
          'No chatId given and telegram.allowedUserIds is empty. Set allowed users in Settings \u2192 Telegram or pass chatId.',
      };
    }
  }

  const sentTo: number[] = [];
  for (const chatId of recipients) {
    try {
      const ok = await _bot.sendMessage(chatId, input.text);
      if (ok) sentTo.push(chatId);
    } catch (err) {
      console.error(`[send_telegram_message] failed for ${chatId}:`, (err as Error).message);
    }
  }

  if (sentTo.length === 0) {
    return { success: false, sentTo: [], error: 'No messages were delivered.' };
  }
  return { success: true, sentTo };
}

export function getSendTelegramToolDefinition() {
  return {
    name: 'send_telegram_message',
    description:
      "Send a Telegram message to Brett. Used at the end of multi-step routines (especially the weekly blog cron) to tell Brett the work is ready for review on his phone. Defaults to every chat in telegram.allowedUserIds \u2014 omit chatId for the common case. The message text is plain (Telegram-flavored Markdown is NOT parsed). Keep messages short \u2014 PR URL plus a 1-line summary, not the full agent transcript.",
    input_schema: {
      type: 'object' as const,
      properties: {
        text: {
          type: 'string',
          description: 'Plain-text message body. Newlines are preserved.',
        },
        chatId: {
          type: 'number',
          description:
            "Optional. Numeric Telegram chat ID. Omit to send to every chat in telegram.allowedUserIds (the normal case for Brett-only notifications).",
        },
      },
      required: ['text'],
    },
  };
}

export async function handleSendTelegramTool(input: unknown): Promise<string> {
  const result = await sendTelegram(input as SendTelegramInput);
  return JSON.stringify(result);
}
