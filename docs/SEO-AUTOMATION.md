# SEO Automation

ACOS pulls real **Google Search Console** data for Brett's three sites on a
schedule, has the agent analyze it, and delivers a plain-English
"what's working / what to fix this week" report to Telegram + desktop — plus two
human-only reminder crons for the parts a machine shouldn't do.

Sites covered (read from `~/dev/_brand-profiles/*/profile.json`):

| Slug    | Brand                          | Site                                |
| ------- | ------------------------------ | ----------------------------------- |
| `pmma`  | Personal Mastery Martial Arts  | www.personalmasterymartialarts.com  |
| `tsai`  | Total Success AI               | www.totalsuccessai.com              |
| `brett` | Brett Lechtenberg (personal)   | www.brettlechtenberg.com            |

Add a fourth brand later by dropping a `profile.json` with a `site.url` into
`~/dev/_brand-profiles/<folder>/` and mapping its slug in
`src/tools/seo-report.ts` (`BRAND_SLUG_TO_FOLDER`). No other code change needed.

## The three cron jobs

| Job                 | Schedule       | What it does                                                                                   |
| ------------------- | -------------- | --------------------------------------------------------------------------------------------- |
| `seo_weekly_report` | Mon 08:00      | Calls `fetch_seo_data` for all brands (28-day window). Agent writes per-site summary (clicks vs last week, top queries, top 3 page-2 opportunities) + a prioritized cross-site to-do list, and sends it via Telegram. |
| `seo_daily_reviews` | Daily 09:00    | Short nudge to reply to new Google reviews + Google Business Profile messages (PMMA-focused). Reminder only. |
| `seo_monthly_local` | 1st of month 09:00 | Monthly GBP checklist: fresh photos, a GBP post, confirm the on-site rating display is honest, request indexing for new pages. |

All three are seeded idempotently on every app launch by
`setupSeoCronJobs()` (`src/main/seo-crons.ts`), routed to the `desktop` channel
(which also fans out to Telegram when a chat is linked).

## One-time setup: approve the Search Console permission

The weekly report needs the **`webmasters.readonly`** Google scope, which was
added after Google was first connected. Until Brett re-consents, the weekly cron
sends a reminder instead of a report (nothing breaks).

To enable real data:

1. Open ACOS → **Settings → Connections → Google → Reconnect**.
2. In the Google consent screen, approve the new **Search Console** (read-only)
   permission.

That's it. The next `seo_weekly_report` run (or a manual run — see below) will
pull live data.

### Account-match requirement

ACOS must be connected as the **same Google account that owns the Search Console
properties** (`personalmastery1@gmail.com`). If a different account is connected,
the tool surfaces Google's `403` per site as: *"this Google account can't read
this property — connect the account that owns it, or add the connected account
as a user on the property."* Fix by either reconnecting the owning account, or
adding the connected account as a user on each property in Search Console.

## How it degrades before data exists (first ~2–4 weeks)

The tool never crashes the cron. It returns a friendly status instead:

- **Google not connected** → "connect Google" message.
- **Scope not granted** → "reconnect and approve Search Console (read-only)".
- **New property, no rows yet** → per-site `notes`: "no data yet (property may be
  new) — check back in a couple of weeks."

Search Console data also lags ~2–3 days, so the query window ends 3 days back to
avoid a tail of guaranteed-empty days.

## Manual trigger

Just ask the agent in chat:

> run my SEO report

It calls `fetch_seo_data` and writes the same report on demand. Pre-consent it
returns the reconnect message; post-consent it returns real (sparse-at-first)
data.

You can scope it: *"run my SEO report for PMMA over the last 14 days"* maps to
`fetch_seo_data({ brandSlug: "pmma", days: 14 })`.

## Editing / toggling the jobs

The jobs appear in the **Scheduled Tasks** panel as `seo_weekly_report`,
`seo_daily_reviews`, and `seo_monthly_local`. You can disable or run-now any of
them there. Note: because the jobs are **re-seeded (delete-then-create) on every
launch**, edits to their schedule/prompt made in the UI are overwritten on the
next start. To change a schedule or prompt permanently, edit
`src/main/seo-crons.ts` and rebuild.

## What the tool does and doesn't do

- **Read-only.** Only the two Search Console `searchAnalytics/query` endpoints
  are called. The tool never writes to Google or to the live sites, and the site
  list is restricted to the known brand profiles (the model cannot pass an
  arbitrary site URL). No tokens or secrets are logged.
- The agent **reports and recommends**; it does not auto-edit site code or
  auto-create tasks from findings.

## Build / deploy note

ACOS is a desktop Electron app — this is **not** auto-deployed like the websites.
After merging, rebuild ACOS to pick up the new tool + crons:

- `npm run dev` — run locally to test.
- `npm run dist:local` — produce a packaged build.

## Out of scope (Phase 2 candidates)

- GA4 Analytics Data API (its own scope) — Search Console is the higher-value
  first cut.
- Auto-creating tasks or auto-editing site code from findings.
- A bespoke SEO dashboard UI — the Telegram/desktop report is the deliverable.
