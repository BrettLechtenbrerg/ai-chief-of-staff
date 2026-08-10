/**
 * Tool diagnostics - timing, logging, and timeout wrapper
 *
 * Wraps all tool handlers to:
 * - Log start/end with timing
 * - Enforce timeouts
 * - Catch and report errors
 */

const TOOL_TIMEOUT_MS = 30000; // 30 second default timeout

interface ToolTiming {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'running' | 'success' | 'error' | 'timeout';
  error?: string;
}

// Track active tool calls
const activeTools = new Map<string, ToolTiming>();
let toolCallId = 0;

/**
 * Log tool diagnostic message
 */
function logTool(
  level: 'info' | 'warn' | 'error',
  message: string,
  data?: Record<string, unknown>
): void {
  const timestamp = new Date().toISOString();
  const dataStr = data ? ` ${JSON.stringify(data)}` : '';
  const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : '🔧';
  console.log(`${prefix} [Tool ${timestamp}] ${message}${dataStr}`);
}

function describeStructure(value: unknown): Record<string, unknown> {
  if (value === null) return { type: 'null' };
  if (typeof value === 'string') return { type: 'string', characters: value.length };
  if (Array.isArray(value)) return { type: 'array', items: value.length };
  if (typeof value !== 'object') return { type: typeof value };

  const entries = Object.entries(value as Record<string, unknown>);
  return {
    type: 'object',
    fields: entries.slice(0, 20).map(([key, field]) => ({
      key,
      type: Array.isArray(field) ? 'array' : field === null ? 'null' : typeof field,
    })),
    omittedFields: Math.max(0, entries.length - 20),
  };
}

/**
 * Optional per-call context threaded from the agent framework into tool
 * handlers. `onProgress` lets long-running tools (e.g. render_video) emit
 * periodic heartbeat messages that surface in the chat status indicator.
 */
export interface ToolProgressContext {
  onProgress?: (message: string) => void;
}

/**
 * Wrap a tool handler with diagnostics and timeout
 */
export function wrapToolHandler<T>(
  toolName: string,
  handler: (input: T, context?: ToolProgressContext) => Promise<string>,
  timeoutMs: number = TOOL_TIMEOUT_MS
): (input: T, context?: ToolProgressContext) => Promise<string> {
  return async (input: T, context?: ToolProgressContext): Promise<string> => {
    const callId = `${toolName}-${++toolCallId}`;
    const timing: ToolTiming = {
      name: toolName,
      startTime: Date.now(),
      status: 'running',
    };
    activeTools.set(callId, timing);

    const inputMetadata = describeStructure(input);
    logTool('info', `START ${toolName}`, { callId, input: inputMetadata });

    // Create timeout promise
    let timeoutId: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<string>((_, reject) => {
      timeoutId = setTimeout(() => {
        timing.status = 'timeout';
        timing.endTime = Date.now();
        timing.duration = timing.endTime - timing.startTime;
        logTool('error', `TIMEOUT ${toolName} after ${timeoutMs}ms`, {
          callId,
          duration: timing.duration,
        });
        reject(new Error(`Tool ${toolName} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      // Race between handler and timeout
      const result = await Promise.race([handler(input, context), timeoutPromise]);

      clearTimeout(timeoutId!);
      timing.status = 'success';
      timing.endTime = Date.now();
      timing.duration = timing.endTime - timing.startTime;

      logTool('info', `END ${toolName}`, {
        callId,
        duration: `${timing.duration}ms`,
        result: { type: typeof result, characters: result.length },
      });

      return result;
    } catch (error) {
      clearTimeout(timeoutId!);
      timing.status = timing.status === 'timeout' ? 'timeout' : 'error';
      timing.endTime = Date.now();
      timing.duration = timing.endTime - timing.startTime;
      timing.error = error instanceof Error ? error.message : 'Unknown error';

      logTool('error', `FAIL ${toolName}`, {
        callId,
        duration: `${timing.duration}ms`,
        errorType: error instanceof Error ? error.name : typeof error,
      });

      // Return error as JSON so agent can see it
      return JSON.stringify({
        error: timing.error,
        toolName,
        duration: timing.duration,
        timedOut: timing.status === 'timeout',
      });
    } finally {
      activeTools.delete(callId);
    }
  };
}

/**
 * Get currently active tools (for debugging)
 */
export function getActiveTools(): ToolTiming[] {
  const now = Date.now();
  return Array.from(activeTools.values()).map((t) => ({
    ...t,
    duration: now - t.startTime,
  }));
}

/**
 * Log active tools status (call periodically to detect hangs)
 */
export function logActiveToolsStatus(): void {
  const active = getActiveTools();
  if (active.length > 0) {
    logTool('warn', `${active.length} tools still running`, {
      tools: active.map((t) => ({ name: t.name, runningFor: `${t.duration}ms` })),
    });
  }
}

/**
 * Specific timeout values for different tool types
 */
export const TOOL_TIMEOUTS = {
  // Fast tools - should complete in <5s
  remember: 5000,
  forget: 5000,
  list_facts: 5000,
  notify: 5000,

  // Medium tools - up to 15s
  schedule_task: 10000,
  list_scheduled_tasks: 5000,
  delete_scheduled_task: 5000,

  // Slow tools - browser operations
  browser: 45000, // Browser can be slow

  // Very slow tools - external generative APIs
  // gpt-image-1 at quality:'high' commonly takes 60–180s; we've seen
  // outliers near 4 min on busy days. 5 min keeps us off the timeout
  // path so the agent doesn't lie about a successful call that's
  // actually still in flight. Doubled to 8 min for the square-variant
  // path which makes TWO API calls in sequence.
  generate_blog_image: 480000,

  // Pure file I/O — fast, but allow generous headroom in case the
  // inbox folder needs creation or the cron passes a huge image path.
  write_daily_posting_packet: 15000,

  // AEO measurement fires ~75 web-search AI calls (25 prompts × 3 engines)
  // at concurrency 4; typical run 2–5 min, slow days longer. 12 min keeps
  // the wrapper from racing a healthy-but-slow run.
  fetch_aeo_visibility: 12 * 60 * 1000,

  // Video Studio tools shell out to long-running external processes and
  // enforce their own runInWorkspace timeouts (scaffold 12 min, render 20 min,
  // trim 30 min). The wrapper timeout must OUTLAST the tool's internal one so
  // the tool returns its structured error instead of the wrapper racing it out
  // at the 30s default — which stranded renders mid-flight with the agent
  // falling back to silent background polling (beta.21 tester report).
  scaffold_video_project: 13 * 60 * 1000,
  render_video: 21 * 60 * 1000,
  trim_video_silence: 31 * 60 * 1000,
} as const;

/**
 * Get timeout for a specific tool
 */
export function getToolTimeout(toolName: string): number {
  return TOOL_TIMEOUTS[toolName as keyof typeof TOOL_TIMEOUTS] || TOOL_TIMEOUT_MS;
}
