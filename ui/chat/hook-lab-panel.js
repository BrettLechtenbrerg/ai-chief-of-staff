/* Hook Lab Panel — embedded in chat.html
 *
 * Turns a video idea / offer / topic into a complete hook system (best format +
 * 5 options for each of the 5 hook elements + score + 15–30s script + CTAs),
 * following the Hook Lab framework (assets/skills/hook-lab/SKILL.md).
 *
 * Pattern mirrors content-writer-panel.js / video-studio-panel.js — module-scope
 * state, helper funcs, named entry points called from sidebar bindings + inline
 * onclick attrs. Hook Lab is conversational (no approval markers): Start boots a
 * "Hook Lab" session, sets the brand, and fires a kickoff that adopts the
 * framework and analyzes the user's idea.
 */

// ---- Module state ----

let _hlInitialized = false;
let _hlNotyf = null;

let _hlBrands = [];
let _hlPickedBrandId = null;

// Optional goal hint — one of the framework's accomplishment targets. Steers the
// format recommendation. null = let Hook Lab infer the goal from the idea.
let _hlGoal = null;

const _HL_GOALS = [
  'Get leads',
  'Sell a service',
  'Promote a class',
  'Promote an event',
  'Educate',
  'Build trust',
  'Go viral',
  'Get comments',
  'Build authority',
  'Book a call',
];

// ---- Show / Hide ----

function showHookLabPanel() {
  const chatView = document.getElementById('chat-view');
  const hlView = document.getElementById('hook-lab-view');
  if (!hlView) return;

  if (typeof _dismissOtherPanels === 'function') _dismissOtherPanels('hook-lab-view');

  if (chatView) chatView.classList.add('hidden');
  hlView.classList.add('active');
  if (window._sidebarEnterPanelMode) window._sidebarEnterPanelMode();

  const sidebarBtn = document.getElementById('sidebar-hook-lab-btn');
  if (sidebarBtn) sidebarBtn.classList.add('active');

  if (!_hlInitialized) _hlInitialized = true;

  _hlLoadState().then(() => _hlRender());
}

function hideHookLabPanel() {
  const chatView = document.getElementById('chat-view');
  const hlView = document.getElementById('hook-lab-view');
  if (!hlView) return;

  hlView.classList.remove('active');
  if (chatView) chatView.classList.remove('hidden');
  if (window._sidebarExitPanelMode) window._sidebarExitPanelMode();

  const sidebarBtn = document.getElementById('sidebar-hook-lab-btn');
  if (sidebarBtn) sidebarBtn.classList.remove('active');
}

function toggleHookLabPanel() {
  const hlView = document.getElementById('hook-lab-view');
  if (hlView && hlView.classList.contains('active')) {
    hideHookLabPanel();
  } else {
    showHookLabPanel();
  }
}

// ---- Toast ----

function _hlShowToast(message, type) {
  if (!_hlNotyf) {
    _hlNotyf = new Notyf({
      duration: 3000,
      position: { x: 'right', y: 'bottom' },
      dismissible: true,
      types: [
        { type: 'success', background: '#4ade80' },
        { type: 'error', background: '#f87171' },
      ],
    });
  }
  _hlNotyf[type === 'error' ? 'error' : 'success'](message);
}

// ---- State loading ----

async function _hlLoadState() {
  try {
    _hlBrands = (await window.pocketAgent.brands.list()) || [];
    if (!_hlPickedBrandId || !_hlBrands.some((b) => b.id === _hlPickedBrandId)) {
      const def = _hlBrands.find((b) => b.is_default);
      _hlPickedBrandId = def ? def.id : (_hlBrands[0] && _hlBrands[0].id) || null;
    }
  } catch (err) {
    console.warn('[HL] Failed to read brands:', err);
    _hlBrands = [];
    _hlPickedBrandId = null;
  }
}

// ---- Rendering ----

function _hlRender() {
  _hlRenderBrandPicker();
  _hlRenderChips();
  _hlUpdateStartState();
}

function _hlRenderBrandPicker() {
  const select = document.getElementById('hl-brand-picker');
  if (!select) return;
  select.innerHTML = '';

  // First option = no brand (generic hooks).
  const none = document.createElement('option');
  none.value = '';
  none.textContent = _hlBrands.length === 0 ? 'No brands yet — generic hooks' : 'No brand (generic)';
  select.appendChild(none);

  for (const b of _hlBrands) {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = b.is_default ? `${b.name} (default)` : b.name;
    if (b.id === _hlPickedBrandId) opt.selected = true;
    select.appendChild(opt);
  }
  select.disabled = false;
}

function _hlRenderChips() {
  const wrap = document.getElementById('hl-goal-chips');
  if (!wrap) return;
  wrap.innerHTML = '';
  for (const goal of _HL_GOALS) {
    const chip = document.createElement('button');
    chip.className = 'hl-chip' + (_hlGoal === goal ? ' selected' : '');
    chip.textContent = goal;
    chip.addEventListener('click', () => {
      if (typeof playNormalClick === 'function') playNormalClick();
      // Toggle: clicking the selected chip clears it.
      _hlGoal = _hlGoal === goal ? null : goal;
      _hlRenderChips();
    });
    wrap.appendChild(chip);
  }
}

function _hlUpdateStartState() {
  const startBtn = document.getElementById('hl-start-btn');
  const hint = document.getElementById('hl-actions-hint');
  const idea = (document.getElementById('hl-idea-input')?.value || '').trim();
  // Start is enabled once there's an idea. With no idea, Hook Lab can still open
  // and ask — but requiring a topic makes the first response immediately useful.
  if (startBtn) startBtn.disabled = idea.length === 0;
  if (hint) {
    hint.textContent = idea.length === 0
      ? 'Describe your video, offer, or topic to begin.'
      : 'Ready — I\u2019ll build your full hook system.';
  }
}

function _hlOnBrandPick() {
  const select = document.getElementById('hl-brand-picker');
  if (!select) return;
  _hlPickedBrandId = select.value || null;
}

// Called from the idea textarea's oninput.
function _hlOnIdeaInput() {
  _hlUpdateStartState();
}

// ---- The kickoff recipe ----

function _hlBuildKickoffPrompt(idea) {
  const goalLine = _hlGoal
    ? `The user's stated goal for this video is: ${_hlGoal}.`
    : 'The user did not pick a specific goal — infer it from the idea below.';

  return [
    'You are now running Hook Lab — a short-form hook strategist. For this session, follow the Hook Lab framework below to turn the user\u2019s idea into a COMPLETE hook system. Be clear, direct, strategic, fast-moving, no fluff. No slow intros, no academic theory.',
    '',
    'If a brand is set on this session, its voice/audience/business context is already injected above — tailor every hook to that brand. Otherwise write platform-native, generally strong hooks.',
    '',
    goalLine,
    '',
    '=== HOOK LAB FRAMEWORK ===',
    '',
    'First identify what the user is trying to accomplish (leads, sell, promote a class/event, educate, build trust, go viral, comments, authority, book a call, transformation, urgency, awareness). Then recommend BOTH a main format category and a specific format type.',
    '',
    '5 MAIN FORMAT CATEGORIES:',
    '- Educational \u2014 teach/build authority/promote a class. Payoff: viewer learns. ("Most people think X, but here\u2019s what actually matters\u2026")',
    '- Storytelling \u2014 trust/emotion/transformation. Payoff: the resolution. ("I almost made a huge mistake until\u2026")',
    '- Challenge \u2014 engagement/competition/demonstration. Payoff: someone wins/loses. ("I gave myself 30 minutes to\u2026")',
    '- Wait For It \u2014 suspense/reveal/before-after/reaction. Payoff: the reveal. ("Watch what happens when\u2026")',
    '- Skit \u2014 humor/relatable pain. Payoff: laugh/cringe/relate/share. ("POV: you said you\u2019d just check one email\u2026")',
    '',
    'SPECIFIC FORMAT TYPES (pick one inside the chosen category):',
    '- Educational: The Great Question · How to do X in X · Top 5 [thing] · Common Belief Buster · Credibility + Tip · If You X, Listen to This.',
    '- Storytelling: Come With Me/GRWM · The Knowledge Gap · How I Built This · Transformation Story · The "Why" · I Just Experienced X.',
    '- Challenge: Comparison · Blindfold Guess · The Jarring Setup · Increasing Difficulty · Cash Challenge · Impossible Task.',
    '- Wait For It: Wholesome Surprise · Will He/She Notice · Stranger Reaction · The Bait & Switch · Mystery Unboxing · Doing X Until X.',
    '- Skit: Hypothetical Scenario · Comparison · Unexpected Journey · Caught in the Act · Stereotypes · Dry Parody.',
    '',
    'THE 5-SECOND RULE: if a phone died after 5s, would they lose sleep wondering what\u2019s next? The first 5s must include at least one of: strong question, surprising statement, visual contradiction, challenge, reveal setup, mistake, warning, pattern interrupt, mystery, a result they want, or a problem they recognize. Kill "Hey guys\u2026" / "Today I want to talk about\u2026" intros.',
    '',
    'THE 5 HOOK ELEMENTS (use all five): Verbal (spoken) · Text overlay (on-screen) · Visual (what they see) · Audio (sound/music/silence/SFX) · Caption (social caption).',
    '',
    'THE 3 C\u2019s: Clarity + Context + Curiosity. Formula: clear topic + specific audience/context + an unanswered question or tension. Never give away the full answer in the first line.',
    '',
    'OUTPUT \u2014 produce ALL of this in order:',
    '1. Best Format Recommendation \u2014 Primary goal · Best main category · Best specific type · Payoff · Why this fits.',
    '2. Format Strategy \u2014 short, practical note on how this type should work here.',
    '3. 5 Verbal Hook options.',
    '4. 5 Text Overlay options (short, bold, punchy).',
    '5. 5 Visual Hook options (first 1\u20133s).',
    '6. 5 Audio Hook options.',
    '7. 5 Caption Hook options.',
    '8. Best Hook Combination \u2014 strongest verbal+text+visual+audio+caption as one cohesive opening; say why.',
    '9. Hook Score \u2014 score the combo /25 (Verbal/5, Text/5, Visual/5, Audio/5, Caption/5). Total /25, what\u2019s strong, what would make it stronger, how to increase curiosity. Aim 20+/25.',
    '10. Short-Form Script (15\u201330s) \u2014 Hook \u2192 Setup \u2192 Build \u2192 Payoff \u2192 CTA, with spoken lines, text overlay, visual direction, suggested cuts, B-roll.',
    '11. 5 CTA options \u2014 mix soft / comment / DM / lead-gen / direct-sales.',
    '12. Bonus Optimization \u2014 a few of the most useful tweaks (opening visual, prop, first line, curiosity gap, pacing, thumbnail text, hashtags, retention).',
    '',
    'Always give multiple options for every element \u2014 never one hook, never skip the format type, never skip the 5 elements.',
    '',
    'LEAD-GEN MODE \u2014 auto-trigger if the topic involves ads, lead gen, realtor/real estate, business owner, service business, booking calls, an offer, webinar, workshop, funnels, landing page, free guide, consultation, commercial, sales video, class sign-ups, or event registration. Add: a Problem+Promise hook, a Trust line, a Value statement, a lead-gen CTA, and 3+ A/B variations (curiosity / pain-point / direct-offer).',
    '',
    'REWRITE MODE \u2014 if the idea below is an existing hook, repeat it, score it /25, name what\u2019s missing, then give the full system above.',
    '=== END FRAMEWORK ===',
    '',
    'After the full hook system, add one short line: "Want me to build the winning hook into a video? Open Video Studio and I\u2019ll turn this script into an MP4."',
    '',
    'Here is the user\u2019s video idea / offer / topic:',
    '',
    idea || '(The user did not type an idea. Briefly introduce yourself as Hook Lab in 1\u20132 lines and ask for their video idea, offer, or topic.)',
  ].join('\n');
}

// ---- Start ----

async function startHookLab() {
  await _hlLoadState();

  const idea = (document.getElementById('hl-idea-input')?.value || '').trim();
  if (!idea) {
    _hlShowToast('Describe your video, offer, or topic first', 'error');
    _hlUpdateStartState();
    return;
  }

  const startBtn = document.getElementById('hl-start-btn');
  if (startBtn) startBtn.disabled = true;

  try {
    // Find or create the Hook Lab session.
    let sessionId = null;
    try {
      const list = await window.pocketAgent.sessions.list();
      const existing = (list || []).find((s) => s && s.name === 'Hook Lab');
      if (existing) sessionId = existing.id;
    } catch (err) {
      console.warn('[HL] sessions.list failed:', err);
    }

    if (!sessionId) {
      // 'automation' mode mirrors Content Writer — a focused chat recipe, no
      // file/coder tooling needed to write hooks.
      const result = await window.pocketAgent.sessions.create('Hook Lab', 'automation');
      if (!result || !result.success || !result.session) {
        _hlShowToast(result?.error || 'Failed to create session', 'error');
        return;
      }
      if (typeof sessions !== 'undefined' && Array.isArray(sessions)) {
        sessions.push(result.session);
      }
      sessionId = result.session.id;
    }

    // Target the picked brand (or clear it) so hooks match that voice/audience.
    try {
      await window.pocketAgent.sessions.setBrand(sessionId, _hlPickedBrandId || null);
    } catch (err) {
      console.warn('[HL] sessions.setBrand failed:', err);
    }

    hideHookLabPanel();
    if (typeof switchSession === 'function') {
      await switchSession(sessionId);
    } else if (typeof currentSessionId !== 'undefined') {
      currentSessionId = sessionId;
    }
    if (typeof renderTabs === 'function') renderTabs();

    await new Promise((resolve) => setTimeout(resolve, 0));
    const messageInput = document.getElementById('message-input');
    if (messageInput) {
      messageInput.value = _hlBuildKickoffPrompt(idea);
    }
    if (typeof sendMessage === 'function') {
      await sendMessage();
    }

    // Clear the idea box so the next open starts fresh.
    const ideaEl = document.getElementById('hl-idea-input');
    if (ideaEl) ideaEl.value = '';
  } catch (err) {
    console.error('[HL] startHookLab failed:', err);
    _hlShowToast(err.message || 'Failed to start Hook Lab', 'error');
  } finally {
    if (startBtn) startBtn.disabled = false;
  }
}
