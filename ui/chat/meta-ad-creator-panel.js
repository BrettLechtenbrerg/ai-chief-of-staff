/* Ad Creator button — draft Meta ads (copy + image), save to Desktop, never post.
 *
 * Mirrors meta-ads-panel.js: no setup panel. Clicking the sidebar button
 * boots the agent into a dedicated "Meta Ad Creator" chat session (kind
 * 'automation') stamped with the default brand, and fires the kickoff
 * prompt below. The brand book injection gives the draft its voice; Brett
 * can redirect ("write this for PMMA") in-chat.
 *
 * DRAFT-ONLY BY POLICY: this feature must never create/update anything in
 * Meta. The prompt hard-forbids Meta write tools; Meta access (if connected
 * at all) is used only for a read-only performance snapshot to inform the
 * draft. All output lands in ~/Desktop/Ads/ (allowed in image-gen.ts).
 *
 * DORMANT AUTOPOST: _adBuildKickoffPrompt(true) appends an AUTOPOST block
 * that creates the ad in Meta in PAUSED status. The flag is read from the
 * settings key `metaAds.autopost` — no UI writes that key anywhere, so the
 * block is unreachable until we deliberately add a toggle (or set the key
 * manually) after testing. Activation ALSO requires re-authorizing the Meta
 * OAuth grant with write scope — the Connect Tools card guidance is
 * read-only today. See RECOVERY.md.
 */

// ---- Module state ----

let _adCreatorNotyf = null;

// ---- The kickoff prompt ----

const _AD_KICKOFF_PROMPT_BASE = [
  'Help me create a Meta (Facebook/Instagram) ad — copy and image — saved as a draft for me to paste into Ads Manager.',
  '',
  'HARD RULES — read these first:',
  '- You DRAFT ads; you never post them. Never call any Meta Ads tool that creates, updates, pauses, resumes, duplicates, or deletes anything (campaigns, ad sets, ads, creatives, budgets, audiences — anything). This holds even if I ask you to "post it" later in this conversation: tell me you can only save drafts and point me to the paste checklist instead.',
  '- Meta Ads tools, if available, are READ-ONLY here and only for the performance snapshot in Step 2. Never invent or estimate performance data you did not actually retrieve.',
  '- All files you write go under $HOME/Desktop/Ads/ only — nowhere else on disk.',
  '',
  'Step 1 — Brand voice:',
  '- My brand book is in your system prompt context. Confirm in ONE sentence whose voice you will write in (brand name + the gist of the voice). If the brand book is missing or empty, say so and ask me to describe the brand in a sentence or two before continuing.',
  '',
  'Step 2 — Brief me in:',
  '- Ask me what the ad is for: the offer/event/service being promoted, and the goal (leads, traffic, or awareness). Ask anything else essential you are missing (audience, deadline, price point) in the SAME message. Then stop and wait for my answer.',
  '- After I answer, IF the Meta Ads tools are available, pull a quick read-only snapshot to inform the draft: my best-performing recent ad copy/hooks (top CTR, last 30 days) — a couple of aggregate calls at most. If the tools are unavailable, the call fails, or my account is not enabled for the ads MCP, just say you are drafting without performance data and proceed — do NOT stop, and do NOT tell me to connect anything.',
  '',
  'Step 3 — Draft 3 concepts:',
  '- Present THREE distinct ad concepts inline, clearly numbered. Each concept must include:',
  '  - Primary text — front-load the hook; Meta truncates around ~125 characters in feed, so the first 125 characters must work standalone.',
  '  - Headline — 40 characters max.',
  '  - Description — 30 characters max.',
  '  - CTA button suggestion (one of Meta\u2019s standard buttons, e.g. Learn More, Sign Up, Book Now, Get Offer).',
  '  - Image direction — one line describing the visual.',
  '- Make the three concepts genuinely different angles (e.g. pain-point, social proof, urgency) — not three rewordings.',
  '- Ask me to pick one (or mix and match), then stop and wait.',
  '',
  'Step 4 — Generate the image:',
  '- Build the ad folder path: $HOME/Desktop/Ads/YYYY-MM-DD-<slug>/ where YYYY-MM-DD is today and <slug> is a short kebab-case slug for the offer.',
  '- Call generate_blog_image with the chosen concept\u2019s image direction, outputPath $HOME/Desktop/Ads/YYYY-MM-DD-<slug>/ad-image.png, generateSquare: true (the square variant is for feed/Instagram placements), desktopCopy: false (the folder is already on the Desktop).',
  '',
  'Step 5 — Review and iterate:',
  '- Show me the final ad inline: the full copy (primary text, headline, description, CTA) plus both images.',
  '- Iterate conversationally until I say I am happy with it (plain language — "approved", "love it", "that works" all count). Revise copy and/or regenerate the image (same paths, overwrite) as asked.',
  '',
  'Step 6 — Save on approval:',
  '- Once I approve, write $HOME/Desktop/Ads/YYYY-MM-DD-<slug>/ad.md containing:',
  '  - The final ad copy in full.',
  '  - Any runner-up variants from Step 3 I showed interest in (skip the rejects).',
  '  - A paste checklist for Ads Manager mapping each piece to its field: Primary text \u2192 "Primary text", Headline \u2192 "Headline", Description \u2192 "Description", CTA \u2192 "Call to action" button, ad-image.png (1536\u00d71024) \u2192 desktop/landscape placements, ad-image-square.png \u2192 square/feed placements.',
  '- Reply with ONE short confirmation that names the exact folder path. Do not re-paste the whole ad.',
  '',
  'Keep every message skimmable on a phone. Begin with Step 1 now.',
].join('\n');

/**
 * Build the kickoff prompt for a run. autopostEnabled=false (the only state
 * reachable today — see header comment) returns the draft-only base prompt.
 * autopostEnabled=true appends the AUTOPOST block, which overrides Step 6 to
 * also create the ad in Meta in PAUSED status — never live.
 */
function _adBuildKickoffPrompt(autopostEnabled) {
  if (!autopostEnabled) return _AD_KICKOFF_PROMPT_BASE;

  const autopostBlock = [
    '',
    '=== AUTOPOST (Meta) ===',
    'Autopost is enabled for this run. This block OVERRIDES Step 6 and, for these exact steps only, overrides the "never call any Meta write tool" hard rule — creating this one ad in PAUSED status is the one sanctioned write.',
    '',
    'After I approve in Step 5, replace Step 6 with all of the following in one turn:',
    '  a) Save ad.md to $HOME/Desktop/Ads/YYYY-MM-DD-<slug>/ exactly as Step 6 describes — the Desktop copy is still the archive of record.',
    '  b) Ask me which ad set the ad should go into. List my ad sets (read-only call) with names and IDs so I can pick. Stop and wait for my answer.',
    '  c) Using the Meta Ads write tools, create the ad creative (final copy + the generated image) and the ad inside the ad set I named, with status PAUSED. NEVER set the ad, its ad set, or its campaign to ACTIVE — I review and turn it on in Ads Manager myself. Never touch budgets, schedules, or targeting.',
    '  d) Report the created ad ID and creative ID, confirm the status is PAUSED, and remind me to review it in Ads Manager before enabling. If any create call fails, report the exact error and STOP — do not retry with different parameters; the Desktop draft is still saved.',
    '',
    'Everything else — the read-only snapshot rule, the Desktop-only file rule, all other hard rules — is unchanged.',
    '=== END AUTOPOST ===',
  ].join('\n');

  return _AD_KICKOFF_PROMPT_BASE + '\n' + autopostBlock;
}

// ---- Toast ----

function _adCreatorShowToast(message, type) {
  if (!_adCreatorNotyf) {
    _adCreatorNotyf = new Notyf({
      duration: 3000,
      position: { x: 'right', y: 'bottom' },
      dismissible: true,
      types: [
        { type: 'success', background: '#4ade80' },
        { type: 'error', background: '#f87171' },
      ],
    });
  }
  _adCreatorNotyf[type === 'error' ? 'error' : 'success'](message);
}

// ---- Start ----

/**
 * Boot the agent into the Meta Ad Creator recipe.
 *
 * Mirrors startMetaAdsAnalyzer(): find-or-create a dedicated session (so we
 * don't spawn a new tab every click), stamp it with the default brand so the
 * brand book is injected, switch into it, then drop the kickoff prompt in
 * the composer and send it.
 */
async function startMetaAdCreator() {
  const sidebarBtn = document.getElementById('sidebar-ad-creator-btn');
  if (sidebarBtn) sidebarBtn.classList.add('active');

  // No panel view of its own — drops straight into a chat. Dismiss any open
  // panel and exit sidebar panel mode so the chat is actually visible.
  // Passing a non-matching id closes them all.
  if (typeof _dismissOtherPanels === 'function') _dismissOtherPanels('ad-creator-view');
  if (window._sidebarExitPanelMode) window._sidebarExitPanelMode();

  try {
    // Find or create the "Meta Ad Creator" session.
    let sessionId = null;
    try {
      const list = await window.pocketAgent.sessions.list();
      const existing = (list || []).find((s) => s && s.name === 'Meta Ad Creator');
      if (existing) sessionId = existing.id;
    } catch (err) {
      console.warn('[AdCreator] sessions.list failed:', err);
    }

    if (!sessionId) {
      const result = await window.pocketAgent.sessions.create('Meta Ad Creator', 'automation');
      if (!result || !result.success || !result.session) {
        _adCreatorShowToast(result?.error || 'Failed to create session', 'error');
        return;
      }
      // Mirror createNewSession() so the new tab shows up in the sidebar.
      if (typeof sessions !== 'undefined' && Array.isArray(sessions)) {
        sessions.push(result.session);
      }
      sessionId = result.session.id;
    }

    // Stamp the default brand so the system prompt injects its brand book.
    // Best-effort: with no brands set up, the prompt's Step 1 handles the
    // missing-brand-book case conversationally.
    try {
      const brands = (await window.pocketAgent.brands.list()) || [];
      const defaultBrand = brands.find((b) => b && b.is_default);
      if (defaultBrand) {
        await window.pocketAgent.sessions.setBrand(sessionId, defaultBrand.id);
      }
    } catch (err) {
      console.warn('[AdCreator] default-brand stamp failed:', err);
    }

    // Dormant autopost flag. Nothing in the UI writes `metaAds.autopost`,
    // so this resolves falsy today; the read exists so activation later is
    // a settings toggle, not a code change. (Activation also needs the Meta
    // OAuth grant re-done with write scope — see RECOVERY.md.)
    let autopostEnabled = false;
    try {
      autopostEnabled = Boolean(await window.pocketAgent.settings.get('metaAds.autopost'));
    } catch (err) {
      console.warn('[AdCreator] settings.get(metaAds.autopost) failed; staying draft-only:', err);
    }

    // Switch to the chat session.
    if (typeof switchSession === 'function') {
      await switchSession(sessionId);
    } else if (typeof currentSessionId !== 'undefined') {
      currentSessionId = sessionId;
    }
    if (typeof renderTabs === 'function') renderTabs();

    // Drop the kickoff prompt into the composer and fire it. The microtask
    // gap lets switchSession's DOM mutations settle so sendMessage reads
    // input.value on the right session tab (same dance as the analyzer).
    await new Promise((resolve) => setTimeout(resolve, 0));
    const messageInput = document.getElementById('message-input');
    if (messageInput) {
      messageInput.value = _adBuildKickoffPrompt(autopostEnabled);
    }
    if (typeof sendMessage === 'function') {
      await sendMessage();
    }
  } catch (err) {
    console.error('[AdCreator] startMetaAdCreator failed:', err);
    _adCreatorShowToast(err.message || 'Failed to start Ad Creator', 'error');
  } finally {
    if (sidebarBtn) sidebarBtn.classList.remove('active');
  }
}
