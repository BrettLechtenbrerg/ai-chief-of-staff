import { shell, app } from 'electron';
import { trustedHandle } from './trusted-ipc.js';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { loadWorkflowCommands, loadWorkflowCommandsFromDir } from '../../config/commands-loader';
import { isMacOS, getPermissionsStatus, openPermissionSettings } from '../../permissions';
import type { PermissionType } from '../../permissions';
import { decodeBoundedAttachment, MAX_ATTACHMENT_BYTES } from '../../utils/input-limits.js';
import { resolveExistingPathWithin, resolvePathForCreateWithin } from '../../utils/safe-path.js';
import type { IPCDependencies } from './types';

const IS_WINDOWS = process.platform === 'win32';
const HOME_DIR = process.env.HOME || process.env.USERPROFILE || '';

export function registerMiscIPC(deps: IPCDependencies): void {
  const {
    getMemory,
    openChatWindow,
    openSettingsWindow,
    openCronWindow,
    openCustomizeWindow,
    openFactsWindow,
    openDailyLogsWindow,
    openSoulWindow,
  } = deps;

  // App window openers
  trustedHandle('app:openFacts', async () => {
    openFactsWindow();
  });

  trustedHandle('app:openDailyLogs', async () => {
    openDailyLogsWindow();
  });

  trustedHandle('app:openSoul', async () => {
    openSoulWindow();
  });

  trustedHandle('app:openCustomize', async () => {
    openCustomizeWindow();
  });

  trustedHandle('app:openRoutines', async () => {
    openCronWindow();
  });

  trustedHandle('app:openSettings', async (_, tab?: string) => {
    openSettingsWindow(tab);
  });

  trustedHandle('app:openChat', async () => {
    openChatWindow();
  });

  trustedHandle('app:getVersion', () => {
    return app.getVersion();
  });

  trustedHandle('app:openExternal', async (_, url: string) => {
    // Only allow http, https, and mailto schemes to prevent arbitrary protocol handler abuse
    if (!/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)) {
      console.warn('[Main] Blocked openExternal with disallowed scheme:', url);
      return;
    }
    await shell.openExternal(url);
  });

  trustedHandle('app:openPath', async (_, filePath: string) => {
    try {
      const allowedDir = path.join(app.getPath('documents'), 'AI Chief of Staff');
      const canonicalPath = resolveExistingPathWithin(allowedDir, filePath);
      await shell.openPath(canonicalPath);
    } catch (error) {
      console.warn('[Main] Blocked invalid openPath request:', error instanceof Error ? error.message : error);
    }
  });

  // Remote images open in the system browser; the privileged main process never downloads them.
  trustedHandle('app:openImage', async (_, src: string) => {
    try {
      if (/^https?:\/\//i.test(src)) {
        const remoteUrl = new URL(src);
        if (remoteUrl.protocol !== 'https:' && remoteUrl.protocol !== 'http:') {
          throw new Error('Unsupported image URL protocol');
        }
        await shell.openExternal(remoteUrl.href);
        return;
      }

      const mediaDir = path.join(app.getPath('documents'), 'AI Chief of Staff', 'media');
      const canonicalPath = resolveExistingPathWithin(mediaDir, src);
      const extension = path.extname(canonicalPath).toLowerCase();
      if (!new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']).has(extension)) {
        throw new Error('Unsupported image type');
      }
      await shell.openPath(canonicalPath);
    } catch (error) {
      console.warn('[Main] Blocked invalid openImage request:', error instanceof Error ? error.message : error);
    }
  });

  // OAuth flow for Claude subscription
  trustedHandle('auth:startOAuth', async () => {
    const { ClaudeOAuth } = await import('../../auth/oauth');
    return ClaudeOAuth.startFlow();
  });

  trustedHandle('auth:completeOAuth', async (_, code: string) => {
    const { ClaudeOAuth } = await import('../../auth/oauth');
    return ClaudeOAuth.completeWithCode(code);
  });

  trustedHandle('auth:cancelOAuth', async () => {
    const { ClaudeOAuth } = await import('../../auth/oauth');
    ClaudeOAuth.cancelFlow();
    return { success: true };
  });

  trustedHandle('auth:isOAuthPending', async () => {
    const { ClaudeOAuth } = await import('../../auth/oauth');
    return ClaudeOAuth.isPending();
  });

  trustedHandle('auth:validateOAuth', async () => {
    try {
      const { ClaudeOAuth } = await import('../../auth/oauth');
      // Timeout after 5 seconds to avoid hanging the UI
      const result = await Promise.race([
        ClaudeOAuth.getAccessToken().then((token) => ({ valid: token !== null })),
        new Promise<{ valid: boolean }>((resolve) =>
          setTimeout(() => resolve({ valid: false }), 5000)
        ),
      ]);
      console.log('[OAuth] Validation result:', result.valid ? 'valid' : 'expired/failed');
      return result;
    } catch (error) {
      console.error('[OAuth] Validation error:', error);
      return { valid: false };
    }
  });

  // OpenAI OAuth flow
  trustedHandle('openai:startOAuth', async () => {
    const { OpenAIOAuth } = await import('../../auth/openai-oauth');
    return OpenAIOAuth.startFlow();
  });

  trustedHandle('openai:completeOAuth', async () => {
    // Code-based flow is not used — browser-based PKCE flow auto-handles callback
    return { success: false, error: 'Not supported — use Sign in button' };
  });

  trustedHandle('openai:validateOAuth', async () => {
    try {
      const { OpenAIOAuth } = await import('../../auth/openai-oauth');
      const result = await Promise.race([
        OpenAIOAuth.getAccessToken().then((token) => ({ valid: token !== null })),
        new Promise<{ valid: boolean }>((resolve) =>
          setTimeout(() => resolve({ valid: false }), 5000)
        ),
      ]);
      console.log('[OpenAI OAuth] Validation result:', result.valid ? 'valid' : 'expired/failed');
      return result;
    } catch (error) {
      console.error('[OpenAI OAuth] Validation error:', error);
      return { valid: false };
    }
  });

  trustedHandle('openai:logoutOAuth', async () => {
    const { OpenAIOAuth } = await import('../../auth/openai-oauth');
    OpenAIOAuth.logout();
    return { success: true };
  });

  // Browser control
  trustedHandle('browser:detectInstalled', async () => {
    const { detectInstalledBrowsers } = await import('../../browser/launcher');
    return detectInstalledBrowsers();
  });

  trustedHandle('browser:launch', async (_, browserId: string, port?: number) => {
    const { launchBrowser } = await import('../../browser/launcher');
    return launchBrowser(browserId, port || 9222);
  });

  trustedHandle('browser:testConnection', async (_, cdpUrl?: string) => {
    const { testCdpConnection } = await import('../../browser/launcher');
    return testCdpConnection(cdpUrl || 'http://localhost:9222');
  });

  // Shell commands — platform-aware shell selection
  const ALLOWED_COMMAND_PREFIXES = IS_WINDOWS
    ? [
        '(Get-Command pocket',
        'Invoke-RestMethod https://api.github.com/repos/KenKaiii/',
        '$installDir = Join-Path',
      ]
    : [
        'which pocket',
        'curl -fsSL https://api.github.com/repos/KenKaiii/pocket-agent-cli/',
        'curl -fsSL https://raw.githubusercontent.com/KenKaiii/pocket-agent-cli/main/scripts/install.sh -o /tmp/pocket-cli-install.sh && sed',
      ];

  // Validate the `strings` version-check command
  const STRINGS_CMD_SUFFIX = ` | grep -E '^v[0-9]+\\.[0-9]+\\.[0-9]+$' | head -1`;
  function isAllowedStringsCmd(cmd: string): boolean {
    if (!cmd.startsWith('strings "') || !cmd.endsWith(STRINGS_CMD_SUFFIX)) return false;
    const pathPart = cmd.slice('strings "'.length, cmd.length - STRINGS_CMD_SUFFIX.length - 1);
    return /^[\w/.-]+$/.test(pathPart);
  }

  trustedHandle('shell:runCommand', async (_, command: string) => {
    // The trusted IPC wrapper already enforces the exact local top-level page.
    // Only known command patterns may cross this narrower shell boundary.
    const isAllowed =
      ALLOWED_COMMAND_PREFIXES.some((prefix) => command.startsWith(prefix)) ||
      (!IS_WINDOWS && isAllowedStringsCmd(command));
    if (!isAllowed) {
      console.warn('[Shell] Blocked non-allowlisted command:', command.slice(0, 80));
      throw new Error('Access denied: command not in allowlist');
    }
    const execAsync = promisify(exec);
    const shellOpts: Record<string, unknown> = IS_WINDOWS
      ? { shell: 'powershell.exe', env: process.env }
      : {
          shell: '/bin/bash',
          env: {
            ...process.env,
            PATH: `${process.env.PATH}:/usr/local/bin:/opt/homebrew/bin:${HOME_DIR}/.local/bin`,
          },
        };
    try {
      const { stdout } = await execAsync(command, shellOpts);
      return stdout;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Shell] Command failed:', errorMsg);
      throw error;
    }
  });

  // Commands (Workflows)
  trustedHandle('commands:list', async (_, sessionId?: string) => {
    const memory = getMemory();
    if (sessionId && memory) {
      const sessionMode = memory.getSessionMode(sessionId);
      const sessionWorkDir = memory.getSessionWorkingDirectory(sessionId);
      if (sessionMode === 'coder' && sessionWorkDir) {
        const sessionCommandsDir = path.join(sessionWorkDir, '.claude', 'commands');
        if (fs.existsSync(sessionCommandsDir)) {
          return loadWorkflowCommandsFromDir(sessionCommandsDir);
        }
      }
    }
    return loadWorkflowCommands();
  });

  // File attachments
  trustedHandle('attachment:save', async (_, name: string, dataUrl: string) => {
    try {
      const { bytes, safeName } = decodeBoundedAttachment(name, dataUrl);
      const attachmentsDir = path.join(app.getPath('userData'), 'attachments');
      fs.mkdirSync(attachmentsDir, { recursive: true, mode: 0o700 });
      const filePath = resolvePathForCreateWithin(
        attachmentsDir,
        path.join(attachmentsDir, `${Date.now()}-${safeName}`),
      );
      fs.writeFileSync(filePath, bytes, { flag: 'wx', mode: 0o600 });
      console.log('[Attachment] Saved attachment');
      return filePath;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Attachment] Save failed:', errorMsg);
      throw error;
    }
  });

  // Extract text from Office documents
  trustedHandle('attachment:extract-text', async (_, filePath: string) => {
    const attachmentsDir = path.join(app.getPath('userData'), 'attachments');
    const canonicalPath = resolveExistingPathWithin(attachmentsDir, filePath);
    const stat = fs.statSync(canonicalPath);
    if (!stat.isFile() || stat.size > MAX_ATTACHMENT_BYTES) {
      throw new Error('Attachment is not a regular file within the 10 MB limit');
    }
    const extractable = new Set(['.docx', '.pptx', '.xlsx', '.odt', '.odp', '.ods', '.rtf']);
    if (!extractable.has(path.extname(canonicalPath).toLowerCase())) {
      throw new Error('Unsupported extractable attachment type');
    }
    const { parseOffice } = await import('officeparser');
    const ast = await parseOffice(canonicalPath);
    const text = ast.toText();
    if (Buffer.byteLength(text, 'utf8') > MAX_ATTACHMENT_BYTES) {
      throw new Error('Extracted attachment text exceeds the 10 MB limit');
    }
    return text;
  });

  // Permissions (macOS)
  trustedHandle('permissions:isMacOS', () => {
    return isMacOS();
  });

  trustedHandle('permissions:checkStatus', (_, types: PermissionType[]) => {
    return getPermissionsStatus(types);
  });

  trustedHandle('permissions:openSettings', async (_, type: PermissionType) => {
    await openPermissionSettings(type);
  });
}
