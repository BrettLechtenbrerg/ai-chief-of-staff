import type { CronScheduler } from '../scheduler';
import { SettingsManager } from '../settings';

// Month name mapping for birthday parsing
const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

/**
 * Parse a birthday string into month and day
 * Supports formats like: "March 15", "15 March", "3/15", "03-15", "March 15th"
 */
export function parseBirthday(birthday: string): { month: number; day: number } | null {
  if (!birthday || !birthday.trim()) return null;

  const cleaned = birthday.trim().toLowerCase();

  // Try "Month Day" or "Month Dayth/st/nd/rd" format (e.g., "March 15" or "March 15th")
  const monthDayMatch = cleaned.match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?$/);
  if (monthDayMatch) {
    const month = MONTHS[monthDayMatch[1]];
    const day = parseInt(monthDayMatch[2], 10);
    if (month && day >= 1 && day <= 31) {
      return { month, day };
    }
  }

  // Try "Day Month" format (e.g., "15 March" or "15th March")
  const dayMonthMatch = cleaned.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)$/);
  if (dayMonthMatch) {
    const day = parseInt(dayMonthMatch[1], 10);
    const month = MONTHS[dayMonthMatch[2]];
    if (month && day >= 1 && day <= 31) {
      return { month, day };
    }
  }

  // Try numeric formats: "3/15", "03/15", "3-15", "03-15"
  const numericMatch = cleaned.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (numericMatch) {
    const first = parseInt(numericMatch[1], 10);
    const second = parseInt(numericMatch[2], 10);
    // Assume MM/DD format (US style)
    if (first >= 1 && first <= 12 && second >= 1 && second <= 31) {
      return { month: first, day: second };
    }
  }

  return null;
}

/**
 * Set up birthday cron jobs when birthday is configured.
 * Creates two jobs: one at midnight and one at noon on the birthday.
 */
export async function setupBirthdayCronJobs(
  birthday: string,
  scheduler: CronScheduler | null
): Promise<void> {
  if (!scheduler) return;

  const jobNameMidnight = 'birthday_midnight';
  const jobNameNoon = 'birthday_noon';

  // Always delete existing birthday jobs first (including legacy names with underscore prefix)
  scheduler.deleteJob(jobNameMidnight);
  scheduler.deleteJob(jobNameNoon);
  scheduler.deleteJob('_birthday_midnight');
  scheduler.deleteJob('_birthday_noon');

  const parsed = parseBirthday(birthday);
  if (!parsed) {
    console.log('[Birthday] No valid birthday to schedule');
    return;
  }

  const { month, day } = parsed;
  const userName = SettingsManager.get('profile.name') || 'the user';

  // Cron format: minute hour day month day-of-week
  // Midnight: 0 0 DAY MONTH *
  // Noon: 0 12 DAY MONTH *
  const cronMidnight = `0 0 ${day} ${month} *`;
  const cronNoon = `0 12 ${day} ${month} *`;

  const promptMidnight = `It's ${userName}'s birthday! The clock just struck midnight. Send them a warm, heartfelt birthday message to start their special day. Be genuine and celebratory - this is the first birthday wish of their day!`;

  const promptNoon = `It's ${userName}'s birthday and it's now midday! Send them another wonderful birthday message. Make this one even more special and celebratory than the morning one - wish them an amazing rest of their birthday, mention hoping their day has been great so far, and express how much you appreciate them.`;

  // Create the jobs (routing broadcasts to all configured channels)
  await scheduler.createJob(jobNameMidnight, cronMidnight, promptMidnight, 'desktop');
  await scheduler.createJob(jobNameNoon, cronNoon, promptNoon, 'desktop');

  console.log(`[Birthday] Scheduled birthday reminders for ${month}/${day} (${userName})`);
}
