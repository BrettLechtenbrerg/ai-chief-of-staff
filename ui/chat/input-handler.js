function handleKeydown(e) {
  // @Mention autocomplete keyboard nav
  if (mentionActive && document.getElementById('gchat-mention-list')) {
    const items = document.querySelectorAll('.gchat-mention-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      mentionSelectedIndex = Math.min(mentionSelectedIndex + 1, items.length - 1);
      gchatFilterMentions();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      mentionSelectedIndex = Math.max(mentionSelectedIndex - 1, 0);
      gchatFilterMentions();
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const active = items[mentionSelectedIndex];
      if (active) {
        const name = active.textContent.substring(1); // strip leading @
        gchatInsertMention(name);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      gchatDismissMentionList();
      return;
    }
  }

  // Tab: Accept the suggestion and place cursor at end
  if (e.key === 'Tab' && getCurrentSuggestion() && !input.value.trim()) {
    e.preventDefault();
    acceptSuggestion();
    return;
  }

  // Enter: Send message (or suggestion if no user input)
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    // If there's a suggestion and no user input, send the suggestion
    if (getCurrentSuggestion() && !input.value.trim()) {
      input.value = getCurrentSuggestion();
      clearSuggestion();
    }
    handleSendClick();
    return;
  }

  // Escape: Clear mention list first, then reply banner, then suggestion
  if (e.key === 'Escape') {
    if (gchatReplyTo) {
      e.preventDefault();
      gchatClearReply();
      return;
    }
    if (getCurrentSuggestion()) {
      e.preventDefault();
      clearSuggestion();
      return;
    }
  }
}

function autoResizeTextarea() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 150) + 'px';
}

function handleInput(e) {
  // When user types, clear the suggestion
  if (getCurrentSuggestion() && input.value.trim()) {
    clearSuggestion();
  }
  autoResizeTextarea();

  // Send typing indicator in global chat (throttled to 1 per 3s)
  if (globalChatMode) {
    const now = Date.now();
    if (now >= chatTypingThrottleUntil && input.value.trim()) {
      chatTypingThrottleUntil = now + 3000;
      sendChatWs({ type: 'typing' });
    }
  }

  // @Mention detection in global chat
  if (globalChatMode) {
    updateMentionHighlight();
    const cursorPos = input.selectionStart;
    const textBefore = input.value.substring(0, cursorPos);
    const match = textBefore.match(/@([\w-]*)$/);
    if (match) {
      mentionActive = true;
      mentionStartPos = cursorPos - match[0].length;
      mentionQuery = match[1];
      mentionSelectedIndex = 0;
      gchatFilterMentions();
    } else if (mentionActive) {
      gchatDismissMentionList();
    }
  }
}

function setSuggestion(text) {
  if (!text) {
    clearSuggestion();
    return;
  }
  setCurrentSuggestion(text);
  ghostSuggestion.innerHTML = escapeHtml(text) + '<span class="tab-hint">Tab to accept</span>';
  ghostSuggestion.classList.remove('hidden');
  input.classList.add('has-suggestion');
}

function clearSuggestion() {
  setCurrentSuggestion(null);
  ghostSuggestion.innerHTML = '';
  ghostSuggestion.classList.add('hidden');
  input.classList.remove('has-suggestion');
}

function acceptSuggestion() {
  if (!getCurrentSuggestion()) return;
  input.value = getCurrentSuggestion();
  clearSuggestion();
  autoResizeTextarea();
  // Place cursor at the end
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

