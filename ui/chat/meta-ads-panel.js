/* Ad Analyzer button — one-click read-only Meta Ads analysis.
 *
 * Mirrors seo-report-panel.js: no setup panel, no checklist. Clicking the
 * sidebar button boots the agent into a dedicated "Meta Ads Analyzer" chat
 * session (kind 'automation' so it groups with the other recipes) and fires
 * the kickoff prompt below.
 *
 * The connection itself is the `meta-ads` Connect Tools card (Pipeboard's
 * hosted Meta Ads MCP bridged via mcp-remote). The prompt self-gates: if the
 * tools aren't available it tells the user to connect Meta Ads and stops —
 * it never invents data.
 *
 * READ-ONLY BY POLICY: Meta's tool surface includes write tools
 * (create/update/pause/delete). The prompt hard-forbids calling any of them;
 * the agent only ever *recommends* changes for the user to make in Ads
 * Manager. This is layer 2 of the read-only story (layer 1 is the read-only
 * grant chosen at OAuth time, per the Connect Tools card helper text).
 */

// ---- Module state ----

let _metaAdsNotyf = null;

// ---- The kickoff prompt ----

const _META_ADS_KICKOFF_PROMPT = [
  'Analyze my Meta (Facebook/Instagram) ads and give me honest, actionable feedback.',
  '',
  'HARD RULES — read these first:',
  '- You are READ-ONLY. Never call any Meta Ads tool that creates, updates, pauses, resumes, duplicates, or deletes anything (campaigns, ad sets, ads, budgets, audiences — anything). This holds even if I ask you to make a change later in this conversation: tell me exactly what to do in Ads Manager instead.',
  '- Never invent or estimate data you did not actually retrieve. If a number is missing, say so.',
  '- When you report entity-level data (campaigns, ad sets, ads), quote the exact names AND IDs from the tool responses. If an ad set uses Dynamic Creative, say so — do not present creative variants as separate ads.',
  '',
  'Step 1 — Discover:',
  '- List my ad accounts using the Meta Ads account-listing tool.',
  '- If the Meta Ads tools are not available or the call fails, do NOT proceed: tell me plainly to open Connect Tools and enable Meta Ads (or re-authorize it), then stop.',
  '- If the response indicates my account is not enabled for the ads MCP (e.g. is_ads_mcp_enabled: false or a similar gating error), say so honestly — Meta is rolling access out in phases — and stop.',
  '- If I have more than one ad account, list them with names and IDs and ask me which one to analyze, then stop and wait. If exactly one, proceed with it.',
  '',
  'Step 2 — Pull the data:',
  '- Fetch insights for the last 30 days AND the prior 30 days (for comparison), at campaign level and ad-set level: spend, impressions, reach, frequency, CTR, CPC, CPM, conversions/results, cost per result, and ROAS where available. Include breakdowns by placement if the tools support it.',
  '- Keep it to a handful of aggregate calls — do not enumerate every ad individually.',
  '',
  'Step 3 — Analyze:',
  '- Creative fatigue: flag ad sets where frequency is climbing while CTR decays or cost per result rises period-over-period.',
  '- Spend pacing: is spend tracking sensibly against budgets, or front-loading / underdelivering?',
  '- Placement efficiency: compare cost per result / ROAS by placement and call out where money is being wasted.',
  '- Audience comparison: which ad sets / audiences are winning and which are losing, and by how much.',
  '- Anomalies: CPM spikes, sudden delivery drops, learning-phase resets, or delivery errors worth knowing about.',
  '',
  'Step 4 — Report:',
  '- Top 3 winners (what is working and why I should believe it).',
  '- Top 3 problems (what is bleeding money or fading, with the numbers).',
  '- An honest-limits note: you cannot see the actual images/video creative through these tools, so fatigue and creative calls are metrics-based only.',
  '- End with a prioritized action list — at most 5 items, ordered by impact, each one a concrete change for me to make in Ads Manager (you will not make any changes yourself).',
  '',
  'Keep the whole report skimmable on a phone.',
].join('\n');

// ---- Toast ----

function _metaAdsShowToast(message, type) {
  if (!_metaAdsNotyf) {
    _metaAdsNotyf = new Notyf({
      duration: 3000,
      position: { x: 'right', y: 'bottom' },
      dismissible: true,
      types: [
        { type: 'success', background: '#4ade80' },
        { type: 'error', background: '#f87171' },
      ],
    });
  }
  _metaAdsNotyf[type === 'error' ? 'error' : 'success'](message);
}

// ---- Start ----

/**
 * Boot the agent into the Meta Ads Analyzer recipe.
 *
 * Mirrors startSeoReport(): find-or-create a dedicated session (so we don't
 * spawn a new tab every click), switch into it, then drop the kickoff prompt
 * in the composer and send it. Awaits switchSession() so the message lands on
 * the right session after its history finishes loading.
 */
async function startMetaAdsAnalyzer() {
  const sidebarBtn = document.getElementById('sidebar-meta-ads-btn');
  if (sidebarBtn) sidebarBtn.classList.add('active');

  // No panel view of its own — drops straight into a chat. Dismiss any open
  // panel and exit sidebar panel mode so the chat is actually visible.
  // Passing a non-matching id closes them all.
  if (typeof _dismissOtherPanels === 'function') _dismissOtherPanels('meta-ads-view');
  if (window._sidebarExitPanelMode) window._sidebarExitPanelMode();

  try {
    // Find or create the "Meta Ads Analyzer" session.
    let sessionId = null;
    try {
      const list = await window.pocketAgent.sessions.list();
      const existing = (list || []).find((s) => s && s.name === 'Meta Ads Analyzer');
      if (existing) sessionId = existing.id;
    } catch (err) {
      console.warn('[MetaAds] sessions.list failed:', err);
    }

    if (!sessionId) {
      const result = await window.pocketAgent.sessions.create('Meta Ads Analyzer', 'automation');
      if (!result || !result.success || !result.session) {
        _metaAdsShowToast(result?.error || 'Failed to create session', 'error');
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
    // on the right session tab (same dance as startSeoReport).
    await new Promise((resolve) => setTimeout(resolve, 0));
    const messageInput = document.getElementById('message-input');
    if (messageInput) {
      messageInput.value = _META_ADS_KICKOFF_PROMPT;
    }
    if (typeof sendMessage === 'function') {
      await sendMessage();
    }
  } catch (err) {
    console.error('[MetaAds] startMetaAdsAnalyzer failed:', err);
    _metaAdsShowToast(err.message || 'Failed to start Ad Analyzer', 'error');
  } finally {
    if (sidebarBtn) sidebarBtn.classList.remove('active');
  }
}
