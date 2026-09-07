/**
 * Unit tests for the auto-updater module
 *
 * Tests updater initialization, status reporting, IPC handler setup,
 * and dev-mode behavior with mocked electron-updater and Electron.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Use vi.hoisted to create variables that are available in vi.mock factories
const { mockAutoUpdater, mockIpcMainHandle, mockUpdaterAccess, mockMetadata } = vi.hoisted(() => ({
  mockUpdaterAccess: vi.fn(),
  mockMetadata: { contents: '{}' as string | Error },
  mockAutoUpdater: {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    on: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
  },
  mockIpcMainHandle: vi.fn(),
}));

let mockIsPackaged = false;

vi.mock('electron-updater', () => ({
  default: { get autoUpdater() { mockUpdaterAccess(); return mockAutoUpdater; } },
  autoUpdater: mockAutoUpdater,
}));

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  ipcMain: {
    handle: (...args: unknown[]) => mockIpcMainHandle(...args),
  },
  app: {
    getAppPath: () => '/inert-packaged-app',
    get isPackaged() {
      return mockIsPackaged;
    },
  },
}));

vi.mock('../../src/settings', () => ({
  SettingsManager: {
    get: vi.fn(() => 'true'),
  },
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
    if (args[0] === '/inert-packaged-app/package.json') {
      if (mockMetadata.contents instanceof Error) throw mockMetadata.contents;
      return mockMetadata.contents;
    }
    return actual.readFileSync(...args);
  } };
});

// Sender authorization has its own suite; invoke updater IPC operations directly here.
vi.mock('../../src/main/ipc/trusted-ipc.js', () => ({ trustedHandle: (...args: unknown[]) => mockIpcMainHandle(...args) }));

// Must import after mocks are set up
import { getUpdateStatus, initializeUpdater, checkForUpdates, downloadUpdate, installUpdate, setupUpdaterIPC } from '../../src/main/updater';

import { isInstallValidationStartup } from '../../src/main/update-policy';

describe('installer startup policy', () => {
  it('requires explicit validation mode and verified personal metadata', () => {
    mockMetadata.contents = JSON.stringify({ acosUpdatePolicy: 'personal-local-v1' });
    expect(isInstallValidationStartup('1')).toBe(true);
    for (const invalid of ['', '0', 'true']) {
      expect(() => isInstallValidationStartup(invalid)).toThrow('verified personal build');
    }
    for (const metadata of ['{}', 'null', '{', '{"acosUpdatePolicy":"unknown"}', new Error('unreadable')]) {
      mockMetadata.contents = metadata;
      expect(() => isInstallValidationStartup('1')).toThrow('verified personal build');
    }
  });
  it('leaves ordinary launches unchanged regardless of metadata', () => {
    const previous = process.env.ACOS_INSTALL_VALIDATION;
    delete process.env.ACOS_INSTALL_VALIDATION;
    try {
      for (const metadata of ['{}', '{"acosUpdatePolicy":"personal-local-v1"}', new Error('unreadable')]) {
        mockMetadata.contents = metadata;
        expect(isInstallValidationStartup()).toBe(false);
      }
    } finally {
      if (previous !== undefined) process.env.ACOS_INSTALL_VALIDATION = previous;
    }
  });
});

describe('updater', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsPackaged = false;
    mockMetadata.contents = '{}';
    mockAutoUpdater.autoDownload = false;
    mockAutoUpdater.autoInstallOnAppQuit = true;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('getUpdateStatus', () => {
    it('returns a status object', () => {
      const status = getUpdateStatus();

      expect(status).toBeDefined();
      expect(status).toHaveProperty('status');
    });
  });

  describe('initializeUpdater', () => {
    it('sets status to dev-mode when not packaged', () => {
      mockIsPackaged = false;

      initializeUpdater();

      const status = getUpdateStatus();
      expect(status.status).toBe('dev-mode');
      expect(status.error).toContain('packaged app');
    });

    it('sets up event handlers when packaged', () => {
      mockIsPackaged = true;

      initializeUpdater();

      // Should register event handlers on autoUpdater
      expect(mockAutoUpdater.on).toHaveBeenCalledWith('checking-for-update', expect.any(Function));
      expect(mockAutoUpdater.on).toHaveBeenCalledWith('update-available', expect.any(Function));
      expect(mockAutoUpdater.on).toHaveBeenCalledWith('update-not-available', expect.any(Function));
      expect(mockAutoUpdater.on).toHaveBeenCalledWith('download-progress', expect.any(Function));
      expect(mockAutoUpdater.on).toHaveBeenCalledWith('update-downloaded', expect.any(Function));
      expect(mockAutoUpdater.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('configures autoUpdater settings when packaged', () => {
      mockIsPackaged = true;

      initializeUpdater();

      // beta.7: autoDownload flipped to true so testers get bug-fix builds
      // pulled in the background instead of having to click Download manually.
      // autoInstallOnAppQuit was already true — the pair gives a silent
      // "installed on next quit" update flow.
      expect(mockAutoUpdater.autoDownload).toBe(true);
      expect(mockAutoUpdater.autoInstallOnAppQuit).toBe(true);
    });
  });

  describe('checkForUpdates', () => {
    it('returns dev-mode status when not packaged', async () => {
      mockIsPackaged = false;

      const status = await checkForUpdates();

      expect(status.status).toBe('dev-mode');
    });
  });

  describe('durable packaged policy', () => {
    function emit(name: string, value: unknown) {
      const listener = mockAutoUpdater.on.mock.calls.find(([event]) => event === name)?.[1];
      expect(listener).toBeTypeOf('function');
      listener(value);
    }

    it('preserves the beta startup check, automatic download/install flags and manual operations', async () => {
      mockIsPackaged = true;
      initializeUpdater();
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(10000);
      expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledOnce();
      expect(mockAutoUpdater.autoDownload).toBe(true);
      expect(mockAutoUpdater.autoInstallOnAppQuit).toBe(true);
      emit('update-available', { version: '1.0.0-beta.26' });
      await downloadUpdate();
      expect(mockAutoUpdater.downloadUpdate).toHaveBeenCalledOnce();
      emit('update-downloaded', { version: '1.0.0-beta.26' });
      installUpdate();
      expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
    });

    it('reproduces the packaged automatic incoming-release flow with an inert updater', async () => {
      mockIsPackaged = true;
      mockAutoUpdater.checkForUpdates.mockImplementationOnce(async () => {
        emit('update-available', { version: '1.0.0-beta.26' });
        // electron-updater 6.8.9 AppUpdater.doCheckForUpdates starts this automatically.
        if (mockAutoUpdater.autoDownload) {
          await mockAutoUpdater.downloadUpdate();
          emit('update-downloaded', { version: '1.0.0-beta.26' });
        }
      });
      initializeUpdater();
      await vi.advanceTimersByTimeAsync(10000);
      expect(mockAutoUpdater.downloadUpdate).toHaveBeenCalledOnce();
      expect(getUpdateStatus().status).toBe('downloaded');
      expect(mockAutoUpdater.autoInstallOnAppQuit).toBe(true);
    });

    it.each([
      JSON.stringify({ acosUpdatePolicy: 'personal-local-v1' }),
      JSON.stringify({ acosUpdatePolicy: 'unknown-v2' }),
      JSON.stringify({ acosUpdatePolicy: false }),
      JSON.stringify({ acosUpdatePolicy: null }),
      JSON.stringify({ acosUpdatePolicy: {} }),
      '{broken', 'null', '[]', new Error('unreadable'),
    ])('fails closed before initialization and every direct/IPC operation: %s', async (metadata) => {
      mockIsPackaged = true;
      mockMetadata.contents = metadata;
      initializeUpdater();
      expect((await checkForUpdates()).error).toContain('Updates disabled');
      await expect(downloadUpdate()).rejects.toThrow('Updates disabled');
      expect(() => installUpdate()).toThrow('Updates disabled');
      setupUpdaterIPC();
      const invoke = async (channel: string): Promise<{ error?: string; success?: boolean }> => {
        const handler = mockIpcMainHandle.mock.calls.find(([name]) => name === channel)?.[1];
        expect(handler).toBeTypeOf('function');
        return handler();
      };
      expect((await invoke('updater:checkForUpdates')).error).toContain('Updates disabled');
      expect(await invoke('updater:downloadUpdate')).toMatchObject({ success: false });
      expect(await invoke('updater:installUpdate')).toMatchObject({ success: false });
      expect((await invoke('updater:getStatus')).error).toContain('Updates disabled');
      expect(mockUpdaterAccess).not.toHaveBeenCalled();
      expect(mockAutoUpdater.on).not.toHaveBeenCalled();
      expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled();
      expect(mockAutoUpdater.downloadUpdate).not.toHaveBeenCalled();
      expect(mockAutoUpdater.quitAndInstall).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('rechecks metadata at operation time even with stale available/downloaded status', async () => {
      mockIsPackaged = true;
      initializeUpdater();
      emit('update-available', { version: '1.0.0-beta.26' });
      mockMetadata.contents = JSON.stringify({ acosUpdatePolicy: 'personal-local-v1' });
      await expect(downloadUpdate()).rejects.toThrow('Updates disabled');
      emit('update-downloaded', { version: '1.0.0-beta.26' });
      expect(() => installUpdate()).toThrow('Updates disabled');
      await vi.advanceTimersByTimeAsync(10000);
      expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled();
      expect(mockAutoUpdater.downloadUpdate).not.toHaveBeenCalled();
      expect(mockAutoUpdater.quitAndInstall).not.toHaveBeenCalled();
    });
  });

  describe('setupUpdaterIPC', () => {
    it('registers 4 IPC handlers', () => {
      setupUpdaterIPC();

      expect(mockIpcMainHandle).toHaveBeenCalledTimes(4);
      expect(mockIpcMainHandle).toHaveBeenCalledWith('updater:checkForUpdates', expect.any(Function));
      expect(mockIpcMainHandle).toHaveBeenCalledWith('updater:downloadUpdate', expect.any(Function));
      expect(mockIpcMainHandle).toHaveBeenCalledWith('updater:installUpdate', expect.any(Function));
      expect(mockIpcMainHandle).toHaveBeenCalledWith('updater:getStatus', expect.any(Function));
    });
  });
});
