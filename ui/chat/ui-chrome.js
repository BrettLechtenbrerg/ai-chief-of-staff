function openSettings(tab) {
  showSettingsPanel(tab);
}



function openCustomize() {
  showPersonalizePanel();
}

// Hamburger menu functions
function toggleMenu() {
  const btn = document.getElementById('hamburger-btn');
  const dropdown = document.getElementById('menu-dropdown');
  const isOpen = dropdown.classList.contains('open');

  if (isOpen) {
    closeMenu();
  } else {
    btn.classList.add('active');
    dropdown.classList.add('open');
  }
}

function closeMenu() {
  const btn = document.getElementById('hamburger-btn');
  const dropdown = document.getElementById('menu-dropdown');
  btn.classList.remove('active');
  dropdown.classList.remove('open');
}

// Close menu when clicking outside
document.addEventListener('click', (e) => {
  const menu = document.querySelector('.hamburger-menu');
  if (menu && !menu.contains(e.target)) {
    closeMenu();
  }
});

// Close menu on escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeMenu();
    closeDailyTasks();
  }
});

function openRoutines() {
  showRoutinesPanel();
}

async function openDocs() {
  try {
    await window.pocketAgent.app.openExternal('https://pocketagent-web.vercel.app/docs');
  } catch (err) {
    console.error('Failed to open docs:', err);
  }
}

function openAbout() {
  document.getElementById('about-modal').classList.add('show');
}

function closeAbout() {
  document.getElementById('about-modal').classList.remove('show');
}

