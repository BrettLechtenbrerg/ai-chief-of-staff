import type Database from 'better-sqlite3';
import type { MemoryManager } from '../memory';
import type { NotificationChannels } from './notifications';
import { sendReminderToAllChannels } from './notifications';
import type { JobResult } from './index';

/**
 * Interfaces for calendar events and tasks queried from the database.
 */
export interface CalendarEvent {
  id: number;
  title: string;
  description: string | null;
  start_time: string;
  location: string | null;
  reminder_minutes: number;
  channel: string;
  session_id: string | null;
}

export interface Task {
  id: number;
  title: string;
  description: string | null;
  due_date: string;
  priority: string;
  reminder_minutes: number;
  channel: string;
  session_id: string | null;
}

/**
 * Format date for SQLite datetime() function.
 * SQLite is finicky with milliseconds and 'Z' suffix, use clean ISO format.
 */
export function formatForSqlite(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, '');
}

/**
 * Check for calendar events that need reminders and send notifications.
 * Returns job history entries for each reminder sent.
 */
export async function checkCalendarEvents(
  db: Database.Database,
  now: Date,
  nowSqlite: string,
  channels: NotificationChannels,
  memory: MemoryManager | null
): Promise<JobResult[]> {
  const results: JobResult[] = [];

  const events = db
    .prepare(
      `
      SELECT id, title, description, start_time, location, reminder_minutes, channel, session_id
      FROM calendar_events
      WHERE reminded = 0
        AND datetime(replace(start_time, 'Z', ''), '-' || reminder_minutes || ' minutes') <= datetime(?)
        AND datetime(replace(start_time, 'Z', '')) > datetime(?)
    `
    )
    .all(nowSqlite, nowSqlite) as CalendarEvent[];

  for (const event of events) {
    const startTime = new Date(event.start_time);
    const minutesUntil = Math.round((startTime.getTime() - now.getTime()) / 60000);

    let message = `Upcoming event: "${event.title}"`;
    if (minutesUntil > 0) {
      message += ` in ${minutesUntil} minute${minutesUntil === 1 ? '' : 's'}`;
    } else {
      message += ' starting now';
    }
    if (event.location) {
      message += ` at ${event.location}`;
    }

    const sessionId = event.session_id || 'default';

    // Save reminder to messages table for persistence and history display
    if (memory) {
      memory.saveMessage('assistant', message, sessionId, {
        source: 'scheduler',
        jobName: 'calendar_reminder',
      });
    }

    await sendReminderToAllChannels(channels, 'calendar', message, sessionId);

    // Mark as reminded
    db.prepare('UPDATE calendar_events SET reminded = 1 WHERE id = ?').run(event.id);
    console.log(`[Scheduler] Marked calendar event ${event.id} as reminded`);

    results.push({
      jobName: `calendar:${event.title}`,
      response: message,
      channel: event.channel,
      success: true,
      timestamp: new Date(),
    });
  }

  return results;
}

/**
 * Check for tasks with due dates that need reminders and send notifications.
 * Returns job history entries for each reminder sent.
 */
export async function checkTaskReminders(
  db: Database.Database,
  now: Date,
  nowSqlite: string,
  channels: NotificationChannels,
  memory: MemoryManager | null
): Promise<JobResult[]> {
  const results: JobResult[] = [];

  const tasks = db
    .prepare(
      `
      SELECT id, title, description, due_date, priority, reminder_minutes, channel, session_id
      FROM tasks
      WHERE status != 'completed'
        AND reminded = 0
        AND reminder_minutes IS NOT NULL
        AND due_date IS NOT NULL
        AND datetime(replace(due_date, 'Z', ''), '-' || reminder_minutes || ' minutes') <= datetime(?)
        AND datetime(replace(due_date, 'Z', '')) > datetime(?)
    `
    )
    .all(nowSqlite, nowSqlite) as Task[];

  if (tasks.length > 0) {
    console.log(`[Scheduler] Found ${tasks.length} task(s) due for reminder`);
  }

  for (const task of tasks) {
    const dueDate = new Date(task.due_date);
    const minutesUntil = Math.round((dueDate.getTime() - now.getTime()) / 60000);

    let message = `Task due soon: "${task.title}"`;
    if (minutesUntil > 0) {
      message += ` in ${minutesUntil} minute${minutesUntil === 1 ? '' : 's'}`;
    } else {
      message += ' due now';
    }
    if (task.priority === 'high') {
      message += ' (High Priority)';
    }

    const sessionId = task.session_id || 'default';

    // Save reminder to messages table for persistence and history display
    if (memory) {
      memory.saveMessage('assistant', message, sessionId, {
        source: 'scheduler',
        jobName: 'task_reminder',
      });
    }

    await sendReminderToAllChannels(channels, 'task', message, sessionId);

    // Mark as reminded
    db.prepare('UPDATE tasks SET reminded = 1 WHERE id = ?').run(task.id);
    console.log(`[Scheduler] Marked task ${task.id} as reminded`);

    results.push({
      jobName: `task:${task.title}`,
      response: message,
      channel: task.channel,
      success: true,
      timestamp: new Date(),
    });
  }

  return results;
}
