function handleCronTestingStart(data) {
  // Only handle if it's for the current session
  if (data.sessionId && data.sessionId !== currentSessionId) return;

  const sessionId = data.sessionId || currentSessionId;

  // Clear empty state / welcome text
  const emptyState = messagesDiv.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  // Clear any stale streaming state from previous interactions
  streamingTextBySession.delete(sessionId);
  const oldBubble = streamingBubbleBySession.get(sessionId);
  if (oldBubble) {
    oldBubble.remove();
    streamingBubbleBySession.delete(sessionId);
  }
  const pendingRaf = streamingRafBySession.get(sessionId);
  if (pendingRaf) {
    cancelAnimationFrame(pendingRaf);
    streamingRafBySession.delete(sessionId);
  }

  // Remove any existing status indicator
  const oldStatusEl = statusElBySession.get(sessionId);
  if (oldStatusEl) {
    oldStatusEl.remove();
    statusElBySession.delete(sessionId);
  }
  toolCountBySession.delete(sessionId);

  // Insert a user message bubble so the UI looks like a normal conversation
  addMessage('user', `⚡ Testing routine: ${data.name}`);

  // Create status indicator (same as when user sends a message)
  isLoadingBySession.set(sessionId, true);
  renderTabs();
  setButtonState(true);
  const statusEl = addStatusIndicator('*stretches paws* thinking...');
  statusElBySession.set(sessionId, statusEl);
  ensureStatusListener(sessionId);
  scrollToBottom();
}

function handleSchedulerMessage(data) {
  console.log(`[Chat] handleSchedulerMessage called - data.sessionId: ${data.sessionId}, currentSessionId: ${currentSessionId}`);
  // Only show message if it's for the current session
  if (data.sessionId && data.sessionId !== currentSessionId) {
    console.log(`[Chat] SKIPPING - session mismatch`);
    return;
  }
  console.log(`[Chat] DISPLAYING - session matches or no sessionId`);

  const sessionId = data.sessionId || currentSessionId;

  // Clear empty state if present
  const emptyState = messagesDiv.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  // Clean up streaming bubble (created by partial_text status events during cron runs)
  const streamBubble = streamingBubbleBySession.get(sessionId);
  if (streamBubble) {
    streamBubble.style.display = 'none';
  }

  // Routine prompts are hidden from the UI - the user only sees the agent's response
  // The prompt is still processed by the agent and saved to the database for history

  // Add the agent's response
  addMessage('assistant', data.response, !streamBubble);

  // Remove streaming bubble after final message is added
  if (streamBubble) {
    streamBubble.remove();
    streamingBubbleBySession.delete(sessionId);
  }
  streamingTextBySession.delete(sessionId);
  const pendingRaf = streamingRafBySession.get(sessionId);
  if (pendingRaf) {
    cancelAnimationFrame(pendingRaf);
    streamingRafBySession.delete(sessionId);
  }

  // Clean up status indicator
  const statusEl = statusElBySession.get(sessionId);
  if (statusEl) {
    statusEl.remove();
    statusElBySession.delete(sessionId);
  }
  toolCountBySession.delete(sessionId);

  // Reset loading state
  isLoadingBySession.set(sessionId, false);
  renderTabs();
  setButtonState(false);

  // Update stats and scroll
  updateStats();
  scrollToBottom();

  // Focus window
  window.focus();
}

function handleTelegramMessage(data) {
  // Only show message if it's for the current session
  // (messages are already saved to SQLite for the correct session)
  if (data.sessionId && data.sessionId !== currentSessionId) {
    console.log(`[Chat] Telegram message for session ${data.sessionId}, current is ${currentSessionId} - skipping display`);
    return;
  }

  // Clear empty state if present
  const emptyState = messagesDiv.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  // Add user message
  addMessage('user', data.userMessage);

  // Add the agent's response (with media if present)
  addMessage('assistant', data.response, true, [], null, true, data.media);

  // Show compaction notice if conversation was compacted
  if (data.wasCompacted) {
    addMessage('system', 'your chat has been compacted', true, [], null, false);
  }

  // Update stats and scroll
  updateStats();
  scrollToBottom();
}


