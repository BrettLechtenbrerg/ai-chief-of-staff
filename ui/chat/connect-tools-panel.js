/* Connect Tools Panel — friendly marketplace for the curated set of
 * integrations (Gmail, Calendar, Drive, GHL, DataForSEO, Firecrawl,
 * Bookmarks).
 *
 * Cards are rendered from the menu returned by `connectTools.listSupported()`
 * and their state from `connectTools.getStatus()`. Polling happens while the
 * panel is visible — same cadence and pattern as connections-panel.js.
 *
 * Auth flows:
 *   google-oauth: clicking Connect kicks the system-browser flow via IPC;
 *                 panel waits for the resolved promise (the loopback server
 *                 receives the callback automatically) and re-renders.
 *   api-key / two-field: inputs render inside the card body; Save & Test
 *                 calls connectTools.connect with the field values.
 *   auto:        single Enable button, no inputs.
 *
 * Status events:
 *   googleOAuth.onExpired — flip every google-oauth card to reconnect-needed
 *                 immediately, without waiting for the next poll.
 */

let _ctInitialized = false;
let _ctNotyf = null;
let _ctTools = []; // SupportedTool[] from IPC
let _ctStatuses = {}; // id -> ToolStatus
let _ctPollTimer = null;
let _ctExpiredUnsub = null;
// Only ever prompt for migration once per session.
let _ctMigrationPrompted = false;
// Per-card UI state — what the user has typed but not yet submitted.
const _ctDrafts = {};

// ---- Show / Hide ----------------------------------------------------------

function showConnectToolsPanel() {
  const chatView = document.getElementById('chat-view');
  const ctView = document.getElementById('connect-tools-view');
  if (!ctView) return;

  if (typeof _dismissOtherPanels === 'function') {
    _dismissOtherPanels('connect-tools-view');
  }

  if (chatView) chatView.classList.add('hidden');
  ctView.classList.add('active');
  if (window._sidebarEnterPanelMode) window._sidebarEnterPanelMode();

  const sidebarBtn = document.getElementById('sidebar-connect-tools-btn');
  if (sidebarBtn) sidebarBtn.classList.add('active');

  _ctInitPanel();
}

function hideConnectToolsPanel() {
  const chatView = document.getElementById('chat-view');
  const ctView = document.getElementById('connect-tools-view');
  if (!ctView) return;

  ctView.classList.remove('active');
  if (chatView) chatView.classList.remove('hidden');
  if (window._sidebarExitPanelMode) window._sidebarExitPanelMode();

  const sidebarBtn = document.getElementById('sidebar-connect-tools-btn');
  if (sidebarBtn) sidebarBtn.classList.remove('active');

  _ctStopPolling();
}

function toggleConnectToolsPanel() {
  const ctView = document.getElementById('connect-tools-view');
  if (ctView && ctView.classList.contains('active')) {
    hideConnectToolsPanel();
  } else {
    showConnectToolsPanel();
  }
}

// ---- Initialization -------------------------------------------------------

async function _ctInitPanel() {
  if (!_ctInitialized) {
    _ctInitialized = true;
    // Wire the global "Google account was revoked" listener once.
    if (
      window.pocketAgent &&
      window.pocketAgent.googleOAuth &&
      typeof window.pocketAgent.googleOAuth.onExpired === 'function'
    ) {
      _ctExpiredUnsub = window.pocketAgent.googleOAuth.onExpired(() => {
        _ctShowToast(
          'Google access was revoked — reconnect to keep using Gmail/Calendar/Drive.',
          'error',
        );
        _ctRefresh();
      });
    }
  }

  try {
    _ctTools = await window.pocketAgent.connectTools.listSupported();
  } catch (err) {
    console.error('[ConnectTools] listSupported failed:', err);
    _ctTools = [];
  }
  await _ctRefresh();
  _ctStartPolling();
  // Detect any existing manually-curated entries whose names overlap with
  // our managed tools and offer a one-time migration prompt (plan Step 12).
  _ctMaybePromptMigration();
}

async function _ctMaybePromptMigration() {
  if (_ctMigrationPrompted) return;
  _ctMigrationPrompted = true;
  try {
    const matches = await window.pocketAgent.connectTools.detectMigratable();
    if (!matches || matches.length === 0) return;
    const names = matches.map((m) => m.mcpServerName).join(', ');
    const proceed = window.confirm(
      `Connect Tools found existing manual entries in mcp-servers.json that match supported tools:\n\n  ${names}\n\n` +
        'Stamp them as managed by Connect Tools? Your command / args / env stay unchanged — future edits via Connect Tools will overwrite. ' +
        'Click Cancel to keep them hand-managed (they\u2019ll show as read-only here).',
    );
    if (!proceed) return;
    for (const m of matches) {
      try {
        await window.pocketAgent.connectTools.adoptManagedFlag(m.toolId);
      } catch (err) {
        console.error('[ConnectTools] adopt failed for', m.toolId, err);
      }
    }
    _ctShowToast(`Adopted ${matches.length} existing entr${matches.length === 1 ? 'y' : 'ies'}.`, 'success');
    await _ctRefresh();
  } catch (err) {
    console.error('[ConnectTools] detectMigratable failed:', err);
  }
}

function _ctStartPolling() {
  _ctStopPolling();
  _ctPollTimer = setInterval(() => _ctRefresh(), 5000);
}

function _ctStopPolling() {
  if (_ctPollTimer) {
    clearInterval(_ctPollTimer);
    _ctPollTimer = null;
  }
}

async function _ctRefresh() {
  try {
    const statuses = await window.pocketAgent.connectTools.getStatus();
    _ctStatuses = {};
    for (const s of statuses || []) _ctStatuses[s.id] = s;
    // If the user is actively typing into one of our inputs, defer the
    // re-render — wiping #ct-cards.innerHTML mid-keystroke yanks focus and
    // makes the form unusable. The next 5s poll picks up where we left off,
    // and _ctConnect / _ctDisconnect call _ctRefresh directly so the user
    // never waits on a status update they triggered.
    if (_ctIsCardInputFocused()) return;
    _ctRender();
  } catch (err) {
    console.error('[ConnectTools] getStatus failed:', err);
  }
}

function _ctIsCardInputFocused() {
  const el = document.activeElement;
  if (!el || !el.tagName) return false;
  if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return false;
  return !!el.closest && !!el.closest('#ct-cards');
}

// ---- Rendering ------------------------------------------------------------

function _ctRender() {
  const container = document.getElementById('ct-cards');
  if (!container) return;
  container.innerHTML = '';
  for (const tool of _ctTools) {
    const status = _ctStatuses[tool.id] || {
      id: tool.id,
      status: 'not-connected',
      toolCount: 0,
      lastError: null,
      managedByAcos: false,
      externallyManaged: false,
    };
    container.appendChild(_ctRenderCard(tool, status));
  }
}

function _ctRenderCard(tool, status) {
  const card = document.createElement('section');
  card.className = 'ct-card';
  card.setAttribute('data-state', status.status);
  card.setAttribute('data-tool-id', tool.id);
  // Connected cards collapse by default; everything else stays open.
  if (status.status !== 'connected') card.classList.add('expanded');

  const badge = status.status === 'connected' ? '✓' : status.status === 'connecting' ? '…' : '⚠';
  const headerLine = _ctHeaderLine(tool, status);

  const header = document.createElement('div');
  header.className = 'ct-card-header';
  header.innerHTML = `
    <div class="ct-card-title">
      <span class="ct-card-badge">${badge}</span>
      <div>
        <h2>${_ctEscape(tool.name)}</h2>
        <div class="ct-card-status">${_ctEscape(headerLine)}</div>
      </div>
    </div>
    <button class="ct-btn-secondary" data-action="toggle">${card.classList.contains('expanded') ? 'Hide' : 'Edit'}</button>
  `;
  header
    .querySelector('[data-action="toggle"]')
    .addEventListener('click', () => card.classList.toggle('expanded'));
  card.appendChild(header);

  const body = document.createElement('div');
  body.className = 'ct-card-body';
  body.appendChild(_ctRenderDescription(tool));

  if (status.externallyManaged) {
    // Hand-managed entries skip helper links / callouts — the only fix
    // action is to edit mcp-servers.json directly.
  } else {
    const links = _ctRenderHelperLinks(tool);
    if (links) body.appendChild(links);
    const helper = _ctRenderHelper(tool);
    if (helper) body.appendChild(helper);
  }

  if (status.externallyManaged) {
    // When the entry is hand-managed in mcp-servers.json the only fix-action
    // is to edit/remove it from Settings → Connections. Folding any live
    // lastError into the same warning avoids the confusing double-status
    // line (yellow hand-managed + red error) reported during the May 23
    // smoke test. ACOS-managed entries still render lastError separately
    // because their fix-action is Reconnect/Disconnect, not file editing.
    const warn = document.createElement('p');
    warn.className = 'ct-warning';
    const base =
      'This connection is hand-managed in mcp-servers.json. Edit or remove it from Settings → Connections instead.';
    warn.textContent = status.lastError
      ? `${base} Current error: ${status.lastError}`
      : base;
    body.appendChild(warn);
  } else {
    body.appendChild(_ctRenderFields(tool, status));
    body.appendChild(_ctRenderActions(tool, status));
    if (status.lastError) {
      const err = document.createElement('p');
      err.className = 'ct-error';
      err.textContent = status.lastError;
      body.appendChild(err);
    }
  }
  card.appendChild(body);
  return card;
}

function _ctHeaderLine(tool, status) {
  if (status.status === 'connected') {
    if (status.email) return `Connected as ${status.email}`;
    // Surface validator-supplied meta when we have it (firecrawl credits,
    // dataforseo balance) so testers immediately see proof of life.
    const meta = status.validatorMeta;
    if (meta) {
      if (tool.id === 'firecrawl' && typeof meta.remainingCredits === 'number') {
        return `Connected — ${meta.remainingCredits} credits`;
      }
      if (tool.id === 'dataforseo' && typeof meta.balance === 'number') {
        return `Connected — $${meta.balance} credit`;
      }
    }
    if (status.toolCount > 0) return `Connected — ${status.toolCount} tools available`;
    return 'Connected';
  }
  if (status.status === 'connecting') return 'Connecting…';
  if (status.status === 'failed') return 'Failed to start';
  if (status.status === 'reconnect-needed') return 'Reconnect needed';
  return tool.description;
}

// Open a URL in the system browser via the same IPC the Content Writer uses.
// Falls back to window.open if the preload isn't available (e.g. tests).
function _ctOpenExternal(url) {
  try {
    if (
      window.pocketAgent &&
      window.pocketAgent.app &&
      typeof window.pocketAgent.app.openExternal === 'function'
    ) {
      window.pocketAgent.app.openExternal(url);
      return;
    }
  } catch (err) {
    console.warn('[ConnectTools] openExternal failed:', err);
  }
  try {
    window.open(url, '_blank');
  } catch (err) {
    console.warn('[ConnectTools] window.open failed:', err);
  }
}

function _ctRenderHelperLinks(tool) {
  if (!tool.signupUrl && !tool.dashboardUrl) return null;
  const row = document.createElement('div');
  row.className = 'ct-helper-links';
  if (tool.signupUrl) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ct-link-btn';
    btn.textContent = 'Open sign-up';
    btn.setAttribute('data-href', tool.signupUrl);
    btn.addEventListener('click', () => _ctOpenExternal(tool.signupUrl));
    row.appendChild(btn);
  }
  if (tool.dashboardUrl) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ct-link-btn';
    btn.textContent = 'Open dashboard';
    btn.setAttribute('data-href', tool.dashboardUrl);
    btn.addEventListener('click', () => _ctOpenExternal(tool.dashboardUrl));
    row.appendChild(btn);
  }
  return row;
}

function _ctRenderHelper(tool) {
  if (!tool.helperHtml) return null;
  const p = document.createElement('p');
  p.className = 'ct-helper';
  // Trusted innerHTML: the source is the SupportedTool config we ship and
  // review in src/main/ipc/connect-tools-ipc.ts, never user input.
  p.innerHTML = tool.helperHtml;
  return p;
}

function _ctRenderDescription(tool) {
  const p = document.createElement('p');
  p.className = 'ct-card-description';
  p.textContent = tool.description;
  return p;
}

// Per-card state for the show/hide-secret eye toggle. Keyed by
// `${tool.id}.${field.key}`. Defaults to hidden (false). Stored in module
// scope (not on the field input) because re-renders rebuild the DOM and we
// want the toggle state to survive a poll-skipped re-render.
const _ctRevealedSecrets = {};

function _ctRenderFields(tool, status) {
  const wrapper = document.createElement('div');
  if (!tool.fields || tool.fields.length === 0) return wrapper;
  // Don't expose fields once connected — user disconnects to re-enter.
  if (status.status === 'connected') return wrapper;
  const draft = _ctDrafts[tool.id] || {};
  for (const field of tool.fields) {
    const row = document.createElement('div');
    row.className = 'ct-field-row';
    const id = `ct-field-${tool.id}-${field.key}`;
    const revealKey = `${tool.id}.${field.key}`;
    const revealed = !!_ctRevealedSecrets[revealKey];
    const inputType = field.secret && !revealed ? 'password' : 'text';
    if (field.secret) {
      row.innerHTML = `
        <label for="${id}">${_ctEscape(field.label)}</label>
        <div class="ct-secret-input">
          <input
            id="${id}"
            type="${inputType}"
            placeholder="${_ctEscape(field.placeholder || '')}"
            autocomplete="off"
            spellcheck="false"
            value="${_ctEscape(draft[field.key] || '')}"
          />
          <button
            type="button"
            class="ct-secret-toggle"
            data-reveal-key="${_ctEscape(revealKey)}"
            aria-label="${revealed ? 'Hide' : 'Show'} ${_ctEscape(field.label)}"
            title="${revealed ? 'Hide' : 'Show'}"
          >${revealed ? '🙈' : '👁️'}</button>
        </div>
      `;
      const toggleBtn = row.querySelector('.ct-secret-toggle');
      toggleBtn.addEventListener('click', () => {
        _ctRevealedSecrets[revealKey] = !_ctRevealedSecrets[revealKey];
        const inputEl = row.querySelector('input');
        const nowRevealed = _ctRevealedSecrets[revealKey];
        inputEl.type = nowRevealed ? 'text' : 'password';
        toggleBtn.textContent = nowRevealed ? '🙈' : '👁️';
        toggleBtn.setAttribute('title', nowRevealed ? 'Hide' : 'Show');
        toggleBtn.setAttribute(
          'aria-label',
          `${nowRevealed ? 'Hide' : 'Show'} ${field.label}`,
        );
        // Keep focus on the input so the user can keep typing.
        inputEl.focus();
      });
    } else {
      row.innerHTML = `
        <label for="${id}">${_ctEscape(field.label)}</label>
        <input
          id="${id}"
          type="text"
          placeholder="${_ctEscape(field.placeholder || '')}"
          autocomplete="off"
          spellcheck="false"
          value="${_ctEscape(draft[field.key] || '')}"
        />
      `;
    }
    row.querySelector('input').addEventListener('input', (e) => {
      _ctDrafts[tool.id] = _ctDrafts[tool.id] || {};
      _ctDrafts[tool.id][field.key] = e.target.value;
    });
    wrapper.appendChild(row);
  }
  return wrapper;
}

function _ctRenderActions(tool, status) {
  const wrap = document.createElement('div');
  wrap.className = 'ct-actions';

  if (status.status === 'connected') {
    const disc = document.createElement('button');
    disc.className = 'ct-btn-secondary';
    disc.textContent = 'Disconnect';
    disc.addEventListener('click', () => _ctDisconnect(tool));
    wrap.appendChild(disc);
    return wrap;
  }

  if (status.status === 'connecting') {
    const spinner = document.createElement('span');
    spinner.className = 'ct-spinner';
    wrap.appendChild(spinner);
    const txt = document.createElement('span');
    txt.textContent = 'Connecting…';
    wrap.appendChild(txt);
    return wrap;
  }

  const primary = document.createElement('button');
  primary.textContent = _ctPrimaryLabel(tool, status);
  primary.addEventListener('click', () => _ctConnect(tool));
  wrap.appendChild(primary);
  return wrap;
}

function _ctPrimaryLabel(tool, status) {
  if (status.status === 'reconnect-needed') return 'Reconnect';
  if (status.status === 'failed') return 'Try Again';
  if (tool.authType === 'google-oauth') return 'Connect with Google';
  if (tool.authType === 'auto') return 'Enable';
  return 'Save & Test';
}

// ---- Actions --------------------------------------------------------------

async function _ctConnect(tool) {
  // Optimistic UI — flip the card to "connecting" immediately, then poll for
  // the real status afterward.
  _ctStatuses[tool.id] = { ..._ctStatuses[tool.id], status: 'connecting', lastError: null };
  _ctRender();

  const payload = _ctDrafts[tool.id] || {};

  // Pre-flight: for firecrawl / dataforseo, hit the validator BEFORE we
  // persist anything. This catches "used login password instead of API
  // password" style mistakes inline and surfaces the live balance/credits.
  let validatorMeta = null;
  try {
    const pre = await _ctPreflight(tool, payload);
    if (pre && pre.valid === false) {
      _ctShowToast(pre.error || `${tool.name} credentials didn’t validate`, 'error');
      // Restore the prior status so the card doesn't get stuck on "connecting".
      await _ctRefresh();
      return;
    }
    if (pre && pre.valid === true) {
      validatorMeta = pre.meta || null;
    }
  } catch (err) {
    console.warn('[ConnectTools] pre-flight validator failed:', err);
    // Don't block on validator transport errors — fall through to connect.
  }

  try {
    const result = await window.pocketAgent.connectTools.connect(tool.id, payload);
    if (!result.success) {
      _ctShowToast(result.error || `Failed to connect ${tool.name}`, 'error');
    } else {
      _ctShowToast(`${tool.name} connected.`, 'success');
      // Wipe the draft on success so secrets don't linger in memory.
      delete _ctDrafts[tool.id];
      // Stash validator meta so the next _ctRender() can surface credits /
      // balance in the header line. _ctRefresh() rebuilds _ctStatuses from
      // IPC, so we re-apply after.
      if (validatorMeta) {
        await _ctRefresh();
        if (_ctStatuses[tool.id]) {
          _ctStatuses[tool.id].validatorMeta = validatorMeta;
          _ctRender();
        }
        return;
      }
    }
  } catch (err) {
    _ctShowToast(err.message || `Failed to connect ${tool.name}`, 'error');
  }
  await _ctRefresh();
}

// Run the tool-specific pre-flight validator (if any). Returns:
//   { valid: true,  meta?: {...} }   — ok to proceed
//   { valid: false, error: string }  — abort with inline error
//   null                              — no validator for this tool, proceed
async function _ctPreflight(tool, payload) {
  if (!window.pocketAgent || !window.pocketAgent.validate) return null;
  if (tool.id === 'firecrawl') {
    const apiKey = (payload.apiKey || '').trim();
    if (!apiKey) return { valid: false, error: 'API key is required' };
    const r = await window.pocketAgent.validate.firecrawlKey(apiKey);
    if (!r || r.valid !== true) {
      return { valid: false, error: (r && r.error) || 'Firecrawl key didn’t validate' };
    }
    return {
      valid: true,
      meta: { remainingCredits: r.remainingCredits, planCredits: r.planCredits },
    };
  }
  if (tool.id === 'dataforseo') {
    const username = (payload.username || '').trim();
    const password = payload.password || '';
    if (!username || !password) {
      return { valid: false, error: 'Username and API password are required' };
    }
    const r = await window.pocketAgent.validate.dataForSEOKey(username, password);
    if (!r || r.valid !== true) {
      return { valid: false, error: (r && r.error) || 'DataForSEO didn’t validate' };
    }
    return { valid: true, meta: { balance: r.balance } };
  }
  return null;
}

async function _ctDisconnect(tool) {
  const ok = window.confirm(`Disconnect ${tool.name}?`);
  if (!ok) return;
  try {
    const result = await window.pocketAgent.connectTools.disconnect(tool.id);
    if (!result.success) {
      _ctShowToast(result.error || `Failed to disconnect ${tool.name}`, 'error');
    } else {
      _ctShowToast(`${tool.name} disconnected.`, 'success');
    }
  } catch (err) {
    _ctShowToast(err.message || `Failed to disconnect ${tool.name}`, 'error');
  }
  await _ctRefresh();
}

async function copyConnectToolsDiagnostics() {
  try {
    const blob = await window.pocketAgent.connectTools.diagnostics();
    const text = JSON.stringify(blob, null, 2);
    await navigator.clipboard.writeText(text);
    _ctShowToast('Diagnostics copied to clipboard.', 'success');
  } catch (err) {
    console.error('[ConnectTools] diagnostics failed:', err);
    _ctShowToast('Failed to copy diagnostics.', 'error');
  }
}

// ---- Toast ----------------------------------------------------------------

function _ctShowToast(message, type) {
  if (!_ctNotyf) {
    _ctNotyf = new Notyf({
      duration: 3000,
      position: { x: 'right', y: 'bottom' },
      dismissible: true,
      types: [
        { type: 'success', background: '#4ade80' },
        { type: 'error', background: '#f87171' },
      ],
    });
  }
  _ctNotyf[type === 'error' ? 'error' : 'success'](message);
}

// ---- Utility --------------------------------------------------------------

function _ctEscape(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
