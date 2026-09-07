/* User-originated approval queue for confirmation-required tools. */
let _approvalCurrent = null;
const _approvalQueue = [];
let _approvalExpiryTimer = null;
let _approvalPreviousFocus = null;
const _approvalBackground = [];

function _approvalHide() {
  document.getElementById('tool-approval-modal')?.classList.remove('show');
  for (const element of _approvalBackground.splice(0)) element.inert = false;
}

function _approvalShowNext() {
  if (_approvalCurrent || !_approvalQueue.length) return;
  _approvalCurrent = _approvalQueue.shift();
  if (_approvalCurrent.expiresAt <= Date.now()) {
    _approvalCurrent = null;
    _approvalShowNext();
    return;
  }
  _approvalPreviousFocus = document.activeElement;
  _approvalExpiryTimer = setTimeout(() => void resolveToolApproval('deny'), _approvalCurrent.expiresAt - Date.now());
  const overlay = document.getElementById('tool-approval-modal');
  document.getElementById('approval-tool-name').textContent = _approvalCurrent.toolName;
  document.getElementById('approval-capability').textContent =
    _approvalCurrent.capability.replaceAll('-', ' ');
  document.getElementById('approval-summary').textContent = `Session: ${_approvalCurrent.sessionId}. ${_approvalCurrent.summary}`;
  document.getElementById('approval-details').textContent = _approvalCurrent.details || 'No argument preview available.';
  for (let container = overlay; container?.parentElement; container = container.parentElement) {
    for (const sibling of container.parentElement.children) {
      if (sibling !== container && sibling instanceof HTMLElement && !sibling.inert) {
        sibling.inert = true;
        _approvalBackground.push(sibling);
      }
    }
  }
  overlay?.classList.add('show');
  document.getElementById('approval-deny-btn')?.focus();
}

async function resolveToolApproval(decision) {
  const request = _approvalCurrent;
  if (!request) return false;
  clearTimeout(_approvalExpiryTimer);
  _approvalCurrent = null;
  _approvalHide();
  try {
    const result = await window.pocketAgent.approval.resolve(request.id, decision);
    return Boolean(result && result.success);
  } catch (error) {
    console.error('[Approval] Failed to resolve request:', error);
    return false;
  } finally {
    _approvalPreviousFocus?.focus();
    _approvalShowNext();
  }
}

// Voice approval uses a separate main-process path. The main process accepts
// only exact recognized phrases and records the source as `voice`; model output
// cannot call this function directly through the Realtime tool bridge.
window.resolvePendingToolApprovalFromVoice = async function (transcript) {
  const request = _approvalCurrent;
  if (!request) return false;
  const result = await window.pocketAgent.approval.resolveVoice(request.id, transcript);
  if (!result || !result.success) return false;
  clearTimeout(_approvalExpiryTimer);
  _approvalCurrent = null;
  _approvalHide();
  _approvalPreviousFocus?.focus();
  _approvalShowNext();
  return true;
};

document.addEventListener('DOMContentLoaded', () => {
  window.pocketAgent.approval.onRequested((request) => {
    if (request.expiresAt <= Date.now()) return;
    _approvalQueue.push(request);
    _approvalShowNext();
  });

  document.getElementById('tool-approval-modal')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) void resolveToolApproval('deny');
  });

  document.addEventListener('keydown', (event) => {
    if (!_approvalCurrent) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      void resolveToolApproval('deny');
    } else if (event.key === 'Tab') {
      const controls = [...document.querySelectorAll('#tool-approval-modal button:not(:disabled), #tool-approval-modal [tabindex="0"]')];
      const index = controls.indexOf(document.activeElement);
      if (index === -1 || (event.shiftKey ? index === 0 : index === controls.length - 1)) {
        event.preventDefault();
        (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
      }
    }
  });
});
