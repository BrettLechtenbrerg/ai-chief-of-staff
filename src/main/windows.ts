import { BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { SettingsManager } from '../settings';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============ Window Registry ============

const windowRegistry = new Map<string, BrowserWindow>();

/**
 * Get a tracked window by its ID.
 * Returns the window if it exists and hasn't been destroyed, otherwise null.
 */
export function getWindow(id: string): BrowserWindow | null {
  const win = windowRegistry.get(id);
  if (win && !win.isDestroyed()) return win;
  // Clean up stale entries
  if (win) windowRegistry.delete(id);
  return null;
}

/**
 * Store a window reference in the registry.
 * Pass null to remove the entry.
 */
export function setWindow(id: string, win: BrowserWindow | null): void {
  if (win) {
    windowRegistry.set(id, win);
  } else {
    windowRegistry.delete(id);
  }
}

/**
 * Get all currently open (non-destroyed) windows from the registry.
 */
export function getAllWindows(): BrowserWindow[] {
  const windows: BrowserWindow[] = [];
  for (const [id, win] of windowRegistry) {
    if (win && !win.isDestroyed()) {
      windows.push(win);
    } else {
      windowRegistry.delete(id);
    }
  }
  return windows;
}

// ============ Window Factory ============

export interface CreateWindowOptions {
  /** Unique ID used to track the window in the registry */
  id: string;
  /** Window title */
  title: string;
  /** HTML file name (relative to ui/ directory), e.g. 'chat.html' */
  htmlFile: string;
  /** Default width */
  width: number;
  /** Default height */
  height: number;
  /**
   * Settings key for persisting window bounds (e.g. 'window.chatBounds').
   * If omitted, bounds are not saved/restored.
   */
  boundsKey?: string;
  /** Optional hash to append to the loaded URL (e.g. for tab navigation) */
  hash?: string;
  /** Extra BrowserWindow options to merge in (e.g. resizable, minimizable) */
  extraOptions?: Partial<Electron.BrowserWindowConstructorOptions>;
  /**
   * Called after the window is created but before it's shown.
   * Use for any window-specific setup (event listeners, IPC wiring, etc.).
   */
  onCreated?: (win: BrowserWindow) => void;
  /**
   * Called when the window is closed (after cleanup).
   * Use for window-specific teardown logic.
   */
  onClosed?: () => void;
}

/**
 * Generic window factory that handles the common boilerplate:
 * 1. Check if window already exists → focus it
 * 2. Load saved bounds from SettingsManager
 * 3. Create BrowserWindow with standard webPreferences
 * 4. Load HTML file
 * 5. Set up ready-to-show → show()
 * 6. Set up moved/resized/close → save bounds
 * 7. Set up closed → clean up registry
 *
 * Returns the existing or newly created BrowserWindow.
 */
export function createWindow(options: CreateWindowOptions): BrowserWindow {
  const { id, title, htmlFile, width, height, boundsKey, hash, extraOptions, onCreated, onClosed } =
    options;

  // 1. If window already exists, focus it and return
  const existing = getWindow(id);
  if (existing) {
    existing.focus();
    return existing;
  }

  // 2. Build window options with optional saved bounds
  let windowOptions: Electron.BrowserWindowConstructorOptions = {
    width,
    height,
    title,
    backgroundColor: '#0a0a0b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
    ...extraOptions,
  };

  if (boundsKey) {
    const savedBoundsJson = SettingsManager.get(boundsKey);
    if (savedBoundsJson) {
      try {
        const savedBounds = JSON.parse(savedBoundsJson);
        if (savedBounds.x !== undefined) windowOptions.x = savedBounds.x;
        if (savedBounds.y !== undefined) windowOptions.y = savedBounds.y;
        if (savedBounds.width) windowOptions.width = savedBounds.width;
        if (savedBounds.height) windowOptions.height = savedBounds.height;
      } catch {
        /* ignore invalid bounds */
      }
    }
  }

  // 3. Create the window
  const win = new BrowserWindow(windowOptions);

  // 4. Load HTML file
  const loadOptions: Electron.LoadFileOptions = {};
  if (hash) loadOptions.hash = hash;
  win.loadFile(path.join(__dirname, '../../ui', htmlFile), loadOptions);

  // 5. Show when ready
  win.once('ready-to-show', () => {
    win.show();
  });

  // 6. Save bounds on move/resize/close (if boundsKey provided)
  if (boundsKey) {
    const saveBounds = () => {
      if (!win.isDestroyed()) {
        SettingsManager.set(boundsKey, JSON.stringify(win.getBounds()));
      }
    };
    win.on('moved', saveBounds);
    win.on('resized', saveBounds);
    win.on('close', saveBounds);
  }

  // 7. Clean up registry on close
  win.on('closed', () => {
    setWindow(id, null);
    onClosed?.();
  });

  // Register in the window registry
  setWindow(id, win);

  // Call post-creation hook
  onCreated?.(win);

  return win;
}
