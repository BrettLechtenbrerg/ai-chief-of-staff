/**
 * Tests for send_telegram_message tool.
 *
 * The tool talks to an injected TelegramSender. We mock the sender so we
 * never hit the real Telegram API but still verify:
 *  - validation: empty text rejected, missing bot rejected
 *  - chat-ID allow-list: explicit chatId not in allowedUserIds rejected
 *  - default recipients: omitting chatId fans out to allowedUserIds
 *  - JSON envelope from the handler
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockGetSetting = vi.fn();
vi.mock('../../src/settings', () => ({
  SettingsManager: {
    get: (k: string) => mockGetSetting(k),
  },
}));

import {
  sendTelegram,
  setTelegramBotForTools,
  handleSendTelegramTool,
} from '../../src/tools/telegram-tool';

const mockSend = vi.fn();
const fakeBot = {
  sendMessage: (chatId: number, text: string) => mockSend(chatId, text),
};

beforeEach(() => {
  mockGetSetting.mockReset();
  mockSend.mockReset();
  mockSend.mockResolvedValue(true);
  setTelegramBotForTools(fakeBot);
});

describe('send_telegram_message / validation', () => {
  it('rejects empty text', async () => {
    const r = await sendTelegram({ text: '' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/text is required/);
  });

  it('rejects when no bot is registered', async () => {
    setTelegramBotForTools(null);
    const r = await sendTelegram({ text: 'hi' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Telegram bot is not running/);
  });

  it('rejects chatId not in telegram.allowedUserIds', async () => {
    mockGetSetting.mockImplementation((k) => (k === 'telegram.allowedUserIds' ? '111,222' : ''));
    const r = await sendTelegram({ text: 'hi', chatId: 999 });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not in telegram.allowedUserIds/);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('rejects when no chatId and allowedUserIds is empty', async () => {
    mockGetSetting.mockReturnValue('');
    const r = await sendTelegram({ text: 'hi' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/No chatId given/);
  });
});

describe('send_telegram_message / delivery', () => {
  it('sends to the explicit chatId when allowed', async () => {
    mockGetSetting.mockImplementation((k) =>
      k === 'telegram.allowedUserIds' ? '7049067963' : '',
    );
    const r = await sendTelegram({ text: 'hello', chatId: 7049067963 });
    expect(r.success).toBe(true);
    expect(r.sentTo).toEqual([7049067963]);
    expect(mockSend).toHaveBeenCalledWith(7049067963, 'hello');
  });

  it('fans out to every allowed user when chatId is omitted', async () => {
    mockGetSetting.mockImplementation((k) =>
      k === 'telegram.allowedUserIds' ? '111,222,333' : '',
    );
    const r = await sendTelegram({ text: 'broadcast' });
    expect(r.success).toBe(true);
    expect(r.sentTo).toEqual([111, 222, 333]);
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it('parses string chatId', async () => {
    mockGetSetting.mockImplementation((k) =>
      k === 'telegram.allowedUserIds' ? '7049067963' : '',
    );
    const r = await sendTelegram({ text: 'hi', chatId: '7049067963' as never });
    expect(r.success).toBe(true);
    expect(mockSend).toHaveBeenCalledWith(7049067963, 'hi');
  });

  it('rejects non-numeric chatId', async () => {
    const r = await sendTelegram({ text: 'hi', chatId: 'not-a-number' as never });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/chatId must be a number/);
  });

  it('returns failure when no messages delivered', async () => {
    mockSend.mockResolvedValue(false);
    mockGetSetting.mockImplementation((k) =>
      k === 'telegram.allowedUserIds' ? '111' : '',
    );
    const r = await sendTelegram({ text: 'hi' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/No messages were delivered/);
  });

  it('survives a sendMessage exception', async () => {
    mockSend.mockRejectedValueOnce(new Error('network'));
    mockSend.mockResolvedValueOnce(true);
    mockGetSetting.mockImplementation((k) =>
      k === 'telegram.allowedUserIds' ? '111,222' : '',
    );
    const r = await sendTelegram({ text: 'hi' });
    expect(r.success).toBe(true);
    expect(r.sentTo).toEqual([222]);
  });
});

describe('send_telegram_message / handler envelope', () => {
  it('returns JSON string the agent can parse', async () => {
    mockGetSetting.mockReturnValue('');
    const out = await handleSendTelegramTool({ text: 'hi' });
    const parsed = JSON.parse(out);
    expect(parsed.success).toBe(false);
    expect(typeof parsed.error).toBe('string');
  });
});
