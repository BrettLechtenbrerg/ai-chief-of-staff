/* Personalize Panel — embedded in chat.html */

let _pzInitialized = false;
let _pzNotyf = null;
let _pzLocationLookupTimeout = null;
let _pzSystemPromptContent = '';
let _pzAgentModes = [];

function _pzShowToast(msg, type) {
  if (!_pzNotyf) _pzNotyf = new Notyf({ duration: 3000, position: { x: 'right', y: 'bottom' }, dismissible: true, types: [{ type: 'success', background: '#4ade80' }, { type: 'error', background: '#f87171' }] });
  _pzNotyf[type === 'error' ? 'error' : 'success'](msg);
}

// ---- Show / Hide ----

function showPersonalizePanel(tab) {
  const chatView = document.getElementById('chat-view');
  const pzView = document.getElementById('personalize-view');
  if (!pzView) return;

  _dismissOtherPanels('personalize-view');

  chatView.classList.add('hidden');
  pzView.classList.add('active');
  if (window._sidebarEnterPanelMode) window._sidebarEnterPanelMode();

  const sidebarBtn = document.getElementById('sidebar-personalize-btn');
  if (sidebarBtn) sidebarBtn.classList.add('active');

  if (!_pzInitialized) { _pzInit(); _pzInitialized = true; }
  if (tab) _pzSwitchTab(tab);
}

function hidePersonalizePanel() {
  const chatView = document.getElementById('chat-view');
  const pzView = document.getElementById('personalize-view');
  if (!pzView) return;
  pzView.classList.remove('active');
  chatView.classList.remove('hidden');
  if (window._sidebarExitPanelMode) window._sidebarExitPanelMode();

  const sidebarBtn = document.getElementById('sidebar-personalize-btn');
  if (sidebarBtn) sidebarBtn.classList.remove('active');
}

function togglePersonalizePanel() {
  const pzView = document.getElementById('personalize-view');
  if (pzView && pzView.classList.contains('active')) hidePersonalizePanel();
  else showPersonalizePanel();
}

// ---- Init ----

function _pzInit() {
  const root = document.getElementById('personalize-view');
  if (!root) return;

  // Tab navigation
  root.querySelectorAll('.pz-nav-item').forEach(item => {
    item.addEventListener('click', () => { playNormalClick(); _pzSwitchTab(item.dataset.tab); });
  });

  _pzLoadAgentName();
  _pzLoadPersonality();
  _pzLoadWorld();
  _pzLoadSystemPrompt();
  _pzSetupBirthdayPicker();
  _pzLoadTimezones().then(() => _pzLoadProfile());
  _pzSetupLocationAutocomplete();
}

function _pzSwitchTab(tabId) {
  const root = document.getElementById('personalize-view');
  if (!root) return;
  root.querySelectorAll('.pz-nav-item').forEach(n => n.classList.toggle('active', n.dataset.tab === tabId));
  root.querySelectorAll('.pz-tab').forEach(c => c.classList.toggle('active', c.id === `pz-tab-${tabId}`));
}

// ---- Agent Name ----

async function _pzLoadAgentName() {
  try {
    const name = await window.pocketAgent.settings.get('personalize.agentName');
    document.getElementById('pz-agent-name-input').value = name || 'Frankie';
    const desc = await window.pocketAgent.settings.get('personalize.description');
    document.getElementById('pz-agent-description').value = desc || '';
  } catch (e) { console.error('[Personalize] Error loading agent name:', e); }
}

async function pzSaveAgentName() {
  const name = document.getElementById('pz-agent-name-input').value.trim() || 'Frankie';
  const desc = document.getElementById('pz-agent-description').value.trim();
  try {
    await window.pocketAgent.settings.set('personalize.agentName', name);
    await window.pocketAgent.settings.set('personalize.description', desc);
    _pzShowToast('Saved! Reboot to apply', 'success');
    _pzActivateReboot();
  } catch (e) { _pzShowToast('Couldn\'t save name', 'error'); }
}

// ---- Personality ----

async function _pzLoadPersonality() {
  try {
    const p = await window.pocketAgent.settings.get('personalize.personality');
    document.getElementById('pz-personality-editor').value = p || '';
  } catch (e) { console.error('[Personalize] Error loading personality:', e); }
}

async function pzSavePersonality() {
  try {
    await window.pocketAgent.settings.set('personalize.personality', document.getElementById('pz-personality-editor').value);
    _pzShowToast('Saved! Reboot to apply', 'success');
    _pzActivateReboot();
  } catch (e) { _pzShowToast('Couldn\'t save personality', 'error'); }
}

// ---- World ----

function _pzInitWorldTabs() {
  const tabs = document.getElementById('pz-world-mode-tabs');
  if (!tabs) return;
  tabs.querySelectorAll('.pz-mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.querySelectorAll('.pz-mode-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.worldTab;
      document.querySelectorAll('.pz-world-tab-content').forEach(p => p.style.display = p.dataset.worldPanel === target ? '' : 'none');
    });
  });
}

async function _pzLoadWorld() {
  _pzInitWorldTabs();
  try {
    document.getElementById('pz-world-goals').value = await window.pocketAgent.settings.get('personalize.goals') || '';
    document.getElementById('pz-world-struggles').value = await window.pocketAgent.settings.get('personalize.struggles') || '';
    document.getElementById('pz-world-funfacts').value = await window.pocketAgent.settings.get('personalize.funFacts') || '';
  } catch (e) { console.error('[Personalize] Error loading world:', e); }
}

async function pzSaveWorld() {
  try {
    await window.pocketAgent.settings.set('personalize.goals', document.getElementById('pz-world-goals').value);
    await window.pocketAgent.settings.set('personalize.struggles', document.getElementById('pz-world-struggles').value);
    await window.pocketAgent.settings.set('personalize.funFacts', document.getElementById('pz-world-funfacts').value);
    _pzShowToast('Saved! Reboot to apply', 'success');
    _pzActivateReboot();
  } catch (e) { _pzShowToast('Couldn\'t save world', 'error'); }
}

// ---- System Prompt ----

async function _pzLoadSystemPrompt() {
  try {
    const [content, modes] = await Promise.all([
      window.pocketAgent.customize.getSystemPrompt(),
      window.pocketAgent.customize.getAgentModes(),
    ]);
    _pzSystemPromptContent = content || '(agent not initialized)';
    _pzAgentModes = modes || [];

    const tabsContainer = document.getElementById('pz-prompt-mode-tabs');
    if (!tabsContainer) return;
    tabsContainer.innerHTML = '<button class="pz-mode-tab active" data-prompt-mode="system">System Guidelines</button>';
    for (const mode of _pzAgentModes) {
      if (!mode.systemPrompt) continue;
      const btn = document.createElement('button');
      btn.className = 'pz-mode-tab';
      btn.dataset.promptMode = mode.id;
      btn.textContent = mode.name;
      btn.title = mode.description;
      tabsContainer.appendChild(btn);
    }

    tabsContainer.querySelectorAll('.pz-mode-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        tabsContainer.querySelectorAll('.pz-mode-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const modeId = tab.dataset.promptMode;
        const display = document.getElementById('pz-system-prompt-display');
        if (modeId === 'system') display.textContent = _pzSystemPromptContent;
        else { const mode = _pzAgentModes.find(m => m.id === modeId); display.textContent = mode ? mode.systemPrompt : '(no prompt)'; }
      });
    });

    document.getElementById('pz-system-prompt-display').textContent = _pzSystemPromptContent;
  } catch (e) {
    console.error('[Personalize] Error loading system prompt:', e);
    const el = document.getElementById('pz-system-prompt-display');
    if (el) el.textContent = '(error loading prompt)';
  }
}

// ---- Reboot ----

function _pzActivateReboot() {
  const btn = document.getElementById('pz-reboot-btn');
  if (btn) { btn.disabled = false; btn.classList.add('active'); }
}

async function pzRestartAgent() {
  const btn = document.getElementById('pz-reboot-btn');
  if (btn && btn.disabled) return;
  _pzShowToast('Rebooting...', 'success');
  try {
    await window.pocketAgent.agent.restart();
    if (btn) { btn.disabled = true; btn.classList.remove('active'); }
    _pzShowToast('Back online!', 'success');
  } catch (e) { _pzShowToast('Couldn\'t restart', 'error'); }
}

// ---- Profile ----

const _pzProfileFields = ['name', 'location', 'timezone', 'occupation'];

function _pzSetupBirthdayPicker() {
  const daySelect = document.getElementById('pz-profile-birthday-day');
  if (!daySelect) return;
  for (let i = 1; i <= 31; i++) {
    const opt = document.createElement('option');
    opt.value = i; opt.textContent = i;
    daySelect.appendChild(opt);
  }
}

async function _pzLoadTimezones() {
  try {
    const timezones = await window.pocketAgent.location.getTimezones();
    const select = document.getElementById('pz-profile-timezone');
    if (!select) return;
    const grouped = {};
    timezones.forEach(tz => { const [region] = tz.split('/'); if (!grouped[region]) grouped[region] = []; grouped[region].push(tz); });
    Object.keys(grouped).sort().forEach(region => {
      const optgroup = document.createElement('optgroup');
      optgroup.label = region;
      grouped[region].sort().forEach(tz => { const opt = document.createElement('option'); opt.value = tz; opt.textContent = tz.replace(/_/g, ' '); optgroup.appendChild(opt); });
      select.appendChild(optgroup);
    });
  } catch (e) { console.error('[Personalize] Error loading timezones:', e); }
}

async function _pzLoadProfile() {
  try {
    for (const field of _pzProfileFields) {
      const value = await window.pocketAgent.settings.get(`profile.${field}`);
      const input = document.getElementById(`pz-profile-${field}`);
      if (input) input.value = value || '';
    }
    const birthday = await window.pocketAgent.settings.get('profile.birthday');
    if (birthday) {
      const match = birthday.match(/^([A-Za-z]+)\s+(\d{1,2})$/);
      if (match) {
        document.getElementById('pz-profile-birthday-month').value = match[1];
        document.getElementById('pz-profile-birthday-day').value = match[2];
      }
    }
  } catch (e) { _pzShowToast('Couldn\'t load profile', 'error'); }
}

async function pzSaveProfile() {
  const status = document.getElementById('pz-profile-status');
  if (status) status.textContent = 'Saving...';
  try {
    for (const field of _pzProfileFields) {
      const input = document.getElementById(`pz-profile-${field}`);
      if (input) await window.pocketAgent.settings.set(`profile.${field}`, input.value);
    }
    const month = document.getElementById('pz-profile-birthday-month').value;
    const day = document.getElementById('pz-profile-birthday-day').value;
    await window.pocketAgent.settings.set('profile.birthday', month && day ? `${month} ${day}` : '');
    if (status) status.textContent = 'Saved! Reboot to apply';
    _pzShowToast('Got it! Reboot to apply', 'success');
    _pzActivateReboot();
  } catch (e) {
    if (status) status.textContent = 'Failed to save profile';
    _pzShowToast('Couldn\'t save profile', 'error');
  }
}

// ---- Location autocomplete ----

function _pzSetupLocationAutocomplete() {
  const input = document.getElementById('pz-profile-location');
  const dropdown = document.getElementById('pz-location-dropdown');
  if (!input || !dropdown) return;

  input.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    if (_pzLocationLookupTimeout) clearTimeout(_pzLocationLookupTimeout);
    if (query.length < 2) { dropdown.classList.remove('show'); return; }

    _pzLocationLookupTimeout = setTimeout(async () => {
      try {
        const results = await window.pocketAgent.location.lookup(query);
        if (results.length === 0) { dropdown.classList.remove('show'); return; }
        dropdown.innerHTML = results.map(r => `
          <div class="pz-autocomplete-item" data-display="${r.display}" data-timezone="${r.timezone}">
            <div class="city">${r.city}</div>
            <div class="details">${r.province ? r.province + ', ' : ''}${r.country} - ${r.timezone}</div>
          </div>
        `).join('');
        dropdown.querySelectorAll('.pz-autocomplete-item').forEach(item => {
          item.addEventListener('click', () => {
            input.value = item.dataset.display;
            document.getElementById('pz-profile-timezone').value = item.dataset.timezone;
            dropdown.classList.remove('show');
          });
        });
        dropdown.classList.add('show');
      } catch (e) { console.error('[Personalize] Error looking up location:', e); }
    }, 300);
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) dropdown.classList.remove('show');
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') dropdown.classList.remove('show'); });
}
