/**
 * SEO automation cron jobs. Modeled on src/main/birthday.ts: idempotent
 * create-missing-only on launch to preserve user-edited prompts/schedules from
 * this code, namespaced `seo_*`, all routed to the `desktop` channel (which also
 * fans out to Telegram when a chat is linked).
 *
 * Three jobs:
 *   - seo_weekly_report (Mon 08:00) — the real automation: calls fetch_seo_data
 *     for all brands, has the agent analyze it, and delivers a plain-English
 *     report + prioritized to-do list via Telegram. Degrades gracefully when
 *     Search Console isn't connected yet.
 *   - seo_daily_reviews (daily 09:00) — short human-only nudge: reply to new
 *     Google reviews + GBP messages (PMMA-focused).
 *   - seo_monthly_local (1st 09:00) — monthly Google Business Profile checklist.
 *
 * All times use the standard 5-field cron expressions already proven elsewhere
 * in this codebase (minute hour day month day-of-week).
 */

import type { CronScheduler } from '../scheduler';
import { getSeoReportDefinition } from '../tools/seo-report-definition';

export const buildSeoWeeklyReportPrompt = () => getSeoReportDefinition().prompt;

const DAILY_REVIEWS_PROMPT = `Quick daily local-SEO nudge for Brett (mainly PMMA).

Send Brett a short Telegram message (via \`send_telegram_message\`) reminding him to:
1. Check for and reply to any new Google reviews (especially PMMA) — a prompt, warm, personalized reply.
2. Check the Google Business Profile inbox for any new customer messages and reply.

Keep it to 2–3 sentences. This is a reminder only — you don't have access to the review data, so don't fabricate review counts or content. If there's genuinely nothing new he'll just glance and move on.`;

const MONTHLY_LOCAL_PROMPT = `Monthly Google Business Profile (GBP) + indexing checklist for Brett (mainly PMMA).

Send Brett a Telegram message (via \`send_telegram_message\`) with this month's local-SEO checklist:
1. Add 2–3 fresh, recent photos to the PMMA Google Business Profile (classes, events, students).
2. Publish at least one GBP Post (update/offer/event) this month.
3. Confirm the site's review/rating display is honest — the aggregateRating structured data must reflect real Google reviews, never inflated numbers.
4. In Google Search Console, use "Request indexing" (URL Inspection) for any important new or recently-updated pages from the past month.

Keep it as a short numbered checklist he can act on in 15 minutes.`;

/**
 * Idempotently seed missing SEO cron jobs. Existing legacy routines are preserved.
 */
export async function setupSeoCronJobs(scheduler: CronScheduler | null): Promise<void> {
  if (!scheduler) return;

  const jobs: Array<{ name: string; cron: string; prompt: string }> = [
    { name: 'seo_weekly_report', cron: '0 8 * * 1', prompt: buildSeoWeeklyReportPrompt() },
    { name: 'seo_daily_reviews', cron: '0 9 * * *', prompt: DAILY_REVIEWS_PROMPT },
    { name: 'seo_monthly_local', cron: '0 9 1 * *', prompt: MONTHLY_LOCAL_PROMPT },
  ];

  // Names do not prove source ownership. Preserve ALL existing prompts/schedules,
  // including legacy seeds; refreshing those requires an explicit user decision.
  const existing = new Set(scheduler.getAllJobs().map(job => job.name));
  for (const job of jobs) {
    if (!existing.has(job.name)) await scheduler.createJob(job.name, job.cron, job.prompt, 'desktop');
  }

  console.log(`[SEO] Scheduled cron jobs: ${jobs.map((j) => j.name).join(', ')}`);
}
