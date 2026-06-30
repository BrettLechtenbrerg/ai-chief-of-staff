async function loadHistory(options = {}) {
  const { preserveScroll = false } = options;
  // Capture scroll position (and whether user was pinned to bottom) before wiping.
  const prevScrollTop = messagesDiv.scrollTop;
  const prevDistFromBottom = messagesDiv.scrollHeight - messagesDiv.scrollTop - messagesDiv.clientHeight;
  const wasAtBottom = prevDistFromBottom < 40;
  try {
    const history = await window.pocketAgent.agent.getHistory(100, currentSessionId);
    disableAutoAnimate(); messagesDiv.innerHTML = '';

    if (history.length === 0) {
      showEmptyState();
    } else {
      let lastDate = null;
      for (let i = 0; i < history.length; i++) {
        const msg = history[i];
        // Add date separator if needed
        const msgDate = parseSqliteTimestamp(msg.timestamp).toLocaleDateString();
        if (msgDate !== lastDate) {
          addTimestamp(msgDate);
          lastDate = msgDate;
        }

        // Hide routine prompts — only show the agent's response
        if (msg.role === 'user' && msg.metadata?.source === 'scheduler') {
          continue;
        }

        // Strip workflow content from user messages — show badge + user text only
        let displayContent = msg.content;
        let isWorkflowMsg = false;
        if (msg.role === 'user' && msg.content.startsWith('[Workflow: ')) {
          const endBracket = msg.content.indexOf(']');
          const endMarker = msg.content.indexOf('[/Workflow]');
          if (endBracket !== -1 && endMarker !== -1) {
            const workflowName = msg.content.substring(11, endBracket);
            const userText = msg.content.substring(endMarker + 11).replace(/^\n\n/, '').trim();
            displayContent = workflowName + (userText ? ' ' + userText : '');
            isWorkflowMsg = true;
          }
        }

        // Render error messages with error style instead of assistant style
        const renderRole = (msg.role === 'assistant' && msg.metadata?.isError) ? 'error' : msg.role;
        const msgEl = addMessage(renderRole, displayContent, false, [], msg.timestamp);
      }
    }

    enableAutoAnimate();
    if (preserveScroll && !wasAtBottom) {
      // Restore prior scroll position after the DOM has laid out.
      requestAnimationFrame(() => {
        messagesDiv.scrollTo({ top: prevScrollTop, behavior: 'instant' });
      });
    } else {
      scrollToBottom(true); // Instant scroll on initial load / when pinned to bottom
    }
  } catch (err) {
    enableAutoAnimate();
    console.error('Failed to load history:', err);
    showEmptyState();
  }
}

let _appVersion = '';

async function updateStats() {
  try {
    if (!_appVersion) {
      try { _appVersion = await window.pocketAgent.app.getVersion(); } catch (e) { /* ignore */ }
    }
    const prefix = _appVersion ? `AI Chief of Staff v${_appVersion}` : 'AI Chief of Staff';
    const stats = await window.pocketAgent.agent.getStats(currentSessionId);
    if (stats) {
      let parts = [`${stats.messageCount} msgs`];
      if (currentAgentMode !== 'coder') {
        parts.push(`${stats.factCount} facts`);
      }
      if (stats.contextTokens != null && stats.contextWindow) {
        const pct = Math.round((stats.contextTokens / stats.contextWindow) * 100);
        parts.push(`${pct}% context`);
      }

      document.title = `${prefix} — ${parts.join(' · ')}`;
    }
  } catch (err) {
    console.error('Failed to get stats:', err);
  }
}

async function updateModelBadge() {
  try {
    const badge = document.getElementById('model-badge');
    const modelId = await window.pocketAgent.settings.get('agent.model');
    const fallbackNames = {
      'claude-opus-4-7': 'OPUS 4.7',
      'claude-opus-4-6': 'OPUS 4.6',
      'claude-sonnet-4-6': 'SONNET 4.6',
      'claude-haiku-4-5-20251001': 'HAIKU 4.5',
      'kimi-k2.6': 'KIMI K2.6',
      'glm-5-turbo': 'GLM-5 TURBO',
      'glm-5': 'GLM-5',
      'glm-4.7': 'GLM-4.7',
    };

    let models = [];
    try {
      models = await window.pocketAgent.settings.getAvailableModels();
    } catch (_) {
      // IPC failed — fall back to single option
    }

    badge.innerHTML = '';

    if (models.length > 0) {
      for (const model of models) {
        const opt = document.createElement('option');
        opt.value = model.id;
        opt.textContent = model.name;
        if (model.id === modelId) opt.selected = true;
        badge.appendChild(opt);
      }
    } else {
      // Fallback: show current model only
      const opt = document.createElement('option');
      opt.value = modelId;
      opt.textContent = fallbackNames[modelId] || modelId.toUpperCase();
      opt.selected = true;
      badge.appendChild(opt);
    }

    // Sentinel row: lets the user pull newly-released models on demand. Picking
    // it runs discovery instead of switching the model (handled below).
    const discover = document.createElement('option');
    discover.value = '__discover__';
    discover.textContent = '🔄 Check for new models…';
    badge.appendChild(discover);
  } catch (err) {
    console.error('Failed to load model:', err);
  }
}

let _modelDiscoverNotyf = null;
function _modelDiscoverToast(message, type) {
  try {
    if (!_modelDiscoverNotyf) {
      _modelDiscoverNotyf = new Notyf({
        duration: 3500,
        position: { x: 'right', y: 'bottom' },
        dismissible: true,
        types: [
          { type: 'success', background: '#4ade80' },
          { type: 'error', background: '#f87171' },
        ],
      });
    }
    _modelDiscoverNotyf[type === 'error' ? 'error' : 'success'](message);
  } catch (_) { /* Notyf unavailable — ignore */ }
}

// Model badge change handler — switch model and auto-reboot
document.getElementById('model-badge').addEventListener('change', async (e) => {
  const newModel = e.target.value;
  const badge = e.target;

  // "Check for new models…" sentinel — run live discovery, then restore the
  // real selection. Never treated as an actual model switch.
  if (newModel === '__discover__') {
    badge.disabled = true;
    _modelDiscoverToast('Checking for new models…', 'success');
    try {
      const res = await window.pocketAgent.settings.discoverModels();
      await updateModelBadge();
      if (res && res.ok) {
        _modelDiscoverToast(
          res.added > 0
            ? `Added ${res.added} new model${res.added === 1 ? '' : 's'} 🎉`
            : 'You\'re up to date — no new models found',
          'success'
        );
      } else {
        _modelDiscoverToast((res && res.error) || 'Could not check for models', 'error');
      }
    } catch (err) {
      console.error('Model discovery failed:', err);
      await updateModelBadge();
      _modelDiscoverToast('Could not check for models', 'error');
    } finally {
      badge.disabled = false;
    }
    return;
  }

  try {
    // Save new model setting
    await window.pocketAgent.settings.set('agent.model', newModel);
    // Flash badge to indicate switching
    badge.classList.add('badge-attachment');
    // Restart agent with new model
    await window.pocketAgent.agent.restart();
    // Restore badge color
    badge.classList.remove('badge-attachment');
    await updateModelBadge();
  } catch (err) {
    console.error('Failed to switch model:', err);
    badge.classList.remove('badge-attachment');
    await updateModelBadge();
  }
});

