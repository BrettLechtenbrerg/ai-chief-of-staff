function getGreeting() {
  const hour = new Date().getHours();
  const greetings = {
    morning: [
      "morning, what are we building",
      "fresh start, what's the plan",
      "new day, new ideas",
      "morning, where do we begin",
      "alright, what's first today"
    ],
    lunch: [
      "okay, what's on the agenda",
      "fresh slate, talk to me",
      "alright, what are we doing",
      "new thread, what's the move",
      "ready when you are"
    ],
    afternoon: [
      "clean slate, what's next",
      "alright, what do you need",
      "new chat, let's get into it",
      "okay what are we tackling",
      "fresh page, go ahead"
    ],
    night: [
      "evening, what's on your mind",
      "blank canvas, what's the idea",
      "alright, what are we cooking",
      "new thread, lay it on me",
      "okay, where do we start"
    ],
    midnight: [
      "late night idea, let's hear it",
      "can't sleep, let's build something",
      "fresh start at a wild hour",
      "okay, what's keeping you up",
      "midnight session, go ahead"
    ]
  };

  let period;
  if (hour >= 5 && hour < 12) period = 'morning';
  else if (hour >= 12 && hour < 14) period = 'lunch';
  else if (hour >= 14 && hour < 18) period = 'afternoon';
  else if (hour >= 18 && hour < 24) period = 'night';
  else period = 'midnight';

  const pool = greetings[period];
  return pool[Math.floor(Math.random() * pool.length)];
}

function showEmptyState() {
  const greeting = getGreeting();
  const nameTag = userName ? `, ${escapeHtml(userName)}` : '';
  // "What I Can Do" button surfaces a capability/how-to-use modal
  // (see chat/help-modal.{html,css,js}). New users found the interface
  // unintuitive; this is the entry point.
  messagesDiv.innerHTML = `
    <div class="empty-state">
      <button type="button" class="empty-state-help" onclick="playNormalClick(); showHelpModal()" title="See what your AI Chief of Staff can do">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 3.5"/><path d="M12 17h.01"/></g></svg>
        <span>What I Can Do</span>
        <span class="empty-state-help-chevron">▾</span>
      </button>
      <div class="pixel-heart"></div>
      <div class="empty-subtitle">${greeting}${nameTag}</div>
    </div>
  `;
}

async function loadUserProfile() {
  try {
    userName = (await window.pocketAgent.settings.get('profile.name')) || '';
    agentName = (await window.pocketAgent.settings.get('personalize.agentName')) || '';
    updateInputPlaceholder();
  } catch (err) {
    console.error('Failed to load user profile:', err);
  }
}

function updateInputPlaceholder() {
  const placeholder = userName
    ? `what's on your mind, ${userName}?`
    : "what's on your mind?";
  input.placeholder = placeholder;
}

function scrollToBottom(instant = false) {
  requestAnimationFrame(() => {
    messagesDiv.scrollTo({
      top: messagesDiv.scrollHeight,
      behavior: instant ? 'instant' : 'smooth'
    });
  });
}

function scrollToTop() {
  requestAnimationFrame(() => {
    messagesDiv.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  });
}

// Scroll button visibility
const scrollTopBtn = document.getElementById('scroll-top-btn');
const scrollBottomBtn = document.getElementById('scroll-bottom-btn');
const SCROLL_THRESHOLD = 200;

function updateScrollButtons() {
  const scrollTop = messagesDiv.scrollTop;
  const scrollHeight = messagesDiv.scrollHeight;
  const clientHeight = messagesDiv.clientHeight;
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

  // Show "scroll to top" when scrolled down past threshold
  if (scrollTop > SCROLL_THRESHOLD) {
    scrollTopBtn.classList.add('visible');
  } else {
    scrollTopBtn.classList.remove('visible');
  }

  // Show "scroll to bottom" when not at bottom
  if (distanceFromBottom > SCROLL_THRESHOLD) {
    scrollBottomBtn.classList.add('visible');
  } else {
    scrollBottomBtn.classList.remove('visible');
  }
}

messagesDiv.addEventListener('scroll', updateScrollButtons);

// Global chat scroll buttons
const gchatMsgsDiv = document.getElementById('global-chat-messages');
const gchatScrollTopBtn = document.getElementById('gchat-scroll-top-btn');
const gchatScrollBottomBtn = document.getElementById('gchat-scroll-bottom-btn');

window.gchatScrollToTop = function() {
  gchatMsgsDiv.scrollTo({ top: 0, behavior: 'smooth' });
};

window.gchatScrollToBottom = function() {
  gchatMsgsDiv.scrollTo({ top: gchatMsgsDiv.scrollHeight, behavior: 'smooth' });
};

function updateGchatScrollButtons() {
  if (!globalChatMode) return;
  const scrollTop = gchatMsgsDiv.scrollTop;
  const scrollHeight = gchatMsgsDiv.scrollHeight;
  const clientHeight = gchatMsgsDiv.clientHeight;
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

  if (scrollTop > SCROLL_THRESHOLD) {
    gchatScrollTopBtn.classList.add('visible');
  } else {
    gchatScrollTopBtn.classList.remove('visible');
  }

  if (distanceFromBottom > SCROLL_THRESHOLD) {
    gchatScrollBottomBtn.classList.add('visible');
  } else {
    gchatScrollBottomBtn.classList.remove('visible');
  }
}

gchatMsgsDiv.addEventListener('scroll', updateGchatScrollButtons);

