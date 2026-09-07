import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAllWindows } from '../windows.js';

export type TrustedPage =
  | 'chat.html'
  | 'cron.html'
  | 'customize.html'
  | 'facts.html'
  | 'daily-logs.html'
  | 'soul.html';

type ChannelRule = string;

const PAGE_CHANNEL_POLICY: Readonly<Record<TrustedPage, readonly ChannelRule[]>> = {
  'chat.html': [
    'agent:*',
    'approval:*',
    'attachments:*',
    'attachment:*',
    'sessions:*',
    'brands:*',
    'seoReport:getDefinition',
    'finance:request',
    'finance:selectCsv',
    'finance:selectReceipt',
    'finance:export',
    'finance:cancel',
    'finance:analyze',
    'facts:*',
    'soul:*',
    'dailyLogs:*',
    'app:*',
    'context:*',
    'audio:*',
    'realtime:*',
    'cron:*',
    'commands:*',
    'settings:*',
    'auth:*',
    'openai-auth:*',
    'openai:*',
    'themes:*',
    'chat:*',
    'updater:*',
    'browser:*',
    'shell:*',
    'connections:*',
    'google-oauth:*',
    'connectTools:*',
    'permissions:*',
    'customize:*',
    'location:*',
    'timezone:*',
  ],
  'cron.html': [
    'commands:list',
    'cron:list',
    'cron:create',
    'cron:update',
    'cron:delete',
    'cron:toggle',
    'cron:run',
    'sessions:list',
  ],
  'customize.html': [
    'agent:restart',
    'customize:getAgentModes',
    'customize:getSystemPrompt',
    'timezone:list',
    'location:lookup',
    'settings:get',
    'settings:set',
  ],
  'facts.html': ['facts:list', 'facts:delete'],
  'daily-logs.html': ['dailyLogs:list'],
  'soul.html': ['soul:list', 'soul:delete'],
};

function trustedPageForPath(rendererPath: string): TrustedPage | null {
  const trustedUiDirectory = path.resolve(app.getAppPath(), 'ui');
  for (const page of Object.keys(PAGE_CHANNEL_POLICY) as TrustedPage[]) {
    if (rendererPath === path.resolve(trustedUiDirectory, page)) return page;
  }
  return null;
}

export function isChannelAllowedForPage(page: TrustedPage, channel: string): boolean {
  return PAGE_CHANNEL_POLICY[page].some((rule) => {
    if (rule.endsWith(':*')) return channel.startsWith(rule.slice(0, -1));
    return channel === rule;
  });
}

function reject(channel: string, reason: string): never {
  console.warn('[IPC] Rejected renderer request', { channel, reason });
  throw new Error('Untrusted IPC sender');
}

export function getTrustedPageForWebContents(
  webContents: WebContents | null,
  rendererUrl?: string
): TrustedPage | null {
  if (!webContents || webContents.isDestroyed()) return null;
  const owningWindow = BrowserWindow.fromWebContents(webContents);
  if (!owningWindow || owningWindow.isDestroyed() || owningWindow.webContents !== webContents) return null;
  if (!getAllWindows().some((window) => window === owningWindow)) return null;

  try {
    const parsedUrl = new URL(rendererUrl || webContents.getURL());
    if (parsedUrl.protocol !== 'file:') return null;
    return trustedPageForPath(path.resolve(fileURLToPath(parsedUrl)));
  } catch {
    return null;
  }
}

export function assertTrustedIpcSender(event: IpcMainInvokeEvent, channel: string): TrustedPage {
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame) reject(channel, 'not-top-frame');

  const page = getTrustedPageForWebContents(event.sender, frame.url);
  if (!page) reject(channel, 'untrusted-window-or-page');
  if (!isChannelAllowedForPage(page, channel)) reject(channel, 'channel-not-allowed');
  return page;
}

export function trustedHandle<Args extends unknown[], Result>(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: Args) => Result
): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedIpcSender(event, channel);
    return listener(event, ...(args as Args));
  });
}
