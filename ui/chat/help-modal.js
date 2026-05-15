/* "What I Can Do" help modal — capability overview for new users.
   Trigger lives inside the empty-state (see scroll.js showEmptyState()).
   Modal markup lives in chat.html (#help-modal). Show/hide uses the
   shared .modal-overlay.show toggle from overlays.css. */

function showHelpModal() {
  const m = document.getElementById('help-modal');
  if (m) m.classList.add('show');
}

function hideHelpModal() {
  const m = document.getElementById('help-modal');
  if (m) m.classList.remove('show');
}

// Footer button: close the help modal, then open the Routine Recipes modal
// so users can browse copy-paste-ready templates.
function openRecipesFromHelp() {
  hideHelpModal();
  if (typeof showRecipesModal === 'function') {
    showRecipesModal();
  }
}

// Dismiss on backdrop click — matches the pattern other overlays use.
document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('help-modal');
  if (!overlay) return;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) hideHelpModal();
  });
});
