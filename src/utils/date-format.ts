/**
 * Date/schedule formatting utilities.
 */

/** Format an ISO date string for human-readable display. */
export function formatDateTime(isoString: string | null): string | null {
  if (!isoString) return null;
  const date = new Date(isoString);
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** Format a millisecond duration into a compact string (e.g. "30m", "2h", "1d"). */
export function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  if (ms < 86400000) return `${Math.round(ms / 3600000)}h`;
  return `${Math.round(ms / 86400000)}d`;
}

/**
 * Format a schedule for display based on schedule_type.
 *
 * Produces human-readable strings like "cron: 0 9 * * *", "at: Thu, Dec 25, 3:00 PM",
 * or "every 30m".
 */
export function formatScheduleDisplay(job: {
  schedule_type?: string;
  schedule: string | null;
  run_at?: string | null;
  interval_ms?: number | null;
}): string {
  const scheduleType = job.schedule_type || 'cron';

  if (scheduleType === 'cron' && job.schedule) {
    return `cron: ${job.schedule}`;
  }
  if (scheduleType === 'at' && job.run_at) {
    const formatted = formatDateTime(job.run_at);
    return `at: ${formatted || job.run_at}`;
  }
  if (scheduleType === 'every' && job.interval_ms) {
    return `every ${formatDuration(job.interval_ms)}`;
  }

  // Fallback: try to show whatever is available
  if (job.schedule) return job.schedule;
  if (job.run_at) return `at: ${formatDateTime(job.run_at) || job.run_at}`;
  if (job.interval_ms) return `every ${formatDuration(job.interval_ms)}`;

  return 'unknown';
}
