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
    _ctRender();
  } catch (err) {
    console.error('[ConnectTools] getStatus failed:', err);
  }
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
    if (status.toolCount > 0) return `Connected — ${status.toolCount} tools available`;
    return 'Connected';
  }
  if (status.status === 'connecting') return 'Connecting…';
  if (status.status === 'failed') return 'Failed to start';
  if (status.status === 'reconnect-needed') return 'Reconnect needed';
  return tool.description;
}

function _ctRenderDescription(tool) {
  const p = document.createElement('p');
  p.className = 'ct-card-description';
  p.textContent = tool.description;
  return p;
}

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
    row.innerHTML = `
      <label for="${id}">${_ctEscape(field.label)}</label>
      <input
        id="${id}"
        type="${field.secret ? 'password' : 'text'}"
        placeholder="${_ctEscape(field.placeholder || '')}"
        autocomplete="off"
        spellcheck="false"
        value="${_ctEscape(draft[field.key] || '')}"
      />
    `;
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
  try {
    const result = await window.pocketAgent.connectTools.connect(tool.id, payload);
    if (!result.success) {
      _ctShowToast(result.error || `Failed to connect ${tool.name}`, 'error');
    } else {
      _ctShowToast(`${tool.name} connected.`, 'success');
      // Wipe the draft on success so secrets don't linger in memory.
      delete _ctDrafts[tool.id];
    }
  } catch (err) {
    _ctShowToast(err.message || `Failed to connect ${tool.name}`, 'error');
  }
  await _ctRefresh();
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
