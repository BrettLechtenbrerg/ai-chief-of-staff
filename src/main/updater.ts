import electronUpdater from 'electron-updater';
// Do not access the lazy autoUpdater getter until the durable policy allows it.
// On macOS the getter constructs an updater and registers native hooks.
type UpdateInfo = electronUpdater.UpdateInfo;
type ProgressInfo = electronUpdater.ProgressInfo;
import { BrowserWindow, app } from 'electron';
import { trustedHandle } from './ipc/trusted-ipc.js';
import { SettingsManager } from '../settings';
import { getUpdateBlockReason } from './update-policy';

export interface UpdateStatus {
  status:
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'error'
    | 'dev-mode';
  info?: UpdateInfo;
  progress?: { percent: number; bytesPerSecond: number; transferred: number; total: number };
  error?: string;
}

let currentStatus: UpdateStatus = { status: 'idle' };
let settingsWindow: BrowserWindow | null = null;
let chatWindow: BrowserWindow | null = null;
let isInitialized = false;

/**
 * Get the current update status
 */
export function getUpdateStatus(): UpdateStatus {
  return blockedStatus() ?? currentStatus;
}

function blockedStatus(): UpdateStatus | null {
  const reason = getUpdateBlockReason();
  if (!reason) return null;
  currentStatus = { status: 'error', error: reason };
  return currentStatus;
}

function assertUpdatesAllowed(): void {
  const blocked = blockedStatus();
  if (blocked) throw new Error(blocked.error);
}

/**
 * Send status update to settings window
 */
function sendStatusToRenderer(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('updater:status', currentStatus);
  }
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.webContents.send('updater:status', currentStatus);
  }
}

/**
 * Initialize the auto-updater
 */
export function initializeUpdater(): void {
  if (blockedStatus()) return;
  if (!app.isPackaged) {
    console.log('[Updater] Skipping initialization in development mode');
    currentStatus = { status: 'dev-mode', error: 'Updates only work in packaged app' };
    return;
  }

  const { autoUpdater } = electronUpdater;
  isInitialized = true;

  // Configure updater
  // autoDownload=true: pull the new version in the background after the
  // startup check finishes; autoInstallOnAppQuit=true then applies it silently
  // on next quit. Before beta.7 this was false, which meant testers had to
  // click Download + Install manually — most never did, so bug-fix builds
  // never reached the field.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // Set up event handlers
  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] Checking for updates...');
    currentStatus = { status: 'checking' };
    sendStatusToRenderer();
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    console.log('[Updater] Update available:', info.version);
    currentStatus = { status: 'available', info };
    sendStatusToRenderer();
  });

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    console.log('[Updater] No updates available. Current version is up to date.');
    currentStatus = { status: 'not-available', info };
    sendStatusToRenderer();
  });

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    console.log(`[Updater] Download progress: ${progress.percent.toFixed(1)}%`);
    currentStatus = {
      status: 'downloading',
      progress: {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      },
    };
    sendStatusToRenderer();
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    console.log('[Updater] Update downloaded:', info.version);
    currentStatus = { status: 'downloaded', info };
    sendStatusToRenderer();
  });

  autoUpdater.on('error', (error: Error) => {
    console.error('[Updater] Error:', error.message);
    const msg = error.message;

    // Classify errors: some are transient/expected, others are real failures
    if (
      msg.includes('latest-mac.yml') ||
      msg.includes('latest.yml') ||
      (msg.includes('404') && msg.includes('releases/download'))
    ) {
      // Release exists but build artifacts aren't uploaded yet — not a real error
      currentStatus = {
        status: 'not-available',
        error: 'Latest release is still being built. Check back in a few minutes.',
      };
    } else if (msg.includes('read-only volume')) {
      currentStatus = {
        status: 'error',
        error: 'Move AI Chief of Staff to Applications folder to enable updates.',
      };
    } else if (
      msg.includes('net::ERR_') ||
      msg.includes('ENOTFOUND') ||
      msg.includes('ETIMEDOUT') ||
      msg.includes('ECONNREFUSED')
    ) {
      currentStatus = {
        status: 'error',
        error: 'Could not reach update server. Check your internet connection.',
      };
    } else if (msg.includes('HttpError') || msg.includes('status code')) {
      currentStatus = {
        status: 'error',
        error: 'Update server returned an error. Try again later.',
      };
    } else {
      currentStatus = { status: 'error', error: msg };
    }

    sendStatusToRenderer();
  });

  // Check for updates on startup if auto-update is enabled
  const autoUpdateEnabled = SettingsManager.get('updates.autoCheck') !== 'false';
  if (autoUpdateEnabled) {
    // Delay initial check to avoid slowing down startup
    setTimeout(() => {
      checkForUpdates().catch((err) => {
        console.error('[Updater] Initial check failed:', err);
      });
    }, 10000); // 10 second delay
  }
}

/**
 * Check for updates
 */
export async function checkForUpdates(): Promise<UpdateStatus> {
  const blocked = blockedStatus();
  if (blocked) return blocked;
  if (!isInitialized || !app.isPackaged) {
    currentStatus = { status: 'dev-mode', error: 'Updates only work in packaged app' };
    sendStatusToRenderer();
    return currentStatus;
  }

  try {
    currentStatus = { status: 'checking' };
    sendStatusToRenderer();
    await electronUpdater.autoUpdater.checkForUpdates();
    return currentStatus;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    currentStatus = { status: 'error', error: errorMsg };
    sendStatusToRenderer();
    return currentStatus;
  }
}

/**
 * Download the available update
 */
export async function downloadUpdate(): Promise<void> {
  assertUpdatesAllowed();
  if (currentStatus.status !== 'available') {
    throw new Error('No update available to download');
  }
  await electronUpdater.autoUpdater.downloadUpdate();
}

/**
 * Install the downloaded update and restart
 */
export function installUpdate(): void {
  assertUpdatesAllowed();
  if (currentStatus.status !== 'downloaded') {
    throw new Error('No update downloaded to install');
  }
  electronUpdater.autoUpdater.quitAndInstall(false, true);
}

/**
 * Set the settings window reference for status updates
 */
export function setSettingsWindow(window: BrowserWindow | null): void {
  settingsWindow = window;
}

/**
 * Set the chat window reference for status updates
 */
export function setChatWindow(window: BrowserWindow | null): void {
  chatWindow = window;
}

/**
 * Set up IPC handlers for updater
 */
export function setupUpdaterIPC(): void {
  trustedHandle('updater:checkForUpdates', async () => {
    return checkForUpdates();
  });

  trustedHandle('updater:downloadUpdate', async () => {
    try {
      await downloadUpdate();
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  trustedHandle('updater:installUpdate', () => {
    try {
      installUpdate();
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  trustedHandle('updater:getStatus', () => {
    return getUpdateStatus();
  });
}
