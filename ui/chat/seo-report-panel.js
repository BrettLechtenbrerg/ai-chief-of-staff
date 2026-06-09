/* SEO Report button — one-click weekly SEO report.
 *
 * Unlike the Content Writer (which has a setup-card panel + an approve/spin
 * flow), the SEO report is a single shot: clicking the sidebar button boots the
 * agent into a dedicated "SEO Report" chat session and fires the kickoff prompt,
 * which calls the `fetch_seo_data` tool and writes a plain-English report.
 *
 * There is intentionally NO setup panel here — the `fetch_seo_data` tool
 * self-gates on Google/Search Console access and returns a clear, actionable
 * message when something isn't connected, so there's nothing for a checklist to
 * babysit. This keeps the button dead simple.
 *
 * The kickoff prompt is kept in sync with the weekly cron prompt in
 * src/main/seo-crons.ts (WEEKLY_REPORT_PROMPT) so the manual button and the
 * Monday automation produce the same report.
 */

// ---- Module state ----

let _seoNotyf = null;

// ---- The kickoff prompt — mirrors src/main/seo-crons.ts WEEKLY_REPORT_PROMPT ----

const _SEO_KICKOFF_PROMPT = [
  "It's the weekly SEO review for my three sites (PMMA, TSAI, brettlechtenberg.com).",
  '',
  'Call the `fetch_seo_data` tool with brandSlug "all" and days 28.',
  '',
  'If the tool returns ok:false, do NOT invent data. Relay its `message` to me plainly — for example, if Google or the Search Console permission isn\u2019t connected yet, tell me exactly what to do to fix it. Then stop.',
  '',
  'If the tool returns ok:true, write a tight, plain-English report. For EACH brand:',
  '- One line on total clicks vs the previous 28 days (use clicksDeltaPct; say "no prior data" if null).',
  '- The top 2\u20133 queries actually driving clicks.',
  '- The top 3 "page-2 opportunities" (queries ranking position 11\u201320) \u2014 these are the best near-wins; for each, suggest the concrete tweak (strengthen the page targeting that query, improve the title/H1, add a section answering it).',
  '- Surface any per-site `notes` (e.g. "no data yet" for a new property) honestly.',
  '',
  'Then end with a single prioritized, cross-site TO-DO LIST FOR THIS WEEK \u2014 at most 5 items, ordered by impact, each naming the site and the specific action.',
  '',
  'Keep it skimmable on a phone.',
].join('\n');

// ---- Toast ----

function _seoShowToast(message, type) {
  if (!_seoNotyf) {
    _seoNotyf = new Notyf({
      duration: 3000,
      position: { x: 'right', y: 'bottom' },
      dismissible: true,
      types: [
        { type: 'success', background: '#4ade80' },
        { type: 'error', background: '#f87171' },
      ],
    });
  }
  _seoNotyf[type === 'error' ? 'error' : 'success'](message);
}

// ---- Start ----

/**
 * Boot the agent into the SEO Report recipe.
 *
 * Mirrors startContentWriter(): find-or-create a dedicated session (so we don't
 * spawn a new tab every click), switch into it, then drop the kickoff prompt in
 * the composer and send it. Awaits switchSession() so the message lands on the
 * right session after its history finishes loading.
 */
async function startSeoReport() {
  const sidebarBtn = document.getElementById('sidebar-seo-report-btn');
  if (sidebarBtn) sidebarBtn.classList.add('active');

  // This button has no panel view of its own — it drops straight into a chat.
  // If the user clicked it while another panel (Content Writer, Connect Tools,
  // Settings, …) was open, that panel would cover the chat and the report would
  // fire invisibly behind it. Dismiss any open panel and exit sidebar panel mode
  // so the chat is actually visible. Passing a non-matching id closes them all.
  if (typeof _dismissOtherPanels === 'function') _dismissOtherPanels('seo-report-view');
  if (window._sidebarExitPanelMode) window._sidebarExitPanelMode();

  try {
    // Find or create the "SEO Report" session.
    let sessionId = null;
    try {
      const list = await window.pocketAgent.sessions.list();
      const existing = (list || []).find((s) => s && s.name === 'SEO Report');
      if (existing) sessionId = existing.id;
    } catch (err) {
      console.warn('[SEO] sessions.list failed:', err);
    }

    if (!sessionId) {
      const result = await window.pocketAgent.sessions.create('SEO Report', 'automation');
      if (!result || !result.success || !result.session) {
        _seoShowToast(result?.error || 'Failed to create session', 'error');
        return;
      }
      // Mirror createNewSession() so the new tab shows up in the sidebar.
      if (typeof sessions !== 'undefined' && Array.isArray(sessions)) {
        sessions.push(result.session);
      }
      sessionId = result.session.id;
    }

    // Switch to the chat session.
    if (typeof switchSession === 'function') {
      await switchSession(sessionId);
    } else if (typeof currentSessionId !== 'undefined') {
      currentSessionId = sessionId;
    }
    if (typeof renderTabs === 'function') renderTabs();

    // Drop the kickoff prompt into the composer and fire it. The microtask gap
    // lets switchSession's DOM mutations settle so sendMessage reads input.value
    // on the right session tab (same dance as startContentWriter).
    await new Promise((resolve) => setTimeout(resolve, 0));
    const messageInput = document.getElementById('message-input');
    if (messageInput) {
      messageInput.value = _SEO_KICKOFF_PROMPT;
    }
    if (typeof sendMessage === 'function') {
      await sendMessage();
    }
  } catch (err) {
    console.error('[SEO] startSeoReport failed:', err);
    _seoShowToast(err.message || 'Failed to start SEO Report', 'error');
  } finally {
    if (sidebarBtn) sidebarBtn.classList.remove('active');
  }
}
