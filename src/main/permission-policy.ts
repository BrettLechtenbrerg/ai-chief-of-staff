import type { Session } from 'electron';
import { getTrustedPageForWebContents } from './ipc/trusted-ipc.js';

/**
 * Electron permission policy: deny every renderer permission except microphone
 * audio requested by the trusted top-level chat page.
 */
export function installPermissionPolicy(session: Session): void {
  session.setPermissionCheckHandler((webContents, permission, _origin, details) => {
    return (
      permission === 'media' &&
      details.isMainFrame &&
      details.mediaType === 'audio' &&
      getTrustedPageForWebContents(webContents, details.requestingUrl) === 'chat.html'
    );
  });

  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined;
    const allowMicrophone =
      permission === 'media' &&
      details.isMainFrame &&
      Array.isArray(mediaTypes) &&
      mediaTypes.length === 1 &&
      mediaTypes[0] === 'audio' &&
      getTrustedPageForWebContents(webContents, details.requestingUrl) === 'chat.html';
    callback(allowMicrophone);
  });
}
