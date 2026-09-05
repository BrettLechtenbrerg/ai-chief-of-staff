import { app, Notification, globalShortcut, powerMonitor, dialog, session } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { AgentManager } from '../agent';
import { resolveAndPersistModel } from '../agent/resolve-model';
import { MemoryManager } from '../memory';
import { createScheduler, CronScheduler } from '../scheduler';
import { createTelegramBot, TelegramBot } from '../channels/telegram';
import { SettingsManager } from '../settings';
import { DEFAULT_COMMANDS } from '../config/commands';
import {
  createRotatingDatabaseBackup,
  restoreDatabaseBackup,
} from '../storage/database-backup';
import { getBrowserManager } from '../browser';
import { initializeUpdater, setupUpdaterIPC, setSettingsWindow, setChatWindow } from './updater';
import { createWindow, getWindow } from './windows';
import { fixPathForPackagedApp } from './node-paths';
import { setupBirthdayCronJobs } from './birthday';
import { setupSeoCronJobs } from './seo-crons';
import { createTray, updateTrayMenu, initTray } from './tray';
import { getMCPManager } from '../mcp/manager';
import { installPermissionPolicy } from './permission-policy.js';
import { trustedHandle } from './ipc/trusted-ipc.js';
import {
  registerAgentIPC,
  registerSessionsIPC,
  registerBrandsIPC,
  registerSettingsIPC,
  refreshDiscoveredModels,
  registerFactsIPC,
  registerCronIPC,
  registerMiscIPC,
  registerContextIPC,
  registerAudioIPC,
  registerConnectionsIPC,
  registerGoogleOAuthIPC,
  registerConnectToolsIPC,
  registerRealtimeIPC,
} from './ipc';
import type { IPCDependencies } from './ipc';

// Handle EPIPE errors gracefully (happens when stdout pipe is closed)
process.stdout?.on('error', (err: Error & { code?: string }) => {
  if (err.code === 'EPIPE') return;
});
process.stderr?.on('error', (err: Error & { code?: string }) => {
  if (err.code === 'EPIPE') return;
});
process.on('uncaughtException', (err) => {
  if (err.message?.includes('EPIPE')) return;
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

// IS_WINDOWS and HOME_DIR moved to src/main/ipc/misc-ipc.ts

// Fix PATH for packaged apps — platform-aware (must run early, at module load)
fixPathForPackagedApp();

let memory: MemoryManager | null = null;
let scheduler: CronScheduler | null = null;
let telegramBot: TelegramBot | null = null;

// Set when app.whenReady() initialization throws. Exposed to the renderer via
// 'app:getStartupError' so the UI can show the REAL failure (e.g. a corrupt
// database or an unloadable native module) instead of the misleading
// "install out of date" toast that fires on missing IPC handlers.
let startupError: string | null = null;
const startupHealth = {
  version: app.getVersion(),
  startedAt: new Date().toISOString(),
  ipcRegistered: false,
  sqliteLoaded: false,
  initializationComplete: false,
  error: null as string | null,
};

function writeStartupHealth(update: Partial<typeof startupHealth>): void {
  Object.assign(startupHealth, update);
  try {
    const destination = path.join(app.getPath('userData'), 'startup-health.json');
    const temporary = `${destination}.tmp`;
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.writeFileSync(temporary, JSON.stringify(startupHealth, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, destination);
    fs.chmodSync(destination, 0o600);
  } catch (error) {
    console.warn('[Main] Could not write startup health marker:', error);
  }
}
// tray menu updates are event-driven via IPC handlers
let modelChangedHandler: ((model: string) => void) | null = null;

// Window IDs for the registry
const WIN = {
  CHAT: 'chat',
  CRON: 'cron',
  SETTINGS: 'settings',
  CUSTOMIZE: 'customize',
  FACTS: 'facts',
  DAILY_LOGS: 'dailyLogs',
  SOUL: 'soul',
} as const;

/**
 * Get the agent's isolated workspace directory.
 * This is separate from the app's project root to prevent conflicts.
 * Located in ~/Documents/AI Chief of Staff/ (falls back to userData if Documents is unavailable,
 * e.g. iCloud Drive syncing or broken symlink on macOS).
 */
function getAgentWorkspace(): string {
  const documentsPath = app.getPath('documents');
  const workspace = path.join(documentsPath, 'AI Chief of Staff');
  const fallback = path.join(app.getPath('userData'), 'workspace');

  // Verify the Documents path is actually USABLE — not just present.
  // On macOS with iCloud Drive, ~/Documents is synced; iCloud can evict or
  // permission-lock files at any time, so a directory that exists and is
  // readable can still throw EPERM on write (the May 28 incident, where every
  // agent turn crashed writing .pocket-version). mkdirSync({recursive:true})
  // succeeds on an existing dir without testing writability, so it cannot
  // catch this. We do a real write-probe instead. If Documents is unusable
  // — unreachable, broken iCloud symlink, or permission-locked — fall back to
  // the non-synced userData workspace.
  try {
    fs.mkdirSync(workspace, { recursive: true });
    const probe = path.join(workspace, '.write-probe');
    fs.writeFileSync(probe, String(Date.now()));
    fs.rmSync(probe, { force: true });
    return workspace;
  } catch (err) {
    console.warn(
      `[Main] Documents workspace unusable (${documentsPath}): ${
        err instanceof Error ? err.message : String(err)
      }. Using non-synced fallback: ${fallback}`
    );
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

/**
 * Migrate identity.md content into personalize.* SQLite settings.
 * One-time migration: parses agent name from heading, extracts personality sections,
 * migrates profile.custom to personalize.world, renames identity.md to .migrated.
 */
function migratePersonalizeFromIdentity(): void {
  if (SettingsManager.get('personalize._migrated')) return;

  const workspace = getAgentWorkspace();
  const identityPath = path.join(workspace, 'identity.md');

  try {
    if (fs.existsSync(identityPath)) {
      const content = fs.readFileSync(identityPath, 'utf-8');

      // Parse agent name from "# Name" heading
      const nameMatch = content.match(/^#\s+(.+?)(?:\s+the\s+\w+)?$/m);
      if (nameMatch) {
        const rawName = nameMatch[1].trim();
        // Only set if it differs from default
        if (rawName && rawName !== 'Franky the Cat') {
          SettingsManager.set('personalize.agentName', rawName);
          console.log(`[Migration] Set agent name: ${rawName}`);
        }
      }

      // Extract personality: everything from ## Vibe through ## Don't section
      const vibeMatch = content.match(/## Vibe[\s\S]*?(?=\n##[^#]|$)/);
      const dontMatch = content.match(/## Don't[\s\S]*?(?=\n##[^#]|$)/);
      if (vibeMatch || dontMatch) {
        const parts: string[] = [];
        if (vibeMatch) parts.push(vibeMatch[0].trim());
        if (dontMatch) parts.push(dontMatch[0].trim());
        const personality = parts.join('\n\n');
        SettingsManager.set('personalize.personality', personality);
        console.log(`[Migration] Set personality: ${personality.length} chars`);
      }

      // Rename identity.md
      fs.renameSync(identityPath, identityPath + '.migrated');
      console.log('[Migration] Renamed identity.md → identity.md.migrated');
    }

    // Migrate profile.custom → personalize.funFacts
    const profileCustom = SettingsManager.get('profile.custom');
    if (profileCustom) {
      SettingsManager.set('personalize.funFacts', profileCustom);
      SettingsManager.delete('profile.custom');
      console.log(
        `[Migration] Moved profile.custom → personalize.funFacts: ${profileCustom.length} chars`
      );
    }

    // Migrate old personalize.world (from earlier migration) → personalize.funFacts
    const oldWorld = SettingsManager.get('personalize.world');
    if (oldWorld) {
      const existing = SettingsManager.get('personalize.funFacts');
      SettingsManager.set(
        'personalize.funFacts',
        existing ? `${existing}\n\n${oldWorld}` : oldWorld
      );
      SettingsManager.delete('personalize.world');
      console.log(
        `[Migration] Moved personalize.world → personalize.funFacts: ${oldWorld.length} chars`
      );
    }
  } catch (err) {
    console.error('[Migration] Personalize migration failed:', err);
  }

  // Set flag regardless of success to prevent re-running
  SettingsManager.set('personalize._migrated', 'true');
  console.log('[Migration] Personalize migration complete');
}

/**
 * Ensure the agent workspace directory exists.
 * Creates it if missing (on first run, after onboarding, or if deleted).
 * Sets up .claude/commands for workflow commands.
 */
function ensureAgentWorkspace(): string {
  const workspace = getAgentWorkspace();
  const currentVersion = app.getVersion();
  const versionFile = path.join(workspace, '.pocket-version');

  if (!fs.existsSync(workspace)) {
    console.log('[Main] Creating agent workspace:', workspace);
    fs.mkdirSync(workspace, { recursive: true });
  }

  // Check if app version changed (update occurred)
  let isVersionUpdate = false;

  if (fs.existsSync(versionFile)) {
    const previousVersion = fs.readFileSync(versionFile, 'utf-8').trim();
    if (previousVersion !== currentVersion) {
      isVersionUpdate = true;
      console.log(`[Main] App updated from v${previousVersion} to v${currentVersion}`);
    }
  } else {
    // First install or version file missing - treat as update to populate files
    isVersionUpdate = true;
    console.log(`[Main] First install or version file missing, will populate config files`);
  }

  // Repopulate config files on version update
  if (isVersionUpdate) {
    const backupDir = path.join(workspace, '.backups');

    // Create backup directory
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    // identity.md and CLAUDE.md are no longer managed here.
    // Personalize settings are in SQLite. Coder mode generates its own CLAUDE.md per session.

    // Populate default workflow commands
    // If .claude is a symlink (or broken symlink) from a previous install, replace it with a real directory.
    // Use lstatSync instead of existsSync because existsSync follows symlinks and returns
    // false for broken symlinks, which would skip cleanup and cause ENOENT on mkdir.
    const workspaceClaudeDirForCmds = path.join(workspace, '.claude');
    let claudeDirExists = false;
    let claudeDirIsSymlink = false;
    try {
      const stat = fs.lstatSync(workspaceClaudeDirForCmds);
      claudeDirExists = true;
      claudeDirIsSymlink = stat.isSymbolicLink();
    } catch {
      // Doesn't exist at all — that's fine
    }

    if (claudeDirExists && claudeDirIsSymlink) {
      // Preserve any user-created commands from the symlink target before replacing
      const symlinkCommandsDir = path.join(workspaceClaudeDirForCmds, 'commands');
      const preservedCommands: Array<{ name: string; content: string }> = [];
      if (fs.existsSync(symlinkCommandsDir)) {
        const defaultFilenames = new Set(DEFAULT_COMMANDS.map((c) => c.filename));
        for (const file of fs.readdirSync(symlinkCommandsDir).filter((f) => f.endsWith('.md'))) {
          if (!defaultFilenames.has(file)) {
            preservedCommands.push({
              name: file,
              content: fs.readFileSync(path.join(symlinkCommandsDir, file), 'utf-8'),
            });
          }
        }
      }
      fs.unlinkSync(workspaceClaudeDirForCmds);
      fs.mkdirSync(workspaceClaudeDirForCmds, { recursive: true });
      console.log('[Main] Replaced .claude symlink with real directory for commands');
      // Restore preserved user commands
      if (preservedCommands.length > 0) {
        const restoredDir = path.join(workspaceClaudeDirForCmds, 'commands');
        fs.mkdirSync(restoredDir, { recursive: true });
        for (const cmd of preservedCommands) {
          fs.writeFileSync(path.join(restoredDir, cmd.name), cmd.content);
        }
        console.log(`[Main] Preserved ${preservedCommands.length} user workflow command(s)`);
      }
    }
    const commandsDir = path.join(workspaceClaudeDirForCmds, 'commands');
    if (!fs.existsSync(commandsDir)) {
      fs.mkdirSync(commandsDir, { recursive: true });
    }
    // Only write defaults — never delete existing user commands
    for (const cmd of DEFAULT_COMMANDS) {
      fs.writeFileSync(path.join(commandsDir, cmd.filename), cmd.content);
    }
    console.log(`[Main] Populated ${DEFAULT_COMMANDS.length} default workflow command(s)`);

    // Mark onboarding as completed for existing users who already have keys
    // (prevents re-triggering onboarding after updating to the embedded version)
    if (
      SettingsManager.hasRequiredKeys() &&
      SettingsManager.get('onboarding.completed') !== 'true'
    ) {
      SettingsManager.set('onboarding.completed', 'true');
      console.log('[Main] Marked onboarding as completed for existing user');
    }

    // Clear saved window bounds so updated default dimensions take effect.
    // Users' custom sizes will be re-saved on next window move/resize.
    SettingsManager.delete('window.chatBounds');
    SettingsManager.delete('window.cronBounds');
    SettingsManager.delete('window.settingsBounds');
    SettingsManager.delete('window.customizeBounds');
    SettingsManager.delete('window.factsBounds');
    SettingsManager.delete('window.dailyLogsBounds');
    SettingsManager.delete('window.soulBounds');
    console.log('[Main] Cleared saved window bounds for fresh layout');

    // Update version file
    fs.writeFileSync(versionFile, currentVersion);
    console.log(`[Main] Updated version file to v${currentVersion}`);
  }

  // Clean up legacy .claude/skills folder (no longer used)
  const workspaceClaudeDir = path.join(workspace, '.claude');
  if (fs.existsSync(workspaceClaudeDir)) {
    const workspaceSkillsDir = path.join(workspaceClaudeDir, 'skills');
    try {
      if (fs.existsSync(workspaceSkillsDir)) {
        const stats = fs.lstatSync(workspaceSkillsDir);
        if (stats.isSymbolicLink()) {
          fs.unlinkSync(workspaceSkillsDir);
        } else {
          fs.rmSync(workspaceSkillsDir, { recursive: true, force: true });
        }
        console.log('[Main] Removed legacy .claude/skills folder');
      }
    } catch (err) {
      console.warn('[Main] Failed to remove legacy .claude/skills:', err);
    }
  }

  return workspace;
}

// ============ Windows ============

function openChatWindow(): void {
  const win = createWindow({
    id: WIN.CHAT,
    title: `AI Chief of Staff v${app.getVersion()}`,
    htmlFile: 'chat.html',
    width: 1020,
    height: 720,
    boundsKey: 'window.chatBounds',
    onClosed: () => setChatWindow(null),
  });
  setChatWindow(win);
}

function requestVoiceToggle(): void {
  openChatWindow();
  const win = getWindow(WIN.CHAT);
  if (!win || win.isDestroyed()) return;
  const sendToggle = () => {
    if (!win.isDestroyed()) win.webContents.send('voice:toggle-requested');
  };
  if (win.webContents.isLoadingMainFrame()) {
    win.webContents.once('did-finish-load', sendToggle);
  } else {
    sendToggle();
  }
}

function openCronWindow(): void {
  const win = createWindow({
    id: WIN.CRON,
    title: 'My Scheduled Tasks - AI Chief of Staff',
    htmlFile: 'cron.html',
    width: 700,
    height: 500,
    boundsKey: 'window.cronBounds',
  });
  // If the window was already open and was just focused, the renderer's
  // DOMContentLoaded handler won't re-fire — send an explicit event so it
  // re-checks `localStorage['acos-edit-job']` and switches into edit mode.
  if (win && !win.isDestroyed()) {
    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', () => {
        if (!win.isDestroyed()) win.webContents.send('cron:check-pending-edit');
      });
    } else {
      win.webContents.send('cron:check-pending-edit');
    }
  }
}

function openSettingsWindow(tab?: string): void {
  // Open settings panel inside the chat window instead of a separate modal
  const chatWin = getWindow(WIN.CHAT);
  if (chatWin) {
    chatWin.show();
    chatWin.focus();
    chatWin.webContents.send('open-settings', tab);
    // Connect updater to chat window for status updates
    setSettingsWindow(chatWin);
  }
}

function openCustomizeWindow(): void {
  createWindow({
    id: WIN.CUSTOMIZE,
    title: 'Make It Yours - AI Chief of Staff',
    htmlFile: 'customize.html',
    width: 800,
    height: 650,
    boundsKey: 'window.customizeBounds',
  });
}

function openFactsWindow(): void {
  createWindow({
    id: WIN.FACTS,
    title: 'My Brain - AI Chief of Staff',
    htmlFile: 'facts.html',
    width: 700,
    height: 550,
    boundsKey: 'window.factsBounds',
  });
}

function openDailyLogsWindow(): void {
  createWindow({
    id: WIN.DAILY_LOGS,
    title: 'Daily Logs - AI Chief of Staff',
    htmlFile: 'daily-logs.html',
    width: 700,
    height: 550,
    boundsKey: 'window.dailyLogsBounds',
  });
}

function openSoulWindow(): void {
  createWindow({
    id: WIN.SOUL,
    title: 'My Approach - AI Chief of Staff',
    htmlFile: 'soul.html',
    width: 700,
    height: 550,
    boundsKey: 'window.soulBounds',
  });
}

function showNotification(title: string, body: string): void {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
}

// ============ IPC Handlers ============

/**
 * Build the shared dependency container for IPC modules.
 * Uses getter functions so modules always read the latest mutable global values.
 */
function buildIPCDeps(): IPCDependencies {
  return {
    getMemory: () => memory,
    getScheduler: () => scheduler,
    getTelegramBot: () => telegramBot,
    setTelegramBot: (bot) => {
      telegramBot = bot;
    },
    updateTrayMenu,
    initializeAgent,
    restartAgent,
    openChatWindow,
    openSettingsWindow,
    openCronWindow,
    openCustomizeWindow,
    openFactsWindow,
    openDailyLogsWindow,
    openSoulWindow,
    WIN,
  };
}

function setupIPC(): void {
  const deps = buildIPCDeps();
  registerAgentIPC(deps);
  registerSessionsIPC(deps);
  registerBrandsIPC(deps);
  registerSettingsIPC(deps);
  registerFactsIPC(deps);
  registerCronIPC(deps);
  registerMiscIPC(deps);
  registerContextIPC();
  registerAudioIPC();
  registerConnectionsIPC(() => app.getPath('userData'));
  registerGoogleOAuthIPC();
  registerConnectToolsIPC(
    () => app.getPath('userData'),
    () => ({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      // In dev the compiled main lives in dist/main/index.js, so the
      // project root is two levels up. In packaged mode this is unused
      // (isPackaged=true → resourcesPath/vendor wins).
      projectRoot: path.join(__dirname, '../..'),
    })
  );
  // Voice mode (Realtime ears+mouth, Claude brain). Handlers are inert unless
  // the renderer opens a session, which is gated off-by-default by the
  // voice.enabled setting + the Voice button visibility.
  registerRealtimeIPC(deps);
}

// ============ Agent Lifecycle ============

async function initializeAgent(): Promise<void> {
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'ai-chief-of-staff.db');

  // Check if we have required API keys
  if (!SettingsManager.hasRequiredKeys()) {
    console.log('[Main] No API keys configured, skipping agent initialization');
    return;
  }

  // Project root (where CLAUDE.md and CLI tools live)
  const projectRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'app')
    : path.join(__dirname, '../..');

  // Agent workspace (isolated working directory for file operations)
  const workspace = ensureAgentWorkspace();

  // Initialize memory (if not already done)
  if (!memory) {
    memory = new MemoryManager(dbPath);
  }

  // Build tools config from settings
  const toolsConfig = {
    mcpServers: {},
    // The whole home folder is in scope for a personal chief of staff (Desktop/Blogs,
    // ~/dev repos). Credential and browser-profile paths stay blocked by the sandbox.
    approvedRoots: [workspace, path.join(app.getPath('userData'), 'attachments'), app.getPath('home')],
    computerUse: {
      enabled: false,
      dockerized: true,
      displaySize: { width: 1920, height: 1080 },
    },
    browser: {
      enabled: SettingsManager.getBoolean('browser.enabled'),
      cdpUrl: SettingsManager.get('browser.cdpUrl') || 'http://localhost:9222',
    },
  };

  // Resolve model — single source of truth lives in src/agent/resolve-model.ts.
  // Covers all providers (anthropic / openai / moonshot / glm / xiaomi /
  // minimax / deepseek) and persists the resolved model so chat-engine and
  // the model picker see it on the next read. settings:set also calls this
  // whenever a provider credential changes, so `agent.model` stays in sync.
  const configuredModel = SettingsManager.get('agent.model');
  const model = resolveAndPersistModel();
  if (configuredModel && model !== configuredModel) {
    console.log(
      `[Main] Model/key mismatch: ${configuredModel} has no matching credential, falling back to ${model}`
    );
  }

  // Initialize agent with tools config
  AgentManager.initialize({
    memory,
    projectRoot,
    workspace, // Isolated working directory for agent file operations
    dataDir: app.getPath('userData'),
    model,
    tools: toolsConfig,
  });

  // Start external MCP servers (Gmail / Calendar / GHL / etc.) configured
  // in <userData>/mcp-servers.json. Fire and forget — each server's startup
  // failure is logged but doesn't block app boot. Tools become available
  // as soon as each child process finishes its MCP handshake; turns started
  // before that finishes simply see fewer tools.
  getMCPManager()
    .start(app.getPath('userData'))
    .catch((err) => console.error('[Main] MCP manager startup failed:', (err as Error).message));

  // Listen for model changes and broadcast to UI
  // Remove previous listener to prevent stacking on re-init
  if (modelChangedHandler) {
    AgentManager.off('model:changed', modelChangedHandler);
  }
  modelChangedHandler = (model: string) => {
    if (getWindow(WIN.CHAT)) {
      getWindow(WIN.CHAT)?.webContents.send('model:changed', model);
    }
    if (getWindow(WIN.SETTINGS)) {
      getWindow(WIN.SETTINGS)?.webContents.send('model:changed', model);
    }
  };
  AgentManager.on('model:changed', modelChangedHandler);

  // Forward session mode changes (from switch_agent tool) to chat window
  AgentManager.on(
    'sessionModeChanged',
    (sessionId: string, newMode: string, _icon: string, _name: string) => {
      if (getWindow(WIN.CHAT)) {
        getWindow(WIN.CHAT)?.webContents.send('agent:sessionModeChanged', sessionId, newMode);
      }
    }
  );

  // Initialize scheduler
  if (SettingsManager.getBoolean('scheduler.enabled')) {
    scheduler = createScheduler();

    // Set all handlers BEFORE initialize() — jobs can fire during init
    scheduler.setNotificationHandler((title: string, body: string) => {
      showNotification(title, body);
    });

    scheduler.setChatHandler(
      (jobName: string, prompt: string, response: string, sessionId: string) => {
        console.log(`[Scheduler] Sending chat message for job: ${jobName} (session: ${sessionId})`);
        if (getWindow(WIN.CHAT)) {
          getWindow(WIN.CHAT)?.webContents.send('scheduler:message', {
            jobName,
            prompt,
            response,
            sessionId,
          });
        } else {
          // Window not open — open it. loadHistory() on init will pick up
          // the message from the database, so no need to send via IPC.
          openChatWindow();
        }
      }
    );

    await scheduler.initialize(memory, dbPath);

    // Set up birthday reminders if birthday is configured
    const birthday = SettingsManager.get('profile.birthday');
    if (birthday) {
      await setupBirthdayCronJobs(birthday, scheduler);
    }

    // Set up SEO automation crons (weekly Search Console report + daily/monthly
    // local-SEO reminders). Idempotent — re-seeded on every launch.
    await setupSeoCronJobs(scheduler);
  }

  // Initialize Telegram
  const telegramEnabled = SettingsManager.getBoolean('telegram.enabled');
  const telegramToken = SettingsManager.get('telegram.botToken');

  if (telegramEnabled && telegramToken) {
    try {
      telegramBot = createTelegramBot();

      if (!telegramBot) {
        console.error('[Main] Telegram bot creation failed');
      } else {
        // Set up cross-channel sync: Telegram -> Desktop
        // Only send to chat window if it's already open - don't force open or notify
        telegramBot.setOnMessageCallback((data) => {
          // Only sync to desktop UI if chat window is already open
          if (getWindow(WIN.CHAT)) {
            getWindow(WIN.CHAT)?.webContents.send('telegram:message', {
              userMessage: data.userMessage,
              response: data.response,
              chatId: data.chatId,
              sessionId: data.sessionId,
              hasAttachment: data.hasAttachment,
              attachmentType: data.attachmentType,
              wasCompacted: data.wasCompacted,
              media: data.media,
            });
          }
          // Messages are already saved to SQLite, so they'll appear when user opens chat
        });

        // Notify UI when Telegram session links change
        telegramBot.setOnSessionLinkCallback(() => {
          if (getWindow(WIN.CHAT)) {
            getWindow(WIN.CHAT)?.webContents.send('sessions:changed');
          }
        });

        await telegramBot.start();

        if (scheduler) {
          scheduler.setTelegramBot(telegramBot);
        }

        // Hand the bot to the agent-tool layer so the send_telegram_message
        // tool can deliver messages mid-routine (used by the weekly blog cron).
        const { setTelegramBotForTools } = await import('../tools');
        setTelegramBotForTools(telegramBot);

        console.log('[Main] Telegram started');
      }
    } catch (error) {
      console.error('[Main] Telegram failed:', error);
    }
  }

  console.log('[Main] AI Chief of Staff initialized');
  updateTrayMenu();
}

async function stopAgent(): Promise<void> {
  if (telegramBot) {
    await telegramBot.stop();
    telegramBot = null;
    // Clear the agent-tool reference so a stale bot can't be called.
    const { setTelegramBotForTools } = await import('../tools');
    setTelegramBotForTools(null);
  }
  if (scheduler) {
    scheduler.stopAll();
    scheduler = null;
  }
  // Cleanup browser resources
  AgentManager.cleanup();
  console.log('[Main] Agent stopped');
  updateTrayMenu();
}

async function restartAgent(): Promise<void> {
  await stopAgent();
  await initializeAgent();
}

// ============ App Lifecycle ============

app.whenReady().then(async () => {
  console.log('[Main] App ready, starting initialization...');
  const earlyUserDataPath = app.getPath('userData');
  const earlyDatabasePath = path.join(earlyUserDataPath, 'ai-chief-of-staff.db');
  const restoreArgument = process.argv.find((argument) => argument.startsWith('--restore-backup='));
  if (restoreArgument) {
    const backupName = restoreArgument.slice('--restore-backup='.length);
    try {
      const result = await restoreDatabaseBackup(earlyDatabasePath, earlyUserDataPath, backupName);
      console.log(`[Main] Restored database from ${path.basename(result.restoredFrom)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox('Database restore failed', message);
      app.quit();
      return;
    }
  }
  installPermissionPolicy(session.defaultSession);
  // Register ALL IPC handlers FIRST, before anything that can throw (native
  // SQLite opens, migrations, credential file setup). Registration only binds
  // channels — handlers read mutable state through getters (getMemory(), the
  // self-guarding SettingsManager), so it is safe to bind them before init.
  // Previously setupIPC() ran AFTER the DB opens: one throw there meant ZERO
  // handlers registered, the renderer got "No handler registered for ..." on
  // every call, and ipc-error-handler.js mis-toasted "install out of date"
  // (a beta tester hit exactly this).
  trustedHandle('app:getStartupError', () => startupError);
  try {
    setupIPC();
    setupUpdaterIPC();
    console.log('[Main] IPC handlers registered');
    writeStartupHealth({ ipcRegistered: true });
  } catch (err) {
    startupError = err instanceof Error ? err.message : String(err);
    console.error('[Main] FATAL ERROR registering IPC:', err);
    writeStartupHealth({ error: startupError });
  }

  try {
    // Ensure the synthesized google-credentials.json exists at <userData>.
    // This is the file the bundled Flo MCP servers will read via
    // FLO_CREDENTIALS_PATH (see plan §3 / §8). Idempotent + cheap; safely
    // no-ops when running against placeholder credentials.
    const { GoogleOAuth } = await import('../auth/google-oauth');
    GoogleOAuth.ensureCredentialsFile();

    // Initialize the browser manager with an Electron-supplied downloads dir
    // so the CDP tier doesn't fall back to `process.cwd()` (which points at
    // the app bundle in a packaged build). The browser module itself never
    // imports Electron — we inject the path here.
    getBrowserManager({ downloadPath: app.getPath('downloads') });

    // === Power Management ===
    // Let macOS manage power naturally — App Nap may coalesce timers by a few
    // seconds when the app is in the background, which is fine for minute-level
    // cron jobs.  node-cron and setInterval still fire reliably without
    // powerSaveBlocker.  Removing the blocker allows the system to downclock
    // and avoids unnecessary fan spin-up on idle.

    // Handle system suspend/resume (actual sleep)
    powerMonitor.on('suspend', () => {
      console.log('[Power] System suspending (sleep)');
    });

    powerMonitor.on('resume', () => {
      console.log('[Power] System resumed from sleep');
      // Force CDP reconnection — WebSocket is dead after sleep
      getBrowserManager()
        .forceReconnectCdp()
        .catch((err) => {
          console.warn('[Power] CDP reconnect after resume failed:', err);
        });
    });

    // Handle lock screen (display off but CPU running)
    powerMonitor.on('lock-screen', () => {
      console.log('[Power] Screen locked');
    });

    powerMonitor.on('unlock-screen', () => {
      console.log('[Power] Screen unlocked');
      // Force CDP reconnection — connection may have gone stale during lock
      getBrowserManager()
        .forceReconnectCdp()
        .catch((err) => {
          console.warn('[Power] CDP reconnect after unlock failed:', err);
        });
    });

    // Set Dock icon on macOS
    if (process.platform === 'darwin') {
      const dockIconPath = path.join(__dirname, '../../assets/icon.png');
      if (fs.existsSync(dockIconPath)) {
        app.dock?.setIcon(dockIconPath);
      }
    }

    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'ai-chief-of-staff.db');
    console.log('[Main] DB path:', dbPath);

    // Initialize settings first (uses same DB)
    console.log('[Main] Initializing settings...');
    SettingsManager.initialize(dbPath);

    // Migrate from old config.json if it exists
    const oldConfigPath = path.join(userDataPath, 'config.json');
    await SettingsManager.migrateFromConfig(oldConfigPath);
    console.log('[Main] Settings initialized');

    // Migrate identity.md → personalize settings (one-time)
    migratePersonalizeFromIdentity();

    // Initialize memory (shared with settings)
    console.log('[Main] Initializing memory...');
    memory = new MemoryManager(dbPath);
    console.log('[Main] Memory initialized');
    writeStartupHealth({ sqliteLoaded: true });
    void createRotatingDatabaseBackup(dbPath, userDataPath)
      .then((backupPath) => console.log(`[Main] SQLite backup healthy: ${path.basename(backupPath)}`))
      .catch((error) => console.warn('[Main] SQLite backup failed:', (error as Error).message));

    console.log('[Main] Creating tray...');
    initTray({
      openChatWindow,
      openSettingsWindow,
      restartAgent,
      showNotification,
    });
    await createTray();
    console.log('[Main] Tray created');

    // Initialize auto-updater (only in packaged app)
    if (app.isPackaged) {
      initializeUpdater();
      console.log('[Main] Auto-updater initialized');
    }

    // Register global shortcut (Alt+Z on all platforms — maps to Option+Z on macOS)
    const shortcut = 'Alt+Z';
    const registered = globalShortcut.register(shortcut, () => {
      openChatWindow();
    });
    if (registered) {
      console.log(`[Main] Global shortcut ${shortcut} registered`);
    } else {
      console.warn(`[Main] Failed to register global shortcut ${shortcut}`);
    }

    const voiceShortcut = 'Alt+Shift+V';
    const voiceRegistered = globalShortcut.register(voiceShortcut, requestVoiceToggle);
    if (voiceRegistered) {
      console.log(`[Main] Voice shortcut ${voiceShortcut} registered`);
    } else {
      console.warn(`[Main] Failed to register voice shortcut ${voiceShortcut}`);
    }

    // Run workspace setup and version migration unconditionally — this handles
    // window bounds reset, onboarding fix, and config file updates regardless
    // of whether the agent will be initialized (isFirstRun may skip initializeAgent).
    ensureAgentWorkspace();

    // Open the chat window on launch so a Dock/Finder click shows the app on the
    // first click. Login-item launches stay quiet in the tray; first run always
    // opens so the user lands on onboarding.
    const firstRun = SettingsManager.isFirstRun();
    if (firstRun || !app.getLoginItemSettings().wasOpenedAtLogin) openChatWindow();
    if (!firstRun) {
      console.log('[Main] Initializing agent...');
      await initializeAgent();
      // Pick up freshly-released models without a manual "Check for new
      // models" click. Fire and forget; a failure keeps the cached list.
      refreshDiscoveredModels()
        .then(({ added }) => {
          if (added > 0) modelChangedHandler?.(AgentManager.getModel());
        })
        .catch((err) => console.warn('[Main] model discovery failed:', (err as Error).message));
    }

    // Tray menu is updated event-driven (after messages, cron changes, etc.)
    // No polling needed — updateTrayMenu() is called directly by IPC handlers
    writeStartupHealth({ initializationComplete: true, error: null });
  } catch (error) {
    startupError = error instanceof Error ? error.message : String(error);
    console.error('[Main] FATAL ERROR during initialization:', error);
    writeStartupHealth({ error: startupError });
    // Surface the real failure immediately — a tray app with a broken main
    // process otherwise looks "open but ignoring you".
    dialog.showErrorBox(
      'AI Chief of Staff failed to start',
      `${startupError}\n\nData folder: ${app.getPath('userData')}\n\nPlease send a screenshot of this message to support.`
    );
  }
});

app.on('window-all-closed', () => {
  // Keep running (tray app)
});

app.on('activate', () => {
  // macOS: clicking Dock icon opens chat window
  openChatWindow();
});

app.on('before-quit', async () => {
  if (app.isReady()) {
    globalShortcut.unregisterAll(); // Clean up global shortcuts
  }
  if (modelChangedHandler) {
    AgentManager.off('model:changed', modelChangedHandler);
    modelChangedHandler = null;
  }
  await stopAgent();
  await getMCPManager()
    .stop()
    .catch((err) => console.warn('[Main] MCP manager stop error:', (err as Error).message));
  if (memory) {
    memory.close();
  }
  SettingsManager.close();
});

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    openChatWindow();
  });
}
