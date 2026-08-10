import { beforeEach, describe, expect, it, vi } from 'vitest';

const getTrustedPageForWebContents = vi.hoisted(() => vi.fn());
vi.mock('../../src/main/ipc/trusted-ipc.js', () => ({ getTrustedPageForWebContents }));

import { installPermissionPolicy } from '../../src/main/permission-policy.js';

let checkHandler: (...args: any[]) => boolean;
let requestHandler: (...args: any[]) => void;

beforeEach(() => {
  vi.clearAllMocks();
  const session = {
    setPermissionCheckHandler: vi.fn((handler) => {
      checkHandler = handler;
    }),
    setPermissionRequestHandler: vi.fn((handler) => {
      requestHandler = handler;
    }),
  };
  installPermissionPolicy(session as never);
});

describe('renderer permission policy', () => {
  it('allows only top-level chat microphone checks', () => {
    const contents = {};
    getTrustedPageForWebContents.mockReturnValue('chat.html');
    expect(
      checkHandler(contents, 'media', 'file://', {
        isMainFrame: true,
        mediaType: 'audio',
        requestingUrl: 'file:///chat.html',
      })
    ).toBe(true);
    expect(
      checkHandler(contents, 'media', 'file://', {
        isMainFrame: true,
        mediaType: 'video',
        requestingUrl: 'file:///chat.html',
      })
    ).toBe(false);
    expect(
      checkHandler(contents, 'notifications', 'file://', {
        isMainFrame: true,
        requestingUrl: 'file:///chat.html',
      })
    ).toBe(false);

    getTrustedPageForWebContents.mockReturnValue('customize.html');
    expect(
      checkHandler(contents, 'media', 'file://', {
        isMainFrame: true,
        mediaType: 'audio',
        requestingUrl: 'file:///customize.html',
      })
    ).toBe(false);
  });

  it('denies video, mixed media, subframes, unknown pages, and every non-media request', () => {
    const contents = {};
    const callback = vi.fn();
    getTrustedPageForWebContents.mockReturnValue('chat.html');

    requestHandler(contents, 'media', callback, {
      isMainFrame: true,
      requestingUrl: 'file:///chat.html',
      mediaTypes: ['audio'],
    });
    expect(callback).toHaveBeenLastCalledWith(true);

    for (const [permission, details] of [
      ['media', { isMainFrame: true, requestingUrl: 'file:///chat.html', mediaTypes: ['video'] }],
      [
        'media',
        { isMainFrame: true, requestingUrl: 'file:///chat.html', mediaTypes: ['audio', 'video'] },
      ],
      ['media', { isMainFrame: false, requestingUrl: 'file:///chat.html', mediaTypes: ['audio'] }],
      ['geolocation', { isMainFrame: true, requestingUrl: 'file:///chat.html' }],
    ] as const) {
      requestHandler(contents, permission, callback, details);
      expect(callback).toHaveBeenLastCalledWith(false);
    }

    getTrustedPageForWebContents.mockReturnValue(null);
    requestHandler(contents, 'media', callback, {
      isMainFrame: true,
      requestingUrl: 'https://attacker.example',
      mediaTypes: ['audio'],
    });
    expect(callback).toHaveBeenLastCalledWith(false);
  });
});
