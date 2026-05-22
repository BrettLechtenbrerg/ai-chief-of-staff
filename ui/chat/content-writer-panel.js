/* Content Writer Panel — embedded in chat.html
 *
 * Three-card setup checklist + one Start button that boots the agent into
 * the "Content Writer" recipe for a new chat session.
 *
 * Pattern mirrors routines-panel.js / personalize-panel.js — module-scope
 * state, helper funcs, named entry points called from sidebar bindings and
 * inline onclick attributes in chat.html.
 */

// ---- Module state ----

let _cwInitialized = false;
let _cwNotyf = null;
// Snapshot of card states. Recomputed by _cwLoadState() on show and after
// every Save. Drives badge rendering, the Start button's disabled bit, and
// whether each card is expanded by default.
const _cwState = {
  openai: 'missing',      // 'ok' | 'missing' | 'invalid'
  dataforseo: 'missing',  // 'ok' | 'missing' | 'invalid'
  brandbook: 'missing',   // 'ok' | 'missing'
};

// Track which cards the user has manually expanded so re-rendering after a
// save doesn't snap an in-progress card closed underneath them.
const _cwExpanded = {
  openai: false,
  dataforseo: false,
  brandbook: false,
};

// ---- The kickoff prompt — the actual recipe ---------------------------
//
// Sent verbatim to the agent when the user clicks Start. The agent reads
// this as a single user turn and follows the steps. Hard rules at the
// bottom keep it from publishing externally or skipping the brand book.

const _CW_KICKOFF_PROMPT = [
  'You are running the Content Writer routine for me. Follow each step in order. If any step fails, tell me what went wrong and stop — don\u2019t push or write anything broken to disk.',
  '',
  'Step 1 — Read my brand book.',
  'Use the Brand & Style + Writing Rules in your system prompt context (already injected from my Knowledge Base settings). Confirm in one sentence what brand you\u2019re writing for (e.g. "Writing for [their business] — voice is [tone descriptor]").',
  '',
  'Step 2 — Find a topic worth writing about.',
  'Use the DataForSEO MCP server to research keyword ideas in my niche. Pull the brand niche from "About My Business" in my Knowledge Base. Aim for: search volume \u2265 50/mo, keyword difficulty \u2264 30, commercial or informational intent. Tell me 3 candidate topics with their volume + KD; pick the strongest one yourself unless I object.',
  '',
  'Step 3 — Research the SERP angle.',
  'For the chosen keyword, use web_fetch on the top 3 SERP results. Read what they cover. Choose an angle that brings my brand\u2019s perspective per the Writing Rules (don\u2019t copy what\u2019s already ranking — bring something they don\u2019t).',
  '',
  'Step 4 — Verify any facts you\u2019ll cite.',
  'For each citable claim you plan to use, web_fetch the source URL and confirm it says what you\u2019re claiming. Drop any claim you cannot verify live.',
  '',
  'Step 5 — Create the output folder.',
  'Use shell_command to run: mkdir -p "$HOME/Desktop/Blogs/$(date +%Y-%m-%d)-<post-slug>"',
  'where <post-slug> is a short kebab-case version of the title.',
  '',
  'Step 6 — Generate the hero image.',
  'Call generate_blog_image with:',
  '  prompt: a vivid 1\u20132 sentence subject description (the tool prepends the style preamble; don\u2019t include "photo-realistic" in your prompt)',
  '  style: \'photo-realistic\' (default — testers can ask you to switch to editorial-illustration if they prefer)',
  '  outputPath: $HOME/Desktop/Blogs/YYYY-MM-DD-slug/hero.png',
  '  generateSquare: false',
  '',
  'Step 7 — Write the article.',
  '800\u20131200 words. Follow my Brand & Style + Writing Rules exactly. Include a clear title, meta description (150\u2013160 chars), 3\u20135 H2 sections, and a closing CTA appropriate to my business.',
  '',
  'Step 8 — Post it inline in this chat for review.',
  'Show me the full article rendered as markdown (title as H1, body with section headings, etc.) followed by the hero image as a markdown image reference (`![hero](file:///$HOME/Desktop/Blogs/YYYY-MM-DD-slug/hero.png)`). Then ask me: "Want any changes, or are we good to publish?"',
  '',
  'Step 9 — Iterate or publish.',
  '- If I ask for changes: edit in chat, regenerate the image if I want, repost. Loop until I\u2019m happy.',
  '- If I say "publish" / "looks good" / "ship it" / similar approval: use the write tool to save the final article as $HOME/Desktop/Blogs/YYYY-MM-DD-slug/blog-post.md, then confirm with: "Done. Your article is in ~/Desktop/Blogs/YYYY-MM-DD-slug/. Paste blog-post.md into your blog editor and upload hero.png as the featured image."',
  '',
  'Hard rules:',
  '- NEVER post the article to any external service (no GHL, no WordPress, no GitHub). Output goes to ~/Desktop/Blogs/ only.',
  '- NEVER skip my Brand & Style + Writing Rules. They override any default voice.',
  '- If DataForSEO isn\u2019t reachable, tell me and stop. Don\u2019t make up keyword stats.',
  '- If the brand book is empty, tell me "Add your brand book in Content Writer first" and stop.',
  '',
  'Begin with Step 1 now.',
].join('\n');

// ---- Show / Hide ----

function showContentWriterPanel() {
  const chatView = document.getElementById('chat-view');
  const cwView = document.getElementById('content-writer-view');
  if (!cwView) return;

  _dismissOtherPanels('content-writer-view');

  if (chatView) chatView.classList.add('hidden');
  cwView.classList.add('active');
  if (window._sidebarEnterPanelMode) window._sidebarEnterPanelMode();

  const sidebarBtn = document.getElementById('sidebar-content-writer-btn');
  if (sidebarBtn) sidebarBtn.classList.add('active');

  if (!_cwInitialized) {
    _cwInitialized = true;
  }

  // Re-fetch state every time the panel opens — settings may have been
  // changed elsewhere (Personalize panel, Settings panel) since the user
  // last saw this view.
  _cwLoadState().then(() => _cwRender());
}

function hideContentWriterPanel() {
  const chatView = document.getElementById('chat-view');
  const cwView = document.getElementById('content-writer-view');
  if (!cwView) return;

  cwView.classList.remove('active');
  if (chatView) chatView.classList.remove('hidden');
  if (window._sidebarExitPanelMode) window._sidebarExitPanelMode();

  const sidebarBtn = document.getElementById('sidebar-content-writer-btn');
  if (sidebarBtn) sidebarBtn.classList.remove('active');
}

function toggleContentWriterPanel() {
  const cwView = document.getElementById('content-writer-view');
  if (cwView && cwView.classList.contains('active')) {
    hideContentWriterPanel();
  } else {
    showContentWriterPanel();
  }
}

// ---- Toast ----

function _cwShowToast(message, type) {
  if (!_cwNotyf) {
    _cwNotyf = new Notyf({
      duration: 3000,
      position: { x: 'right', y: 'bottom' },
      dismissible: true,
      types: [
        { type: 'success', background: '#4ade80' },
        { type: 'error', background: '#f87171' },
      ],
    });
  }
  _cwNotyf[type === 'error' ? 'error' : 'success'](message);
}

// ---- State loading ----

/**
 * Read current OpenAI key, brand-book fields, and MCP connection list to
 * decide which cards are ✓ vs ⚠. Having a key counts as ✓ for OpenAI —
 * we don't re-validate online unless the user explicitly Tests, matching
 * how Settings → LLM treats it.
 */
async function _cwLoadState() {
  // OpenAI
  try {
    const key = await window.pocketAgent.settings.get('openai.apiKey');
    _cwState.openai = key && String(key).trim().length > 0 ? 'ok' : 'missing';
  } catch (err) {
    console.warn('[CW] Failed to read openai.apiKey:', err);
    _cwState.openai = 'missing';
  }

  // Brand book — both fields required for ✓
  try {
    const brandStyle = await window.pocketAgent.settings.get('personalize.brandStyle');
    const writingRules = await window.pocketAgent.settings.get('personalize.writingRules');
    const bsOk = brandStyle && String(brandStyle).trim().length > 0;
    const wrOk = writingRules && String(writingRules).trim().length > 0;
    _cwState.brandbook = bsOk && wrOk ? 'ok' : 'missing';
  } catch (err) {
    console.warn('[CW] Failed to read brand book settings:', err);
    _cwState.brandbook = 'missing';
  }

  // DataForSEO — connection exists in mcp-servers.json
  try {
    const { servers } = await window.pocketAgent.connections.list();
    const found = (servers || []).find((s) => s.name === 'dataforseo');
    _cwState.dataforseo = found ? 'ok' : 'missing';
  } catch (err) {
    console.warn('[CW] Failed to list MCP connections:', err);
    _cwState.dataforseo = 'missing';
  }
}

// ---- Rendering ----

function _cwRender() {
  _cwRenderCard('openai', {
    okStatus: 'Connected',
    missingStatus: 'Needed for images and writing',
    setupLabel: 'Set up OpenAI \u2192',
    okLabel: 'Edit',
  });
  _cwRenderCard('dataforseo', {
    okStatus: 'Connected',
    missingStatus: 'Needed for keyword research',
    setupLabel: 'Set up DataForSEO \u2192',
    okLabel: 'Edit',
  });
  _cwRenderCard('brandbook', {
    okStatus: 'Saved',
    missingStatus: 'So I write in your voice, not mine',
    setupLabel: 'Add brand book \u2192',
    okLabel: 'Edit',
  });

  // Populate the brand book textareas with their current saved values
  // (so re-opening Edit shows what they already have).
  _cwPopulateBrandBookInputs();

  // Start button gating
  const startBtn = document.getElementById('cw-start-btn');
  const hint = document.getElementById('cw-actions-hint');
  const allOk = _cwState.openai === 'ok' && _cwState.dataforseo === 'ok' && _cwState.brandbook === 'ok';
  if (startBtn) startBtn.disabled = !allOk;
  if (hint) {
    hint.textContent = allOk
      ? 'Ready when you are.'
      : 'Complete the three steps above to unlock.';
  }
}

function _cwRenderCard(key, labels) {
  const card = document.querySelector(`#content-writer-view .cw-card[data-card="${key}"]`);
  if (!card) return;
  const state = _cwState[key];
  card.setAttribute('data-state', state);

  const badge = document.getElementById(`cw-badge-${key}`);
  if (badge) badge.textContent = state === 'ok' ? '\u2713' : '\u26a0';

  const status = document.getElementById(`cw-status-${key}`);
  if (status) status.textContent = state === 'ok' ? labels.okStatus : labels.missingStatus;

  const toggle = document.getElementById(`cw-toggle-${key}`);
  if (toggle) toggle.textContent = state === 'ok' ? labels.okLabel : labels.setupLabel;

  // Auto-collapse if ✓ and user didn't manually expand; auto-expand if
  // missing/invalid so they see what to do without clicking.
  const shouldBeOpen = _cwExpanded[key] || state !== 'ok';
  if (shouldBeOpen) {
    card.classList.add('expanded');
  } else {
    card.classList.remove('expanded');
  }
}

function _cwPopulateBrandBookInputs() {
  // Pull current saved values into the textareas if the inputs are empty
  // (don't overwrite work in progress).
  (async () => {
    try {
      const bs = await window.pocketAgent.settings.get('personalize.brandStyle');
      const wr = await window.pocketAgent.settings.get('personalize.writingRules');
      const bsEl = document.getElementById('cw-input-brand-style');
      const wrEl = document.getElementById('cw-input-writing-rules');
      if (bsEl && !bsEl.value) bsEl.value = bs || '';
      if (wrEl && !wrEl.value) wrEl.value = wr || '';
    } catch (err) {
      console.warn('[CW] Failed to populate brand book inputs:', err);
    }
  })();
}

// ---- Card toggle (chevron-style) ----

function _cwToggleCard(key) {
  _cwExpanded[key] = !_cwExpanded[key];
  const card = document.querySelector(`#content-writer-view .cw-card[data-card="${key}"]`);
  if (!card) return;
  // When the card is in ✓ state and the user collapses it, honor that;
  // when in ⚠ state we keep it open regardless of _cwExpanded.
  const state = _cwState[key];
  const shouldBeOpen = _cwExpanded[key] || state !== 'ok';
  if (shouldBeOpen) {
    card.classList.add('expanded');
  } else {
    card.classList.remove('expanded');
  }
}

// ---- External links ----

function _cwOpenExternal(url) {
  try {
    window.pocketAgent.app.openExternal(url);
  } catch (err) {
    console.warn('[CW] openExternal failed:', err);
  }
}

// ---- Save handlers ----

function _cwSetMessage(key, message, kind) {
  const el = document.getElementById(`cw-msg-${key}`);
  if (!el) return;
  el.textContent = message || '';
  el.classList.remove('ok', 'err');
  if (kind === 'ok') el.classList.add('ok');
  if (kind === 'err') el.classList.add('err');
}

function _cwBusy(buttonId, busy, busyLabel) {
  const btn = document.getElementById(buttonId);
  if (!btn) return;
  if (busy) {
    btn.dataset.originalLabel = btn.textContent;
    btn.textContent = busyLabel || 'Testing\u2026';
    btn.disabled = true;
  } else {
    if (btn.dataset.originalLabel) btn.textContent = btn.dataset.originalLabel;
    btn.disabled = false;
  }
}

async function _cwSaveOpenAI() {
  const input = document.getElementById('cw-input-openai');
  const key = input ? input.value.trim() : '';
  if (!key) {
    _cwSetMessage('openai', 'Paste your OpenAI key first.', 'err');
    return;
  }
  _cwSetMessage('openai', '', null);
  _cwBusy('cw-save-openai', true, 'Testing\u2026');
  try {
    const result = await window.pocketAgent.validate.openAIKey(key);
    if (!result.valid) {
      _cwSetMessage('openai', result.error || 'Invalid key.', 'err');
      _cwShowToast('OpenAI key didn\u2019t validate', 'error');
      return;
    }
    await window.pocketAgent.settings.set('openai.apiKey', key);
    _cwSetMessage('openai', 'Saved \u2014 connected.', 'ok');
    _cwShowToast('OpenAI key saved', 'success');
    if (input) input.value = '';
    _cwExpanded.openai = false;
    await _cwLoadState();
    _cwRender();
  } catch (err) {
    _cwSetMessage('openai', err.message || 'Save failed.', 'err');
  } finally {
    _cwBusy('cw-save-openai', false);
  }
}

async function _cwSaveDataForSEO() {
  const loginEl = document.getElementById('cw-input-dfs-login');
  const pwEl = document.getElementById('cw-input-dfs-password');
  const login = loginEl ? loginEl.value.trim() : '';
  const password = pwEl ? pwEl.value : '';
  if (!login || !password) {
    _cwSetMessage('dataforseo', 'Enter your login email and API password.', 'err');
    return;
  }
  _cwSetMessage('dataforseo', '', null);
  _cwBusy('cw-save-dataforseo', true, 'Testing\u2026');
  try {
    const result = await window.pocketAgent.validate.dataForSEOKey(login, password);
    if (!result.valid) {
      _cwSetMessage('dataforseo', result.error || 'Invalid credentials.', 'err');
      _cwShowToast('DataForSEO didn\u2019t validate', 'error');
      return;
    }

    // Build the MCP server config. Use the dataforseo-mcp-server npm package
    // launched via npx so testers don't need to install anything globally.
    const mcpConfig = {
      command: 'npx',
      args: ['-y', 'dataforseo-mcp-server'],
      env: {
        DATAFORSEO_USERNAME: login,
        DATAFORSEO_PASSWORD: password,
      },
    };

    // List-first so we update an existing connection instead of failing
    // with "already exists" on testers who set it up before.
    let existing = null;
    try {
      const { servers } = await window.pocketAgent.connections.list();
      existing = (servers || []).find((s) => s.name === 'dataforseo') || null;
    } catch (err) {
      console.warn('[CW] connections.list failed; will try add:', err);
    }

    if (existing) {
      await window.pocketAgent.connections.update('dataforseo', 'dataforseo', mcpConfig);
    } else {
      await window.pocketAgent.connections.add('dataforseo', mcpConfig);
    }

    const balanceNote =
      typeof result.balance === 'number'
        ? ` \u2014 $${result.balance.toFixed(2)} balance`
        : '';
    _cwSetMessage('dataforseo', `Saved \u2014 connected${balanceNote}.`, 'ok');
    _cwShowToast('DataForSEO connected', 'success');
    if (pwEl) pwEl.value = '';
    _cwExpanded.dataforseo = false;
    await _cwLoadState();
    _cwRender();
  } catch (err) {
    _cwSetMessage('dataforseo', err.message || 'Save failed.', 'err');
  } finally {
    _cwBusy('cw-save-dataforseo', false);
  }
}

async function _cwSaveBrandBook() {
  const bsEl = document.getElementById('cw-input-brand-style');
  const wrEl = document.getElementById('cw-input-writing-rules');
  const brandStyle = bsEl ? bsEl.value.trim() : '';
  const writingRules = wrEl ? wrEl.value.trim() : '';
  if (!brandStyle || !writingRules) {
    _cwSetMessage('brandbook', 'Both fields are required.', 'err');
    return;
  }
  _cwSetMessage('brandbook', '', null);
  _cwBusy('cw-save-brandbook', true, 'Saving\u2026');
  try {
    await window.pocketAgent.settings.set('personalize.brandStyle', brandStyle);
    await window.pocketAgent.settings.set('personalize.writingRules', writingRules);
    _cwSetMessage('brandbook', 'Saved.', 'ok');
    _cwShowToast('Brand book saved', 'success');
    _cwExpanded.brandbook = false;
    await _cwLoadState();
    _cwRender();
  } catch (err) {
    _cwSetMessage('brandbook', err.message || 'Save failed.', 'err');
  } finally {
    _cwBusy('cw-save-brandbook', false);
  }
}

// ---- Start ----

/**
 * Boot the agent into the Content Writer recipe.
 *
 * - Defensive: re-check all 3 cards are ✓ (state could be stale if a
 *   tester edited settings in another panel before clicking Start).
 * - If a "Content Writer" session already exists, switch into it instead
 *   of duplicating tabs.
 * - Awaits switchSession() so the kickoff message lands on the right
 *   session — without the await, the message would fire while the prior
 *   session was still loading its history.
 */
async function startContentWriter() {
  // Defensive re-validation
  await _cwLoadState();
  if (_cwState.openai !== 'ok' || _cwState.dataforseo !== 'ok' || _cwState.brandbook !== 'ok') {
    _cwRender();
    _cwShowToast('Finish the three setup steps first', 'error');
    return;
  }

  const startBtn = document.getElementById('cw-start-btn');
  if (startBtn) startBtn.disabled = true;

  try {
    // Find or create the Content Writer session
    let sessionId = null;
    try {
      const list = await window.pocketAgent.sessions.list();
      const existing = (list || []).find((s) => s && s.name === 'Content Writer');
      if (existing) sessionId = existing.id;
    } catch (err) {
      console.warn('[CW] sessions.list failed:', err);
    }

    if (!sessionId) {
      const result = await window.pocketAgent.sessions.create('Content Writer');
      if (!result || !result.success || !result.session) {
        _cwShowToast(result?.error || 'Failed to create session', 'error');
        return;
      }
      // Mirror createNewSession() so the new tab shows up in the sidebar.
      if (typeof sessions !== 'undefined' && Array.isArray(sessions)) {
        sessions.push(result.session);
      }
      sessionId = result.session.id;
    }

    // Close this panel, then switch to the chat session.
    hideContentWriterPanel();
    if (typeof switchSession === 'function') {
      await switchSession(sessionId);
    } else if (typeof currentSessionId !== 'undefined') {
      currentSessionId = sessionId;
    }
    if (typeof renderTabs === 'function') renderTabs();

    // Drop the kickoff prompt into the message input and fire it. The
    // microtask gap lets switchSession's DOM mutations settle so
    // sendMessage's read of input.value lands on the right session tab.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const messageInput = document.getElementById('message-input');
    if (messageInput) {
      messageInput.value = _CW_KICKOFF_PROMPT;
    }
    if (typeof sendMessage === 'function') {
      await sendMessage();
    }
  } catch (err) {
    console.error('[CW] startContentWriter failed:', err);
    _cwShowToast(err.message || 'Failed to start Content Writer', 'error');
  } finally {
    if (startBtn) startBtn.disabled = false;
  }
}

// ---- Expose to inline onclick handlers ----
// (panel funcs are already global function declarations; nothing more needed)
