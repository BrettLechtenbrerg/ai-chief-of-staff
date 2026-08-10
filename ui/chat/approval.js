/* User-originated approval queue for confirmation-required tools. */
let _approvalCurrent = null;
const _approvalQueue = [];

function _approvalShowNext() {
  if (_approvalCurrent || !_approvalQueue.length) return;
  _approvalCurrent = _approvalQueue.shift();
  const overlay = document.getElementById('tool-approval-modal');
  document.getElementById('approval-tool-name').textContent = _approvalCurrent.toolName;
  document.getElementById('approval-capability').textContent =
    _approvalCurrent.capability.replaceAll('-', ' ');
  document.getElementById('approval-summary').textContent = _approvalCurrent.summary;
  overlay?.classList.add('show');
  document.getElementById('approval-deny-btn')?.focus();
}

async function resolveToolApproval(decision) {
  const request = _approvalCurrent;
  if (!request) return false;
  _approvalCurrent = null;
  document.getElementById('tool-approval-modal')?.classList.remove('show');
  try {
    const result = await window.pocketAgent.approval.resolve(request.id, decision);
    return Boolean(result && result.success);
  } catch (error) {
    console.error('[Approval] Failed to resolve request:', error);
    return false;
  } finally {
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
  _approvalCurrent = null;
  document.getElementById('tool-approval-modal')?.classList.remove('show');
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
    if (event.key === 'Escape' && _approvalCurrent) void resolveToolApproval('deny');
  });
});
