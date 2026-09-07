import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bot, InputFile } from 'grammy';
import { ApprovalManager, type ApprovalRequest } from '../../src/security/approval-manager';
import { TelegramDeliveryDenied, telegramDeliveryApproval, MAX_TELEGRAM_CAPTURE_BYTES } from '../../src/security/telegram-delivery';
import { createHash } from 'crypto';
import * as fsPromises from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { TelegramBot } from '../../src/channels/telegram';
import { sendToAllChannels, sendReminderToAllChannels } from '../../src/scheduler/notifications';
import { sendTelegram, setTelegramBotForTools } from '../../src/tools/telegram-tool';
import type { MemoryManager } from '../../src/memory';

vi.mock('fs/promises', async (original) => {
  const fs = await original<typeof import('fs/promises')>();
  return { ...fs, open: vi.fn(fs.open) };
});
const { transport } = vi.hoisted(() => ({ transport: vi.fn() }));
vi.mock('grammy', async (original) => {
  const grammy = await original<typeof import('grammy')>();
  return { ...grammy, Bot: class extends grammy.Bot {
    constructor(token: string) {
      super(token, { botInfo: { id: 1, is_bot: true, first_name: 'Fixture', username: 'fixture_bot',
        can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false },
      client: { fetch: transport } });
    }
  } };
});
vi.mock('../../src/agent', () => ({ AgentManager: { isInitialized: () => false } }));
vi.mock('../../src/settings', () => ({ SettingsManager: {
  get: (key: string) => key === 'telegram.botToken' ? 'fixture-token' : '123',
  getArray: () => ['123'], set: vi.fn(),
} }));

describe('Telegram wire approval (real grammY, inert transport)', () => {
  let channel: TelegramBot;
  let bot: Bot;
  let previews: ApprovalRequest[];
  beforeEach(() => {
    transport.mockReset().mockResolvedValue({ json: async () => ({ ok: true, result: { message_id: 9 } }) });
    previews = [];
    ApprovalManager.setNotifier(null);
    channel = new TelegramBot();
    Object.assign(channel, { isRunning: true });
    bot = (channel as unknown as { bot: Bot }).bot;
    setTelegramBotForTools(channel);
  });
  afterEach(() => {
    ApprovalManager.setNotifier(null);
    setTelegramBotForTools(null);
    vi.useRealTimers();
  });
  function decision(approve: boolean) {
    ApprovalManager.setNotifier((request) => {
      previews.push(request);
      ApprovalManager.resolve(request.id, approve ? 'approve' : 'deny', 'ui');
      return true;
    });
  }
  const help = { update_id: 1, message: { message_id: 1, date: 0,
    chat: { id: 123, type: 'private' as const, first_name: 'Fixture' },
    from: { id: 123, is_bot: false, first_name: 'Fixture' },
    text: '/help', entities: [{ type: 'bot_command' as const, offset: 0, length: 5 }] } };

  it('denies real direct ctx.reply from an incoming /help without UI; allows only one approved execution', async () => {
    await expect(bot.handleUpdate(help)).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
    decision(true);
    await bot.handleUpdate(help);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(JSON.parse(previews[0].details).payload).toMatchObject({ chat_id: 123, parse_mode: 'HTML' });
    expect(ApprovalManager.resolve(previews[0].id, 'approve', 'ui')).toBe(false);
    decision(false);
    await expect(bot.handleUpdate(help)).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('denies bot.sendMessage without fallback reprompt and protects tool delivery', async () => {
    decision(false);
    expect(await channel.sendMessage(123, 'private draft')).toBe(false);
    expect(previews).toHaveLength(1);
    expect((await sendTelegram({ text: 'tool draft' })).success).toBe(false);
    expect(transport).not.toHaveBeenCalled();
    decision(true);
    expect((await sendTelegram({ text: 'tool draft' })).sentTo).toEqual([123]);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('shows and approves each exact formatted chunk independently', async () => {
    decision(true);
    expect(await channel.sendMessage(123, 'chunk '.repeat(1000))).toBe(true);
    expect(previews.length).toBeGreaterThan(1);
    for (const [index, request] of previews.entries()) {
      const body = JSON.parse(transport.mock.calls[index][1].body);
      expect(JSON.parse(request.details).payload).toEqual(body);
    }
  });
  it('snapshots destination/content before awaiting; cancellation immediately after approval denies', async () => {
    ApprovalManager.setNotifier((request) => { previews.push(request); return true; });
    const payload = { chat_id: 123, text: 'original' };
    const pending = bot.api.raw.sendMessage(payload);
    payload.text = 'changed'; payload.chat_id = 456;
    ApprovalManager.resolve(previews[0].id, 'approve', 'ui');
    await pending;
    expect(JSON.parse(transport.mock.calls[0][1].body)).toEqual({ chat_id: 123, text: 'original' });
    const controller = new AbortController();
    const canceled = bot.api.sendMessage(123, 'cancel', {}, controller.signal);
    ApprovalManager.resolve(previews[1].id, 'approve', 'ui');
    controller.abort();
    await expect(canceled).rejects.toBeInstanceOf(TelegramDeliveryDenied);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('denies pending abort, cancel-session, expiry and UI removal', async () => {
    vi.useFakeTimers();
    ApprovalManager.setNotifier((request) => { previews.push(request); return true; });
    for (const cancel of ['abort', 'session', 'expiry', 'ui']) {
      const controller = new AbortController();
      const pending = bot.api.sendMessage(123, cancel, {}, controller.signal);
      const assertion = expect(pending).rejects.toBeInstanceOf(TelegramDeliveryDenied);
      if (cancel === 'abort') controller.abort();
      if (cancel === 'session') ApprovalManager.cancelSession(previews.at(-1)!.sessionId);
      if (cancel === 'expiry') await vi.advanceTimersByTimeAsync(120_001);
      if (cancel === 'ui') ApprovalManager.setNotifier(null);
      await assertion;
    }
    expect(transport).not.toHaveBeenCalled();
  });
  it('retains local scheduler notifications/results when Telegram delivery is denied', async () => {
    decision(false);
    const onNotification = vi.fn(); const onChatMessage = vi.fn();
    const channels = { telegramBot: channel, onNotification, onChatMessage,
      memory: { getChatForSession: () => 123 } as unknown as MemoryManager };
    await sendToAllChannels(channels, 'fixture', 'prompt', 'local result', 'session');
    await sendReminderToAllChannels(channels, 'task', 'local reminder', 'session');
    expect(onChatMessage).toHaveBeenCalledTimes(2);
    expect(onNotification).toHaveBeenCalledWith('AI Chief of Staff', 'local reminder');
    expect(previews).toHaveLength(2);
    expect(transport).not.toHaveBeenCalled();
    decision(true);
    await sendToAllChannels(channels, 'fixture', 'prompt', 'approved result', 'session', '123');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('gates edits, deletes, typing and hidden polling startup deleteWebhook; known reads run, other methods require approval', async () => {
    decision(false);
    for (const call of [() => bot.api.editMessageText(123, 9, 'edit'),
      () => bot.api.deleteMessage(123, 9), () => bot.api.sendChatAction(123, 'typing'),
      () => bot.api.deleteWebhook({ drop_pending_updates: false })]) {
      await expect(call()).rejects.toBeInstanceOf(TelegramDeliveryDenied);
    }
    expect(transport).not.toHaveBeenCalled();
    await bot.api.getMe(); await bot.api.getUpdates(); await bot.api.getFile('fixture');
    expect(transport).toHaveBeenCalledTimes(3);
    decision(true);
    await bot.api.setMyName('reviewed');
    await bot.api.setMyCommands([{ command: 'help', description: 'Help' }]);
    expect(transport).toHaveBeenCalledTimes(5);
    expect(JSON.parse(previews.at(-1)!.details).method).toBe('setMyCommands');
  });
  it('binds each uploaded media byte and filename to approval; rejects unpreviewable sources', async () => {
    const bytes = Buffer.from('fixture photo bytes');
    ApprovalManager.setNotifier((request) => { previews.push(request); return true; });
    const pending = bot.api.sendPhoto(123, new InputFile(bytes, 'fixture.png'));
    bytes.fill(0);
    const photo = JSON.parse(previews[0].details).payload.photo;
    expect(photo).toEqual({ filename: 'fixture.png', bytes: 19, sha256: createHash('sha256').update('fixture photo bytes').digest('hex') });
    ApprovalManager.resolve(previews[0].id, 'deny', 'ui');
    await expect(pending).rejects.toBeInstanceOf(TelegramDeliveryDenied);
    expect(transport).not.toHaveBeenCalled();
    await expect(bot.api.sendPhoto(123, new InputFile(new URL('https://invalid.test/image')))).rejects.toThrow();
  });
  it('captures >64KB local media once, previews a digest, and never reopens the approved source', async () => {
    const dir = await fsPromises.mkdtemp(join(tmpdir(), 'telegram-approval-'));
    const path = join(dir, 'media.bin');
    const original = Buffer.alloc(128 * 1024, 42);
    const prev = vi.fn().mockResolvedValue({ ok: true, result: true });
    try {
      for (const method of ['sendPhoto', 'sendAudio', 'sendDocument', 'sendVideo'] as const) {
        await fsPromises.writeFile(path, original);
        ApprovalManager.setNotifier((request) => { previews.push(request); return true; });
        const before = previews.length;
        const field = method.slice(4).toLowerCase();
        const pending = telegramDeliveryApproval()(prev, method,
          { chat_id: 123, [field]: new InputFile(path, 'media.bin') });
        await vi.waitFor(() => expect(previews.length).toBe(before + 1));
        expect(prev).toHaveBeenCalledTimes(before);
        const preview = JSON.parse(previews.at(-1)!.details).payload[field];
        expect(preview).toEqual({ filename: 'media.bin', bytes: original.length,
          sha256: createHash('sha256').update(original).digest('hex') });
        await fsPromises.writeFile(path, Buffer.alloc(original.length, 0));
        ApprovalManager.resolve(previews.at(-1)!.id, 'approve', 'ui');
        await pending;
        const sent = prev.mock.calls.at(-1)![1][field] as InputFile;
        expect(Object.getOwnPropertyDescriptor(sent, 'fileData')!.value).toEqual(original);
      }
    } finally {
      await fsPromises.rm(dir, { recursive: true, force: true });
    }
  });
  it('fails closed for large media with no UI/abort and aggregate cap overflow', async () => {
    const prev = vi.fn();
    const gate = telegramDeliveryApproval();
    const media = new InputFile(Buffer.alloc(128 * 1024), 'large.bin');
    await expect(gate(prev, 'sendDocument', { chat_id: 123, document: media })).rejects.toBeInstanceOf(TelegramDeliveryDenied);
    const controller = new AbortController();
    controller.abort();
    await expect(gate(prev, 'sendDocument', { chat_id: 123, document: media }, controller.signal)).rejects.toBeInstanceOf(TelegramDeliveryDenied);
    decision(true);
    const half = new InputFile(Buffer.alloc(MAX_TELEGRAM_CAPTURE_BYTES / 2 + 1), 'half.bin');
    await expect(gate(prev, 'sendMediaGroup', { chat_id: 123,
      media: [{ type: 'photo', media: half }, { type: 'photo', media: half }] })).rejects.toBeInstanceOf(TelegramDeliveryDenied);
    expect(previews).toHaveLength(0);
    expect(prev).not.toHaveBeenCalled();
  });
  it('rejects source growth/oversize before approval and always closes file handles', async () => {
    const prev = vi.fn();
    decision(true);
    for (const size of [128 * 1024, MAX_TELEGRAM_CAPTURE_BYTES + 1]) {
      const close = vi.fn().mockResolvedValue(undefined);
      const read = vi.fn().mockImplementation(async (_buffer, _offset, length) => ({ bytesRead: length }));
      const open = vi.spyOn(fsPromises, 'open').mockResolvedValue({
        stat: async () => ({ isFile: () => true, size, mtimeMs: 0 }), read, close,
      } as unknown as Awaited<ReturnType<typeof fsPromises.open>>);
      try {
        await expect(telegramDeliveryApproval()(prev, 'sendDocument', {
          chat_id: 123, document: new InputFile('/fixture/growing.bin'),
        })).rejects.toBeInstanceOf(TelegramDeliveryDenied);
        expect(close).toHaveBeenCalledOnce();
        if (size > MAX_TELEGRAM_CAPTURE_BYTES) expect(read).not.toHaveBeenCalled();
        else expect(read).toHaveBeenCalledTimes(2); // bounded data read + growth probe
      } finally { open.mockRestore(); }
    }
    expect(previews).toHaveLength(0);
    expect(prev).not.toHaveBeenCalled();
  });
  it('cancels session-bound asynchronous capture before a dialog or delivery', async () => {
    decision(true);
    const close = vi.fn().mockResolvedValue(undefined);
    const open = vi.spyOn(fsPromises, 'open').mockImplementation(async () => {
      ApprovalManager.cancelSession('telegram-delivery:123');
      return { stat: async () => ({ isFile: () => true, size: 128 * 1024 }), close,
        read: vi.fn() } as unknown as Awaited<ReturnType<typeof fsPromises.open>>;
    });
    const prev = vi.fn();
    try {
      await expect(telegramDeliveryApproval()(prev, 'sendDocument', {
        chat_id: 123, document: new InputFile('/fixture/canceled.bin'),
      })).rejects.toBeInstanceOf(TelegramDeliveryDenied);
      expect(close).toHaveBeenCalledOnce();
      expect(previews).toHaveLength(0);
      expect(prev).not.toHaveBeenCalled();
    } finally { open.mockRestore(); }
  });
  it('real polling startup cannot perform its hidden deleteWebhook without consent', async () => {
    await expect(bot.start()).rejects.toBeInstanceOf(TelegramDeliveryDenied);
    expect(transport).not.toHaveBeenCalled();
  });
  it('later transformers and inherited ctx.api cannot skip approval of their changed payload', async () => {
    bot.api.config.use(async (prev, method, payload, signal) => {
      if (method === 'sendMessage') Object.assign(payload, { chat_id: 456, text: 'transformed' });
      return prev(method, payload, signal);
    });
    decision(false);
    await expect(bot.handleUpdate(help)).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
    expect(JSON.parse(previews[0].details).payload).toMatchObject({ chat_id: 456, text: 'transformed' });
  });
  it('does not broaden generic remote tool permission', async () => {
    decision(true);
    expect(await ApprovalManager.request({ toolName: 'bash', capability: 'external-write', args: {},
      channel: 'telegram', sessionId: 'fixture' })).toBe(false);
    expect(previews).toHaveLength(0);
  });
});
