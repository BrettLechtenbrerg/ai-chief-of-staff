/**
 * Settings → Connections panel.
 *
 * Renders every entry in `<userData>/mcp-servers.json` with live status
 * from MCPServerManager, and offers add / edit / delete / toggle /
 * test-connection actions. All real work happens in main process via
 * `window.pocketAgent.connections.*` (see src/main/ipc/connections-ipc.ts).
 *
 * Polling: while the panel is visible we re-pull statuses every 5s so the
 * UI reflects the agent's view of which servers are healthy. We stop the
 * poll on exit to keep the renderer idle when the panel is closed.
 */

/* eslint-disable no-unused-vars */
// Functions called from inline onclick handlers in chat.html.

let _connNotyf = null;
let _connPollTimer = null;
let _connEditorState = null; // { mode: 'add' | 'edit', name?: string }

function _connToast(message, type) {
  if (!_connNotyf) {
    _connNotyf = new Notyf({
      duration: 3000,
      position: { x: 'right', y: 'bottom' },
      dismissible: true,
      types: [
        { type: 'success', background: '#4ade80' },
        { type: 'error', background: '#f87171' },
      ],
    });
  }
  _connNotyf[type === 'error' ? 'error' : 'success'](message);
}

function _connEscapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Heuristic: env keys ending in these suffixes are rendered as password fields. */
function _connIsSecretKey(k) {
  return /(_KEY|_TOKEN|_SECRET|_PASSWORD|_PASS|_API_KEY)$/i.test(k);
}

function _connStatusBadge(server) {
  const status = server.status;
  let cls = 'info';
  let label = status;
  if (status === 'ready') {
    cls = 'success';
    label = `Ready (${server.toolCount} ${server.toolCount === 1 ? 'tool' : 'tools'})`;
  } else if (status === 'failed') {
    cls = 'error';
    label = 'Failed';
  } else if (status === 'disabled') {
    cls = 'info';
    label = 'Disabled';
  } else if (status === 'starting') {
    label = 'Starting…';
  } else if (status === 'stopped') {
    label = 'Stopped';
  } else if (status === 'idle') {
    label = 'Idle';
  }
  const errorTip = server.lastError ? ` data-tip="${_connEscapeHtml(server.lastError)}"` : '';
  return `<span class="status ${cls} conn-status-badge"${errorTip}>${_connEscapeHtml(label)}</span>`;
}

async function loadConnections() {
  const listEl = document.getElementById('connections-list');
  if (!listEl) return;
  try {
    const { servers } = await window.pocketAgent.connections.list();
    if (!servers || servers.length === 0) {
      listEl.innerHTML = `
        <div class="connections-empty">
          <p>No connections yet — add one to give your AI more tools.</p>
          <button class="skills-setup-btn btn-compact btn-accent" onclick="playNormalClick(); connOpenEditor()">+ Add Connection</button>
        </div>`;
      return;
    }
    listEl.innerHTML = servers.map(renderConnectionRow).join('');
  } catch (err) {
    console.error('[Connections] Failed to load:', err);
    listEl.innerHTML = `<div class="connections-empty">Couldn't load connections: ${_connEscapeHtml(err.message || 'unknown error')}</div>`;
  }
}

function renderConnectionRow(server) {
  const enabled = !server.disabled;
  // Match the convention used elsewhere in #settings-view: `.toggle.active`
  // drives the on-state styling (background + knob translate) from
  // settings-panel.css.
  const toggleClass = enabled ? 'toggle active' : 'toggle';
  return `
    <div class="conn-row" data-name="${_connEscapeHtml(server.name)}">
      <div class="conn-row-main">
        <div class="conn-row-name">${_connEscapeHtml(server.name)}</div>
        <div class="conn-row-cmd">${_connEscapeHtml(server.command)} ${_connEscapeHtml((server.args || []).join(' '))}</div>
      </div>
      <div class="conn-row-status">
        ${_connStatusBadge(server)}
      </div>
      <div class="conn-row-actions">
        <div class="${toggleClass}" data-tip="${enabled ? 'Disable' : 'Enable'}" onclick="playNormalClick(); connToggle('${_connEscapeHtml(server.name)}', ${!enabled})"></div>
        <button class="conn-icon-btn" data-tip="Edit" onclick="playNormalClick(); connOpenEditor('${_connEscapeHtml(server.name)}')">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m16.474 5.408l2.118 2.117m-.756-3.982L12.109 9.27c-.301.301-.452.452-.582.618q-.231.295-.4.633c-.094.189-.165.39-.305.795l-.59 1.713l-.193.563a.32.32 0 0 0 .405.406l.563-.193l1.713-.591c.404-.139.606-.209.795-.305q.338-.167.633-.398c.166-.131.317-.282.618-.583l5.731-5.73a1.873 1.873 0 0 0-2.65-2.648M19 15c0 1.886 0 2.828-.586 3.414S16.886 19 15 19H9c-1.886 0-2.828 0-3.414-.586S5 16.886 5 15V9c0-1.886 0-2.828.586-3.414S7.114 5 9 5"/></svg>
        </button>
        <button class="conn-icon-btn conn-icon-btn-danger" data-tip="Delete" onclick="playNormalClick(); connDelete('${_connEscapeHtml(server.name)}')">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5" d="m19.5 5.5l-.62 10.025c-.158 2.561-.237 3.842-.88 4.763a4 4 0 0 1-1.2 1.128c-.957.584-2.24.584-4.806.584c-2.57 0-3.855 0-4.814-.585a4 4 0 0 1-1.2-1.13c-.642-.922-.72-2.205-.874-4.77L4.5 5.5M3 5.5h18m-4.944 0l-.683-1.408c-.453-.936-.68-1.403-1.071-1.695a2 2 0 0 0-.275-.172C13.594 2 13.074 2 12.035 2c-1.066 0-1.599 0-2.04.234a2 2 0 0 0-.278.18c-.395.303-.616.788-1.058 1.757L8.053 5.5"/></svg>
        </button>
      </div>
    </div>
  `;
}

async function connOpenEditor(name) {
  const editor = document.getElementById('connections-editor');
  if (!editor) return;

  let existing = null;
  if (name) {
    try {
      const { servers } = await window.pocketAgent.connections.list();
      existing = servers.find((s) => s.name === name) || null;
    } catch (err) {
      _connToast(err.message || 'Failed to load entry', 'error');
      return;
    }
  }
  _connEditorState = name ? { mode: 'edit', name } : { mode: 'add' };

  const envLines = existing
    ? Object.entries(existing.env || {}).map(([k, v]) => `${k}=${v}`).join('\n')
    : '';
  const argsLines = existing ? (existing.args || []).join('\n') : '';

  editor.innerHTML = `
    <div class="conn-editor-header">${name ? `Edit "${_connEscapeHtml(name)}"` : 'New Connection'}</div>
    <div class="conn-editor-grid">
      <label>Name
        <input type="text" id="conn-edit-name" value="${_connEscapeHtml(existing?.name || '')}" placeholder="my-mcp-server">
      </label>
      <label>Command
        <input type="text" id="conn-edit-command" value="${_connEscapeHtml(existing?.command || '')}" placeholder="npx">
      </label>
      <label>Args (one per line)
        <textarea id="conn-edit-args" rows="3" placeholder="-y\n@modelcontextprotocol/server-...">${_connEscapeHtml(argsLines)}</textarea>
      </label>
      <label>Environment (KEY=value, one per line)
        <textarea id="conn-edit-env" rows="3" placeholder="API_KEY=...">${_connEscapeHtml(envLines)}</textarea>
      </label>
      <label>Working directory (optional)
        <input type="text" id="conn-edit-cwd" value="${_connEscapeHtml(existing?.cwd || '')}" placeholder="/absolute/path">
      </label>
    </div>
    <div class="conn-editor-actions">
      <button class="skills-setup-btn btn-compact" onclick="playNormalClick(); connTestConnection()">Test Connection</button>
      <div class="conn-editor-actions-right">
        <button class="skills-setup-btn btn-compact" onclick="playNormalClick(); connCloseEditor()">Cancel</button>
        <button class="skills-setup-btn btn-compact btn-accent" onclick="playNormalClick(); connSave()">Save</button>
      </div>
    </div>
    <div id="conn-editor-status" class="conn-editor-status"></div>
  `;
  editor.classList.remove('hidden');
}

function connCloseEditor() {
  const editor = document.getElementById('connections-editor');
  if (editor) {
    editor.classList.add('hidden');
    editor.innerHTML = '';
  }
  _connEditorState = null;
}

function _connReadEditorInput() {
  const nameEl = document.getElementById('conn-edit-name');
  const cmdEl = document.getElementById('conn-edit-command');
  const argsEl = document.getElementById('conn-edit-args');
  const envEl = document.getElementById('conn-edit-env');
  const cwdEl = document.getElementById('conn-edit-cwd');
  if (!nameEl || !cmdEl) return null;

  const name = (nameEl.value || '').trim();
  const command = (cmdEl.value || '').trim();

  const args = (argsEl?.value || '')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const env = {};
  for (const line of (envEl?.value || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1);
  }

  const cwd = (cwdEl?.value || '').trim();

  return {
    name,
    config: {
      command,
      args: args.length > 0 ? args : undefined,
      env: Object.keys(env).length > 0 ? env : undefined,
      cwd: cwd || undefined,
    },
  };
}

async function connSave() {
  const payload = _connReadEditorInput();
  if (!payload) return;
  if (!payload.name) {
    _connToast('Name is required', 'error');
    return;
  }
  if (!payload.config.command) {
    _connToast('Command is required', 'error');
    return;
  }

  try {
    if (_connEditorState?.mode === 'edit' && _connEditorState.name) {
      await window.pocketAgent.connections.update(
        _connEditorState.name,
        payload.name,
        payload.config,
      );
      _connToast(`Updated "${payload.name}"`, 'success');
    } else {
      await window.pocketAgent.connections.add(payload.name, payload.config);
      _connToast(`Added "${payload.name}"`, 'success');
    }
    connCloseEditor();
    await loadConnections();
  } catch (err) {
    _connToast(err.message || 'Save failed', 'error');
  }
}

async function connTestConnection() {
  const payload = _connReadEditorInput();
  if (!payload) return;
  if (!payload.config.command) {
    _connToast('Command is required', 'error');
    return;
  }
  const statusEl = document.getElementById('conn-editor-status');
  if (statusEl) {
    statusEl.className = 'conn-editor-status info';
    statusEl.textContent = 'Testing connection…';
  }
  try {
    const result = await window.pocketAgent.connections.testConnection(payload.config);
    if (statusEl) {
      if (result.ok) {
        statusEl.className = 'conn-editor-status success';
        statusEl.textContent = `Connected. ${result.toolCount} tool${result.toolCount === 1 ? '' : 's'} available.`;
      } else {
        statusEl.className = 'conn-editor-status error';
        statusEl.textContent = `Failed: ${result.error || 'unknown error'}`;
      }
    }
  } catch (err) {
    if (statusEl) {
      statusEl.className = 'conn-editor-status error';
      statusEl.textContent = `Failed: ${err.message || 'unknown error'}`;
    }
  }
}

async function connDelete(name) {
  // Risk #8 mitigation: spell the name out before deleting.
  if (!confirm(`Delete connection "${name}"? This will stop the server and remove it from mcp-servers.json.`)) {
    return;
  }
  try {
    await window.pocketAgent.connections.delete(name);
    _connToast(`Deleted "${name}"`, 'success');
    await loadConnections();
  } catch (err) {
    _connToast(err.message || 'Delete failed', 'error');
  }
}

async function connToggle(name, enable) {
  try {
    await window.pocketAgent.connections.toggle(name, enable);
    _connToast(enable ? `Enabled "${name}"` : `Disabled "${name}"`, 'success');
    await loadConnections();
  } catch (err) {
    _connToast(err.message || 'Toggle failed', 'error');
  }
}

async function connOpenConfigFile() {
  try {
    await window.pocketAgent.connections.openConfigFile();
  } catch (err) {
    _connToast(err.message || "Couldn't open config file", 'error');
  }
}

function connectionsRefreshStatus() {
  if (_connPollTimer) clearInterval(_connPollTimer);
  // Refresh once on entry, then poll every 5s.
  loadConnections();
  _connPollTimer = setInterval(() => {
    // Only refresh if the section is still visible.
    const section = document.getElementById('connections');
    if (!section || !section.classList.contains('active')) {
      clearInterval(_connPollTimer);
      _connPollTimer = null;
      return;
    }
    loadConnections();
  }, 5000);
}

function connectionsStopPolling() {
  if (_connPollTimer) {
    clearInterval(_connPollTimer);
    _connPollTimer = null;
  }
}

// Hook into the settings-panel navigation. _stgNavigateToSection is defined
// in settings-panel.js; we wrap it so we know when the user enters / exits
// the Connections section without modifying that file's internals.
(function installNavHook() {
  const origReady = () => {
    if (typeof window._stgNavigateToSection !== 'function') return false;
    const original = window._stgNavigateToSection;
    window._stgNavigateToSection = function (sectionId) {
      original(sectionId);
      if (sectionId === 'connections') {
        connectionsRefreshStatus();
      } else {
        connectionsStopPolling();
        connCloseEditor();
      }
    };
    return true;
  };

  // settings-panel.js declares `_stgNavigateToSection` as a free function,
  // not on `window`. Bridge it once both scripts have loaded by polling
  // briefly on DOMContentLoaded.
  document.addEventListener('DOMContentLoaded', () => {
    // Expose the original on window so we can wrap it. We do this by
    // monkey-patching the click handler on the nav item directly \u2014 simpler
    // than reaching into module scope.
    const navItem = document.querySelector('.settings-nav-item[data-section="connections"]');
    if (navItem) {
      navItem.addEventListener('click', () => {
        // Defer so settings-panel.js click handler runs first and toggles
        // the .active class on our section.
        setTimeout(() => connectionsRefreshStatus(), 0);
      });
    }
    // Stop polling when the user leaves the section via any other nav item.
    document.querySelectorAll('.settings-nav-item').forEach((el) => {
      if (el.dataset.section === 'connections') return;
      el.addEventListener('click', () => {
        connectionsStopPolling();
        connCloseEditor();
      });
    });
    // Also stop polling when the settings panel itself is hidden.
    const backBtn = document.querySelector('#settings-view .settings-header button');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        connectionsStopPolling();
        connCloseEditor();
      });
    }
    // Bind once \u2014 origReady() returns whether it succeeded but we don't
    // need it given the click-handler approach above.
    origReady();
  });
})();
