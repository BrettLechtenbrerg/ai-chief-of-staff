import { trustedHandle } from './trusted-ipc.js';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { AgentManager, ImageContent } from '../../agent';
import { SettingsManager } from '../../settings';
import {
  getValidatedBase64ByteLength,
  MAX_ATTACHMENT_BYTES,
  MAX_MEDIA_READ_BYTES,
} from '../../utils/input-limits.js';
import { resolveExistingPathWithin } from '../../utils/safe-path.js';
import { getWindow } from '../windows';
import type { IPCDependencies } from './types';

export function registerAgentIPC(deps: IPCDependencies): void {
  const { getMemory, getTelegramBot, updateTrayMenu, WIN } = deps;

  // Chat messages with status streaming
  trustedHandle(
    'agent:send',
    async (event, message: string, sessionId?: string, images?: ImageContent[]) => {
      if (typeof message !== 'string' || Buffer.byteLength(message, 'utf8') > 1024 * 1024) {
        return { success: false, error: 'Message exceeds the 1 MB limit.' };
      }
      if (images !== undefined && (!Array.isArray(images) || images.length > 8)) {
        return { success: false, error: 'Too many image attachments (max 8).' };
      }
      try {
        let totalImageBytes = 0;
        for (const image of images || []) {
          if (image?.type !== 'base64' || !['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(image.mediaType)) {
            throw new Error('Unsupported image payload');
          }
          totalImageBytes += getValidatedBase64ByteLength(image.data, MAX_ATTACHMENT_BYTES);
        }
        if (totalImageBytes > MAX_MEDIA_READ_BYTES) throw new Error('Images exceed the 20 MB total limit');
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Invalid image payload' };
      }

      console.log(
        `[IPC] agent:send received sessionId: ${sessionId}, images: ${images?.length || 0}`
      );
      // Auto-initialize agent if not yet initialized (handles race conditions and late key setup)
      if (!AgentManager.isInitialized()) {
        if (SettingsManager.hasRequiredKeys()) {
          console.log('[IPC] Agent not initialized, initializing now...');
          await deps.initializeAgent();
        }
        if (!AgentManager.isInitialized()) {
          return {
            success: false,
            error: 'No API keys configured. Please add your key in Settings > LLM.',
          };
        }
      }

      // Set up status listener to forward to renderer
      const effectiveSessionId = sessionId || 'default';
      const statusHandler = (status: {
        type: string;
        sessionId?: string;
        toolName?: string;
        toolInput?: string;
        message?: string;
      }) => {
        // Only forward status events for this session (or events without sessionId for backward compat)
        if (status.sessionId && status.sessionId !== effectiveSessionId) return;

        // Send status update to the chat window that initiated the request
        const webContents = event.sender;
        if (!webContents.isDestroyed()) {
          webContents.send('agent:status', status);
        }
      };

      AgentManager.on('status', statusHandler);

      try {
        const result = await AgentManager.processMessage(
          message,
          'desktop',
          sessionId || 'default',
          images
        );
        updateTrayMenu();

        // Sync to Telegram (Desktop -> Telegram) - only to the linked chat for this session
        const memory = getMemory();
        const telegramBot = getTelegramBot();
        const linkedChatId = memory?.getChatForSession(effectiveSessionId);
        console.log(
          '[Main] Checking telegram sync - bot exists:',
          !!telegramBot,
          'session:',
          effectiveSessionId,
          'linked chat:',
          linkedChatId
        );
        if (telegramBot && linkedChatId && result.response) {
          console.log('[Main] Syncing desktop message to Telegram chat:', linkedChatId);
          telegramBot
            .syncToChat(message, result.response, linkedChatId, result.media)
            .catch((err) => {
              console.error('[Main] Failed to sync desktop message to Telegram:', err);
            });
        }

        // If response is empty (e.g. aborted/stopped), signal stop instead of empty bubble
        if (!result.response) {
          return { success: true, stopped: true };
        }

        return {
          success: true,
          response: result.response,
          tokensUsed: result.tokensUsed,
          suggestedPrompt: result.suggestedPrompt,
          wasCompacted: result.wasCompacted,
          media: result.media,
          planPending: result.planPending,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        return { success: false, error: errorMsg };
      } finally {
        AgentManager.off('status', statusHandler);
      }
    }
  );

  trustedHandle('agent:history', async (_, limit: number = 50, sessionId?: string) => {
    return AgentManager.getRecentMessages(limit, sessionId || 'default');
  });

  trustedHandle('agent:stats', async (_, sessionId?: string) => {
    return AgentManager.getStats(sessionId);
  });

  trustedHandle('agent:clear', async (_, sessionId?: string) => {
    if (sessionId) {
      AgentManager.clearQueue(sessionId);
    }
    AgentManager.clearConversation(sessionId);
    updateTrayMenu();
    return { success: true };
  });

  trustedHandle('agent:stop', async (_, sessionId?: string) => {
    const stopped = AgentManager.stopQuery(sessionId);
    return { success: stopped };
  });

  // Agent mode (General / Coder / Researcher / Writer / Therapist)
  trustedHandle('agent:setMode', async (_, mode: string) => {
    const { isValidModeId } = await import('../../agent/agent-modes');
    if (!isValidModeId(mode)) {
      return { success: false, error: 'Invalid mode' };
    }
    AgentManager.setMode(mode);
    SettingsManager.set('agent.mode', mode);
    // Broadcast to chat window
    if (getWindow(WIN.CHAT)) {
      getWindow(WIN.CHAT)?.webContents.send('agent:modeChanged', mode);
    }
    return { success: true };
  });

  trustedHandle('agent:getMode', async () => {
    return AgentManager.getMode();
  });

  // Per-session mode (locked after first message)
  trustedHandle('agent:getSessionMode', async (_, sessionId: string) => {
    return getMemory()?.getSessionMode(sessionId) || 'coder';
  });

  trustedHandle('agent:setSessionMode', async (_, sessionId: string, mode: string) => {
    const { isValidModeId, getModeConfig } = await import('../../agent/agent-modes');
    if (!isValidModeId(mode)) {
      return { success: false, error: 'Invalid mode' };
    }
    const memory = getMemory();
    // Only allow mode change if session has no messages
    const msgCount = memory?.getSessionMessageCount(sessionId) || 0;
    if (msgCount > 0) {
      return { success: false, error: 'Cannot change mode after messages have been sent' };
    }

    const session = memory?.getSession(sessionId);
    const modeConfig = getModeConfig(mode);
    console.log(
      `[Sessions] Mode switch: session=${sessionId} "${session?.name}" ${session?.mode}->${mode} | current working_directory=${session?.working_directory || 'null'}`
    );

    // Don't create working directory on mode switch — it's created lazily on first message.
    // When switching to chat-engine mode: clear working directory (keep directory on disk)
    if (modeConfig.engine === 'chat' && session?.working_directory) {
      console.log(
        `[Sessions] Clearing working directory (kept on disk): ${session.working_directory}`
      );
      memory?.setSessionWorkingDirectory(sessionId, null);
    }

    const success = memory?.setSessionMode(sessionId, mode) ?? false;
    return { success };
  });

  trustedHandle('agent:restart', async () => {
    try {
      await deps.restartAgent();
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Read bounded image files from the canonical media directory for chat display.
  trustedHandle('agent:readMedia', async (_, filePath: string) => {
    try {
      const mediaDir = path.join(app.getPath('documents'), 'AI Chief of Staff', 'media');
      const canonicalPath = resolveExistingPathWithin(mediaDir, filePath);
      const stat = fs.statSync(canonicalPath);
      if (!stat.isFile() || stat.size > MAX_MEDIA_READ_BYTES) {
        throw new Error('Media is not a regular file within the 20 MB limit');
      }

      const ext = path.extname(canonicalPath).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
      };
      const mimeType = mimeMap[ext];
      if (!mimeType) throw new Error('Unsupported media type');
      const buffer = fs.readFileSync(canonicalPath);
      return `data:${mimeType};base64,${buffer.toString('base64')}`;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Main] Failed to read media file:', errorMsg);
      return null;
    }
  });
}
