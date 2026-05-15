// Event bindings — replaces all inline onclick/oninput/onkeydown/onchange handlers

function bindClick(id, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', handler);
}

function bindMenuClick(id, action) {
  bindClick(id, () => { playNormalClick(); action(); closeMenu(); });
}

// --- About Modal ---
document.getElementById('about-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeAbout();
});
bindClick('about-close-btn', () => { playNormalClick(); closeAbout(); });
bindClick('about-link-youtube', () => {
  playNormalClick();
  window.pocketAgent.app.openExternal('https://www.youtube.com/@kenkaidoesai');
});
bindClick('about-link-skool', () => {
  playNormalClick();
  window.pocketAgent.app.openExternal('https://www.skool.com/kenkai');
});

// --- Plan Approval ---
bindClick('plan-reject-btn', rejectPlan);
bindClick('plan-approve-btn', approvePlan);

// --- Sidebar ---
bindClick('sidebar-new-chat', () => { playNormalClick(); createNewSession(); });
bindClick('sidebar-personalize-btn', () => { playNormalClick(); togglePersonalizePanel(); });
bindClick('sidebar-routines-btn', () => { playNormalClick(); toggleRoutinesPanel(); });
bindClick('sidebar-brain-btn', () => { playNormalClick(); toggleBrainPanel(); });
bindClick('sidebar-docs-btn', () => { playNormalClick(); openDocs(); });
bindClick('sidebar-settings-btn', () => { playNormalClick(); toggleSettingsPanel(); });
bindClick('sidebar-about-btn', () => { playNormalClick(); openAbout(); });

// --- Global Chat Header ---
// --- Scroll Buttons ---
bindClick('scroll-top-btn', () => { playNormalClick(); scrollToTop(); });
bindClick('scroll-bottom-btn', () => { playNormalClick(); scrollToBottom(); });
bindClick('gchat-scroll-top-btn', () => { playNormalClick(); gchatScrollToTop(); });
bindClick('gchat-scroll-bottom-btn', () => { playNormalClick(); gchatScrollToBottom(); });

// --- Search Panel ---
document.getElementById('search-input').addEventListener('input', handleSearchInput);
document.getElementById('search-input').addEventListener('keydown', handleSearchKeydown);
bindClick('search-prev-btn', () => { playNormalClick(); navigateSearch(-1); });
bindClick('search-next-btn', () => { playNormalClick(); navigateSearch(1); });
bindClick('search-close-btn', () => { playNormalClick(); closeSearch(); });

// --- Workflows Panel ---
bindClick('workflows-close-btn', () => { playNormalClick(); closeWorkflows(); });

// --- Input Area ---
bindClick('attach-btn', () => { playNormalClick(); triggerAttach(); });
document.getElementById('message-input').addEventListener('keydown', handleKeydown);
document.getElementById('message-input').addEventListener('input', handleInput);

// --- Input Toolbar ---
bindClick('search-toolbar-btn', () => { playNormalClick(); toggleSearch(); });
bindClick('workflows-toolbar-btn', () => { playNormalClick(); toggleWorkflows(); });
bindClick('fresh-start-btn', () => { playNormalClick(); clearChat(); });
bindClick('admin-clear-chat-btn', () => { playNormalClick(); if (confirm('Clear the entire global chat?')) sendChatWs({ type: 'clear_chat' }); });
bindClick('reply-panel-close', () => { playNormalClick(); gchatClearReply(); });
bindClick('chat-toggle-btn', () => { playNormalClick(); toggleGlobalChat(); });
bindClick('bg-tasks-toggle-btn', () => { playNormalClick(); toggleBackgroundTasks(); });
bindClick('bg-dropdown-back-btn', () => { playNormalClick(); closeBackgroundTasks(); });

// --- Controls ---
document.getElementById('mode-select').addEventListener('change', function() {
  playNormalClick();
  setAgentMode(this.value);
});
bindClick('send-btn', handleSendClick);
document.getElementById('file-input').addEventListener('change', handleFileSelect);
