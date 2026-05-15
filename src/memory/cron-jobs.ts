import Database from 'better-sqlite3';

export interface CronJob {
  id: number;
  name: string;
  schedule_type?: string;
  schedule: string | null;
  run_at?: string | null;
  interval_ms?: number | null;
  prompt: string;
  channel: string;
  enabled: boolean;
  delete_after_run?: boolean;
  context_messages?: number;
  next_run_at?: string | null;
  session_id?: string | null;
  job_type?: 'routine' | 'reminder';
}

/**
 * Save or update a cron job
 */
export function saveCronJob(
  db: Database.Database,
  name: string,
  schedule: string,
  prompt: string,
  channel: string = 'default',
  sessionId: string = 'default'
): number {
  const stmt = db.prepare(`
    INSERT INTO cron_jobs (name, schedule, prompt, channel, session_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      schedule = excluded.schedule,
      prompt = excluded.prompt,
      channel = excluded.channel,
      session_id = excluded.session_id
  `);
  const result = stmt.run(name, schedule, prompt, channel, sessionId);
  return result.lastInsertRowid as number;
}

/**
 * Get cron jobs, optionally filtering to enabled only
 */
export function getCronJobs(db: Database.Database, enabledOnly: boolean = true): CronJob[] {
  const query = enabledOnly
    ? 'SELECT * FROM cron_jobs WHERE enabled = 1'
    : 'SELECT * FROM cron_jobs';
  const stmt = db.prepare(query);
  const rows = stmt.all() as Array<{
    id: number;
    name: string;
    schedule_type: string;
    schedule: string | null;
    run_at: string | null;
    interval_ms: number | null;
    prompt: string;
    channel: string;
    enabled: number;
    delete_after_run: number;
    context_messages: number;
    next_run_at: string | null;
    session_id: string | null;
    job_type: string | null;
  }>;
  return rows.map((r) => ({
    ...r,
    enabled: r.enabled === 1,
    delete_after_run: r.delete_after_run === 1,
    job_type: (r.job_type || 'routine') as 'routine' | 'reminder',
  }));
}

/**
 * Enable or disable a cron job by name
 */
export function setCronJobEnabled(db: Database.Database, name: string, enabled: boolean): boolean {
  const stmt = db.prepare(`
    UPDATE cron_jobs SET enabled = ? WHERE name = ?
  `);
  const result = stmt.run(enabled ? 1 : 0, name);
  return result.changes > 0;
}

/**
 * Delete a cron job by name
 */
export function deleteCronJob(db: Database.Database, name: string): boolean {
  const stmt = db.prepare('DELETE FROM cron_jobs WHERE name = ?');
  const result = stmt.run(name);
  return result.changes > 0;
}
