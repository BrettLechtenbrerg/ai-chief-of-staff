/* Sidebar toggle logic */
(function () {
  const sidebar = document.getElementById('sidebar');
  const toggleBtn = document.getElementById('sidebar-toggle-btn');

  if (!sidebar || !toggleBtn) return;

  // Restore saved state
  const saved = localStorage.getItem('sidebar-collapsed');
  if (saved === 'true') {
    sidebar.classList.add('collapsed');
  }

  toggleBtn.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    localStorage.setItem('sidebar-collapsed', sidebar.classList.contains('collapsed'));
  });
})();

// Auto-collapse the sidebar whenever a panel (Settings / Brain / Routines /
// Personalize) is opened, and restore the user's saved preference on close.
// Exposed for the panel show/hide functions to call.
window._sidebarEnterPanelMode = function () {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  sidebar.classList.add('collapsed');
};

window._sidebarExitPanelMode = function () {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const saved = localStorage.getItem('sidebar-collapsed');
  if (saved === 'true') {
    sidebar.classList.add('collapsed');
  } else {
    sidebar.classList.remove('collapsed');
  }
};
