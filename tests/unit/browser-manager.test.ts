/**
 * Unit tests for the BrowserManager class
 *
 * Tests tier selection logic, tool input handling, status reporting,
 * and cleanup with mocked electron and CDP tiers.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockElectronExecute = vi.fn(async () => ({ success: true, tier: 'electron' as const }));
const mockElectronGetState = vi.fn(() => ({ active: true }));
const mockElectronClose = vi.fn();

const mockCdpExecute = vi.fn(async () => ({ success: true, tier: 'cdp' as const }));
const mockCdpGetState = vi.fn(() => ({ connected: true }));
const mockCdpDisconnect = vi.fn();
const mockCdpIsConnected = vi.fn(() => true);
const mockCdpForceReconnect = vi.fn();

vi.mock('../../src/browser/electron-tier', () => ({
  ElectronTier: class MockElectronTier {
    execute = mockElectronExecute;
    getState = mockElectronGetState;
    close = mockElectronClose;
  },
}));

vi.mock('../../src/browser/cdp-tier', () => ({
  CdpTier: class MockCdpTier {
    execute = mockCdpExecute;
    getState = mockCdpGetState;
    disconnect = mockCdpDisconnect;
    isConnected = mockCdpIsConnected;
    forceReconnect = mockCdpForceReconnect;
  },
}));

vi.mock('../../src/settings', () => ({
  SettingsManager: {
    get: vi.fn(() => 'false'),
  },
}));

import { BrowserManager } from '../../src/browser/index';
import { SettingsManager } from '../../src/settings';

describe('BrowserManager', () => {
  let manager: BrowserManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(SettingsManager.get).mockReturnValue('false');
    manager = new BrowserManager();
  });

  it.each(['javascript:', 'JaVaScRiPt:', 'java\nscript:', 'data:', 'file:///synthetic', 'about:blank', '/relative', 'not-a-url'])(
    'rejects non-web navigation before either tier: %s', async (url) => {
      for (const tier of ['electron', 'cdp'] as const) {
        const result = await manager.execute({ action: 'navigate', url, tier });
        expect(result.success).toBe(false);
        expect(mockElectronExecute).not.toHaveBeenCalled();
        expect(mockCdpExecute).not.toHaveBeenCalled();
      }
    }
  );

  describe('selectTier (via execute)', () => {
    it('defaults to electron tier when no preferences set', async () => {
      await manager.execute({ action: 'navigate', url: 'https://example.com' });

      expect(mockElectronExecute).toHaveBeenCalled();
      expect(mockCdpExecute).not.toHaveBeenCalled();
    });

    it('uses cdp tier when explicitly requested', async () => {
      await manager.execute({ action: 'navigate', url: 'https://example.com', tier: 'cdp' });

      expect(mockCdpExecute).toHaveBeenCalled();
      expect(mockElectronExecute).not.toHaveBeenCalled();
    });

    it('selects cdp tier when requiresAuth is true', async () => {
      await manager.execute({ action: 'navigate', url: 'https://example.com', requiresAuth: true });

      expect(mockCdpExecute).toHaveBeenCalled();
      expect(mockElectronExecute).not.toHaveBeenCalled();
    });

    it('falls back to electron when useMyBrowser is true but CDP has never connected', async () => {
      // beta.7 change: rather than fail when CDP is not set up (the common
      // misconfiguration), we fall back to the Electron tier so the agent
      // stays functional. See src/browser/index.ts selectTier().
      vi.mocked(SettingsManager.get).mockReturnValue('true');

      await manager.execute({ action: 'navigate', url: 'https://example.com' });

      expect(mockElectronExecute).toHaveBeenCalled();
      expect(mockCdpExecute).not.toHaveBeenCalled();
    });

    it('selects cdp tier when useMyBrowser is true and CDP is already connected', async () => {
      vi.mocked(SettingsManager.get).mockReturnValue('true');
      mockCdpIsConnected.mockReturnValue(true);

      // Force the CDP tier into existence + connected state by issuing one
      // explicit CDP call first. That mirrors how a real session reaches
      // this branch: the user previously launched Chrome successfully.
      await manager.execute({ action: 'navigate', url: 'https://example.com', tier: 'cdp' });
      mockCdpExecute.mockClear();
      mockElectronExecute.mockClear();

      await manager.execute({ action: 'navigate', url: 'https://example.com' });

      expect(mockCdpExecute).toHaveBeenCalled();
      expect(mockElectronExecute).not.toHaveBeenCalled();
    });
  });

  describe('handleToolInput', () => {
    it('maps input fields to BrowserAction and executes', async () => {
      const input = {
        action: 'navigate',
        url: 'https://example.com',
        requires_auth: false,
        tier: 'electron',
        wait_for: '.content',
        extract_type: 'text',
        extract_selector: 'body',
        scroll_direction: 'down',
        scroll_amount: 500,
        download_path: '/tmp/file.pdf',
        download_timeout: 5000,
        file_path: '/tmp/upload.txt',
        tab_id: 'tab-1',
      };

      await manager.handleToolInput(input);

      expect(mockElectronExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'navigate',
          url: 'https://example.com/',
          requiresAuth: false,
          tier: 'electron',
          waitFor: '.content',
          extractType: 'text',
          extractSelector: 'body',
          scrollDirection: 'down',
          scrollAmount: 500,
          downloadPath: '/tmp/file.pdf',
          downloadTimeout: 5000,
          filePath: '/tmp/upload.txt',
          tabId: 'tab-1',
        }),
      );
    });
  });

  describe('close', () => {
    it('calls close on both tiers when initialized', async () => {
      // Initialize both tiers
      await manager.execute({ action: 'navigate', url: 'https://a.com' });
      await manager.execute({ action: 'navigate', url: 'https://b.com', tier: 'cdp' });

      manager.close();

      expect(mockElectronClose).toHaveBeenCalled();
      expect(mockCdpDisconnect).toHaveBeenCalled();
    });
  });

  describe('forceReconnectCdp', () => {
    it('calls forceReconnect on CDP tier when initialized', async () => {
      // Initialize CDP tier
      await manager.execute({ action: 'navigate', url: 'https://a.com', tier: 'cdp' });

      await manager.forceReconnectCdp();

      expect(mockCdpForceReconnect).toHaveBeenCalled();
    });

    it('is a no-op when CDP tier not initialized', async () => {
      await manager.forceReconnectCdp();

      expect(mockCdpForceReconnect).not.toHaveBeenCalled();
    });
  });
});
