/**
 * Cron/schedule utilities: matching, parsing, validation, and next-run calculation.
 */

/**
 * Match a cron field spec against a value.
 * Supports: *, integers, step (asterisk/N or range/step), ranges (N-M), and comma-separated lists.
 */
export function matchesCronField(spec: string, value: number, min: number, max: number): boolean {
  if (spec === '*') return true;

  return spec.split(',').some((part) => {
    const [range, stepStr] = part.split('/');
    const step = stepStr ? parseInt(stepStr, 10) : 1;

    let start: number, end: number;
    if (range === '*') {
      start = min;
      end = max;
    } else if (range.includes('-')) {
      const [s, e] = range.split('-');
      start = parseInt(s, 10);
      end = parseInt(e, 10);
    } else {
      // Single value (no step)
      if (!stepStr) return value === parseInt(range, 10);
      start = parseInt(range, 10);
      end = max;
    }

    if (value < start || value > end) return false;
    return (value - start) % step === 0;
  });
}

/** Result of parsing a schedule string. */
export interface ParsedSchedule {
  type: 'cron' | 'at' | 'every';
  schedule?: string;
  runAt?: string;
  intervalMs?: number;
}

/**
 * Parse a schedule string and determine its type.
 *
 * Supports:
 * - "every 30m", "every 2h" → recurring interval
 * - "30m", "2h" → one-shot (same as "in 30 minutes")
 * - "tomorrow 3pm", "in 10 minutes" → one-time at a specific datetime
 * - "0 9 * * *" → cron expression
 */
export function parseSchedule(input: string): ParsedSchedule | null {
  const trimmed = input.trim();

  // Check for explicit "every" pattern (recurring): "every 30m", "every 2h", "every 1d"
  const everyMatch = trimmed.match(
    /^every\s+(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)$/i
  );
  if (everyMatch) {
    const [, amount, unit] = everyMatch;
    const num = parseInt(amount, 10);
    let ms: number;
    if (unit.startsWith('m')) ms = num * 60 * 1000;
    else if (unit.startsWith('h')) ms = num * 60 * 60 * 1000;
    else ms = num * 24 * 60 * 60 * 1000;
    return { type: 'every', intervalMs: ms };
  }

  // Check for bare duration (one-shot): "30m", "2h", "1d" → treated as "in X"
  const bareMatch = trimmed.match(/^(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)$/i);
  if (bareMatch) {
    const [, amount, unit] = bareMatch;
    const num = parseInt(amount, 10);
    let ms: number;
    if (unit.startsWith('m')) ms = num * 60 * 1000;
    else if (unit.startsWith('h')) ms = num * 60 * 60 * 1000;
    else ms = num * 24 * 60 * 60 * 1000;
    const runAt = new Date(Date.now() + ms).toISOString();
    return { type: 'at', runAt };
  }

  // Check for "at" pattern: specific datetime
  const atTime = parseDateTime(trimmed);
  if (atTime) {
    // If it's a relative/specific time, treat as "at"
    if (
      trimmed.match(
        /^(today|tomorrow|in\s+\d|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i
      )
    ) {
      return { type: 'at', runAt: atTime };
    }
  }

  // Check for cron expression (5 parts)
  const parts = trimmed.split(/\s+/);
  if (parts.length === 5 && validateCron(trimmed)) {
    return { type: 'cron', schedule: trimmed };
  }

  // Try parsing as datetime for "at" type
  if (atTime) {
    return { type: 'at', runAt: atTime };
  }

  return null;
}

/**
 * Parse a datetime string to ISO format.
 *
 * Supports:
 * - "today 3pm", "tomorrow 9am", "monday 2pm"
 * - "in 2 hours", "in 30 minutes", "in 3 days"
 * - ISO format strings
 */
export function parseDateTime(input: string): string | null {
  const now = new Date();

  // "today 3pm", "tomorrow 9am", "monday 2pm"
  const relativeMatch = input.match(
    /^(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i
  );
  if (relativeMatch) {
    const [, dayStr, hourStr, minStr, ampm] = relativeMatch;
    const targetDate = new Date(now);

    if (dayStr.toLowerCase() === 'tomorrow') {
      targetDate.setDate(targetDate.getDate() + 1);
    } else if (dayStr.toLowerCase() !== 'today') {
      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const targetDay = days.indexOf(dayStr.toLowerCase());
      const currentDay = targetDate.getDay();
      let daysToAdd = targetDay - currentDay;
      if (daysToAdd <= 0) daysToAdd += 7;
      targetDate.setDate(targetDate.getDate() + daysToAdd);
    }

    let hour = parseInt(hourStr, 10);
    const min = minStr ? parseInt(minStr, 10) : 0;
    if (ampm?.toLowerCase() === 'pm' && hour < 12) hour += 12;
    if (ampm?.toLowerCase() === 'am' && hour === 12) hour = 0;

    targetDate.setHours(hour, min, 0, 0);
    return targetDate.toISOString();
  }

  // "in 2 hours", "in 30 minutes", "in 3 days"
  const inMatch = input.match(/^in\s+(\d+)\s*(hour|hr|minute|min|day|d)s?$/i);
  if (inMatch) {
    const [, amount, unit] = inMatch;
    const num = parseInt(amount, 10);
    let ms: number;
    if (unit.toLowerCase().startsWith('hour') || unit.toLowerCase() === 'hr') {
      ms = num * 3600000;
    } else if (unit.toLowerCase().startsWith('min')) {
      ms = num * 60000;
    } else {
      ms = num * 86400000;
    }
    return new Date(now.getTime() + ms).toISOString();
  }

  // Try direct parse (ISO format, etc.)
  const parsed = new Date(input);
  if (!isNaN(parsed.getTime()) && parsed > now) {
    return parsed.toISOString();
  }

  return null;
}

/** Validate a cron expression (5 space-separated fields). */
export function validateCron(schedule: string): boolean {
  const parts = schedule.split(/\s+/);
  if (parts.length !== 5) return false;

  const ranges = [
    [0, 59], // minute
    [0, 23], // hour
    [1, 31], // day
    [1, 12], // month
    [0, 7], // weekday
  ];

  for (let i = 0; i < 5; i++) {
    const part = parts[i];
    if (part === '*') continue;
    if (part.includes('/')) continue;
    if (part.includes('-')) continue;
    if (part.includes(',')) continue;

    const num = parseInt(part, 10);
    if (isNaN(num) || num < ranges[i][0] || num > ranges[i][1]) {
      return false;
    }
  }

  return true;
}

/**
 * Calculate the next run time for a scheduled job.
 *
 * For cron schedules, iterates minute-by-minute up to 48h ahead.
 */
export function calculateNextRun(
  type: string,
  schedule: string | null,
  runAt: string | null,
  intervalMs: number | null
): string | null {
  const now = new Date();

  if (type === 'at' && runAt) {
    const runDate = new Date(runAt);
    return runDate > now ? runAt : null;
  }

  if (type === 'every' && intervalMs) {
    return new Date(now.getTime() + intervalMs).toISOString();
  }

  if (type === 'cron' && schedule) {
    const parts = schedule.split(/\s+/);
    if (parts.length !== 5) return null;

    const [minSpec, hourSpec, domSpec, monSpec, dowSpec] = parts;

    // Iterate minute-by-minute to find next matching time (max 48h lookahead)
    const candidate = new Date(now);
    candidate.setSeconds(0, 0);
    candidate.setMinutes(candidate.getMinutes() + 1);
    const maxTime = now.getTime() + 48 * 60 * 60 * 1000;

    while (candidate.getTime() <= maxTime) {
      if (
        matchesCronField(minSpec, candidate.getMinutes(), 0, 59) &&
        matchesCronField(hourSpec, candidate.getHours(), 0, 23) &&
        matchesCronField(domSpec, candidate.getDate(), 1, 31) &&
        matchesCronField(monSpec, candidate.getMonth() + 1, 1, 12) &&
        matchesCronField(dowSpec, candidate.getDay(), 0, 6)
      ) {
        return candidate.toISOString();
      }
      candidate.setMinutes(candidate.getMinutes() + 1);
    }

    return null;
  }

  return null;
}
