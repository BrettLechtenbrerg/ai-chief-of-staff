// ============ Agent Mode Toggle ============

let currentAgentMode = 'coder';

async function initAgentMode() {
  try {
    // Load per-session mode for the current session
    const mode = await window.pocketAgent.agent.getSessionMode(currentSessionId);
    currentAgentMode = mode || 'coder';
    await updateModeUIForSession(currentSessionId);
  } catch (err) {
    console.error('Failed to load agent mode:', err);
  }

  // Listen for global mode changes (affects new session defaults only)
  window.pocketAgent.agent.onModeChanged((mode) => {
    // Global mode changed — doesn't affect current session, just new ones
    console.log('[Chat] Global default mode changed:', mode);
  });

  // Listen for session mode changes (from switch_agent tool)
  window.pocketAgent.agent.onSessionModeChanged((sessionId, mode) => {
    console.log('[Chat] Session mode changed via switch_agent:', sessionId, mode);
    if (sessionId === currentSessionId) {
      currentAgentMode = mode;
      updateModeButtons(mode);
    }
  });
}

async function setAgentMode(mode) {
  if (mode === currentAgentMode) return;
  currentAgentMode = mode;
  updateModeButtons(mode);

  // Set the mode on the current session (only works if no messages yet)
  try {
    const result = await window.pocketAgent.agent.setSessionMode(currentSessionId, mode);
    if (!result.success) {
      console.warn('Cannot change session mode:', result.error);
      // Revert UI to actual session mode
      const actualMode = await window.pocketAgent.agent.getSessionMode(currentSessionId);
      currentAgentMode = actualMode;
      updateModeButtons(actualMode);
      return;
    }
  } catch (err) {
    console.error('Failed to set session mode:', err);
    return;
  }

  // Also update the global default for new sessions
  window.pocketAgent.agent.setMode(mode).catch(err => {
    console.error('Failed to set global default mode:', err);
  });
}

function updateModeButtons(mode) {
  const select = document.getElementById('mode-select');
  if (select) select.value = mode;
}

async function updateModeUIForSession(sessionId) {
  try {
    const mode = await window.pocketAgent.agent.getSessionMode(sessionId);
    currentAgentMode = mode || 'coder';
    updateModeButtons(currentAgentMode);

    // Lock select if session has messages
    const select = document.getElementById('mode-select');
    if (select) {
      const history = await window.pocketAgent.agent.getHistory(1, sessionId);
      const hasMessages = history && history.length > 0;
      select.classList.toggle('locked', hasMessages);
    }
  } catch (err) {
    console.error('Failed to update mode UI for session:', err);
  }
}

