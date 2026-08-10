/* User-originated approval queue for confirmation-required tools. */
let _approvalCurrent = null;
const _approvalQueue = [];

function _approvalShowNext() {
  if (_approvalCurrent || !_approvalQueue.length) return;
  _approvalCurrent = _approvalQueue.shift();
  const overlay = document.getElementById('tool-approval-modal');
  document.getElementById('approval-tool-name').textContent = _approvalCurrent.toolName;
  document.getElementById('approval-capability').textContent = _approvalCurrent.capability.replaceAll('-', ' ');
  document.getElementById('approval-summary').textContent = _approvalCurrent.summary;
  overlay?.classList.add('show');
  document.getElementById('approval-deny-btn')?.focus();
}

async function resolveToolApproval(decision) {
  const request = _approvalCurrent;
  if (!request) return;
  _approvalCurrent = null;
  document.getElementById('tool-approval-modal')?.classList.remove('show');
  try {
    await window.pocketAgent.approval.resolve(request.id, decision);
  } catch (error) {
    console.error('[Approval] Failed to resolve request:', error);
  }
  _approvalShowNext();
}

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
