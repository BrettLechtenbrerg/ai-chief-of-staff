import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  fromWebContents: vi.fn(),
  getAllWindows: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getAppPath: () => process.cwd() },
  ipcMain: { handle: mocks.handle },
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
}));

vi.mock('../../src/main/windows.js', () => ({
  getAllWindows: mocks.getAllWindows,
}));

import {
  assertTrustedIpcSender,
  isChannelAllowedForPage,
  trustedHandle,
} from '../../src/main/ipc/trusted-ipc.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const chatUrl = pathToFileURL(path.join(projectRoot, 'ui/chat.html')).href;

function trustedEvent(rendererUrl = chatUrl) {
  const mainFrame = { url: rendererUrl };
  const sender = {
    mainFrame,
    isDestroyed: () => false,
    getURL: () => rendererUrl,
  };
  const owningWindow = {
    webContents: sender,
    isDestroyed: () => false,
  };
  mocks.fromWebContents.mockReturnValue(owningWindow);
  mocks.getAllWindows.mockReturnValue([owningWindow]);
  return { event: { sender, senderFrame: mainFrame }, sender, owningWindow };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('trusted IPC sender validation', () => {
  it('accepts an exact registered top-level page/window/channel tuple', () => {
    const { event } = trustedEvent();
    expect(assertTrustedIpcSender(event as never, 'settings:getAll')).toBe('chat.html');
  });

  it('rejects subframes, unknown pages, unregistered windows, and page/channel mismatches', () => {
    const subframe = trustedEvent();
    expect(() =>
      assertTrustedIpcSender(
        { ...subframe.event, senderFrame: { url: chatUrl } } as never,
        'settings:getAll'
      )
    ).toThrow(/Untrusted IPC sender/);

    const sibling = trustedEvent(pathToFileURL(path.join(projectRoot, 'ui-evil/chat.html')).href);
    expect(() => assertTrustedIpcSender(sibling.event as never, 'settings:getAll')).toThrow();

    const unregistered = trustedEvent();
    mocks.getAllWindows.mockReturnValue([]);
    expect(() => assertTrustedIpcSender(unregistered.event as never, 'settings:getAll')).toThrow();

    const facts = trustedEvent(pathToFileURL(path.join(projectRoot, 'ui/facts.html')).href);
    expect(() => assertTrustedIpcSender(facts.event as never, 'shell:run')).toThrow();
  });

  it('checks the sender before calling a registered listener', () => {
    const listener = vi.fn(() => 'ok');
    trustedHandle('settings:getAll', listener);
    const wrapped = mocks.handle.mock.calls[0][1] as (...args: unknown[]) => unknown;

    const valid = trustedEvent();
    expect(wrapped(valid.event)).toBe('ok');
    expect(listener).toHaveBeenCalledOnce();

    const invalid = trustedEvent('https://attacker.example/');
    expect(() => wrapped(invalid.event)).toThrow(/Untrusted IPC sender/);
    expect(listener).toHaveBeenCalledOnce();
  });
});

describe('IPC page/channel policy', () => {
  it('allows only the channels each secondary page uses', () => {
    expect(isChannelAllowedForPage('cron.html', 'cron:create')).toBe(true);
    expect(isChannelAllowedForPage('cron.html', 'settings:getAll')).toBe(false);
    expect(isChannelAllowedForPage('customize.html', 'settings:set')).toBe(true);
    expect(isChannelAllowedForPage('customize.html', 'shell:run')).toBe(false);
    expect(isChannelAllowedForPage('facts.html', 'facts:delete')).toBe(true);
    expect(isChannelAllowedForPage('daily-logs.html', 'dailyLogs:list')).toBe(true);
    expect(isChannelAllowedForPage('soul.html', 'soul:delete')).toBe(true);
  });

  it('migrates every invoke handler to the trusted registrar', () => {
    const mainRoot = path.join(projectRoot, 'src/main');
    const sourceFiles: string[] = [];
    const visit = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(fullPath);
        else if (entry.name.endsWith('.ts')) sourceFiles.push(fullPath);
      }
    };
    visit(mainRoot);

    const untrustedRegistrations = sourceFiles
      .filter((file) => !file.endsWith('trusted-ipc.ts'))
      .filter((file) => fs.readFileSync(file, 'utf8').includes('ipcMain.handle('));
    expect(untrustedRegistrations).toEqual([]);

    const registeredChannels = sourceFiles.flatMap((file) => {
      const source = fs.readFileSync(file, 'utf8');
      return [...source.matchAll(/trustedHandle\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
    });
    expect(registeredChannels.length).toBeGreaterThan(100);
    expect(registeredChannels.every((channel) => isChannelAllowedForPage('chat.html', channel))).toBe(
      true
    );
  });
});
