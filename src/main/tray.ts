import { Tray, Menu, nativeImage, app } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { AgentManager } from '../agent';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IS_WINDOWS = process.platform === 'win32';
const IS_MACOS = process.platform === 'darwin';

let tray: Tray | null = null;

// Cached tray menu icon — built once, reused on every updateTrayMenu() call
let cachedMenuIcon: Electron.NativeImage | undefined;

export interface TrayCallbacks {
  openChatWindow: () => void;
  openSettingsWindow: (tab?: string) => void;
  restartAgent: () => Promise<void>;
  showNotification: (title: string, body: string) => void;
}

let callbacks: TrayCallbacks | null = null;

/**
 * Initialize the tray module with callbacks from the main process.
 * Must be called before createTray().
 */
export function initTray(cb: TrayCallbacks): void {
  callbacks = cb;
}

function createDefaultIcon(): Electron.NativeImage {
  // Create a 16x16 robot face icon for macOS menu bar
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4);

  // Helper to set a pixel white
  const setPixel = (x: number, y: number) => {
    if (x >= 0 && x < size && y >= 0 && y < size) {
      const i = (y * size + x) * 4;
      canvas[i] = 255; // R
      canvas[i + 1] = 255; // G
      canvas[i + 2] = 255; // B
      canvas[i + 3] = 255; // A
    }
  };

  // Helper to draw a filled rectangle
  const fillRect = (x1: number, y1: number, x2: number, y2: number) => {
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        setPixel(x, y);
      }
    }
  };

  // Draw robot face (centered in 16x16)
  // Head outline - rounded rectangle (rows 2-13, cols 3-12)
  // Top edge
  fillRect(4, 2, 11, 2);
  // Bottom edge
  fillRect(4, 13, 11, 13);
  // Left edge
  fillRect(3, 3, 3, 12);
  // Right edge
  fillRect(12, 3, 12, 12);
  // Corners
  setPixel(4, 3);
  setPixel(11, 3);
  setPixel(4, 12);
  setPixel(11, 12);

  // Antenna
  setPixel(7, 0);
  setPixel(8, 0);
  setPixel(7, 1);
  setPixel(8, 1);

  // Eyes (2x2 squares)
  fillRect(5, 5, 6, 7); // Left eye
  fillRect(9, 5, 10, 7); // Right eye

  // Mouth (horizontal line)
  fillRect(5, 10, 10, 11);

  const icon = nativeImage.createFromBuffer(canvas, { width: size, height: size });
  icon.setTemplateImage(true); // For macOS menu bar
  return icon;
}

function getMenuIcon(): Electron.NativeImage | undefined {
  if (cachedMenuIcon !== undefined) return cachedMenuIcon;
  try {
    const menuIconPath = path.join(__dirname, '../../assets/tray-icon@2x.png');
    const rawIcon = nativeImage.createFromPath(menuIconPath);
    if (!rawIcon.isEmpty()) {
      cachedMenuIcon = nativeImage.createEmpty();
      cachedMenuIcon.addRepresentation({
        scaleFactor: 1,
        width: 16,
        height: 16,
        buffer: rawIcon.resize({ width: 16, height: 16 }).toPNG(),
      });
      cachedMenuIcon.addRepresentation({
        scaleFactor: 2,
        width: 32,
        height: 32,
        buffer: rawIcon.resize({ width: 32, height: 32 }).toPNG(),
      });
      cachedMenuIcon.setTemplateImage(true);
    }
  } catch {
    cachedMenuIcon = undefined;
  }
  return cachedMenuIcon;
}

export async function createTray(): Promise<void> {
  const iconPath = path.join(__dirname, '../../assets/tray-icon.png');
  const iconPath2x = path.join(__dirname, '../../assets/tray-icon@2x.png');
  let icon: Electron.NativeImage;

  try {
    // Load both 1x and 2x versions for retina support
    const icon1x = nativeImage.createFromPath(iconPath);
    const icon2x = nativeImage.createFromPath(iconPath2x);

    if (!icon1x.isEmpty() && !icon2x.isEmpty()) {
      // Create a multi-resolution image
      icon = nativeImage.createEmpty();
      const traySize = IS_WINDOWS ? 16 : 22;
      const traySize2x = IS_WINDOWS ? 32 : 44;
      icon.addRepresentation({
        scaleFactor: 1,
        width: traySize,
        height: traySize,
        buffer: icon1x.resize({ width: traySize, height: traySize }).toPNG(),
      });
      icon.addRepresentation({
        scaleFactor: 2,
        width: traySize2x,
        height: traySize2x,
        buffer: icon2x.resize({ width: traySize2x, height: traySize2x }).toPNG(),
      });
      if (IS_MACOS) icon.setTemplateImage(true); // macOS menu bar only
    } else if (!icon1x.isEmpty()) {
      icon = icon1x.resize({ width: IS_WINDOWS ? 16 : 22, height: IS_WINDOWS ? 16 : 22 });
      if (IS_MACOS) icon.setTemplateImage(true);
    } else {
      icon = createDefaultIcon();
    }
  } catch {
    icon = createDefaultIcon();
  }

  tray = new Tray(icon);
  tray.setToolTip('Pocket Agent');

  // Double-click opens chat
  tray.on('double-click', () => {
    callbacks?.openChatWindow();
  });

  updateTrayMenu();
}

export function updateTrayMenu(): void {
  if (!tray || !callbacks) return;

  const stats = AgentManager.getStats();

  const statusText = AgentManager.isInitialized()
    ? `Messages: ${stats?.messageCount || 0} | Facts: ${stats?.factCount || 0}`
    : 'Not initialized';

  const menuIcon = getMenuIcon();

  const contextMenu = Menu.buildFromTemplate([
    {
      label: `Pocket Agent v${app.getVersion()}`,
      enabled: false,
      icon: menuIcon,
    },
    { type: 'separator' },
    {
      label: 'Chat',
      click: () => callbacks?.openChatWindow(),
      accelerator: 'Alt+Z',
    },
    { type: 'separator' },
    {
      label: statusText,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Tweaks...',
      click: () => callbacks?.openSettingsWindow(),
      accelerator: 'CmdOrCtrl+,',
    },
    {
      label: 'Check for Updates...',
      click: () => callbacks?.openSettingsWindow('updates'),
    },
    { type: 'separator' },
    {
      label: 'Reboot',
      click: async () => {
        await callbacks?.restartAgent();
        callbacks?.showNotification('Pocket Agent', 'Back online! ✨');
      },
    },
    { type: 'separator' },
    {
      label: 'Bye!',
      click: () => app.quit(),
      accelerator: 'CmdOrCtrl+Q',
    },
  ]);

  tray.setContextMenu(contextMenu);
}
