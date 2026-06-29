/* Video Studio Panel — embedded in chat.html
 *
 * Setup checklist (workspace + brand + aspect picker + optional OpenAI key) plus
 * one Start button that boots the agent into the Video Studio recipe: design →
 * build → render a branded MP4 with Remotion in an external workspace.
 *
 * Pattern mirrors content-writer-panel.js — module-scope state, helper funcs,
 * named entry points called from sidebar bindings and inline onclick attrs.
 */

// ---- Module state ----

let _vsInitialized = false;
let _vsNotyf = null;

const _vsState = {
  workspace: 'missing', // 'ok' | 'missing' | 'pending'  (Remotion workspace ready)
  brand: 'missing',     // 'ok' | 'missing'              (a brand is picked)
  openai: 'missing',    // 'ok' | 'missing'              (optional — enables image gen)
};

let _vsBrands = [];
let _vsPickedBrandId = null;

// Aspect ratio — persisted to localStorage so the choice sticks across opens.
// Always has a default so it never blocks Start.
const _VS_ASPECTS = {
  '9:16': { w: 1080, h: 1920, label: 'Vertical', platforms: 'Reels / TikTok / Shorts', cls: 'r916' },
  '16:9': { w: 1920, h: 1080, label: 'Landscape', platforms: 'YouTube / web', cls: 'r169' },
  '1:1': { w: 1080, h: 1080, label: 'Square', platforms: 'Feed posts', cls: 'r11' },
};
let _vsAspect = '9:16';

// Whether we've checked the workspace this session (the check shells out, so we
// only auto-run it once on open and cache the result).
let _vsWorkspaceChecked = false;

const _vsExpanded = {
  openai: false,
};

// ---- Show / Hide ----

function showVideoStudioPanel() {
  const chatView = document.getElementById('chat-view');
  const vsView = document.getElementById('video-studio-view');
  if (!vsView) return;

  if (typeof _dismissOtherPanels === 'function') _dismissOtherPanels('video-studio-view');

  if (chatView) chatView.classList.add('hidden');
  vsView.classList.add('active');
  if (window._sidebarEnterPanelMode) window._sidebarEnterPanelMode();

  const sidebarBtn = document.getElementById('sidebar-video-studio-btn');
  if (sidebarBtn) sidebarBtn.classList.add('active');

  if (!_vsInitialized) {
    _vsInitialized = true;
    // Restore persisted aspect.
    try {
      const saved = localStorage.getItem('vs-aspect');
      if (saved && _VS_ASPECTS[saved]) _vsAspect = saved;
    } catch (_) { /* localStorage may be unavailable */ }
  }

  _vsLoadState().then(() => _vsRender());
}

function hideVideoStudioPanel() {
  const chatView = document.getElementById('chat-view');
  const vsView = document.getElementById('video-studio-view');
  if (!vsView) return;

  vsView.classList.remove('active');
  if (chatView) chatView.classList.remove('hidden');
  if (window._sidebarExitPanelMode) window._sidebarExitPanelMode();

  const sidebarBtn = document.getElementById('sidebar-video-studio-btn');
  if (sidebarBtn) sidebarBtn.classList.remove('active');
}

function toggleVideoStudioPanel() {
  const vsView = document.getElementById('video-studio-view');
  if (vsView && vsView.classList.contains('active')) {
    hideVideoStudioPanel();
  } else {
    showVideoStudioPanel();
  }
}

// ---- Toast ----

function _vsShowToast(message, type) {
  if (!_vsNotyf) {
    _vsNotyf = new Notyf({
      duration: 3000,
      position: { x: 'right', y: 'bottom' },
      dismissible: true,
      types: [
        { type: 'success', background: '#4ade80' },
        { type: 'error', background: '#f87171' },
      ],
    });
  }
  _vsNotyf[type === 'error' ? 'error' : 'success'](message);
}

// ---- State loading ----

async function _vsLoadState() {
  // OpenAI (optional)
  try {
    const key = await window.pocketAgent.settings.get('openai.apiKey');
    _vsState.openai = key && String(key).trim().length > 0 ? 'ok' : 'missing';
  } catch (err) {
    console.warn('[VS] Failed to read openai.apiKey:', err);
    _vsState.openai = 'missing';
  }

  // Brands
  try {
    _vsBrands = (await window.pocketAgent.brands.list()) || [];
    if (!_vsPickedBrandId || !_vsBrands.some((b) => b.id === _vsPickedBrandId)) {
      const def = _vsBrands.find((b) => b.is_default);
      _vsPickedBrandId = def ? def.id : (_vsBrands[0] && _vsBrands[0].id) || null;
    }
    _vsState.brand = _vsPickedBrandId ? 'ok' : 'missing';
  } catch (err) {
    console.warn('[VS] Failed to read brands:', err);
    _vsBrands = [];
    _vsState.brand = 'missing';
  }

  // Workspace — checked lazily via a lightweight existence probe. We don't
  // scaffold here (that can take minutes); the agent does it on Start. The
  // probe just reads whether ~/dev/_video-studio looks initialized.
  if (!_vsWorkspaceChecked) {
    try {
      if (window.pocketAgent.videoStudio && window.pocketAgent.videoStudio.workspaceStatus) {
        const st = await window.pocketAgent.videoStudio.workspaceStatus();
        _vsState.workspace = st && st.ready ? 'ok' : 'missing';
      } else {
        // No IPC probe available — treat as "prepared on Start".
        _vsState.workspace = 'pending';
      }
    } catch (err) {
      console.warn('[VS] workspace status failed:', err);
      _vsState.workspace = 'pending';
    }
    _vsWorkspaceChecked = true;
  }
}

// ---- Rendering ----

function _vsRender() {
  _vsRenderCard('workspace', {
    okStatus: 'Remotion workspace ready',
    pendingStatus: 'Prepared automatically on first run (~a few min)',
    missingStatus: 'Set up on first run at ~/dev/_video-studio',
  });

  const pickedBrand = _vsBrands.find((b) => b.id === _vsPickedBrandId);
  _vsRenderCard('brand', {
    okStatus: pickedBrand ? `Branding as ${pickedBrand.name}` : 'Ready',
    missingStatus: 'Pick a brand for voice + colors',
  });

  _vsRenderCard('openai', {
    okStatus: 'Connected — can generate scene images',
    missingStatus: 'Optional — enables AI background/still images',
  });

  _vsRenderBrandPicker();
  _vsRenderAspect();

  // Start button is never hard-blocked — workspace + brand default sensibly and
  // aspect always has a value. Disable only when there are no brands at all.
  const startBtn = document.getElementById('vs-start-btn');
  const hint = document.getElementById('vs-actions-hint');
  const canStart = _vsBrands.length > 0;
  if (startBtn) startBtn.disabled = !canStart;
  if (hint) {
    hint.textContent = canStart
      ? `Will render a ${_vsAspect} video. First run prepares the workspace.`
      : 'Add a brand in Personalize first.';
  }
}

function _vsRenderCard(key, labels) {
  const card = document.querySelector(`#video-studio-view .vs-card[data-card="${key}"]`);
  if (!card) return;
  const state = _vsState[key];
  card.setAttribute('data-state', state === 'ok' ? 'ok' : 'missing');

  const badge = document.getElementById(`vs-badge-${key}`);
  if (badge) badge.textContent = state === 'ok' ? '\u2713' : state === 'pending' ? '\u22ef' : '\u26a0';

  const status = document.getElementById(`vs-status-${key}`);
  if (status) {
    status.textContent =
      state === 'ok' ? labels.okStatus
        : state === 'pending' ? (labels.pendingStatus || labels.missingStatus)
          : labels.missingStatus;
  }

  // Only the optional OpenAI card collapses; workspace + brand stay open.
  if (key === 'openai') {
    const toggle = document.getElementById('vs-toggle-openai');
    if (toggle) toggle.textContent = state === 'ok' ? 'Edit' : 'Add key \u2192';
    const shouldBeOpen = _vsExpanded.openai || state !== 'ok';
    card.classList.toggle('expanded', shouldBeOpen);
  } else {
    card.classList.add('expanded');
  }
}

function _vsRenderBrandPicker() {
  const select = document.getElementById('vs-brand-picker');
  if (!select) return;
  select.innerHTML = '';
  if (_vsBrands.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No brands yet — add one in Personalize';
    select.appendChild(opt);
    select.disabled = true;
    return;
  }
  select.disabled = false;
  for (const b of _vsBrands) {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = b.is_default ? `${b.name} (default)` : b.name;
    if (b.id === _vsPickedBrandId) opt.selected = true;
    select.appendChild(opt);
  }
}

function _vsRenderAspect() {
  const group = document.getElementById('vs-aspect-group');
  if (!group) return;
  group.querySelectorAll('.vs-aspect-option').forEach((el) => {
    el.classList.toggle('selected', el.dataset.aspect === _vsAspect);
  });
}

async function _vsOnBrandPick() {
  const select = document.getElementById('vs-brand-picker');
  if (!select) return;
  _vsPickedBrandId = select.value || null;
  _vsState.brand = _vsPickedBrandId ? 'ok' : 'missing';
  _vsRender();
}

function _vsPickAspect(aspect) {
  if (!_VS_ASPECTS[aspect]) return;
  _vsAspect = aspect;
  try {
    localStorage.setItem('vs-aspect', aspect);
  } catch (_) { /* ignore */ }
  _vsRenderAspect();
  const hint = document.getElementById('vs-actions-hint');
  if (hint && _vsBrands.length > 0) {
    hint.textContent = `Will render a ${_vsAspect} video. First run prepares the workspace.`;
  }
}

// ---- OpenAI card (optional) ----

function _vsToggleOpenAI() {
  _vsExpanded.openai = !_vsExpanded.openai;
  const card = document.querySelector('#video-studio-view .vs-card[data-card="openai"]');
  if (!card) return;
  const shouldBeOpen = _vsExpanded.openai || _vsState.openai !== 'ok';
  card.classList.toggle('expanded', shouldBeOpen);
}

function _vsSetMessage(key, message, kind) {
  const el = document.getElementById(`vs-msg-${key}`);
  if (!el) return;
  el.textContent = message || '';
  el.classList.remove('ok', 'err');
  if (kind === 'ok') el.classList.add('ok');
  if (kind === 'err') el.classList.add('err');
}

async function _vsSaveOpenAI() {
  const input = document.getElementById('vs-input-openai');
  const key = input ? input.value.trim() : '';
  if (!key) {
    _vsSetMessage('openai', 'Paste your OpenAI key first.', 'err');
    return;
  }
  _vsSetMessage('openai', '', null);
  const btn = document.getElementById('vs-save-openai');
  if (btn) { btn.disabled = true; btn.textContent = 'Testing…'; }
  try {
    const result = await window.pocketAgent.validate.openAIKey(key);
    if (!result.valid) {
      _vsSetMessage('openai', result.error || 'Invalid key.', 'err');
      _vsShowToast('OpenAI key didn\u2019t validate', 'error');
      return;
    }
    await window.pocketAgent.settings.set('openai.apiKey', key);
    _vsSetMessage('openai', 'Saved \u2014 connected.', 'ok');
    _vsShowToast('OpenAI key saved', 'success');
    if (input) input.value = '';
    _vsExpanded.openai = false;
    await _vsLoadState();
    _vsRender();
  } catch (err) {
    _vsSetMessage('openai', err.message || 'Save failed.', 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save & Test'; }
  }
}

function _vsOpenExternal(url) {
  try {
    window.pocketAgent.app.openExternal(url);
  } catch (err) {
    console.warn('[VS] openExternal failed:', err);
  }
}

// ---- The kickoff recipe ----

function _vsBuildKickoffPrompt() {
  const spec = _VS_ASPECTS[_vsAspect];
  const dims = `${spec.w}x${spec.h}`;
  return [
    'You are running the Video Studio routine for me. Design → build → render a branded MP4 with Remotion. Follow each step in order. If any step fails, tell me what went wrong and stop — don\u2019t render anything broken.',
    '',
    `The aspect ratio is already chosen: ${_vsAspect} (${spec.label}, ${spec.w}x${spec.h}, ${spec.platforms}). Use these exact pixel dimensions for the composition. Only ask to change it if I explicitly bring it up.`,
    '',
    'Step 1 — Read the Remotion skill.',
    'Read the file at ~/dev/_video-studio/.agents/skills/remotion/SKILL.md (it may not exist until Step 4 scaffolds the workspace — if so, read it right after Step 4). Confirm the hard rules in one line: frame-based animation only, deterministic, staticFile() for assets, individual transform keys, named exports, files under src/remotion/.',
    '',
    'Step 2 — Confirm the brief.',
    'In 1–2 lines confirm: objective, key message / CTA, duration in seconds (default 10s if I don\u2019t say), any assets I gave you, and the brand (already injected from my Knowledge Base — name the brand you\u2019re building for).',
    '',
    'Step 3 — Propose a scene-by-scene plan.',
    'List each scene with its timing (start–end in seconds), on-screen text, and the motion (fade, slide, scale, spring). Keep it tight and on-brand. Then write one short line: "Good to build, or want changes?" and end your message with EXACTLY this marker on its own final line:',
    '[[VS_STATE:ready_for_approval]]',
    '',
    'Step 4 — On approval (`__VS_APPROVE__`), build it.',
    'When (and ONLY when) my next message is the exact literal string `__VS_APPROVE__`:',
    '  a) Call scaffold_video_project to ensure the Remotion workspace exists at ~/dev/_video-studio (first run installs deps — that\u2019s expected to take a few minutes). Read the SKILL.md it reports if you haven\u2019t yet.',
    `  b) Write the composition under src/remotion/ following the skill exactly (frame-based only, deterministic, staticFile() assets, individual transform keys, named export). Build for ${dims}.`,
    `  c) Register the composition in src/Root.tsx with width={${spec.w}} height={${spec.h}} fps={30} and durationInFrames = 30 × (duration in seconds).`,
    '',
    'Step 5 — Generate any still images you need.',
    'If the video needs brand-colored backgrounds, logo cards, or photographic stills, call generate_blog_image and save them into the workspace public/ folder so staticFile() can resolve them. Skip if the video is pure typography/motion.',
    '',
    'Step 6 — Sanity-check one frame.',
    'Run a single still via the shell: cd ~/dev/_video-studio && npx remotion still <CompositionId> out/preview.png --frame=30',
    'Show me that frame inline as a markdown image (![preview](file:///$HOME/dev/_video-studio/out/preview.png)). If it looks wrong, fix the composition before rendering.',
    '',
    'Step 7 — Render.',
    `Call render_video with { compositionId, slug: <short-kebab-title>, aspect: "${_vsAspect}" } (add propsJson only if your composition takes input props). This renders the MP4 and copies it to ~/Desktop/Videos/<date>-<slug>/.`,
    '',
    'Step 8 — Report.',
    'Tell me the output path and give 1–2 lines of per-platform posting notes for the chosen aspect. Then end your message with EXACTLY this marker on its own final line:',
    '[[VS_STATE:done]]',
    '',
    'If I type feedback instead of `__VS_APPROVE__`, treat it as a revision: update the plan (or the composition if already built), re-post, and end with `[[VS_STATE:ready_for_approval]]` again so the approve button reappears.',
    '',
    'Hard rules:',
    '- Frame-based animation ONLY. No CSS transitions/animations, no Tailwind animate-* classes.',
    '- Deterministic ONLY. No Math.random / Date.now / new Date — use Remotion\u2019s random() with a seed.',
    '- Keep all Remotion files under src/remotion/. Use staticFile() for every asset in public/.',
    '- NEVER write into the installed .app bundle. The workspace is ~/dev/_video-studio; output goes to ~/Desktop/Videos/.',
    '- NEVER auto-publish to any platform. This is a draft — I post it myself.',
    '- The markers `[[VS_STATE:ready_for_approval]]` and `[[VS_STATE:done]]` are required exactly as written. The UI scans for them to render buttons.',
    '- Recognize the trigger `__VS_APPROVE__` ONLY in its exact double-underscore bracketed form. Words like "approve" or "go" are conversational feedback, not the trigger.',
    '',
    'Begin with Step 1 now.',
  ].join('\n');
}

// ---- Start ----

async function startVideoStudio() {
  await _vsLoadState();
  if (_vsBrands.length === 0) {
    _vsRender();
    _vsShowToast('Add a brand in Personalize first', 'error');
    return;
  }

  const startBtn = document.getElementById('vs-start-btn');
  if (startBtn) startBtn.disabled = true;

  try {
    // Find or create the Video Studio session.
    let sessionId = null;
    try {
      const list = await window.pocketAgent.sessions.list();
      const existing = (list || []).find((s) => s && s.name === 'Video Studio');
      if (existing) sessionId = existing.id;
    } catch (err) {
      console.warn('[VS] sessions.list failed:', err);
    }

    if (!sessionId) {
      // coder mode is best for writing/debugging TSX + running renders.
      const result = await window.pocketAgent.sessions.create('Video Studio', 'coder');
      if (!result || !result.success || !result.session) {
        _vsShowToast(result?.error || 'Failed to create session', 'error');
        return;
      }
      if (typeof sessions !== 'undefined' && Array.isArray(sessions)) {
        sessions.push(result.session);
      }
      sessionId = result.session.id;
    }

    // Target the picked brand so the system prompt injects that brand's voice.
    if (_vsPickedBrandId) {
      try {
        await window.pocketAgent.sessions.setBrand(sessionId, _vsPickedBrandId);
      } catch (err) {
        console.warn('[VS] sessions.setBrand failed:', err);
      }
    }

    hideVideoStudioPanel();
    if (typeof switchSession === 'function') {
      await switchSession(sessionId);
    } else if (typeof currentSessionId !== 'undefined') {
      currentSessionId = sessionId;
    }
    if (typeof renderTabs === 'function') renderTabs();

    await new Promise((resolve) => setTimeout(resolve, 0));
    const messageInput = document.getElementById('message-input');
    if (messageInput) {
      messageInput.value = _vsBuildKickoffPrompt();
    }
    if (typeof sendMessage === 'function') {
      await sendMessage();
    }
  } catch (err) {
    console.error('[VS] startVideoStudio failed:', err);
    _vsShowToast(err.message || 'Failed to start Video Studio', 'error');
  } finally {
    if (startBtn) startBtn.disabled = false;
  }
}

// ---- Inline action buttons (Approve / Request changes) ----
//
// The agent emits one of two sentinels as the LAST line of an assistant message:
//   [[VS_STATE:ready_for_approval]] — show Approve + Request changes
//   [[VS_STATE:done]]               — terminal, no buttons (still strip marker)
//
// Mirrors content-writer-panel.js's marker handler; no-op outside the
// "Video Studio" session so markers can't leak into other tabs.

const _VS_MARKER_REGEX = /\[\[VS_STATE:(ready_for_approval|done)\]\]/;

function _vsHandleAssistantMessage(text, sessionId) {
  if (!text) return;
  let session = null;
  try {
    if (typeof sessions !== 'undefined' && Array.isArray(sessions)) {
      session = sessions.find((s) => s && s.id === sessionId) || null;
    }
  } catch (err) {
    console.warn('[VS] session lookup failed:', err);
  }
  if (!session || session.name !== 'Video Studio') return;

  const match = text.match(_VS_MARKER_REGEX);
  if (!match) return;
  const state = match[1];

  const bubbles = messagesDiv.querySelectorAll('.message.assistant');
  const lastBubble = bubbles[bubbles.length - 1];
  if (!lastBubble) return;

  const markerLiteral = match[0];
  if (lastBubble.innerHTML.includes(markerLiteral)) {
    lastBubble.innerHTML = lastBubble.innerHTML.split(markerLiteral).join('');
  }
  lastBubble.querySelectorAll('p, code, pre').forEach((el) => {
    if (!el.textContent.trim() && !el.querySelector('img')) el.remove();
  });

  messagesDiv.querySelectorAll('.vs-action-row').forEach((row) => row.remove());

  if (state === 'done') return; // terminal, marker already stripped

  const buttons = [
    { label: '✓ Build it', kind: 'primary', onClick: () => _vsSendTrigger('✓ Approved', '__VS_APPROVE__', sessionId) },
    { label: 'Request changes', kind: 'secondary', onClick: () => _vsRequestChanges() },
  ];
  _vsInjectActionRow(lastBubble, buttons);
}

function _vsInjectActionRow(messageEl, buttons) {
  if (!messageEl || !buttons || buttons.length === 0) return;
  const row = document.createElement('div');
  row.className = 'vs-action-row';
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.className = b.kind === 'secondary' ? 'secondary' : 'primary';
    btn.textContent = b.label;
    btn.addEventListener('click', () => {
      row.querySelectorAll('button').forEach((x) => { x.disabled = true; });
      try {
        b.onClick();
      } catch (err) {
        console.error('[VS] action button handler failed:', err);
        row.querySelectorAll('button').forEach((x) => { x.disabled = false; });
      }
    });
    row.appendChild(btn);
  }
  if (messageEl.parentNode) {
    messageEl.parentNode.insertBefore(row, messageEl.nextSibling);
  }
}

async function _vsSendTrigger(displayLabel, triggerText, sessionId) {
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
        _vsHandleAssistantMessage(result.response, sessionId);
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
    console.error('[VS] trigger send failed:', err);
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

function _vsRequestChanges() {
  const input = document.getElementById('message-input');
  if (!input) return;
  input.value = 'Please make these changes: ';
  input.focus();
  try {
    const len = input.value.length;
    input.setSelectionRange(len, len);
  } catch (_) { /* ignore */ }
}

// Expose to messaging.js.
window._vsHandleAssistantMessage = _vsHandleAssistantMessage;
