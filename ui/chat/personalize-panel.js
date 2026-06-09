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
  _pzLoadContext();
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

// ---- Context (brand book / style / business / refs / custom instructions) ----

// Brand-scoped fields live on the selected brand (brands table); the field id
// pz-context-<key> maps to brand column <brandColumn>. The remaining two
// fields are shared across brands and stay in personalize.* settings.
const _pzBrandContextFields = {
  brandStyle: 'brand_style',
  writingRules: 'writing_rules',
  business: 'business',
};
const _pzSharedContextFields = ['references', 'customInstructions'];

// In-memory brand list + currently selected brand id for the Knowledge Base tab.
let _pzBrands = [];
let _pzSelectedBrandId = null;

// Publishing profiles from ~/dev/_brand-profiles ([] for testers without it).
let _pzPublishProfiles = [];

function _pzInitContextTabs() {
  const tabs = document.getElementById('pz-context-mode-tabs');
  if (!tabs) return;
  tabs.querySelectorAll('.pz-mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.querySelectorAll('.pz-mode-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.contextTab;
      document.querySelectorAll('[data-context-panel]').forEach(p => {
        p.style.display = p.dataset.contextPanel === target ? '' : 'none';
      });
    });
  });
}

async function _pzLoadContext() {
  _pzInitContextTabs();
  try {
    // Shared fields come from settings; wire their drop targets once.
    for (const field of _pzSharedContextFields) {
      const input = document.getElementById(`pz-context-${field}`);
      if (input) {
        input.value = (await window.pocketAgent.settings.get(`personalize.${field}`)) || '';
        _pzWireContextDropTarget(input);
      }
    }
    // Reset any stale inline name editor left open from a prior visit.
    pzCancelBrandEdit();
    // Brand-scoped fields come from the selected brand.
    await _pzLoadBrands();
    for (const field of Object.keys(_pzBrandContextFields)) {
      const input = document.getElementById(`pz-context-${field}`);
      if (input) _pzWireContextDropTarget(input);
    }
  } catch (e) { console.error('[Personalize] Error loading context:', e); }
}

// Load brands, populate the selector, and fill the brand-scoped textareas
// from whichever brand is selected (default brand on first load).
async function _pzLoadBrands() {
  try {
    _pzBrands = (await window.pocketAgent.brands.list()) || [];
  } catch (e) {
    console.error('[Personalize] Error loading brands:', e);
    _pzBrands = [];
  }

  try {
    _pzPublishProfiles = window.pocketAgent.brands.listPublishProfiles
      ? (await window.pocketAgent.brands.listPublishProfiles()) || []
      : [];
  } catch (e) {
    console.error('[Personalize] Error loading publish profiles:', e);
    _pzPublishProfiles = [];
  }

  const select = document.getElementById('pz-brand-select');
  if (!select) return;

  // Keep a valid selection: previous pick if it still exists, else default.
  if (!_pzSelectedBrandId || !_pzBrands.some(b => b.id === _pzSelectedBrandId)) {
    const def = _pzBrands.find(b => b.is_default);
    _pzSelectedBrandId = def ? def.id : (_pzBrands[0] && _pzBrands[0].id) || null;
  }

  select.innerHTML = '';
  for (const b of _pzBrands) {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = b.is_default ? `${b.name} (default)` : b.name;
    if (b.id === _pzSelectedBrandId) opt.selected = true;
    select.appendChild(opt);
  }

  _pzFillBrandFields();
}

// Populate the three brand-scoped textareas from the selected brand record.
function _pzFillBrandFields() {
  const brand = _pzBrands.find(b => b.id === _pzSelectedBrandId);
  for (const [field, column] of Object.entries(_pzBrandContextFields)) {
    const input = document.getElementById(`pz-context-${field}`);
    if (input) input.value = (brand && brand[column]) || '';
  }
  const badge = document.getElementById('pz-brand-default-badge');
  const setDefaultBtn = document.getElementById('pz-brand-setdefault');
  if (badge) badge.style.display = brand && brand.is_default ? '' : 'none';
  if (setDefaultBtn) setDefaultBtn.disabled = !!(brand && brand.is_default);
  _pzFillPublishRow(brand);
}

// Show/refresh the "Publishes to" dropdown for the selected brand. Hidden
// entirely when there are no publishing profiles on this machine.
function _pzFillPublishRow(brand) {
  const row = document.getElementById('pz-brand-publish-row');
  const select = document.getElementById('pz-brand-publish-select');
  if (!row || !select) return;

  if (!_pzPublishProfiles.length) {
    row.style.display = 'none';
    return;
  }
  row.style.display = '';

  const current = (brand && brand.profile_slug) || '';
  select.innerHTML = '';

  const noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = 'Not linked — saves to Desktop';
  select.appendChild(noneOpt);

  for (const p of _pzPublishProfiles) {
    const opt = document.createElement('option');
    opt.value = p.slug;
    const dest = (p.blogIndexUrl || '').replace(/^https?:\/\/(www\.)?/, '');
    opt.textContent = dest ? `${p.shortName || p.name} — ${dest}` : (p.shortName || p.name);
    select.appendChild(opt);
  }
  select.value = current;
  // Linked profile vanished from disk — fall back to the "not linked" option.
  if (select.value !== current) select.value = '';
}

// Persist the publishing-profile link for the selected brand.
async function pzOnBrandPublishChange() {
  const select = document.getElementById('pz-brand-publish-select');
  const brand = _pzBrands.find(b => b.id === _pzSelectedBrandId);
  if (!select || !brand) return;
  const profileSlug = select.value;
  try {
    const res = await window.pocketAgent.brands.update(brand.id, { profile_slug: profileSlug });
    if (!res || !res.success) {
      _pzShowToast(res && res.error ? res.error : 'Couldn\'t link publishing profile', 'error');
      select.value = brand.profile_slug || '';
      return;
    }
    if (res.brand) Object.assign(brand, res.brand);
    const profile = _pzPublishProfiles.find(p => p.slug === profileSlug);
    _pzShowToast(
      profile
        ? `"${brand.name}" now publishes to ${profile.shortName || profile.name}`
        : `"${brand.name}" unlinked — saves to Desktop`,
      'success'
    );
  } catch (e) {
    _pzShowToast('Couldn\'t link publishing profile', 'error');
    select.value = brand.profile_slug || '';
  }
}

// Switching the brand selector: persist any edits to the current brand first
// so unsaved field changes aren't silently lost, then load the new brand.
async function pzOnBrandChange() {
  const select = document.getElementById('pz-brand-select');
  if (!select) return;
  const nextId = select.value;
  if (nextId === _pzSelectedBrandId) return;
  await _pzSaveBrandFields();
  _pzSelectedBrandId = nextId;
  // Re-read from server so we reflect the persisted state of the picked brand.
  await _pzLoadBrands();
}

// Persist the three brand-scoped textareas to the selected brand.
async function _pzSaveBrandFields() {
  if (!_pzSelectedBrandId) return true;
  const update = {};
  for (const [field, column] of Object.entries(_pzBrandContextFields)) {
    const input = document.getElementById(`pz-context-${field}`);
    if (input) update[column] = input.value;
  }
  try {
    const res = await window.pocketAgent.brands.update(_pzSelectedBrandId, update);
    if (!res || !res.success) {
      _pzShowToast(res && res.error ? res.error : 'Couldn\'t save brand', 'error');
      return false;
    }
    // Reflect saved values locally without a full reload.
    const brand = _pzBrands.find(b => b.id === _pzSelectedBrandId);
    if (brand && res.brand) Object.assign(brand, res.brand);
    return true;
  } catch (e) {
    _pzShowToast('Couldn\'t save brand', 'error');
    return false;
  }
}

// window.prompt is a no-op in this Electron renderer, so Add/Rename use an
// inline input row instead. _pzBrandEditMode is 'add' | 'rename' | null.
let _pzBrandEditMode = null;

function _pzShowBrandEdit(mode, initialValue) {
  _pzBrandEditMode = mode;
  const bar = document.getElementById('pz-brand-bar');
  const editor = document.getElementById('pz-brand-edit');
  const input = document.getElementById('pz-brand-name-input');
  if (bar) bar.style.display = 'none';
  if (editor) editor.style.display = '';
  if (input) {
    input.value = initialValue || '';
    input.focus();
    input.select();
  }
}

function pzCancelBrandEdit() {
  _pzBrandEditMode = null;
  const bar = document.getElementById('pz-brand-bar');
  const editor = document.getElementById('pz-brand-edit');
  if (editor) editor.style.display = 'none';
  if (bar) bar.style.display = '';
}

// Enter commits, Escape cancels.
function pzBrandEditKey(event) {
  if (event.key === 'Enter') { event.preventDefault(); pzCommitBrandEdit(); }
  else if (event.key === 'Escape') { event.preventDefault(); pzCancelBrandEdit(); }
}

function pzStartAddBrand() {
  _pzShowBrandEdit('add', '');
}

function pzStartRenameBrand() {
  const brand = _pzBrands.find(b => b.id === _pzSelectedBrandId);
  if (!brand) return;
  _pzShowBrandEdit('rename', brand.name);
}

async function pzCommitBrandEdit() {
  const input = document.getElementById('pz-brand-name-input');
  const name = input ? input.value.trim() : '';
  if (!name) { _pzShowToast('Enter a brand name', 'error'); return; }
  const mode = _pzBrandEditMode;

  if (mode === 'add') {
    try {
      const res = await window.pocketAgent.brands.create({ name });
      if (!res || !res.success) {
        _pzShowToast(res && res.error ? res.error : 'Couldn\'t add brand', 'error');
        return;
      }
      _pzSelectedBrandId = res.brand.id;
      pzCancelBrandEdit();
      await _pzLoadBrands();
      _pzShowToast(`Added brand "${res.brand.name}"`, 'success');
    } catch (e) {
      _pzShowToast('Couldn\'t add brand', 'error');
    }
    return;
  }

  if (mode === 'rename') {
    const brand = _pzBrands.find(b => b.id === _pzSelectedBrandId);
    if (!brand) { pzCancelBrandEdit(); return; }
    if (name === brand.name) { pzCancelBrandEdit(); return; }
    try {
      const res = await window.pocketAgent.brands.update(brand.id, { name });
      if (!res || !res.success) {
        _pzShowToast(res && res.error ? res.error : 'Couldn\'t rename', 'error');
        return;
      }
      pzCancelBrandEdit();
      await _pzLoadBrands();
      _pzShowToast('Renamed', 'success');
    } catch (e) {
      _pzShowToast('Couldn\'t rename', 'error');
    }
  }
}

async function pzSetDefaultBrand() {
  if (!_pzSelectedBrandId) return;
  try {
    const res = await window.pocketAgent.brands.setDefault(_pzSelectedBrandId);
    if (!res || !res.success) {
      _pzShowToast(res && res.error ? res.error : 'Couldn\'t set default', 'error');
      return;
    }
    await _pzLoadBrands();
    _pzShowToast('Set as default brand', 'success');
    _pzActivateReboot();
  } catch (e) {
    _pzShowToast('Couldn\'t set default', 'error');
  }
}

async function pzDeleteBrand() {
  const brand = _pzBrands.find(b => b.id === _pzSelectedBrandId);
  if (!brand) return;
  if (_pzBrands.length <= 1) {
    _pzShowToast('Can\'t delete the last brand', 'error');
    return;
  }
  if (!window.confirm(`Delete brand "${brand.name}"? Sessions using it fall back to the default brand.`)) return;
  try {
    const res = await window.pocketAgent.brands.delete(brand.id);
    if (!res || !res.success) {
      _pzShowToast(res && res.error ? res.error : 'Couldn\'t delete', 'error');
      return;
    }
    _pzSelectedBrandId = null;
    await _pzLoadBrands();
    _pzShowToast(`Deleted "${brand.name}"`, 'success');
  } catch (e) {
    _pzShowToast('Couldn\'t delete', 'error');
  }
}

// Soft cap per field. Plenty of room for a typical brand book (5-20 pages)
// while keeping the per-turn system-prompt cost reasonable. Set to 30k.
const _PZ_CONTEXT_SOFT_CAP = 30000;

function _pzWireContextDropTarget(textarea) {
  if (!textarea || textarea.dataset.pzDropWired === 'true') return;
  textarea.dataset.pzDropWired = 'true';

  // Visual feedback — toggle a class while a draggable item is over the textarea.
  textarea.addEventListener('dragenter', (e) => {
    e.preventDefault();
    textarea.classList.add('pz-drop-active');
  });
  textarea.addEventListener('dragover', (e) => {
    // Required to let drop fire on the element.
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  textarea.addEventListener('dragleave', (e) => {
    // Only clear when the cursor truly leaves the element (not just a child).
    if (e.target === textarea) textarea.classList.remove('pz-drop-active');
  });
  textarea.addEventListener('drop', (e) => {
    e.preventDefault();
    textarea.classList.remove('pz-drop-active');
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    // Only one file at a time keeps the UX predictable. If multiple are
    // dropped, process the first and toast the rest as skipped.
    const [first, ...rest] = files;
    _pzExtractAndAppend(textarea, first);
    if (rest.length) {
      _pzShowToast(`Inserted 1 file, ignored ${rest.length} more — drop one at a time`, 'success');
    }
  });
}

async function _pzExtractAndAppend(textarea, file) {
  // Electron 32+ deprecated File.path (returns empty); use the preload's
  // webUtils.getPathForFile bridge instead, with a one-line fallback for
  // older builds in case anyone runs this on Electron < 32.
  let filePath = '';
  try {
    if (window.pocketAgent.context && window.pocketAgent.context.getPathForFile) {
      filePath = window.pocketAgent.context.getPathForFile(file);
    }
  } catch (_) { /* fall through to legacy file.path */ }
  if (!filePath && file && file.path) filePath = file.path;

  if (!filePath) {
    _pzShowToast('Could not read dropped file path — try again or paste manually', 'error');
    return;
  }

  _pzShowToast(`Extracting ${file.name}…`, 'success');
  try {
    const result = await window.pocketAgent.context.extractText(filePath);
    if (!result || !result.success) {
      _pzShowToast(result?.error || 'Extraction failed', 'error');
      return;
    }

    const existing = textarea.value.trim();
    const header = `\n\n--- From ${result.filename || 'dropped file'} ---\n\n`;
    const combined = existing ? existing + header + result.text : result.text;

    if (combined.length > _PZ_CONTEXT_SOFT_CAP) {
      const proceed = window.confirm(
        `This will make the field ${combined.length.toLocaleString()} characters ` +
        `(soft cap ${_PZ_CONTEXT_SOFT_CAP.toLocaleString()}). Long context costs more tokens ` +
        `on every chat turn. Insert anyway?`
      );
      if (!proceed) return;
    }

    textarea.value = combined;
    // Trigger any input listeners other code might attach later.
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    _pzShowToast(
      `Inserted ${result.charCount.toLocaleString()} chars from ${result.filename} — don\'t forget to Save`,
      'success'
    );
  } catch (err) {
    console.error('[Personalize] drop extraction failed:', err);
    _pzShowToast('Could not extract text from that file', 'error');
  }
}

async function pzSaveContext() {
  try {
    // Brand-scoped fields go to the selected brand; shared fields to settings.
    const brandOk = await _pzSaveBrandFields();
    for (const field of _pzSharedContextFields) {
      const input = document.getElementById(`pz-context-${field}`);
      if (input) {
        await window.pocketAgent.settings.set(`personalize.${field}`, input.value);
      }
    }
    if (!brandOk) return;
    _pzShowToast('Saved! Reboot to apply', 'success');
    _pzActivateReboot();
  } catch (e) { _pzShowToast('Couldn\'t save context', 'error'); }
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
