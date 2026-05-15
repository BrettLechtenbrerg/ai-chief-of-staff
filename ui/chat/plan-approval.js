// ---- Plan Mode Approval ----
let planApprovalSessionId = null;
let planRejectState = 'initial'; // 'initial' | 'feedback'

function showPlanApproval(content, sessionId) {
  planApprovalSessionId = sessionId;
  planRejectState = 'initial';

  const overlay = document.getElementById('plan-approval-overlay');
  const body = document.getElementById('plan-approval-body');
  const feedbackInput = document.getElementById('plan-feedback-input');

  // Render plan content as markdown
  if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
    body.innerHTML = DOMPurify.sanitize(marked.parse(content));
  } else {
    body.textContent = content;
  }

  feedbackInput.classList.add('hidden');
  feedbackInput.value = '';
  overlay.classList.add('show');
}

function hidePlanApproval() {
  document.getElementById('plan-approval-overlay').classList.remove('show');
  planApprovalSessionId = null;
  planRejectState = 'initial';
}

async function approvePlan() {
  if (!planApprovalSessionId) return;
  const sessionId = planApprovalSessionId;
  hidePlanApproval();

  // Send approval as a regular follow-up message
  await sendPlanResponse('Approved. Proceed with implementation.', sessionId);
}

function rejectPlan() {
  if (planRejectState === 'initial') {
    // First click: show feedback textarea
    planRejectState = 'feedback';
    const feedbackInput = document.getElementById('plan-feedback-input');
    feedbackInput.classList.remove('hidden');
    feedbackInput.focus();
    document.getElementById('plan-reject-btn').textContent = 'Send revision';
    return;
  }

  // Second click: send rejection with feedback
  if (!planApprovalSessionId) return;
  const sessionId = planApprovalSessionId;
  const feedback = document.getElementById('plan-feedback-input').value.trim();
  hidePlanApproval();

  const message = feedback
    ? `Rejected. Please revise the plan with this feedback:\n${feedback}`
    : 'Rejected. Please revise the plan.';
  sendPlanResponse(message, sessionId);
}

async function sendPlanResponse(message, sessionId) {
  // Show the user message in chat
  addMessage('user', message, true);

  // Set loading state
  isLoadingBySession.set(sessionId, true);
  renderTabs();
  if (currentSessionId === sessionId) {
    setButtonState(true);
  }
  const statusEl = addStatusIndicator('*stretches paws* thinking...');
  statusElBySession.set(sessionId, statusEl);
  ensureStatusListener(sessionId);
  scrollToBottom();

  try {
    const result = await window.pocketAgent.agent.send(message, sessionId);

    // Clean up
    const currentStatusEl = statusElBySession.get(sessionId);
    if (currentStatusEl) {
      currentStatusEl.remove();
      statusElBySession.delete(sessionId);
    }
    toolCountBySession.delete(sessionId);
    isLoadingBySession.set(sessionId, false);
    renderTabs();
    if (currentSessionId === sessionId) {
      setButtonState(false);
    }

    // Remove streaming bubble if present
    const streamBubble = streamingBubbleBySession.get(sessionId);
    if (streamBubble) disableAutoAnimate();
    if (streamBubble) {
      streamBubble.remove();
      streamingBubbleBySession.delete(sessionId);
    }
    streamingTextBySession.delete(sessionId);

    if (currentSessionId === sessionId) {
      if (result.success && result.planPending) {
        // Another plan revision — show approval again
        addMessage('assistant', result.response, true, [], null, true, result.media);
        showPlanApproval(result.response, sessionId);
      } else if (result.success) {
        addMessage('assistant', result.response, true, [], null, true, result.media);
        if (result.suggestedPrompt) {
          setSuggestion(result.suggestedPrompt);
        }
      } else if (result.error) {
        const errorMsg = result.error || '';
        if (!errorMsg.includes('stopped') && !errorMsg.includes('aborted')) {
          addMessage('error', errorMsg);
        }
      }
      updateStats();
      scrollToBottom();
    }
    if (streamBubble) requestAnimationFrame(() => enableAutoAnimate());
  } catch (err) {
    console.error('Plan response failed:', err);
    const currentStatusEl = statusElBySession.get(sessionId);
    if (currentStatusEl) {
      currentStatusEl.remove();
      statusElBySession.delete(sessionId);
    }
    isLoadingBySession.set(sessionId, false);
    renderTabs();
    if (currentSessionId === sessionId) {
      setButtonState(false);
      addMessage('error', err.message || 'Failed to send plan response');
      scrollToBottom();
    }
  }
}
