/**
 * Scheduler tools for the agent
 *
 * Allows the agent to create, list, and manage scheduled tasks/reminders
 * Supports three schedule types:
 * - cron: Standard cron expressions (e.g., "0 9 * * *")
 * - at: One-time execution (e.g., "tomorrow 3pm", "in 10 minutes")
 * - every: Recurring intervals (requires "every" prefix, e.g., "every 30m", "every 2h")
 * - Bare durations like "30m", "2h" are treated as one-shot (same as "in 30 minutes")
 */

import { getScheduler } from '../scheduler';
import Database from 'better-sqlite3';
import fs from 'fs';
import { getCurrentSessionId } from './session-context';
import { getDbPath } from '../utils/db-path';
import { parseSchedule, calculateNextRun } from '../utils/cron';
import { formatDateTime, formatDuration, formatScheduleDisplay } from '../utils/date-format';

// Note: Direct DB access is used here because MemoryManager.saveCronJob does not yet support
// the extended cron fields (schedule_type, run_at, interval_ms, delete_after_run, next_run_at,
// job_type). Once MemoryManager is extended, this can be migrated to use it instead.

/**
 * Ensure the cron_jobs table has all required columns.
 * Uses ALTER TABLE with catch for idempotent migrations.
 */
function ensureCronJobColumns(db: InstanceType<typeof Database>): void {
  const columns = [
    `ALTER TABLE cron_jobs ADD COLUMN schedule_type TEXT DEFAULT 'cron'`,
    `ALTER TABLE cron_jobs ADD COLUMN run_at TEXT`,
    `ALTER TABLE cron_jobs ADD COLUMN interval_ms INTEGER`,
    `ALTER TABLE cron_jobs ADD COLUMN delete_after_run INTEGER DEFAULT 0`,
    `ALTER TABLE cron_jobs ADD COLUMN next_run_at TEXT`,
    `ALTER TABLE cron_jobs ADD COLUMN session_id TEXT`,
    `ALTER TABLE cron_jobs ADD COLUMN job_type TEXT DEFAULT 'routine'`,
  ];
  for (const sql of columns) {
    try {
      db.exec(sql);
    } catch {
      /* column already exists */
    }
  }
}

/**
 * Upsert a cron job into the database.
 * Returns the result of the INSERT/UPDATE.
 */
function upsertCronJob(
  db: InstanceType<typeof Database>,
  params: {
    name: string;
    scheduleType: string;
    schedule: string | null;
    runAt: string | null;
    intervalMs: number | null;
    prompt: string;
    channel: string;
    deleteAfterRun: number;
    nextRunAt: string | null;
    sessionId: string;
    jobType: string;
  }
): void {
  const existing = db.prepare('SELECT id FROM cron_jobs WHERE name = ?').get(params.name);

  if (existing) {
    db.prepare(
      `
      UPDATE cron_jobs SET
        schedule_type = ?, schedule = ?, run_at = ?, interval_ms = ?,
        prompt = ?, channel = ?, enabled = 1,
        delete_after_run = ?, next_run_at = ?, session_id = ?, job_type = ?,
        updated_at = datetime('now')
      WHERE name = ?
    `
    ).run(
      params.scheduleType,
      params.schedule,
      params.runAt,
      params.intervalMs,
      params.prompt,
      params.channel,
      params.deleteAfterRun,
      params.nextRunAt,
      params.sessionId,
      params.jobType,
      params.name
    );
  } else {
    db.prepare(
      `
      INSERT INTO cron_jobs (
        name, schedule_type, schedule, run_at, interval_ms,
        prompt, channel, enabled, delete_after_run, next_run_at, session_id, job_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
    `
    ).run(
      params.name,
      params.scheduleType,
      params.schedule,
      params.runAt,
      params.intervalMs,
      params.prompt,
      params.channel,
      params.deleteAfterRun,
      params.nextRunAt,
      params.sessionId,
      params.jobType
    );
  }
}

/**
 * Build a user-friendly schedule description from a parsed schedule.
 */
function buildScheduleDescription(parsed: {
  type: string;
  schedule?: string;
  runAt?: string;
  intervalMs?: number;
}): string {
  if (parsed.type === 'at') {
    return `one-time at ${formatDateTime(parsed.runAt!)}`;
  }
  if (parsed.type === 'every') {
    return `every ${formatDuration(parsed.intervalMs!)}`;
  }
  return `cron: ${parsed.schedule}`;
}

/**
 * Common handler logic for creating a routine or reminder.
 */
async function handleCreateJob(
  name: string,
  schedule: string,
  promptOrReminder: string,
  jobType: 'routine' | 'reminder'
): Promise<string> {
  console.log(`[Scheduler] Creating ${jobType}: ${name} (${schedule})`);

  const parsed = parseSchedule(schedule);
  if (!parsed) {
    return JSON.stringify({
      error: `Could not parse schedule: "${schedule}"`,
      hint: 'One-shot: "30m", "2h", "in 10 minutes", "tomorrow 3pm". Recurring: "every 2h", or cron "0 9 * * *"',
    });
  }

  try {
    const dbPath = getDbPath();
    if (!fs.existsSync(dbPath)) {
      return JSON.stringify({ error: 'Database not found. Start Pocket Agent first.' });
    }

    const db = new Database(dbPath);
    try {
      db.pragma('journal_mode = WAL');
      ensureCronJobColumns(db);

      const sessionId = getCurrentSessionId();
      const deleteAfterRun = parsed.type === 'at' ? 1 : 0;
      const targetChannel = 'desktop';

      const nextRunAt = calculateNextRun(
        parsed.type,
        parsed.schedule || null,
        parsed.runAt || null,
        parsed.intervalMs || null
      );

      upsertCronJob(db, {
        name,
        scheduleType: parsed.type,
        schedule: parsed.schedule || null,
        runAt: parsed.runAt || null,
        intervalMs: parsed.intervalMs || null,
        prompt: promptOrReminder,
        channel: targetChannel,
        deleteAfterRun,
        nextRunAt,
        sessionId,
        jobType,
      });

      const scheduleDesc = buildScheduleDescription(parsed);

      console.log(
        `[Scheduler] ${jobType === 'routine' ? 'Routine' : 'Reminder'} created: ${name} (${parsed.type})`
      );
      return JSON.stringify({
        success: true,
        message: `${jobType === 'routine' ? 'Routine' : 'Reminder'} "${name}" created`,
        name,
        type: jobType === 'routine' ? parsed.type : 'reminder',
        schedule: scheduleDesc,
        next_run: formatDateTime(nextRunAt),
        one_time: deleteAfterRun === 1,
        channel: targetChannel,
        session_id: sessionId,
      });
    } finally {
      db.close();
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Scheduler] Failed to create ${jobType}: ${errorMsg}`);
    return JSON.stringify({ error: errorMsg });
  }
}

// ============================================================================
// Tool definitions
// ============================================================================

/**
 * Create routine tool definition
 * Routines send a prompt to the LLM at the scheduled time - the LLM then executes it
 */
export function getCreateRoutineToolDefinition() {
  return {
    name: 'create_routine',
    description:
      'Schedule a prompt for the LLM to execute at a specific time. When triggered, the prompt is sent to the agent who will perform the requested action (browse web, check APIs, research, etc). For simple notifications with no LLM action, use create_reminder instead.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Unique name for this routine (e.g., "morning_weather")',
        },
        schedule: {
          type: 'string',
          description:
            'When to run. One-shot: "30m", "2h", "in 10 minutes", "tomorrow 3pm". Recurring: "every 30m", "every 2h", or cron "0 9 * * *". Bare durations like "2h" are ONE-SHOT (runs once). Use "every 2h" for recurring.',
        },
        prompt: {
          type: 'string',
          description:
            'The prompt sent to the LLM when triggered. Write as an instruction: "Check the weather in KL and tell me", "Summarize today\'s tech news", "Research competitors for X".',
        },
      },
      required: ['name', 'schedule', 'prompt'],
    },
  };
}

/**
 * Create routine tool handler
 * Supports natural language scheduling in addition to cron
 */
export async function handleCreateRoutineTool(input: unknown): Promise<string> {
  const { name, schedule, prompt } = input as {
    name: string;
    schedule: string;
    prompt: string;
  };

  if (!name || !schedule || !prompt) {
    return JSON.stringify({ error: 'Missing required fields: name, schedule, prompt' });
  }

  return handleCreateJob(name, schedule, prompt, 'routine');
}

/**
 * Create reminder tool definition
 * Reminders are simple notifications - no LLM processing, just display the message
 */
export function getCreateReminderToolDefinition() {
  return {
    name: 'create_reminder',
    description:
      'Create a simple reminder notification (NO LLM processing). The message is displayed exactly as written. Use for: "remind me to X", "don\'t forget Y". For tasks requiring LLM action (research, checking weather), use create_routine instead.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Unique name for the reminder (e.g., "shower_reminder")',
        },
        schedule: {
          type: 'string',
          description:
            'When to remind. One-shot: "30m", "2h", "in 10 minutes", "tomorrow 3pm". Recurring: "every 30m", "every 2h", or cron "0 9 * * *". Bare durations like "2h" are ONE-SHOT (runs once). Use "every 2h" for recurring.',
        },
        reminder: {
          type: 'string',
          description:
            'The exact message to display. Examples: "Hey Ken! Time to take a shower 🚿", "Don\'t forget to call mom! 📱". Write a friendly, complete message.',
        },
      },
      required: ['name', 'schedule', 'reminder'],
    },
  };
}

/**
 * Create reminder tool handler
 */
export async function handleCreateReminderTool(input: unknown): Promise<string> {
  const { name, schedule, reminder } = input as {
    name: string;
    schedule: string;
    reminder: string;
  };

  if (!name || !schedule || !reminder) {
    return JSON.stringify({ error: 'Missing required fields: name, schedule, reminder' });
  }

  return handleCreateJob(name, schedule, reminder, 'reminder');
}

/**
 * List routines tool definition
 */
export function getListRoutinesToolDefinition() {
  return {
    name: 'list_routines',
    description:
      'List all scheduled routines (LLM tasks) and reminders (simple notifications). Shows name, type, schedule, and next run time.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  };
}

/**
 * List routines handler
 */
export async function handleListRoutinesTool(): Promise<string> {
  const scheduler = getScheduler();

  if (!scheduler) {
    return JSON.stringify({ error: 'Scheduler not initialized' });
  }

  const jobs = scheduler.getAllJobs();

  if (jobs.length === 0) {
    return JSON.stringify({
      success: true,
      message: 'No scheduled tasks',
      tasks: [],
    });
  }

  return JSON.stringify({
    success: true,
    count: jobs.length,
    tasks: jobs.map((job) => ({
      name: job.name,
      type: job.job_type || 'routine',
      schedule: formatScheduleDisplay(job),
      next_run: job.next_run_at ? formatDateTime(job.next_run_at) : null,
      prompt: job.prompt,
      channel: job.channel,
      enabled: job.enabled,
    })),
  });
}

/**
 * Delete routine tool definition
 */
export function getDeleteRoutineToolDefinition() {
  return {
    name: 'delete_routine',
    description: 'Delete a scheduled routine or reminder by name.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Name of the routine to delete',
        },
      },
      required: ['name'],
    },
  };
}

/**
 * Delete routine handler
 */
export async function handleDeleteRoutineTool(input: unknown): Promise<string> {
  const scheduler = getScheduler();

  if (!scheduler) {
    return JSON.stringify({ error: 'Scheduler not initialized' });
  }

  const { name } = input as { name: string };

  if (!name) {
    return JSON.stringify({ error: 'Routine name is required' });
  }

  const success = scheduler.deleteJob(name);

  if (success) {
    console.log(`[Scheduler] Deleted routine: ${name}`);
    return JSON.stringify({
      success: true,
      message: `Routine "${name}" deleted`,
    });
  } else {
    return JSON.stringify({
      success: false,
      error: `Routine "${name}" not found`,
    });
  }
}

/**
 * Get all scheduler tools
 */
export function getSchedulerTools() {
  return [
    {
      ...getCreateRoutineToolDefinition(),
      handler: handleCreateRoutineTool,
    },
    {
      ...getCreateReminderToolDefinition(),
      handler: handleCreateReminderTool,
    },
    {
      ...getListRoutinesToolDefinition(),
      handler: handleListRoutinesTool,
    },
    {
      ...getDeleteRoutineToolDefinition(),
      handler: handleDeleteRoutineTool,
    },
  ];
}
