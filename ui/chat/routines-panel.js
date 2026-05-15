/* Routines Panel — embedded in chat.html */

let _rtnNotyf = null;
let _rtnSessionsMap = {};

// ---- Show / Hide ----

function showRoutinesPanel() {
  const chatView = document.getElementById('chat-view');
  const routinesView = document.getElementById('routines-view');
  if (!routinesView) return;

  _dismissOtherPanels('routines-view');

  chatView.classList.add('hidden');
  routinesView.classList.add('active');
  if (window._sidebarEnterPanelMode) window._sidebarEnterPanelMode();

  const sidebarBtn = document.getElementById('sidebar-routines-btn');
  if (sidebarBtn) sidebarBtn.classList.add('active');

  _rtnLoadSessions();
  _rtnLoadJobs();
}

function hideRoutinesPanel() {
  const chatView = document.getElementById('chat-view');
  const routinesView = document.getElementById('routines-view');
  if (!routinesView) return;

  routinesView.classList.remove('active');
  chatView.classList.remove('hidden');
  if (window._sidebarExitPanelMode) window._sidebarExitPanelMode();

  const sidebarBtn = document.getElementById('sidebar-routines-btn');
  if (sidebarBtn) sidebarBtn.classList.remove('active');
}

function toggleRoutinesPanel() {
  const routinesView = document.getElementById('routines-view');
  if (routinesView && routinesView.classList.contains('active')) {
    hideRoutinesPanel();
  } else {
    showRoutinesPanel();
  }
}

// ---- Toast ----

function _rtnShowToast(message, type) {
  if (!_rtnNotyf) {
    _rtnNotyf = new Notyf({
      duration: 3000, position: { x: 'right', y: 'bottom' },
      dismissible: true,
      types: [
        { type: 'success', background: '#4ade80' },
        { type: 'error', background: '#f87171' }
      ]
    });
  }
  _rtnNotyf[type === 'error' ? 'error' : 'success'](message);
}

// ---- Helpers ----

function _rtnEscapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function _rtnEscapeAttr(text) {
  return text.replace(/'/g, "\\'").replace(/"/g, '\\"');
}

// ---- Schedule Display ----

function _rtnParseDbTimestamp(timestamp) {
  if (!timestamp) return new Date();
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(timestamp)) return new Date(timestamp);
  return new Date(timestamp.replace(' ', 'T') + 'Z');
}

function _rtnScheduleToHuman(job) {
  const scheduleType = job.schedule_type || 'cron';

  if (scheduleType === 'at' && job.run_at) {
    const runAt = _rtnParseDbTimestamp(job.run_at);
    const now = new Date();
    const h = runAt.getHours(), m = runAt.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    const dh = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const timeStr = `${dh}:${m.toString().padStart(2, '0')} ${ampm}`;
    if (runAt.toDateString() === now.toDateString()) return `Today at ${timeStr}`;
    const tmrw = new Date(now); tmrw.setDate(tmrw.getDate() + 1);
    if (runAt.toDateString() === tmrw.toDateString()) return `Tomorrow at ${timeStr}`;
    return `${runAt.toLocaleDateString()} at ${timeStr}`;
  }

  if (scheduleType === 'every' && job.interval_ms) {
    const ms = job.interval_ms;
    if (ms < 60000) return `Every ${Math.round(ms / 1000)} seconds`;
    if (ms < 3600000) return `Every ${Math.round(ms / 60000)} minutes`;
    if (ms < 86400000) { const hrs = Math.round(ms / 3600000); return `Every ${hrs} hour${hrs === 1 ? '' : 's'}`; }
    const days = Math.round(ms / 86400000); return `Every ${days} day${days === 1 ? '' : 's'}`;
  }

  const cron = job.schedule;
  if (!cron) return 'Unknown schedule';
  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;
  const [minute, hour, , , dow] = parts;

  if (minute.startsWith('*/')) return `Every ${minute.slice(2)} minutes`;
  if (hour.startsWith('*/')) { const hrs = hour.slice(2); return `Every ${hrs} hour${hrs === '1' ? '' : 's'}`; }

  const h = parseInt(hour), m = parseInt(minute);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const dh = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const timeStr = `${dh}:${m.toString().padStart(2, '0')} ${ampm}`;

  if (dow === '*') return `${timeStr} daily`;
  if (dow === '1-5') return `${timeStr} weekdays`;
  if (dow === '0,6') return `${timeStr} weekends`;
  if (dow !== '*') {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return `${timeStr} on ${dow.split(',').map(d => dayNames[parseInt(d)]).join(', ')}`;
  }
  return `${timeStr} daily`;
}

// ---- Data Loading ----

async function _rtnLoadSessions() {
  try {
    const sessions = await window.pocketAgent.sessions.list();
    _rtnSessionsMap = {};
    sessions.forEach(s => { _rtnSessionsMap[s.id] = s.name; });
  } catch (err) { console.error('[Routines] Failed to load sessions:', err); }
}

async function _rtnLoadJobs() {
  const jobsList = document.getElementById('rtn-jobs-list');
  if (!jobsList) return;

  try {
    const allJobs = await window.pocketAgent.cron.list();
    const jobs = allJobs.filter(job => (job.schedule_type || 'cron') !== 'at');

    if (jobs.length === 0) {
      jobsList.innerHTML = '<div class="rtn-empty"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l2 2"/></g></svg><p>Nothing scheduled yet</p></div>';
      return;
    }

    jobsList.innerHTML = jobs.map(job => {
      const sessionName = _rtnSessionsMap[job.session_id] || job.session_id || 'Default';
      const promptDisplay = job.prompt.startsWith('[Workflow: ')
        ? '⚡ ' + _rtnEscapeHtml(job.prompt.substring(11, job.prompt.indexOf(']')))
        : _rtnEscapeHtml(job.prompt);
      return `
        <div class="rtn-job-item ${job.enabled ? '' : 'disabled'}">
          <div class="rtn-job-status"></div>
          <div class="rtn-job-info">
            <div class="rtn-job-name">${_rtnEscapeHtml(job.name)}<span class="rtn-job-session-badge">${_rtnEscapeHtml(sessionName)}</span></div>
            <div class="rtn-job-schedule">${_rtnScheduleToHuman(job)}</div>
            <div class="rtn-job-prompt">${promptDisplay}</div>
          </div>
          <div class="rtn-job-actions">
            <button class="rtn-icon-btn" onclick="playNormalClick(); rtnToggleJob('${_rtnEscapeAttr(job.name)}', ${!job.enabled})" title="${job.enabled ? 'Pause' : 'Resume'}">
              ${job.enabled
                ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.5" d="M4 7c0-1.414 0-2.121.44-2.56C4.878 4 5.585 4 7 4s2.121 0 2.56.44C10 4.878 10 5.585 10 7v10c0 1.414 0 2.121-.44 2.56C9.122 20 8.415 20 7 20s-2.121 0-2.56-.44C4 19.122 4 18.415 4 17zm10 0c0-1.414 0-2.121.44-2.56C14.878 4 15.585 4 17 4s2.121 0 2.56.44C20 4.878 20 5.585 20 7v10c0 1.414 0 2.121-.44 2.56c-.439.44-1.146.44-2.56.44s-2.121 0-2.56-.44C14 19.122 14 18.415 14 17z"/></svg>'
                : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.5" d="M18.89 12.846c-.353 1.343-2.023 2.292-5.364 4.19c-3.23 1.835-4.845 2.752-6.146 2.384a3.25 3.25 0 0 1-1.424-.841C5 17.614 5 15.743 5 12s0-5.614.956-6.579a3.25 3.25 0 0 1 1.424-.84c1.301-.37 2.916.548 6.146 2.383c3.34 1.898 5.011 2.847 5.365 4.19a3.3 3.3 0 0 1 0 1.692Z"/></svg>'
              }
            </button>
            <button class="rtn-icon-btn" onclick="playNormalClick(); rtnRunJob('${_rtnEscapeAttr(job.name)}')" title="Test run">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.5" d="M8.628 12.674H8.17c-1.484 0-2.225 0-2.542-.49c-.316-.489-.015-1.17.588-2.533l1.812-4.098c.548-1.239.822-1.859 1.353-2.206S10.586 3 11.935 3h2.09c1.638 0 2.458 0 2.767.535c.309.536-.098 1.25-.91 2.681l-1.073 1.886c-.404.711-.606 1.066-.603 1.358c.003.378.205.726.53.917c.25.147.657.147 1.471.147c1.03 0 1.545 0 1.813.178c.349.232.531.646.467 1.061c-.049.32-.395.703-1.088 1.469l-5.535 6.12c-1.087 1.203-1.63 1.804-1.996 1.613c-.365-.19-.19-.983.16-2.569l.688-3.106c.267-1.208.4-1.812.08-2.214c-.322-.402-.937-.402-2.168-.402Z"/></svg>
            </button>
            <button class="rtn-icon-btn danger" onclick="playNormalClick(); rtnDeleteJob('${_rtnEscapeAttr(job.name)}')" title="Delete">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5" d="m19.5 5.5l-.62 10.025c-.158 2.561-.237 3.842-.88 4.763a4 4 0 0 1-1.2 1.128c-.957.584-2.24.584-4.806.584c-2.57 0-3.855 0-4.814-.585a4 4 0 0 1-1.2-1.13c-.642-.922-.72-2.205-.874-4.77L4.5 5.5M3 5.5h18m-4.944 0l-.683-1.408c-.453-.936-.68-1.403-1.071-1.695a2 2 0 0 0-.275-.172C13.594 2 13.074 2 12.035 2c-1.066 0-1.599 0-2.04.234a2 2 0 0 0-.278.18c-.395.303-.616.788-1.058 1.757L8.053 5.5"/></svg>
            </button>
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    jobsList.innerHTML = `<div class="rtn-empty"><p>Error: ${_rtnEscapeHtml(err.message)}</p></div>`;
  }
}

// ---- Actions (global for onclick) ----

async function rtnToggleJob(name, enabled) {
  try {
    await window.pocketAgent.cron.toggle(name, enabled);
    _rtnShowToast(enabled ? 'Back at it!' : 'Taking a break', 'success');
    _rtnLoadJobs();
  } catch (err) { _rtnShowToast(err.message, 'error'); }
}

async function rtnRunJob(name) {
  _rtnShowToast('On it!', 'success');
  try { await window.pocketAgent.cron.run(name); }
  catch (err) { _rtnShowToast(err.message, 'error'); }
}

async function rtnDeleteJob(name) {
  if (!confirm(`Delete "${name}"?`)) return;
  try {
    await window.pocketAgent.cron.delete(name);
    _rtnShowToast('Poof! Gone.', 'success');
    _rtnLoadJobs();
  } catch (err) { _rtnShowToast(err.message, 'error'); }
}
