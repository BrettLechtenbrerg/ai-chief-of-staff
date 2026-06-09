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
  brandbook: 'missing',   // 'ok' | 'missing' (the picked brand has a non-empty book)
};

// Multi-brand: the brands list + which brand the Content Writer will target.
// The picked brand's id is stamped onto the Content Writer session before the
// recipe fires, so the system prompt injects that brand's voice.
let _cwBrands = [];
let _cwPickedBrandId = null;

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
  'Show me the full article rendered as markdown (title as H1, body with section headings, etc.) followed by the hero image as a markdown image reference (`![hero](file:///$HOME/Desktop/Blogs/YYYY-MM-DD-slug/hero.png)`).',
  '',
  'Step 9 — Ask for approval.',
  'After the article + image, write one short line: "Want any changes, or are we good to publish?"',
  'Then end your message with EXACTLY this marker on its own final line (no text after it, no code fence, no quotes):',
  '[[CW_STATE:ready_for_approval]]',
  '',
  'Step 10 — Handle the approval trigger `__CW_APPROVE__`.',
  'When (and ONLY when) my next user message is the exact literal string `__CW_APPROVE__`, do all of the following in one turn:',
  '  a) Use the write tool to save the final article markdown to $HOME/Desktop/Blogs/YYYY-MM-DD-slug/blog-post.md (same slug folder you created in Step 5).',
  '  b) Reply with ONE short confirmation sentence, e.g. "Saved blog-post.md to ~/Desktop/Blogs/YYYY-MM-DD-slug/."',
  '  c) End your message with EXACTLY this marker on its own final line:',
  '[[CW_STATE:ready_for_spin]]',
  '',
  'If the user instead types feedback (anything other than the exact `__CW_APPROVE__` literal), treat it as revision: edit the article in chat, regenerate the image if asked, repost the full markdown + image, and end with `[[CW_STATE:ready_for_approval]]` again so the approval buttons reappear.',
  '',
  'Step 11 — Handle the social-spin trigger `__CW_SPIN__`.',
  'When (and ONLY when) my next user message is the exact literal string `__CW_SPIN__`, do ALL of the following in one turn, in this order:',
  '  a) Call generate_blog_image again with the SAME outputPath as the hero (e.g. $HOME/Desktop/Blogs/YYYY-MM-DD-slug/hero.png) and `generateSquare: true`. This produces hero-square.png (1080x1080) alongside the landscape hero. Use the SAME visual prompt as Step 6 so the square matches the hero.',
  '  b) Draft the 5 platform-tailored posts (per the PLATFORM RULES block below). Each must be visibly different from the others and from the blog — not the same text with different lengths.',
  '  c) Use the write tool 5 times to save each post as its own file in the SAME slug folder, BEFORE you send your reply:',
  '       gbp.md, facebook.md, instagram.md, linkedin.md, medium.md',
  '     This is so the user has a permanent disk copy even if the chat is cleared later.',
  '  d) THEN, in ONE assistant chat message, paste the FULL final text of all 5 posts inline so the user can copy-paste from the chat directly to each platform without ever leaving this thread or opening the files. The inline copy is the PRIMARY output — the files are a backup. Format the message EXACTLY like this:',
  '',
  '       Saved 5 platform posts to ~/Desktop/Blogs/YYYY-MM-DD-slug/ (gbp.md, facebook.md, instagram.md, linkedin.md, medium.md) plus hero-square.png for Instagram. Copy-paste straight from below — no need to open the files.',
  '',
  '       ---',
  '',
  '       ### Google Business Profile',
  '       *Image: hero.png (landscape)*',
  '',
  '       <FULL GBP POST TEXT HERE — 750 chars max, no truncation, no placeholder>',
  '',
  '       ---',
  '',
  '       ### Facebook',
  '       *Image: hero.png (landscape)*',
  '',
  '       <FULL FACEBOOK POST TEXT HERE — 150–300 words, no truncation>',
  '',
  '       ---',
  '',
  '       ### Instagram',
  '       *Image: hero-square.png (1080×1080)*',
  '',
  '       <FULL INSTAGRAM CAPTION HERE — ~150–220 words including hashtags, no truncation>',
  '',
  '       ---',
  '',
  '       ### LinkedIn',
  '       *Image: hero.png (landscape)*',
  '',
  '       <FULL LINKEDIN POST TEXT HERE — 1300 chars max, no truncation>',
  '',
  '       ---',
  '',
  '       ### Medium',
  '       *Image: hero.png (landscape)*',
  '',
  '       <FULL MEDIUM POST TEXT HERE — full repost or 400–500 word excerpt, no truncation>',
  '',
  '  e) End your message with EXACTLY this marker on its own final line:',
  '[[CW_STATE:done]]',
  '',
  '  Hard rule for Step 11: NEVER replace the inline post body with a placeholder like "see gbp.md" or "saved to file" or a summary. The user must be able to read and copy the entire final post text from the chat itself. Files are an archival backup, not the primary deliverable.',
  '',
  '=== PLATFORM RULES (Step 11 — social spin) ===',
  '',
  '**Hard rule: Brand book Writing Rules (in your system prompt context) override platform rules in every conflict.** Platform rules govern LENGTH, STRUCTURE, FORMAT, and platform-specific conventions (hashtags, mentions, CTA style). Writing Rules govern VOICE.',
  '',
  '### Google Business Profile',
  '- Audience: local searchers, ready-to-act.',
  '- Length: 750 chars max (hard cap — GBP truncates beyond this).',
  '- Voice: direct, value-first, no fluff. Lead with the most useful sentence.',
  '- Format: 3–4 short paragraphs, no headers, no hashtags, no emoji.',
  '- CTA: "Call/visit/book" — concrete next step with phone or appointment link if known.',
  '- Image: reuse the hero. No regeneration needed.',
  '',
  '### Facebook',
  '- Audience: casual scrollers + existing followers.',
  '- Length: 150–300 words.',
  '- Voice: conversational, like talking to a friend.',
  '- Format: short paragraphs, line breaks for readability. 1–2 emoji max if they add warmth. NO hashtags.',
  '- CTA: "Comment / DM / share if this resonates" — engagement-led.',
  '- Image: reuse the hero.',
  '',
  '### Instagram',
  '- Audience: visual-first, mobile-scrolling.',
  '- Length: caption ~150–220 words. Hook in the first 1–2 lines (before the "more" cut).',
  '- Voice: warm, story-first, personal.',
  '- Format: hook line → line break → body in 3–5 short paragraphs separated by blank lines → line break → 5–10 relevant hashtags at the END.',
  '- CTA: "Save this / share with a friend / DM me ‘XYZ’" — Instagram-native.',
  '- Image: square 1080x1080. (You will generate this via generate_blog_image — see Step 11.)',
  '',
  '### LinkedIn',
  '- Audience: professionals, decision-makers, peers.',
  '- Length: 1300 chars max for the post body (LinkedIn truncates at ~1300 with "see more").',
  '- Voice: insight-led, credible, specific. First-person.',
  '- Format: punchy hook line as the FIRST sentence. Body in 3–5 short paragraphs. End with a single question to drive comments. 0 hashtags ideally, max 3 if topically relevant.',
  '- CTA: "What’s been your experience?" or "Curious how others handle this." Engagement-first, not salesy.',
  '- Image: reuse the hero.',
  '',
  '### Medium',
  '- Audience: long-form readers, often searching for a specific topic.',
  '- Length: full repost OR 400–500 word excerpt — your call based on the blog’s depth.',
  '- Voice: same as the blog. Medium is closest to a re-post; you are not aggressively rewriting.',
  '- Format: keep H2 sections from the blog. Add a 1-line italic intro at the very top: *Originally published at [brand site URL if known, else just "my blog"].* Keep all sub-headers and structure intact.',
  '- CTA: "Clap if this resonated" — Medium-native engagement. Optional sign-off linking back to the original blog.',
  '- Image: reuse the hero.',
  '',
  '=== END PLATFORM RULES ===',
  '',
  'Hard rules:',
  '- NEVER post the article or any social post to any external service (no GHL, no WordPress, no GitHub, no Buffer, no autoposting). All output goes to ~/Desktop/Blogs/ only.',
  '- NEVER skip my Brand & Style + Writing Rules. They override any default voice AND override platform rules on voice conflicts.',
  '- If DataForSEO isn\u2019t reachable, tell me and stop. Don\u2019t make up keyword stats.',
  '- If the brand book is empty, tell me "Add your brand book in Content Writer first" and stop.',
  '- The state markers `[[CW_STATE:ready_for_approval]]`, `[[CW_STATE:ready_for_spin]]`, `[[CW_STATE:done]]` are required exactly as written. The UI scans for them to render action buttons. If you forget the marker, the user has to type approvals manually.',
  '- Recognize the triggers `__CW_APPROVE__` and `__CW_SPIN__` ONLY in their exact double-underscore bracketed form. Words like "approve" or "go" or "ship it" typed by the user are NOT triggers — treat those as conversational feedback.',
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

  // Brand book — load brands, resolve the picked brand, and mark ✓ when that
  // brand's book (Brand & Style + Writing Rules) is non-empty.
  try {
    _cwBrands = (await window.pocketAgent.brands.list()) || [];
    if (!_cwPickedBrandId || !_cwBrands.some((b) => b.id === _cwPickedBrandId)) {
      const def = _cwBrands.find((b) => b.is_default);
      _cwPickedBrandId = def ? def.id : (_cwBrands[0] && _cwBrands[0].id) || null;
    }
    const picked = _cwBrands.find((b) => b.id === _cwPickedBrandId);
    const bsOk = picked && String(picked.brand_style || '').trim().length > 0;
    const wrOk = picked && String(picked.writing_rules || '').trim().length > 0;
    _cwState.brandbook = bsOk && wrOk ? 'ok' : 'missing';
  } catch (err) {
    console.warn('[CW] Failed to read brands:', err);
    _cwBrands = [];
    _cwState.brandbook = 'missing';
  }

  // DataForSEO — connection exists in mcp-servers.json. Match is rename-proof:
  // the May 28 recovery renamed the entry `dataforseo` -> `dataforseo-mcp-server`
  // so its Connect Tools card would resolve, which silently broke this card's
  // exact-name lookup. Detect by credential env var + known names/args instead
  // so any future rename can't regress it again.
  try {
    const { servers } = await window.pocketAgent.connections.list();
    const found = (servers || []).find(_cwIsDataForSEOServer);
    _cwState.dataforseo = found ? 'ok' : 'missing';
  } catch (err) {
    console.warn('[CW] Failed to list MCP connections:', err);
    _cwState.dataforseo = 'missing';
  }
}

// True if an MCP connection summary is a DataForSEO server, regardless of the
// key it's stored under. Checks (in order of reliability): the DataForSEO
// credential env var, then the known package name in command/args, then the
// historical entry names. ConnectionSummary doesn't expose _acos_tool_id, so
// env/args are the durable signals.
function _cwIsDataForSEOServer(s) {
  if (!s) return false;
  const env = s.env || {};
  if (env.DATAFORSEO_USERNAME || env.DATAFORSEO_PASSWORD) return true;
  const haystack = [s.command || '', ...(s.args || [])].join(' ').toLowerCase();
  if (haystack.includes('dataforseo-mcp-server') || haystack.includes('dataforseo')) return true;
  const name = String(s.name || '').toLowerCase();
  return name === 'dataforseo' || name === 'dataforseo-mcp-server';
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
  // Surface the picked brand name in the card status so it's unmistakable
  // which voice the blog post will use (e.g. "Writing as Brett Lechtenberg").
  const pickedBrand = _cwBrands.find((b) => b.id === _cwPickedBrandId);
  _cwRenderCard('brandbook', {
    okStatus: pickedBrand ? `Writing as ${pickedBrand.name}` : 'Ready',
    missingStatus: 'Pick a brand with a filled-in book',
    setupLabel: 'Pick a brand \u2192',
    okLabel: 'Change',
  });

  // Populate the brand picker + preview from the loaded brands.
  _cwRenderBrandPicker();

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
  // missing/invalid so they see what to do without clicking. The brand card
  // is the exception — picking which brand to write for is the whole point,
  // so it always stays open and never hides the brand dropdown.
  const shouldBeOpen = key === 'brandbook' || _cwExpanded[key] || state !== 'ok';
  if (shouldBeOpen) {
    card.classList.add('expanded');
  } else {
    card.classList.remove('expanded');
  }
}

// Render the brand <select> and a short read-only preview of the picked
// brand's book so the user can confirm they chose the right voice.
function _cwRenderBrandPicker() {
  const select = document.getElementById('cw-brand-picker');
  if (select) {
    select.innerHTML = '';
    if (_cwBrands.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No brands yet — add one in Personalize';
      select.appendChild(opt);
      select.disabled = true;
    } else {
      select.disabled = false;
      for (const b of _cwBrands) {
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = b.is_default ? `${b.name} (default)` : b.name;
        if (b.id === _cwPickedBrandId) opt.selected = true;
        select.appendChild(opt);
      }
    }
  }

  const preview = document.getElementById('cw-brand-preview');
  if (preview) {
    const picked = _cwBrands.find((b) => b.id === _cwPickedBrandId);
    if (!picked) {
      preview.textContent = '';
    } else {
      const bs = String(picked.brand_style || '').trim();
      const wr = String(picked.writing_rules || '').trim();
      if (!bs && !wr) {
        preview.textContent = 'This brand has no Brand & Style or Writing Rules yet — add them in Personalize → Knowledge Base.';
      } else {
        const snip = (s) => (s.length > 220 ? s.slice(0, 220) + '…' : s);
        const lines = [];
        if (bs) lines.push('Brand & Style: ' + snip(bs));
        if (wr) lines.push('Writing Rules: ' + snip(wr));
        preview.textContent = lines.join('\n\n');
      }
    }
  }
}

// User picked a different brand from the dropdown.
async function _cwOnBrandPick() {
  const select = document.getElementById('cw-brand-picker');
  if (!select) return;
  _cwPickedBrandId = select.value || null;
  await _cwLoadState();
  _cwRender();
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
    // with "already exists" on testers who set it up before. Match is
    // rename-proof (see _cwIsDataForSEOServer) so an entry stored under
    // `dataforseo-mcp-server` is updated in place rather than duplicated.
    let existing = null;
    try {
      const { servers } = await window.pocketAgent.connections.list();
      existing = (servers || []).find(_cwIsDataForSEOServer) || null;
    } catch (err) {
      console.warn('[CW] connections.list failed; will try add:', err);
    }

    if (existing) {
      // Preserve the existing entry's name so we don't orphan the running
      // server or create a second copy under a different key.
      await window.pocketAgent.connections.update(existing.name, existing.name, mcpConfig);
    } else {
      // Fresh setup uses the canonical name the Connect Tools card expects.
      await window.pocketAgent.connections.add('dataforseo-mcp-server', mcpConfig);
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
      const result = await window.pocketAgent.sessions.create('Content Writer', 'automation');
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

    // Target the Content Writer session at the picked brand so the system
    // prompt injects that brand's voice. Null falls back to the default brand.
    if (_cwPickedBrandId) {
      try {
        await window.pocketAgent.sessions.setBrand(sessionId, _cwPickedBrandId);
      } catch (err) {
        console.warn('[CW] sessions.setBrand failed:', err);
      }
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

// ---- Inline action buttons (Approve / Request changes / Create social) ----
//
// The agent emits one of three plain-text sentinels as the LAST line of an
// assistant message:
//   [[CW_STATE:ready_for_approval]] — show Approve + Request changes
//   [[CW_STATE:ready_for_spin]]     — show Create social content
//   [[CW_STATE:done]]               — terminal, no buttons (still strip the marker)
//
// `_cwHandleAssistantMessage` is called from messaging.js after every
// assistant bubble lands. It is a no-op for sessions whose name is not
// exactly "Content Writer" so it can’t leak buttons into other tabs.

const _CW_MARKER_REGEX = /\[\[CW_STATE:(ready_for_approval|ready_for_spin|done)\]\]/;

function _cwHandleAssistantMessage(text, sessionId) {
  if (!text) return;
  // Only fire inside the Content Writer session. `sessions` is the
  // module-scope global from state.js shared across the ui/chat bundle.
  let session = null;
  try {
    if (typeof sessions !== 'undefined' && Array.isArray(sessions)) {
      session = sessions.find((s) => s && s.id === sessionId) || null;
    }
  } catch (err) {
    console.warn('[CW] session lookup failed:', err);
  }
  if (!session || session.name !== 'Content Writer') return;

  const match = text.match(_CW_MARKER_REGEX);
  if (!match) return;
  const state = match[1];

  // Find the assistant bubble we were just attached to. The bubble was
  // appended by addMessage() immediately before this hook fires, so it
  // is the LAST .message.assistant in messagesDiv.
  const bubbles = messagesDiv.querySelectorAll('.message.assistant');
  const lastBubble = bubbles[bubbles.length - 1];
  if (!lastBubble) return;

  // Strip the marker from the rendered bubble. The marker is plain ASCII
  // (DOMPurify/marked won’t alter the brackets/colon), so a literal
  // string replace on innerHTML is safe. Belt-and-suspenders: also strip
  // it from any inner <p>/<code> wrappers if marked happened to wrap it.
  const markerLiteral = match[0];
  if (lastBubble.innerHTML.includes(markerLiteral)) {
    lastBubble.innerHTML = lastBubble.innerHTML.split(markerLiteral).join('');
  }
  // Clean up empty trailing <p></p> / <code></code> the strip may have left.
  lastBubble.querySelectorAll('p, code, pre').forEach((el) => {
    if (!el.textContent.trim() && !el.querySelector('img')) el.remove();
  });

  // Remove any earlier action rows from this session — only the most
  // recent assistant message should have active buttons.
  messagesDiv.querySelectorAll('.cw-action-row').forEach((row) => row.remove());

  let buttons = [];
  if (state === 'ready_for_approval') {
    buttons = [
      { label: '✓ Approve & Publish', kind: 'primary', onClick: () => _cwSendTrigger('✓ Approved', '__CW_APPROVE__', sessionId) },
      { label: 'Request changes', kind: 'secondary', onClick: () => _cwRequestChanges() },
    ];
  } else if (state === 'ready_for_spin') {
    buttons = [
      { label: '⚡ Create social content', kind: 'primary', onClick: () => _cwSendTrigger('⚡ Generate social content', '__CW_SPIN__', sessionId) },
    ];
  } else {
    // 'done' — terminal, no buttons. Marker already stripped above.
    return;
  }

  _cwInjectActionRow(lastBubble, buttons);
}

function _cwInjectActionRow(messageEl, buttons) {
  if (!messageEl || !buttons || buttons.length === 0) return;
  const row = document.createElement('div');
  row.className = 'cw-action-row';
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.className = b.kind === 'secondary' ? 'secondary' : 'primary';
    btn.textContent = b.label;
    btn.addEventListener('click', () => {
      // Disable all buttons in this row immediately to prevent double-click.
      row.querySelectorAll('button').forEach((x) => { x.disabled = true; });
      try {
        b.onClick();
      } catch (err) {
        console.error('[CW] action button handler failed:', err);
        // Re-enable so the user can retry.
        row.querySelectorAll('button').forEach((x) => { x.disabled = false; });
      }
    });
    row.appendChild(btn);
  }
  // Insert as a sibling immediately after the assistant bubble.
  if (messageEl.parentNode) {
    messageEl.parentNode.insertBefore(row, messageEl.nextSibling);
  }
}

// Send a trigger message (`__CW_APPROVE__` / `__CW_SPIN__`) on behalf of
// the user without going through sendMessage(). Mirrors the loading-state
// dance in plan-approval.js's sendPlanResponse so the spinner + tab
// indicator behave identically to a normal user turn.
async function _cwSendTrigger(displayLabel, triggerText, sessionId) {
  // Visible bubble shows the friendly label; the cryptic trigger text
  // is what we actually send to the agent.
  addMessage('user', displayLabel, true);

  isLoadingBySession.set(sessionId, true);
  renderTabs();
  if (currentSessionId === sessionId) {
    setButtonState(true);
  }
  const statusEl = addStatusIndicator('*stretches paws* thinking...');
  statusElBySession.set(sessionId, statusEl);
  ensureStatusListener(sessionId);
  scrollToBottom();

  try {
    const result = await window.pocketAgent.agent.send(triggerText, sessionId);

    // Cleanup status indicator + loading state
    const currentStatusEl = statusElBySession.get(sessionId);
    if (currentStatusEl) {
      currentStatusEl.remove();
      statusElBySession.delete(sessionId);
    }
    toolCountBySession.delete(sessionId);
    isLoadingBySession.set(sessionId, false);
    renderTabs();
    if (currentSessionId === sessionId) {
      setButtonState(false);
    }

    // Remove streaming bubble if the agent streamed partials.
    const streamBubble = streamingBubbleBySession.get(sessionId);
    if (streamBubble) {
      streamBubble.remove();
      streamingBubbleBySession.delete(sessionId);
    }
    streamingTextBySession.delete(sessionId);
    const pendingRaf = streamingRafBySession.get(sessionId);
    if (pendingRaf) {
      cancelAnimationFrame(pendingRaf);
      streamingRafBySession.delete(sessionId);
    }

    if (currentSessionId === sessionId) {
      if (result && result.success && result.response) {
        addMessage('assistant', result.response, true, [], null, true, result.media);
        // Re-run the marker hook so the next state’s buttons appear.
        _cwHandleAssistantMessage(result.response, sessionId);
        if (result.suggestedPrompt) {
          setSuggestion(result.suggestedPrompt);
        }
      } else if (result && result.error) {
        const errorMsg = result.error || '';
        if (!errorMsg.includes('stopped') && !errorMsg.includes('aborted')) {
          addMessage('error', errorMsg);
        }
      }
      updateStats();
      scrollToBottom();
    }
  } catch (err) {
    console.error('[CW] trigger send failed:', err);
    const currentStatusEl = statusElBySession.get(sessionId);
    if (currentStatusEl) {
      currentStatusEl.remove();
      statusElBySession.delete(sessionId);
    }
    isLoadingBySession.set(sessionId, false);
    renderTabs();
    if (currentSessionId === sessionId) {
      setButtonState(false);
      addMessage('error', err.message || 'Failed to send action');
      scrollToBottom();
    }
  }
}

// Focus the message input and prefill it. No automatic send — the user
// types their feedback like a normal turn.
function _cwRequestChanges() {
  const input = document.getElementById('message-input');
  if (!input) return;
  input.value = 'Please make these changes: ';
  input.focus();
  // Move caret to end so they can start typing.
  try {
    const len = input.value.length;
    input.setSelectionRange(len, len);
  } catch (_) { /* not all input types support setSelectionRange */ }
}

// Expose to messaging.js / external-messages.js. Keeping it on window
// matches the existing cross-module visibility pattern used elsewhere
// (e.g. window._sidebarEnterPanelMode).
window._cwHandleAssistantMessage = _cwHandleAssistantMessage;

// ---- Expose to inline onclick handlers ----
// (panel funcs are already global function declarations; nothing more needed)
