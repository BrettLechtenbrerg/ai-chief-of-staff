/* Routines Panel — embedded in chat.html */

let _rtnNotyf = null;
let _rtnSessionsMap = {};
// Cache of the most recently fetched jobs (filtered to recurring only) so
// we can re-render when the user switches Daily/Weekly/Monthly tabs without
// hitting the DB again.
let _rtnAllJobs = [];
let _rtnActiveBucket = 'daily';

// ---- Show / Hide ----

function showRoutinesPanel() {
  const chatView = document.getElementById('chat-view');
  const routinesView = document.getElementById('routines-view');
  if (!routinesView) return;

  _dismissOtherPanels('routines-view');

  chatView.classList.add('hidden');
  routinesView.classList.add('active');
  if (window._sidebarEnterPanelMode) window._sidebarEnterPanelMode();

  const sidebarBtn = document.getElementById('sidebar-routines-btn');
  if (sidebarBtn) sidebarBtn.classList.add('active');

  _rtnBindTabs();
  _rtnLoadSessions();
  _rtnLoadJobs();
}

function hideRoutinesPanel() {
  const chatView = document.getElementById('chat-view');
  const routinesView = document.getElementById('routines-view');
  if (!routinesView) return;

  routinesView.classList.remove('active');
  chatView.classList.remove('hidden');
  if (window._sidebarExitPanelMode) window._sidebarExitPanelMode();

  const sidebarBtn = document.getElementById('sidebar-routines-btn');
  if (sidebarBtn) sidebarBtn.classList.remove('active');
}

function toggleRoutinesPanel() {
  const routinesView = document.getElementById('routines-view');
  if (routinesView && routinesView.classList.contains('active')) {
    hideRoutinesPanel();
  } else {
    showRoutinesPanel();
  }
}

// ---- Toast ----

function _rtnShowToast(message, type) {
  if (!_rtnNotyf) {
    _rtnNotyf = new Notyf({
      duration: 3000, position: { x: 'right', y: 'bottom' },
      dismissible: true,
      types: [
        { type: 'success', background: '#4ade80' },
        { type: 'error', background: '#f87171' }
      ]
    });
  }
  _rtnNotyf[type === 'error' ? 'error' : 'success'](message);
}

// ---- Helpers ----

function _rtnEscapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function _rtnEscapeAttr(text) {
  return text.replace(/'/g, "\\'").replace(/"/g, '\\"');
}

// ---- Schedule Display ----

function _rtnParseDbTimestamp(timestamp) {
  if (!timestamp) return new Date();
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(timestamp)) return new Date(timestamp);
  return new Date(timestamp.replace(' ', 'T') + 'Z');
}

function _rtnScheduleToHuman(job) {
  const scheduleType = job.schedule_type || 'cron';

  if (scheduleType === 'at' && job.run_at) {
    const runAt = _rtnParseDbTimestamp(job.run_at);
    const now = new Date();
    const h = runAt.getHours(), m = runAt.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    const dh = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const timeStr = `${dh}:${m.toString().padStart(2, '0')} ${ampm}`;
    if (runAt.toDateString() === now.toDateString()) return `Today at ${timeStr}`;
    const tmrw = new Date(now); tmrw.setDate(tmrw.getDate() + 1);
    if (runAt.toDateString() === tmrw.toDateString()) return `Tomorrow at ${timeStr}`;
    return `${runAt.toLocaleDateString()} at ${timeStr}`;
  }

  if (scheduleType === 'every' && job.interval_ms) {
    const ms = job.interval_ms;
    if (ms < 60000) return `Every ${Math.round(ms / 1000)} seconds`;
    if (ms < 3600000) return `Every ${Math.round(ms / 60000)} minutes`;
    if (ms < 86400000) { const hrs = Math.round(ms / 3600000); return `Every ${hrs} hour${hrs === 1 ? '' : 's'}`; }
    const days = Math.round(ms / 86400000); return `Every ${days} day${days === 1 ? '' : 's'}`;
  }

  const cron = job.schedule;
  if (!cron) return 'Unknown schedule';
  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;
  const [minute, hour, , , dow] = parts;

  if (minute.startsWith('*/')) return `Every ${minute.slice(2)} minutes`;
  if (hour.startsWith('*/')) { const hrs = hour.slice(2); return `Every ${hrs} hour${hrs === '1' ? '' : 's'}`; }

  const h = parseInt(hour), m = parseInt(minute);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const dh = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const timeStr = `${dh}:${m.toString().padStart(2, '0')} ${ampm}`;

  if (dow === '*') return `${timeStr} daily`;
  if (dow === '1-5') return `${timeStr} weekdays`;
  if (dow === '0,6') return `${timeStr} weekends`;
  if (dow !== '*') {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return `${timeStr} on ${dow.split(',').map(d => dayNames[parseInt(d)]).join(', ')}`;
  }
  return `${timeStr} daily`;
}

// ---- Data Loading ----

async function _rtnLoadSessions() {
  try {
    const sessions = await window.pocketAgent.sessions.list();
    _rtnSessionsMap = {};
    sessions.forEach(s => { _rtnSessionsMap[s.id] = s.name; });
  } catch (err) { console.error('[Routines] Failed to load sessions:', err); }
}

// Classify a job into 'daily' | 'weekly' | 'monthly' based on its cron string
// or interval. The rules:
//   • cron with day-of-month ≠ '*'          → monthly
//   • cron with day-of-week  ≠ '*'          → weekly
//   • cron with both '*'                    → daily (incl. */N hour/minute)
//   • 'every' with interval_ms ≥ ~28d       → monthly
//   • 'every' with interval_ms ≥ ~7d        → weekly
//   • 'every' shorter / anything else       → daily (sensible default)
function _rtnBucketJob(job) {
  const scheduleType = job.schedule_type || 'cron';

  if (scheduleType === 'every' && job.interval_ms) {
    const DAY_MS = 86400000;
    if (job.interval_ms >= 28 * DAY_MS) return 'monthly';
    if (job.interval_ms >= 7 * DAY_MS) return 'weekly';
    return 'daily';
  }

  if (scheduleType === 'cron' && job.schedule) {
    const parts = job.schedule.split(' ');
    if (parts.length === 5) {
      const [, , dom, , dow] = parts;
      if (dom && dom !== '*') return 'monthly';
      if (dow && dow !== '*') return 'weekly';
      return 'daily';
    }
  }

  return 'daily';
}

function _rtnEmptyMessageForBucket(bucket) {
  if (bucket === 'weekly') return 'No weekly tasks yet';
  if (bucket === 'monthly') return 'No monthly tasks yet';
  return 'No daily tasks yet';
}

function _rtnRenderJobs() {
  const jobsList = document.getElementById('rtn-jobs-list');
  if (!jobsList) return;

  // Bucket counts — always reflect the full cached set.
  const counts = { daily: 0, weekly: 0, monthly: 0 };
  for (const job of _rtnAllJobs) counts[_rtnBucketJob(job)]++;
  for (const b of ['daily', 'weekly', 'monthly']) {
    const el = document.getElementById(`rtn-count-${b}`);
    if (el) el.textContent = String(counts[b]);
  }

  const jobs = _rtnAllJobs.filter(j => _rtnBucketJob(j) === _rtnActiveBucket);

  // Per-tab action row — "Create Task" + "Or pick a recipe" — always shown,
  // whether the tab is empty or already has tasks. Surfaces the path
  // forward consistently in Daily / Weekly / Monthly.
  const actionRow = `<div class="rtn-tab-actions">
      <button class="btn-cinamon rtn-create-btn" onclick="playNormalClick(); openRoutineEditor()">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" style="vertical-align: -2px; margin-right: 4px;"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14m7-7H5"/></svg>Create Task
      </button>
      <button onclick="playNormalClick(); showRecipesModal()">Or pick a recipe</button>
    </div>`;

  if (jobs.length === 0) {
    jobsList.innerHTML = actionRow + `<div class="rtn-empty">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l2 2"/></g></svg>
      <p>${_rtnEscapeHtml(_rtnEmptyMessageForBucket(_rtnActiveBucket))}</p>
    </div>`;
    return;
  }

  jobsList.innerHTML = actionRow + jobs.map(job => {
      const sessionName = _rtnSessionsMap[job.session_id] || job.session_id || 'Default';
      const promptDisplay = job.prompt.startsWith('[Workflow: ')
        ? '⚡ ' + _rtnEscapeHtml(job.prompt.substring(11, job.prompt.indexOf(']')))
        : _rtnEscapeHtml(job.prompt);
      return `
        <div class="rtn-job-item ${job.enabled ? '' : 'disabled'}">
          <div class="rtn-job-status"></div>
          <div class="rtn-job-info">
            <div class="rtn-job-name">${_rtnEscapeHtml(job.name)}<span class="rtn-job-session-badge">${_rtnEscapeHtml(sessionName)}</span></div>
            <div class="rtn-job-schedule">${_rtnScheduleToHuman(job)}</div>
            <div class="rtn-job-prompt">${promptDisplay}</div>
          </div>
          <div class="rtn-job-actions">
            <button class="rtn-icon-btn" onclick="playNormalClick(); rtnToggleJob('${_rtnEscapeAttr(job.name)}', ${!job.enabled})" title="${job.enabled ? 'Pause' : 'Resume'}">
              ${job.enabled
                ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.5" d="M4 7c0-1.414 0-2.121.44-2.56C4.878 4 5.585 4 7 4s2.121 0 2.56.44C10 4.878 10 5.585 10 7v10c0 1.414 0 2.121-.44 2.56C9.122 20 8.415 20 7 20s-2.121 0-2.56-.44C4 19.122 4 18.415 4 17zm10 0c0-1.414 0-2.121.44-2.56C14.878 4 15.585 4 17 4s2.121 0 2.56.44C20 4.878 20 5.585 20 7v10c0 1.414 0 2.121-.44 2.56c-.439.44-1.146.44-2.56.44s-2.121 0-2.56-.44C14 19.122 14 18.415 14 17z"/></svg>'
                : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.5" d="M18.89 12.846c-.353 1.343-2.023 2.292-5.364 4.19c-3.23 1.835-4.845 2.752-6.146 2.384a3.25 3.25 0 0 1-1.424-.841C5 17.614 5 15.743 5 12s0-5.614.956-6.579a3.25 3.25 0 0 1 1.424-.84c1.301-.37 2.916.548 6.146 2.383c3.34 1.898 5.011 2.847 5.365 4.19a3.3 3.3 0 0 1 0 1.692Z"/></svg>'
              }
            </button>
            <button class="rtn-icon-btn" onclick="playNormalClick(); rtnRunJob('${_rtnEscapeAttr(job.name)}')" title="Test run">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.5" d="M8.628 12.674H8.17c-1.484 0-2.225 0-2.542-.49c-.316-.489-.015-1.17.588-2.533l1.812-4.098c.548-1.239.822-1.859 1.353-2.206S10.586 3 11.935 3h2.09c1.638 0 2.458 0 2.767.535c.309.536-.098 1.25-.91 2.681l-1.073 1.886c-.404.711-.606 1.066-.603 1.358c.003.378.205.726.53.917c.25.147.657.147 1.471.147c1.03 0 1.545 0 1.813.178c.349.232.531.646.467 1.061c-.049.32-.395.703-1.088 1.469l-5.535 6.12c-1.087 1.203-1.63 1.804-1.996 1.613c-.365-.19-.19-.983.16-2.569l.688-3.106c.267-1.208.4-1.812.08-2.214c-.322-.402-.937-.402-2.168-.402Z"/></svg>
            </button>
            <button class="rtn-icon-btn danger" onclick="playNormalClick(); rtnDeleteJob('${_rtnEscapeAttr(job.name)}')" title="Delete">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5" d="m19.5 5.5l-.62 10.025c-.158 2.561-.237 3.842-.88 4.763a4 4 0 0 1-1.2 1.128c-.957.584-2.24.584-4.806.584c-2.57 0-3.855 0-4.814-.585a4 4 0 0 1-1.2-1.13c-.642-.922-.72-2.205-.874-4.77L4.5 5.5M3 5.5h18m-4.944 0l-.683-1.408c-.453-.936-.68-1.403-1.071-1.695a2 2 0 0 0-.275-.172C13.594 2 13.074 2 12.035 2c-1.066 0-1.599 0-2.04.234a2 2 0 0 0-.278.18c-.395.303-.616.788-1.058 1.757L8.053 5.5"/></svg>
            </button>
          </div>
        </div>`;
  }).join('');
}

async function _rtnLoadJobs() {
  const jobsList = document.getElementById('rtn-jobs-list');
  if (!jobsList) return;

  try {
    const allJobs = await window.pocketAgent.cron.list();
    // 'at' jobs are one-shot reminders — not recurring routines, so they
    // don't belong on any cadence tab.
    _rtnAllJobs = allJobs.filter(job => (job.schedule_type || 'cron') !== 'at');
    _rtnRenderJobs();
  } catch (err) {
    jobsList.innerHTML = `<div class="rtn-empty"><p>Error: ${_rtnEscapeHtml(err.message)}</p></div>`;
  }
}

// Wire up the cadence tab buttons. Called once on first show.
let _rtnTabsBound = false;
function _rtnBindTabs() {
  if (_rtnTabsBound) return;
  const tabs = document.querySelectorAll('#routines-view .rtn-tab');
  if (!tabs.length) return;
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      playNormalClick();
      const bucket = btn.dataset.rtnTab;
      if (!bucket || bucket === _rtnActiveBucket) return;
      _rtnActiveBucket = bucket;
      tabs.forEach(b => {
        const isActive = b.dataset.rtnTab === bucket;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      _rtnRenderJobs();
    });
  });
  _rtnTabsBound = true;
}

// ---- Actions (global for onclick) ----

async function rtnToggleJob(name, enabled) {
  try {
    await window.pocketAgent.cron.toggle(name, enabled);
    _rtnShowToast(enabled ? 'Back at it!' : 'Taking a break', 'success');
    _rtnLoadJobs();
  } catch (err) { _rtnShowToast(err.message, 'error'); }
}

async function rtnRunJob(name) {
  _rtnShowToast('On it!', 'success');
  try { await window.pocketAgent.cron.run(name); }
  catch (err) { _rtnShowToast(err.message, 'error'); }
}

async function rtnDeleteJob(name) {
  if (!confirm(`Delete "${name}"?`)) return;
  try {
    await window.pocketAgent.cron.delete(name);
    _rtnShowToast('Poof! Gone.', 'success');
    _rtnLoadJobs();
  } catch (err) { _rtnShowToast(err.message, 'error'); }
}

// ============================================================================
// Routine Recipes — ready-made templates with copy-to-clipboard.
//
// Each recipe describes one common routine your AI Chief of Staff can run
// for you. Recipes are intentionally generic — clients tweak the wording,
// schedule, and channel after copying. Cron schedules follow the 5-field
// node-cron format: "minute hour day-of-month month day-of-week".
// Times are local. Update channel to 'email' or 'telegram' if preferred.
// ============================================================================

const ROUTINE_RECIPES = [
  {
    icon: '☀️',
    title: 'Daily Morning Briefing',
    suggestedTime: 'Every weekday at 6:00 AM',
    cron: '0 6 * * 1-5',
    channel: 'desktop',
    summary: 'Wake up to your priorities, calendar, and weather in one shot.',
    prompt:
`Give me my morning briefing.

1. What's on my calendar today? Flag any tight back-to-back meetings or unusual events.
2. What 3 things should I prioritize today, based on my goals and what I've been working on?
3. Any unread emails in the last 12 hours that look urgent or time-sensitive?
4. Weather for my home location.

Keep it under 200 words. Bullets are fine. Use my name.`
  },
  {
    icon: '📧',
    title: 'Email Triage with Draft Replies',
    suggestedTime: 'Every weekday at 8:00 AM and 1:00 PM',
    cron: '0 8,13 * * 1-5',
    channel: 'desktop',
    summary: 'Scan unread inbox, categorize what matters, and pre-draft replies in your voice.',
    prompt:
`Check my unread Gmail inbox.

1. Group messages into: urgent (needs reply today), important (this week), FYI (no action), and noise (newsletters, receipts).
2. For each urgent + important email, draft a reply in my voice based on my writing rules. Save the drafts to Gmail so I can review and send.
3. List the urgent emails by subject + sender + the one-line gist of my drafted reply.

Don't send anything — drafts only.`
  },
  {
    icon: '📅',
    title: 'Calendar Conflict & Gap Check',
    suggestedTime: 'Every Sunday at 6:00 PM',
    cron: '0 18 * * 0',
    channel: 'desktop',
    summary: 'Find overlaps, gaps, and meetings that need prep before the week starts.',
    prompt:
`Look at my calendar for the coming week (Monday through Friday).

1. Any back-to-back meetings with less than 15 min between them? Flag them.
2. Any double-bookings or overlaps? List them.
3. Which meetings have no agenda or unclear purpose in the description?
4. Which meetings probably need prep from me? Why?
5. Suggest 2-3 specific things I should block focus time for.`
  },
  {
    icon: '📊',
    title: 'Friday End-of-Week Review',
    suggestedTime: 'Every Friday at 4:30 PM',
    cron: '30 16 * * 5',
    channel: 'desktop',
    summary: 'Recap what got done, what slipped, and what to carry into next week.',
    prompt:
`It's Friday afternoon. Review this week.

1. Based on my calendar + the conversations we've had, what did I actually accomplish this week? Be specific.
2. What did I say I'd do but didn't? Carry these forward.
3. Any wins worth celebrating?
4. Three things to focus on next week, given my current goals.

Tone: honest, friendly, no hype.`
  },
  {
    icon: '🔔',
    title: 'Daily Hydration & Movement Nudge',
    suggestedTime: 'Every 2 hours from 9 AM to 5 PM, weekdays',
    cron: '0 9,11,13,15,17 * * 1-5',
    channel: 'desktop',
    summary: 'A short, kind reminder to drink water and stand up.',
    prompt:
`Send me a short, friendly nudge — one sentence — to drink water and stand up for 60 seconds. Vary the wording each time. No emojis if it'd feel forced.`
  },
  {
    icon: '📰',
    title: 'Weekly Industry Scan',
    suggestedTime: 'Every Monday at 7:00 AM',
    cron: '0 7 * * 1',
    channel: 'desktop',
    summary: 'Surface the 3-5 stories actually worth my attention from my industry.',
    prompt:
`Search the web for the most relevant news from the past 7 days in my industry (AI, business automation, coaching, SMB consulting — adjust based on what I do).

Return the top 3 to 5 stories. For each:
- One-line headline
- Why it matters to me specifically (1 sentence — connect it to my business or goals)
- Source link

Skip fluff, hype pieces, and press releases. Real signal only.`
  },
  {
    icon: '💰',
    title: 'Monthly Money Check-In',
    suggestedTime: '1st of every month at 9:00 AM',
    cron: '0 9 1 * *',
    channel: 'desktop',
    summary: 'Remind me to check the metrics that actually matter, with specific prompts.',
    prompt:
`It's the first of the month. Send me a short, specific check-in:

1. "Did you review last month's revenue, expenses, and profit?"
2. "Did you check accounts receivable / outstanding invoices?"
3. "What's one financial decision you've been putting off?"
4. "What did last month teach you about the business?"

Keep it to 4 short questions. No fluff.`
  },
  {
    icon: '🎂',
    title: 'Birthday & Anniversary Reminders',
    suggestedTime: 'Every day at 8:00 AM',
    cron: '0 8 * * *',
    channel: 'desktop',
    summary: 'Never miss an important date for people you care about.',
    prompt:
`Check what you remember about important people in my life. Are any birthdays, anniversaries, or other significant dates happening today or in the next 3 days?

If yes:
- List who and what.
- Suggest one specific, thoughtful gesture for each (a text, a call, a small gift idea).

If no important dates are coming up, send nothing.`
  }
];

function _renderRecipes() {
  const list = document.getElementById('recipes-list');
  if (!list) return;
  list.innerHTML = '';
  for (const [i, recipe] of ROUTINE_RECIPES.entries()) {
    const card = document.createElement('div');
    card.className = 'recipe-card';
    card.innerHTML = `
      <div class="recipe-head">
        <span class="recipe-icon" aria-hidden="true">${recipe.icon}</span>
        <div class="recipe-titleblock">
          <h3>${recipe.title}</h3>
          <p class="recipe-summary">${recipe.summary}</p>
        </div>
      </div>
      <div class="recipe-meta">
        <span><strong>When:</strong> ${recipe.suggestedTime}</span>
        <span><strong>Cron:</strong> <code>${recipe.cron}</code></span>
        <span><strong>Channel:</strong> ${recipe.channel}</span>
      </div>
      <details class="recipe-promptbox">
        <summary>Show prompt</summary>
        <pre class="recipe-prompt-text">${_escapeHtml(recipe.prompt)}</pre>
      </details>
      <div class="recipe-actions">
        <button class="recipe-copy" data-recipe-index="${i}">Copy prompt</button>
      </div>
    `;
    list.appendChild(card);
  }

  list.querySelectorAll('.recipe-copy').forEach((btn) => {
    btn.addEventListener('click', () => {
      playNormalClick();
      const idx = parseInt(btn.dataset.recipeIndex, 10);
      const recipe = ROUTINE_RECIPES[idx];
      if (!recipe) return;
      navigator.clipboard.writeText(recipe.prompt).then(() => {
        _rtnShowToast(`Copied: ${recipe.title}`, 'success');
        btn.textContent = '✓ Copied';
        setTimeout(() => { btn.textContent = 'Copy prompt'; }, 1800);
      }).catch(() => {
        _rtnShowToast("Couldn't copy — select the text manually", 'error');
      });
    });
  });
}

function _escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

let _recipesRendered = false;
function showRecipesModal() {
  if (!_recipesRendered) {
    _renderRecipes();
    _recipesRendered = true;
  }
  // Upstream modal-overlay CSS uses .show as the visibility toggle
  // (see ui/chat/overlays.css). 'active' was the wrong class name.
  const m = document.getElementById('recipes-modal');
  if (m) m.classList.add('show');
}

function hideRecipesModal() {
  const m = document.getElementById('recipes-modal');
  if (m) m.classList.remove('show');
}

function openRoutineEditorFromRecipes() {
  // Closes the modal and opens the existing routine editor window so the
  // user can paste the recipe prompt they just copied.
  hideRecipesModal();
  openRoutineEditor();
}

// Opens the cron / routine editor window. Used by:
//   • the primary "Create Task" button in the Scheduled Tasks panel header
//   • the "Open Task Editor" footer button in the Recipes modal
function openRoutineEditor() {
  try {
    window.pocketAgent.app.openRoutines();
  } catch (err) {
    console.error('[Routines] openRoutines failed:', err);
  }
}
