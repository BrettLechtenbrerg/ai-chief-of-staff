/**
 * SEO automation cron jobs. Modeled on src/main/birthday.ts: idempotent
 * delete-then-create on every launch so the prompts/schedules stay in sync with
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

const WEEKLY_REPORT_PROMPT = `It's the weekly SEO review for Brett's three sites (PMMA, TSAI, brettlechtenberg.com).

Call the \`fetch_seo_data\` tool with brandSlug "all" and days 28.

If the tool returns ok:false, do NOT invent data. Relay its \`message\` to Brett plainly — for example, if the Search Console permission hasn't been granted yet, tell him to open Settings → Connections → Google → Reconnect and approve the new "Search Console" permission, and that the report will start working next week once that's done. Then stop.

If the tool returns ok:true, write a tight, plain-English report. For EACH brand:
- One line on total clicks vs the previous 28 days (use clicksDeltaPct; say "no prior data" if null).
- The top 2–3 queries actually driving clicks.
- The top 3 "page-2 opportunities" (queries ranking position 11–20) — these are the best near-wins; for each, suggest the concrete tweak (strengthen the page targeting that query, improve the title/H1, add a section answering it).
- Surface any per-site \`notes\` (e.g. "no data yet" for a new property) honestly.

Then end with a single prioritized, cross-site TO-DO LIST FOR THIS WEEK — at most 5 items, ordered by impact, each naming the site and the specific action.

Keep it skimmable on a phone. Send the whole thing to Brett with the \`send_telegram_message\` tool.`;

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
 * Idempotently (re)seed the three SEO cron jobs. Safe to call on every launch.
 */
export async function setupSeoCronJobs(scheduler: CronScheduler | null): Promise<void> {
  if (!scheduler) return;

  const jobs: Array<{ name: string; cron: string; prompt: string }> = [
    { name: 'seo_weekly_report', cron: '0 8 * * 1', prompt: WEEKLY_REPORT_PROMPT },
    { name: 'seo_daily_reviews', cron: '0 9 * * *', prompt: DAILY_REVIEWS_PROMPT },
    { name: 'seo_monthly_local', cron: '0 9 1 * *', prompt: MONTHLY_LOCAL_PROMPT },
  ];

  // Delete-then-create so schedules/prompts always match this code.
  for (const job of jobs) {
    scheduler.deleteJob(job.name);
  }
  for (const job of jobs) {
    await scheduler.createJob(job.name, job.cron, job.prompt, 'desktop');
  }

  console.log(`[SEO] Scheduled cron jobs: ${jobs.map((j) => j.name).join(', ')}`);
}
