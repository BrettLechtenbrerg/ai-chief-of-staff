async function toggleWorkflows() {
  const panel = document.getElementById('slide-up-panel');
  const workflowsPanel = document.getElementById('workflows-panel');
  const searchPanel = document.getElementById('search-panel');
  const wfBtn = document.getElementById('workflows-toolbar-btn');

  if (panel.classList.contains('open') && !workflowsPanel.classList.contains('hidden')) {
    closeWorkflows();
  } else {
    // Close search if open, show workflows
    searchPanel.classList.add('hidden');
    workflowsPanel.classList.remove('hidden');
    panel.classList.add('open');
    if (wfBtn) wfBtn.classList.add('active');
    const searchBtn = document.getElementById('search-toolbar-btn');
    if (searchBtn) searchBtn.classList.remove('active');
    try {
      const commands = await window.pocketAgent.commands.list(currentSessionId);
      const grid = document.getElementById('workflows-grid');
      grid.innerHTML = '';
      commands.forEach(cmd => {
        const btn = document.createElement('button');
        btn.className = 'workflow-btn';
        btn.title = cmd.description || cmd.name;
        btn.textContent = cmd.name;
        btn.onclick = () => { playNormalClick(); selectWorkflow(cmd); };
        grid.appendChild(btn);
      });
    } catch (err) {
      console.error('Failed to load commands:', err);
    }
  }
}

function closeWorkflows() {
  const panel = document.getElementById('slide-up-panel');
  const workflowsPanel = document.getElementById('workflows-panel');
  const wfBtn = document.getElementById('workflows-toolbar-btn');

  workflowsPanel.classList.add('hidden');
  panel.classList.remove('open');
  if (wfBtn) wfBtn.classList.remove('active');
}

// Global Chat
const CHAT_FUN_WORDS = [
  'moonbeam', 'thundercat', 'starfox', 'cosmicpug', 'neonpickle',
  'turbosloth', 'wizardbeard', 'rocketpants', 'chaosmuffin', 'sparkplug',
  'pixeldust', 'lasercat', 'quantumtoast', 'cyberfox', 'stardust',
  'moonpickle', 'thundermuffin', 'neonsloth', 'cosmicbeard', 'turbocat',
  'wizardpants', 'rocketfox', 'chaosdust', 'sparkbeam', 'pixeltoast',
  'lazerpug', 'quantumpickle', 'cybermuffin', 'starsloth', 'mooncat',
  'thunderdust', 'neonbeard', 'cosmicpants', 'turbofox', 'wizardpug',
  'rocketsloth', 'chaosbeam', 'sparkcat', 'pixelpickle', 'lazertoast',
];

const CHAT_SENDER_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
  '#1abc9c', '#e67e22', '#e91e63', '#00bcd4', '#8bc34a',
];

function hashUsername(username) {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = ((hash << 5) - hash) + username.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getSenderColor(username) {
  return CHAT_SENDER_COLORS[hashUsername(username) % CHAT_SENDER_COLORS.length];
}

async function tryRegisterUsername(name) {
  try {
    const res = await fetch(`${CHAT_API_URL}/api/register-username`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: name }),
    });
    const data = await res.json();
    return data.ok === true;
  } catch { return false; }
}

async function getOrCreateChatUsername() {
  // Load admin key
  try {
    chatAdminKey = (await window.pocketAgent.settings.get('chat.adminKey')) || '';
    // Admin key loaded
  } catch (e) { console.log('[Chat] Admin key load failed:', e); chatAdminKey = ''; }

  try {
    const existing = await window.pocketAgent.settings.get('chat.username');
    if (existing) {
      const normalized = existing.toLowerCase();
      globalChatUsername = normalized;
      // Fix any stored mixed-case usernames
      if (normalized !== existing) {
        try { await window.pocketAgent.settings.set('chat.username', normalized); } catch {}
      }
      return normalized;
    }
  } catch { /* no saved username */ }

  // Generate from profile name or fallback
  let firstName = 'anon';
  try {
    const name = await window.pocketAgent.settings.get('profile.name');
    if (name) firstName = name.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '');
  } catch { /* use default */ }

  // Truncate firstName so total stays ≤ 15 (name + dash + word)
  if (firstName.length > 5) firstName = firstName.slice(0, 5);

  // Try up to 5 times with different fun words
  const shuffled = [...CHAT_FUN_WORDS].sort(() => Math.random() - 0.5);
  let username = '';
  for (let i = 0; i < Math.min(5, shuffled.length); i++) {
    const candidate = `${firstName}-${shuffled[i]}`.slice(0, 15);
    const registered = await tryRegisterUsername(candidate);
    if (registered) {
      username = candidate;
      break;
    }
  }

  // Fallback: add random digits
  if (!username) {
    const fallback = `${firstName}-${Math.floor(Math.random() * 10000)}`.slice(0, 15);
    await tryRegisterUsername(fallback);
    username = fallback;
  }

  try {
    await window.pocketAgent.settings.set('chat.username', username);
  } catch { /* best effort */ }

  globalChatUsername = username;
  return username;
}

function gchatTruncate(text, max = 100) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '...' : text;
}

function gchatSetReply(username, text, element) {
  gchatReplyTo = { username, text, element };
  gchatRenderReplyBanner();
  input.focus();
}

function gchatClearReply() {
  gchatReplyTo = null;
  gchatRenderReplyBanner();
}

function gchatGetUsernames() {
  const seen = new Set();
  for (const msg of globalChatMessages) {
    if (msg.username && msg.username !== globalChatUsername) {
      seen.add(msg.username);
    }
  }
  return [...seen].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

function gchatShowMentionList(filtered) {
  gchatDismissMentionList(true);
  if (!filtered.length) return;
  const list = document.createElement('div');
  list.className = 'gchat-mention-list';
  list.id = 'gchat-mention-list';
  filtered.forEach((name, i) => {
    const item = document.createElement('div');
    item.className = 'gchat-mention-item' + (i === mentionSelectedIndex ? ' active' : '');
    item.innerHTML = '<span class="at-symbol">@</span>' + name.replace(/</g, '&lt;');
    item.onmousedown = (e) => { e.preventDefault(); gchatInsertMention(name); };
    list.appendChild(item);
  });
  const toolbarRow = document.getElementById('toolbar-row');
  toolbarRow.parentNode.insertBefore(list, toolbarRow);
}

function gchatDismissMentionList(keepState) {
  const list = document.getElementById('gchat-mention-list');
  if (list) list.remove();
  if (!keepState) {
    mentionActive = false;
    mentionQuery = '';
    mentionStartPos = -1;
    mentionSelectedIndex = 0;
  }
}

function gchatInsertMention(name) {
  const val = input.value;
  const before = val.substring(0, mentionStartPos);
  const after = val.substring(mentionStartPos + 1 + mentionQuery.length);
  input.value = before + '@' + name + ' ' + after;
  const cursorPos = mentionStartPos + 1 + name.length + 1;
  input.setSelectionRange(cursorPos, cursorPos);
  gchatDismissMentionList();
  input.focus();
  autoResizeTextarea();
  updateMentionHighlight();
}

function gchatFilterMentions() {
  const all = gchatGetUsernames();
  const q = mentionQuery.toLowerCase();
  const filtered = q ? all.filter(n => n.toLowerCase().startsWith(q)) : all;
  mentionSelectedIndex = Math.min(mentionSelectedIndex, Math.max(0, filtered.length - 1));
  gchatShowMentionList(filtered);
}

const mentionHighlight = document.getElementById('mention-highlight');

function gchatAllUsernames() {
  const names = new Set();
  for (const msg of globalChatMessages) {
    if (msg.username) names.add(msg.username.toLowerCase());
  }
  return names;
}

function updateMentionHighlight() {
  if (!globalChatMode) {
    mentionHighlight.innerHTML = '';
    input.classList.remove('mention-active');
    return;
  }
  const val = input.value;
  const known = gchatAllUsernames();
  const escaped = val.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const highlighted = escaped.replace(/@([\w-]+)/g, (match, name) => {
    if (known.has(name.toLowerCase())) return '<span class="mention-hl">' + match + '</span>';
    return match;
  });
  if (highlighted === escaped) {
    mentionHighlight.innerHTML = '';
    input.classList.remove('mention-active');
    return;
  }
  input.classList.add('mention-active');
  mentionHighlight.innerHTML = highlighted;
  mentionHighlight.scrollTop = input.scrollTop;
}

function gchatRenderMentionNodes(text, container) {
  const known = gchatAllUsernames();
  // Split on @mentions, build DOM nodes instead of innerHTML to prevent XSS
  const parts = text.split(/(@[\w-]+)/g);
  for (const part of parts) {
    const mentionMatch = part.match(/^@([\w-]+)$/);
    if (mentionMatch && known.has(mentionMatch[1].toLowerCase())) {
      const span = document.createElement('span');
      span.className = 'gchat-mention';
      span.textContent = part;
      container.appendChild(span);
    } else {
      // Split on newlines to preserve line breaks as <br>
      const lines = part.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (i > 0) container.appendChild(document.createElement('br'));
        if (lines[i]) container.appendChild(document.createTextNode(lines[i]));
      }
    }
  }
}

function gchatRenderReplyBanner() {
  const panel = document.getElementById('reply-panel');
  const contentEl = document.getElementById('reply-panel-content');
  const slideUp = document.getElementById('slide-up-panel');
  if (!panel || !contentEl || !slideUp) return;

  if (!gchatReplyTo) {
    contentEl.innerHTML = '';
    panel.classList.add('hidden');
    // Close slide-up if no other panel is open
    const searchOpen = !document.getElementById('search-panel').classList.contains('hidden');
    const workflowsOpen = !document.getElementById('workflows-panel').classList.contains('hidden');
    const attachOpen = !document.getElementById('attachments-panel').classList.contains('hidden');
    if (!searchOpen && !workflowsOpen && !attachOpen) {
      slideUp.classList.remove('open');
    }
    return;
  }

  contentEl.innerHTML = `
    <div class="gchat-reply-banner-label">Replying to ${gchatReplyTo.username}</div>
    <div class="gchat-reply-banner-text">${gchatReplyTo.text}</div>
  `;

  panel.classList.remove('hidden');
  slideUp.classList.add('open');
}

function gchatCreateReplyPreview(replyTo) {
  const preview = document.createElement('div');
  preview.className = 'gchat-reply-preview';

  const name = document.createElement('div');
  name.className = 'gchat-reply-preview-name';
  name.textContent = replyTo.username;

  const text = document.createElement('div');
  text.className = 'gchat-reply-preview-text';
  text.textContent = gchatTruncate(replyTo.text, 100);

  preview.appendChild(name);
  preview.appendChild(text);

  // Click to scroll to original message
  preview.onclick = () => {
    const container = document.getElementById('global-chat-messages');
    const wrappers = container.querySelectorAll('.global-chat-wrapper');
    for (const w of wrappers) {
      const senderEl = w.querySelector('.global-chat-sender');
      const bubbleEl = w.querySelector('.message');
      if (senderEl && bubbleEl) {
        const nameEl = senderEl.querySelector('span:last-child');
        const bubbleText = bubbleEl.textContent;
        if (nameEl && nameEl.textContent === replyTo.username && bubbleText === replyTo.text) {
          w.scrollIntoView({ behavior: 'smooth', block: 'center' });
          break;
        }
      }
    }
  };

  return preview;
}

function renderGlobalChatMessages() {
  const container = document.getElementById('global-chat-messages');
  container.innerHTML = '';

  if (globalChatMessages.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'global-chat-empty';
    empty.textContent = "No one's here yet \u2014 say something!";
    container.appendChild(empty);
    return;
  }

  globalChatMessages.forEach(msg => {
    const el = createGlobalChatBubble(msg);
    container.appendChild(el);
  });

  // Instant scroll to bottom (bypass CSS smooth scrolling)
  container.style.scrollBehavior = 'auto';
  container.scrollTop = container.scrollHeight;
  container.style.scrollBehavior = '';
}

function gchatToggleReaction(msg, emoji, wrapper) {
  if (!msg.reactions) msg.reactions = {};

  // Find existing reaction by this user
  let existingEmoji = null;
  for (const [e, users] of Object.entries(msg.reactions)) {
    if (users && users.includes(globalChatUsername)) {
      existingEmoji = e;
      break;
    }
  }

  if (existingEmoji === emoji) {
    // Same emoji — remove it
    const users = msg.reactions[emoji];
    users.splice(users.indexOf(globalChatUsername), 1);
    if (users.length === 0) delete msg.reactions[emoji];
  } else {
    // Remove old reaction if switching
    if (existingEmoji && msg.reactions[existingEmoji]) {
      const oldUsers = msg.reactions[existingEmoji];
      oldUsers.splice(oldUsers.indexOf(globalChatUsername), 1);
      if (oldUsers.length === 0) delete msg.reactions[existingEmoji];
    }
    // Add new reaction
    if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
    msg.reactions[emoji].push(globalChatUsername);
  }

  gchatUpdateReactionDisplay(msg, wrapper);
  sendChatWs({ type: 'reaction', messageTs: msg.ts, emoji });
}

function gchatUpdateReactionDisplay(msg, wrapper) {
  let container = wrapper.querySelector('.gchat-reactions');
  if (!container) return;

  container.innerHTML = '';
  const reactions = msg.reactions || {};
  let hasAny = false;

  for (const [emoji, users] of Object.entries(reactions)) {
    if (!users || users.length === 0) continue;
    hasAny = true;
    const btn = document.createElement('button');
    btn.className = 'gchat-reaction';
    if (users.includes(globalChatUsername)) btn.classList.add('active');
    btn.innerHTML = '<span class="reaction-emoji">' + emoji + '</span><span class="reaction-count">' + users.length + '</span>';
    const tooltip = document.createElement('div');
    tooltip.className = 'gchat-reaction-tooltip';
    tooltip.textContent = users.join(', ');
    btn.appendChild(tooltip);
    btn.onclick = (e) => {
      e.stopPropagation();
      gchatToggleReaction(msg, emoji, wrapper);
    };
    container.appendChild(btn);
  }

  container.classList.toggle('hidden', !hasAny);
}

function createGlobalChatBubble(msg) {
  const isSelf = msg.username === globalChatUsername;
  const tier = msg.tier || 0;
  const tierInfo = TIER_CONFIG[tier] || TIER_CONFIG[0];
  const color = msg.admin ? '#f59e0b' : (isSelf ? '' : getSenderColor(msg.username));

  // Wrapper holds sender label above + bubble below
  const wrapper = document.createElement('div');
  wrapper.className = `global-chat-wrapper ${isSelf ? 'self' : 'other'}`;
  wrapper.dataset.messageTs = msg.ts;
  if (msg._optimistic) wrapper.dataset.optimistic = 'true';

  // Sender label (outside bubble)
  const sender = document.createElement('div');
  sender.className = 'global-chat-sender';
  if (msg.admin) {
    const tick = document.createElement('span');
    tick.className = 'verified-badge';
    tick.innerHTML = '<svg viewBox="0 0 40 40"><path d="M19.998 3.094L14.638 0l-2.972 5.15H5.432v6.354L0 14.64 3.094 20 0 25.359l5.432 3.137v6.354h6.234L14.638 40l5.36-3.094L25.358 40l2.972-5.15h6.238v-6.354L40 25.359 36.905 20 40 14.641l-5.432-3.137V5.15h-6.238L25.358 0l-5.36 3.094z" fill="#3b82f6"/><path d="M17.204 27.377l-6.952-6.952 2.828-2.828 4.124 4.124 8.492-8.492 2.828 2.828-11.32 11.32z" fill="#fff"/></svg>';
    sender.appendChild(tick);
  } else if (tier > 0 && tierInfo.badge) {
    const badge = document.createElement('span');
    badge.className = 'tier-badge tier-badge-' + tierInfo.cssClass.replace('tier-', '');
    badge.textContent = tierInfo.badge;
    sender.appendChild(badge);
  }
  const name = document.createElement('span');
  name.textContent = msg.username;
  if (msg.admin) {
    name.className = 'admin-username';
    name.setAttribute('data-text', msg.username);
  } else if (tier > 0 && tierInfo.cssClass) {
    name.className = tierInfo.cssClass;
    // Tiers with ::before pseudo-elements need data-text
    if (tier >= 9) name.setAttribute('data-text', msg.username);
  } else if (!isSelf) {
    name.style.color = color;
  }
  // Tag non-self, non-admin names for tier_update lookups
  if (!isSelf && !msg.admin) {
    name.dataset.chatUsername = msg.username;
  }
  sender.appendChild(name);

  // Admin hover popover on other users' names (not self, not admin)
  if (chatIsAdmin && !isSelf && !msg.admin) {
    name.style.cursor = 'pointer';
    name.addEventListener('mouseenter', (e) => {
      const uname = msg.username;
      const uMinTier = userMinTierMap.get(uname) || 0;
      showAdminTierPopover(uname, tier, uMinTier, e.target);
    });
    name.addEventListener('mouseleave', () => {
      scheduleHideAdminTierPopover();
    });
  }

  wrapper.appendChild(sender);

  // Bubble + reply button row (button vertically centered with bubble)
  const bubbleRow = document.createElement('div');
  bubbleRow.className = 'gchat-bubble-row';

  const div = document.createElement('div');
  div.className = `message ${isSelf ? 'global-chat-self' : 'global-chat-other'}`;
  if (msg.admin) div.classList.add('global-chat-admin');

  // Reply preview inside the bubble (if this message is a reply)
  if (msg.replyTo) {
    div.appendChild(gchatCreateReplyPreview(msg.replyTo));
  }

  const text = document.createElement('span');
  gchatRenderMentionNodes(msg.text, text);
  div.appendChild(text);
  bubbleRow.appendChild(div);

  if (!isSelf) {
    const replyBtn = document.createElement('button');
    replyBtn.className = 'gchat-reply-btn';
    replyBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.5"><path d="m2 5l6.913 3.925c2.526 1.433 3.648 1.433 6.174 0L22 5"/><path stroke-linecap="round" d="M21.92 11.033q0-.739-.016-1.481c-.065-3.078-.098-4.616-1.224-5.756c-1.127-1.14-2.695-1.18-5.83-1.26a114 114 0 0 0-5.78 0c-3.136.08-4.704.12-5.83 1.26S2.08 6.474 2.016 9.552c-.021.99-.021 1.973 0 2.963c.065 3.077.097 4.616 1.224 5.756c1.126 1.14 2.694 1.18 5.83 1.259q1.448.037 2.89.037"/><path stroke-linecap="round" d="M22 21.5c-.116-2.524-.013-3.443-1.656-4.62c-.808-.58-2.433-.961-4.626-.755m1.734-2.532l-2.297 2.153a.5.5 0 0 0-.003.706l2.3 2.188"/></g></svg>';
    replyBtn.onclick = (e) => {
      e.stopPropagation();
      gchatSetReply(msg.username, msg.text, wrapper);
    };
    bubbleRow.appendChild(replyBtn);
  }

  // Reaction picker (appears on hover)
  const reactPicker = document.createElement('div');
  reactPicker.className = 'gchat-react-picker';
  GCHAT_REACTIONS.forEach(emoji => {
    const btn = document.createElement('button');
    btn.textContent = emoji;
    btn.onclick = (e) => {
      e.stopPropagation();
      gchatToggleReaction(msg, emoji, wrapper);
    };
    reactPicker.appendChild(btn);
  });
  bubbleRow.appendChild(reactPicker);

  wrapper.appendChild(bubbleRow);

  // Reaction display (below bubble, outside)
  const reactionsDiv = document.createElement('div');
  reactionsDiv.className = 'gchat-reactions hidden';
  wrapper.appendChild(reactionsDiv);
  gchatUpdateReactionDisplay(msg, wrapper);

  return wrapper;
}

function addGlobalChatMessage(msg) {
  globalChatMessages.push(msg);
  const container = document.getElementById('global-chat-messages');
  // Remove empty state if present
  const empty = container.querySelector('.global-chat-empty');
  if (empty) empty.remove();

  const el = createGlobalChatBubble(msg);
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

let chatActivityInterval = null;

function connectChatWs() {
  if (chatWs && (chatWs.readyState === WebSocket.OPEN || chatWs.readyState === WebSocket.CONNECTING)) return;

  chatWs = new WebSocket(CHAT_WS_URL);

  chatWs.onopen = () => {
    chatWsReconnectDelay = 1000; // reset backoff on successful connect
    const dot = document.getElementById('chat-status-dot');
    if (dot) dot.classList.add('connected');
    const joinPayload = { type: 'join', username: globalChatUsername };
    if (chatAdminKey) joinPayload.adminKey = chatAdminKey;
    chatWs.send(JSON.stringify(joinPayload));
    // Always subscribe to messages so unread notifications work
    chatWs.send(JSON.stringify({ type: 'enter_chat' }));
  };

  chatWs.onmessage = (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }

    if (data.type === 'joined') {
      chatIsAdmin = !!data.admin;
      globalChatSelfTier = data.tier || 0;
      updateHeaderTierBadge();
      // Show admin gear if admin
      const adminWrap = document.getElementById('admin-menu-wrap');
      if (adminWrap) adminWrap.classList.toggle('hidden', !chatIsAdmin);
    } else if (data.type === 'tier_change') {
      const oldTier = globalChatSelfTier;
      globalChatSelfTier = data.tier || 0;
      // Update own messages so re-renders preserve the tier
      globalChatMessages.forEach(m => {
        if (m.username === globalChatUsername) m.tier = data.tier;
      });
      updateHeaderTierBadge();
      if (data.tier > oldTier) {
        const info = TIER_CONFIG[data.tier] || TIER_CONFIG[0];
        showTierToast(info.badge + ' You reached ' + info.name + '!');
      }
    } else if (data.type === 'history') {
      // Track latest known timestamp so we can count missed messages on reconnect
      const prevLatestTs = globalChatMessages.length > 0
        ? globalChatMessages[globalChatMessages.length - 1].ts
        : 0;
      globalChatMessages = (data.messages || []).map(m => {
        if (m.minTier !== undefined) userMinTierMap.set(m.username, m.minTier);
        return {
          username: m.username,
          text: m.text,
          ts: Number(m.ts),
          admin: !!m.admin,
          tier: m.tier || 0,
          replyTo: m.replyTo || undefined,
          reactions: m.reactions || {},
        };
      });
      if (globalChatMode) {
        renderGlobalChatMessages();
      } else if (prevLatestTs > 0) {
        // Reconnected while not viewing chat — count new messages as unread
        const missed = globalChatMessages.filter(
          m => m.ts > prevLatestTs && m.username !== globalChatUsername
        ).length;
        if (missed > 0) {
          chatUnreadCount += missed;
          updateUnreadBadge();
        }
      }
    } else if (data.type === 'typing') {
      if (data.username === globalChatUsername) return;
      // Clear existing timeout for this user
      const prev = chatTypingUsers.get(data.username);
      if (prev) clearTimeout(prev);
      // Set a 4s timeout to auto-clear
      const tid = setTimeout(() => {
        chatTypingUsers.delete(data.username);
        updateTypingIndicator();
      }, 4000);
      chatTypingUsers.set(data.username, tid);
      updateTypingIndicator();
    } else if (data.type === 'message') {
      // Clear typing for the user who sent the message
      if (chatTypingUsers.has(data.username)) {
        clearTimeout(chatTypingUsers.get(data.username));
        chatTypingUsers.delete(data.username);
        updateTypingIndicator();
      }
      if (data.minTier !== undefined) userMinTierMap.set(data.username, data.minTier);
      addGlobalChatMessage({ username: data.username, text: data.text, ts: data.ts, admin: !!data.admin, tier: data.tier || 0, replyTo: data.replyTo || undefined, reactions: data.reactions || {} });
      if (globalChatUsername && data.username !== globalChatUsername) {
        const isReplyToMe = data.replyTo?.username === globalChatUsername;
        const isMentionOfMe = data.text && data.text.includes('@' + globalChatUsername);
        if (isReplyToMe || isMentionOfMe) {
          playReplySound();
        }
      }
      if (!globalChatMode) {
        chatUnreadCount++;
        updateUnreadBadge();
      }
    } else if (data.type === 'reaction') {
      // Handle reaction updates from server
      const rMsg = globalChatMessages.find(m => m.ts === data.messageTs);
      if (rMsg) {
        if (!rMsg.reactions) rMsg.reactions = {};
        if (!rMsg.reactions[data.emoji]) rMsg.reactions[data.emoji] = [];

        const rUsers = rMsg.reactions[data.emoji];
        if (data.action === 'add') {
          if (!rUsers.includes(data.username)) rUsers.push(data.username);
        } else if (data.action === 'remove') {
          rMsg.reactions[data.emoji] = rUsers.filter(u => u !== data.username);
          if (rMsg.reactions[data.emoji].length === 0) delete rMsg.reactions[data.emoji];
        }

        // Update DOM
        const rWrapper = document.querySelector('[data-message-ts="' + data.messageTs + '"]');
        if (rWrapper) gchatUpdateReactionDisplay(rMsg, rWrapper);

        // Play notification if someone reacted to our message
        if (data.action === 'add' && data.username !== globalChatUsername && rMsg.username === globalChatUsername) {
          playReplySound();
        }
      }
    } else if (data.type === 'message_ack') {
      // Server confirmed our message — find and update the optimistic bubble
      if (data.minTier !== undefined) userMinTierMap.set(data.username, data.minTier);
      const optimisticIdx = globalChatMessages.findIndex(m => m._optimistic && m.username === data.username && m.text === data.text);
      if (optimisticIdx !== -1) {
        // Update the optimistic message with server-confirmed data
        globalChatMessages[optimisticIdx] = {
          username: data.username,
          text: data.text,
          ts: data.ts,
          admin: !!data.admin,
          tier: data.tier || 0,
          replyTo: data.replyTo || undefined,
          reactions: data.reactions || {},
        };
        // Find optimistic wrapper by data attribute and update its ts
        const wrappers = document.querySelectorAll('[data-message-ts]');
        for (const w of wrappers) {
          if (w.dataset.optimistic === 'true') {
            w.dataset.messageTs = String(data.ts);
            w.removeAttribute('data-optimistic');
            break;
          }
        }
      } else {
        // Fallback: no optimistic message found, add normally (shouldn't happen)
        addGlobalChatMessage({ username: data.username, text: data.text, ts: data.ts, admin: !!data.admin, tier: data.tier || 0, replyTo: data.replyTo || undefined, reactions: data.reactions || {} });
      }
    } else if (data.type === 'chat_cleared') {
      globalChatMessages = [];
      const container = document.getElementById('global-chat-messages');
      container.innerHTML = '';
      // Show system message
      const sysMsg = document.createElement('div');
      sysMsg.className = 'global-chat-empty';
      sysMsg.textContent = 'Chat was cleared by admin';
      container.appendChild(sysMsg);
    } else if (data.type === 'tier_update') {
      const tuLower = data.username.toLowerCase();
      // Also map the display-cased username
      userMinTierMap.set(data.username, data.minTier);
      // Update tier in message data so re-renders preserve the change
      globalChatMessages.forEach(m => {
        if (m.username.toLowerCase() === tuLower) {
          m.tier = data.tier;
          userMinTierMap.set(m.username, data.minTier);
        }
      });
      // Update existing bubbles for this user (case-insensitive)
      document.querySelectorAll('[data-chat-username]').forEach(nameEl => {
        if (nameEl.dataset.chatUsername.toLowerCase() !== tuLower) return;
        const tierInfo = TIER_CONFIG[data.tier] || TIER_CONFIG[0];
        nameEl.className = '';
        if (data.tier > 0 && tierInfo.cssClass) {
          nameEl.className = tierInfo.cssClass;
          if (data.tier >= 9) nameEl.setAttribute('data-text', nameEl.dataset.chatUsername);
          else nameEl.removeAttribute('data-text');
        }
        // Update badge in same sender div
        const senderDiv = nameEl.parentElement;
        if (senderDiv) {
          const oldBadge = senderDiv.querySelector('.tier-badge');
          if (oldBadge) oldBadge.remove();
          if (data.tier > 0 && tierInfo.badge) {
            const badge = document.createElement('span');
            badge.className = 'tier-badge tier-badge-' + tierInfo.cssClass.replace('tier-', '');
            badge.textContent = tierInfo.badge;
            senderDiv.insertBefore(badge, nameEl);
          }
        }
      });
      // If it's current user, update self tier
      if (globalChatUsername.toLowerCase() === tuLower) {
        globalChatSelfTier = data.tier;
        updateHeaderTierBadge();
      }
      // Update popover if it's showing for this user
      if (adminTierPopoverEl && adminTierPopoverEl.dataset.username.toLowerCase() === tuLower) {
        updateAdminTierPopoverContent(adminTierPopoverEl.dataset.username, data.tier, data.minTier);
      }
    } else if (data.type === 'username_changed') {
      const oldName = data.oldUsername;
      const newName = data.newUsername;
      // If current user was renamed, update globalChatUsername immediately
      if (oldName === globalChatUsername) {
        globalChatUsername = newName;
        try { window.pocketAgent.settings.set('chat.username', newName); } catch {}
        updateHeaderTierBadge();
      }
      // Update cached messages
      globalChatMessages.forEach(m => {
        if (m.username === oldName) m.username = newName;
      });
      // Transfer minTier mapping
      if (userMinTierMap.has(oldName)) {
        userMinTierMap.set(newName, userMinTierMap.get(oldName));
        userMinTierMap.delete(oldName);
      }
      // Update popover if showing for the old username
      if (adminTierPopoverEl && adminTierPopoverEl.dataset.username === oldName) {
        adminTierPopoverEl.dataset.username = newName;
        const header = adminTierPopoverEl.querySelector('.atp-header');
        if (header) header.textContent = newName;
      }
      // Re-render chat to reflect updated usernames
      if (globalChatMode) renderGlobalChatMessages();
    } else if (data.type === 'counts') {
      updateChatCounts(data.online, data.inChat);
    } else if (data.type === 'error') {
      showChatToast(data.message);
    }
  };

  chatWs.onclose = (event) => {
    console.log('[Chat WS] Closed, code:', event.code, 'reason:', event.reason);
    clearAllTypingState();
    const dot = document.getElementById('chat-status-dot');
    if (dot) dot.classList.remove('connected');
    clearTimeout(chatWsReconnectTimer);
    // Don't retry if username is reserved and admin key is wrong
    if (event.code === 4003) {
      console.warn('[Chat WS] Username reserved — admin key mismatch, not reconnecting');
      showChatToast('Username reserved — check admin key in Settings');
      return;
    }
    // Exponential backoff with jitter
    const jitter = chatWsReconnectDelay * 0.2 * (Math.random() - 0.5); // ±10%
    chatWsReconnectTimer = setTimeout(connectChatWs, chatWsReconnectDelay + jitter);
    chatWsReconnectDelay = Math.min(chatWsReconnectDelay * 2, CHAT_WS_MAX_RECONNECT_DELAY);
  };

  chatWs.onerror = (err) => {
    console.warn('[Chat WS] Error:', err.type || err);
  };
}

function sendChatWs(data) {
  if (chatWs && chatWs.readyState === WebSocket.OPEN) {
    chatWs.send(JSON.stringify(data));
    return true;
  }
  return false;
}

function enterChatActive() {
  sendChatWs({ type: 'enter_chat' });
  // Ping activity every 5 min to stay "in chat"
  clearInterval(chatActivityInterval);
  chatActivityInterval = setInterval(() => {
    sendChatWs({ type: 'chat_active' });
  }, 5 * 60 * 1000);
}

function leaveChatActive() {
  clearInterval(chatActivityInterval);
  chatActivityInterval = null;
  // Don't send leave_chat — stay subscribed so unread notifications work
}

const chatSendTimestamps = [];
const CHAT_RATE_LIMIT_WINDOW = 10_000;
const CHAT_RATE_LIMIT_MAX = 5;
let lastChatMessageText = '';

const CHAT_ALLOWED_LINKS = [
  /https?:\/\/(www\.)?(youtube\.com|youtu\.be|m\.youtube\.com)(\/\S*)?/i,
  /https?:\/\/(www\.)?instagram\.com(\/\S*)?/i,
  /https?:\/\/(www\.)?(tiktok\.com|vm\.tiktok\.com)(\/\S*)?/i,
  /https?:\/\/(www\.)?(x\.com|twitter\.com)(\/\S*)?/i,
  /https?:\/\/(www\.)?skool\.com\/kenkai(\/\S*|$)?(?![a-z0-9-])/i,
];
const CHAT_URL_REGEX = /https?:\/\/\S+|www\.\S+/gi;

function chatHasBlockedLinks(text) {
  const urls = text.match(CHAT_URL_REGEX);
  if (!urls) return false;
  for (const url of urls) {
    let allowed = false;
    for (const pattern of CHAT_ALLOWED_LINKS) {
      pattern.lastIndex = 0;
      if (pattern.test(url)) { allowed = true; break; }
    }
    if (!allowed) return true;
  }
  return false;
}

function sendGlobalChatMessage() {
  const text = input.value.trim();
  if (!text) return;

  const now = Date.now();

  // Client-side rate limit
  while (chatSendTimestamps.length && now - chatSendTimestamps[0] >= CHAT_RATE_LIMIT_WINDOW) {
    chatSendTimestamps.shift();
  }
  if (chatSendTimestamps.length >= CHAT_RATE_LIMIT_MAX) {
    showChatToast('Easy tiger, slow down');
    return;
  }

  // Client-side duplicate check
  if (text === lastChatMessageText) {
    showChatToast('You just said that');
    return;
  }

  // Client-side link check
  if (chatHasBlockedLinks(text)) {
    showChatToast("That link isn't allowed here");
    return;
  }

  chatSendTimestamps.push(now);
  lastChatMessageText = text;

  // Capture reply context before clearing
  const replyTo = gchatReplyTo ? { username: gchatReplyTo.username, text: gchatTruncate(gchatReplyTo.text, 200) } : undefined;

  // Check connection before clearing input
  if (!chatWs || chatWs.readyState !== WebSocket.OPEN) {
    showChatToast('Chat is offline — reconnecting…');
    return;
  }

  input.value = '';
  autoResizeTextarea();
  gchatClearReply();
  gchatDismissMentionList();
  mentionHighlight.innerHTML = '';
  input.classList.remove('mention-active');
  sendChatWs({ type: 'message', text, replyTo });

  // Optimistically add message immediately so it appears instant
  const optimisticTs = Date.now();
  addGlobalChatMessage({
    username: globalChatUsername,
    text,
    ts: optimisticTs,
    admin: chatIsAdmin,
    tier: globalChatSelfTier,
    replyTo: replyTo || undefined,
    reactions: {},
    _optimistic: true,
  });
}

const notyf = new Notyf({
  duration: 3000, position: { x: 'right', y: 'bottom' },
  dismissible: true,
  types: [
    { type: 'success', background: '#4ade80' },
    { type: 'error', background: '#f87171' }
  ]
});
function showChatToast(msg) {
  notyf.error(msg);
}

function showTierToast(msg) {
  notyf.open({ type: 'success', message: msg, duration: 3500 });
}

function updateHeaderTierBadge() {
  const badge = document.getElementById('chat-username-badge');
  if (!badge) return;
  const tier = globalChatSelfTier;
  const info = TIER_CONFIG[tier] || TIER_CONFIG[0];
  const wasHidden = badge.classList.contains('hidden');
  badge.className = 'chat-username-badge';
  if (wasHidden) badge.classList.add('hidden');
  if (chatIsAdmin) {
    badge.innerHTML = '';
    const tick = document.createElement('span');
    tick.className = 'verified-badge';
    tick.innerHTML = '<svg viewBox="0 0 40 40" style="width:14px;height:14px"><path d="M19.998 3.094L14.638 0l-2.972 5.15H5.432v6.354L0 14.64 3.094 20 0 25.359l5.432 3.137v6.354h6.234L14.638 40l5.36-3.094L25.358 40l2.972-5.15h6.238v-6.354L40 25.359 36.905 20 40 14.641l-5.432-3.137V5.15h-6.238L25.358 0l-5.36 3.094z" fill="#3b82f6"/><path d="M17.204 27.377l-6.952-6.952 2.828-2.828 4.124 4.124 8.492-8.492 2.828 2.828-11.32 11.32z" fill="#fff"/></svg>';
    badge.appendChild(tick);
    const nameSpan = document.createElement('span');
    nameSpan.className = 'admin-username';
    nameSpan.textContent = globalChatUsername;
    nameSpan.setAttribute('data-text', globalChatUsername);
    badge.appendChild(nameSpan);
  } else if (tier > 0) {
    badge.innerHTML = '';
    const badgeEmoji = document.createElement('span');
    badgeEmoji.className = 'tier-badge tier-badge-' + info.cssClass.replace('tier-', '');
    badgeEmoji.textContent = info.badge + ' ';
    badge.appendChild(badgeEmoji);
    const nameSpan = document.createElement('span');
    nameSpan.className = info.cssClass;
    nameSpan.textContent = globalChatUsername;
    if (tier >= 9) nameSpan.setAttribute('data-text', globalChatUsername);
    badge.appendChild(nameSpan);
    const tierLabel = document.createTextNode(' \u00B7 ' + info.name);
    badge.appendChild(tierLabel);
  } else {
    badge.textContent = globalChatUsername;
  }
}

function buildTierTooltipHTML() {
  const tier = globalChatSelfTier;
  const currentInfo = TIER_CONFIG[tier] || TIER_CONFIG[0];
  const nextTier = tier < 10 ? tier + 1 : null;
  const nextInfo = nextTier ? TIER_CONFIG[nextTier] : null;
  const uname = globalChatUsername;

  let html = '<div class="tier-tooltip-content">';
  html += '<div class="tier-tooltip-current">';
  if (tier > 0) {
    html += '<span class="tier-tooltip-badge">' + currentInfo.badge + '</span> ';
    html += '<strong>' + currentInfo.name + '</strong> (Tier ' + tier + ')';
  } else {
    html += '<strong>No Tier</strong>';
  }
  html += '</div>';

  if (nextInfo) {
    html += '<div class="tier-tooltip-next">';
    html += '<span style="color:var(--text-secondary)">Next: </span>';
    html += '<span class="tier-tooltip-badge">' + nextInfo.badge + '</span> ';
    html += '<strong>' + nextInfo.name + '</strong>';
    html += ' &mdash; ' + nextInfo.threshold + ' msgs/week';
    html += '</div>';
  } else {
    html += '<div class="tier-tooltip-next" style="color:var(--accent)">Max tier reached!</div>';
  }

  html += '<div class="tier-tooltip-divider"></div>';
  html += '<div class="tier-tooltip-list">';
  for (let i = 1; i <= 10; i++) {
    const t = TIER_CONFIG[i];
    const active = i <= tier;
    const isCurrent = i === tier;
    html += '<div class="tier-tooltip-row' + (active ? ' active' : '') + (isCurrent ? ' current' : '') + '">';
    html += '<span class="tier-tooltip-badge tier-badge-' + t.cssClass.replace('tier-', '') + '">' + t.badge + '</span>';
    html += '<span class="tier-tooltip-name-preview"><span class="' + t.cssClass + '"' + (i >= 9 ? ' data-text="' + uname + '"' : '') + '>' + uname + '</span></span>';
    html += '<span class="tier-tooltip-tier-label">' + t.name + '</span>';
    html += '<span class="tier-tooltip-threshold">' + t.threshold + '/wk</span>';
    if (isCurrent) html += '<span class="tier-tooltip-you">YOU</span>';
    html += '</div>';
  }
  html += '</div>';
  html += '</div>';
  return html;
}

let tierTooltipEl = null;
function toggleTierTooltip(e) {
  if (tierTooltipEl) {
    tierTooltipEl.remove();
    tierTooltipEl = null;
    return;
  }
  tierTooltipEl = document.createElement('div');
  tierTooltipEl.className = 'tier-tooltip';
  tierTooltipEl.innerHTML = buildTierTooltipHTML();
  document.body.appendChild(tierTooltipEl);

  // Position below the badge
  const badge = document.getElementById('chat-username-badge');
  if (badge) {
    const rect = badge.getBoundingClientRect();
    tierTooltipEl.style.top = (rect.bottom + 6) + 'px';
    tierTooltipEl.style.right = (window.innerWidth - rect.right) + 'px';
  }

  // Close on click outside
  setTimeout(() => {
    document.addEventListener('click', closeTierTooltip, { once: true });
  }, 0);
}
function closeTierTooltip(e) {
  if (tierTooltipEl) {
    if (tierTooltipEl.contains(e?.target)) {
      document.addEventListener('click', closeTierTooltip, { once: true });
      return;
    }
    tierTooltipEl.remove();
    tierTooltipEl = null;
  }
}

// --- Admin gear dropdown ---
(function initAdminGear() {
  const gearBtn = document.getElementById('admin-gear-btn');
  const dropdown = document.getElementById('admin-dropdown');
  const clearBtn = document.getElementById('admin-clear-chat');
  if (gearBtn && dropdown) {
    gearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      playNormalClick();
      dropdown.classList.toggle('open');
    });
    document.addEventListener('click', () => dropdown.classList.remove('open'));
  }
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      playNormalClick();
      sendChatWs({ type: 'clear_chat' });
      dropdown.classList.remove('open');
    });
  }
})();

// --- Admin tier popover ---
let adminTierPopoverEl = null;
let adminTierPopoverHideTimer = null;

function showAdminTierPopover(username, currentTier, minTier, anchorEl) {
  clearTimeout(adminTierPopoverHideTimer);
  hideAdminTierPopover();

  const popover = document.createElement('div');
  popover.className = 'admin-tier-popover';
  popover.dataset.username = username;
  updateAdminTierPopoverContentEl(popover, username, currentTier, minTier);

  popover.addEventListener('mouseenter', () => clearTimeout(adminTierPopoverHideTimer));
  popover.addEventListener('mouseleave', () => scheduleHideAdminTierPopover());

  document.body.appendChild(popover);
  adminTierPopoverEl = popover;

  // Position near anchor
  const rect = anchorEl.getBoundingClientRect();
  popover.style.left = rect.left + 'px';
  popover.style.top = (rect.bottom + 6) + 'px';
  // Keep within viewport
  const pRect = popover.getBoundingClientRect();
  if (pRect.right > window.innerWidth - 10) {
    popover.style.left = (window.innerWidth - pRect.width - 10) + 'px';
  }
}

function updateAdminTierPopoverContent(username, tier, minTier) {
  if (adminTierPopoverEl) updateAdminTierPopoverContentEl(adminTierPopoverEl, username, tier, minTier);
}

function updateAdminTierPopoverContentEl(el, username, currentTier, minTier) {
  const tierInfo = TIER_CONFIG[currentTier] || TIER_CONFIG[0];
  const floorInfo = TIER_CONFIG[minTier] || TIER_CONFIG[0];
  const floorLabel = minTier > 0 ? ('Tier ' + minTier + ' - ' + floorInfo.name) : 'None';

  el.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'atp-header';
  header.textContent = username;
  el.appendChild(header);

  const current = document.createElement('div');
  current.className = 'atp-current';
  current.textContent = currentTier > 0
    ? 'Current: ' + tierInfo.badge + ' Tier ' + currentTier + ' - ' + tierInfo.name
    : 'Current: No Tier';
  el.appendChild(current);

  const floor = document.createElement('div');
  floor.className = 'atp-floor';

  const floorSpan = document.createElement('span');
  floorSpan.className = 'atp-floor-label';
  floorSpan.textContent = 'Floor: ' + floorLabel;
  floor.appendChild(floorSpan);

  const downBtn = document.createElement('button');
  downBtn.className = 'atp-btn';
  downBtn.textContent = '\u2212';
  downBtn.disabled = minTier <= 0;
  downBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    playNormalClick();
    adminSetFloor(username, minTier - 1);
  });
  floor.appendChild(downBtn);

  const upBtn = document.createElement('button');
  upBtn.className = 'atp-btn';
  upBtn.textContent = '+';
  upBtn.disabled = minTier >= 10;
  upBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    playNormalClick();
    adminSetFloor(username, minTier + 1);
  });
  floor.appendChild(upBtn);

  el.appendChild(floor);
}

function scheduleHideAdminTierPopover() {
  clearTimeout(adminTierPopoverHideTimer);
  adminTierPopoverHideTimer = setTimeout(hideAdminTierPopover, 300);
}

function hideAdminTierPopover() {
  clearTimeout(adminTierPopoverHideTimer);
  if (adminTierPopoverEl) {
    adminTierPopoverEl.remove();
    adminTierPopoverEl = null;
  }
}

function adminSetFloor(username, newMinTier) {
  const clamped = Math.max(0, Math.min(10, newMinTier));
  sendChatWs({ type: 'set_min_tier', targetUsername: username, minTier: clamped });
}

function updateTypingIndicator() {
  const el = document.getElementById('gchat-typing-indicator');
  if (!el) return;
  if (!globalChatMode || chatTypingUsers.size === 0) {
    el.classList.add('hidden');
    return;
  }
  const names = Array.from(chatTypingUsers.keys());
  const textEl = el.querySelector('.gchat-typing-text');
  if (names.length === 1) {
    textEl.textContent = names[0] + ' is typing';
  } else {
    textEl.textContent = names.join(', ') + ' are typing';
  }
  el.classList.remove('hidden');
}

function clearAllTypingState() {
  for (const tid of chatTypingUsers.values()) clearTimeout(tid);
  chatTypingUsers.clear();
  updateTypingIndicator();
}

function updateChatCounts(online, inChat) {
  const el = document.getElementById('chat-online-stats');
  if (el) el.textContent = `${online} online · ${inChat} in chat`;
  if (globalChatMode) {
    const prefix = _appVersion ? `Pocket Agent v${_appVersion}` : 'Pocket Agent';
    document.title = `${prefix} — ${online} online · ${inChat} in chat`;
  }
}

function updateUnreadBadge() {
  const badge = document.getElementById('chat-toggle-badge');
  if (!badge) return;
  if (chatUnreadCount > 0 && !globalChatMode) {
    badge.textContent = chatUnreadCount > 99 ? '99+' : String(chatUnreadCount);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

async function toggleGlobalChat() {
  globalChatMode = !globalChatMode;
  const messagesEl = document.getElementById('messages');
  const globalMsgsEl = document.getElementById('global-chat-messages');
  const toolbarRow = document.getElementById('toolbar-row');
  const bgTasksArea = document.getElementById('background-tasks-area');
  const attachBtn = document.getElementById('attach-btn');
  const workflowBadge = document.getElementById('workflow-badge-container');
  const scrollTopBtn = document.getElementById('scroll-top-btn');
  const scrollBottomBtn = document.getElementById('scroll-bottom-btn');
  const freshStartBtn = document.getElementById('fresh-start-btn');
  const adminClearBtn = document.getElementById('admin-clear-chat-btn');

  if (globalChatMode) {
    // Enter chat mode — clear unread
    chatUnreadCount = 0;
    updateUnreadBadge();
    await getOrCreateChatUsername();

    // Close search/workflows panels if open
    closeSearch();
    closeWorkflows();

    messagesEl.classList.add('hidden');
    globalMsgsEl.classList.remove('hidden');
    toolbarRow.classList.add('hidden');
    if (attachBtn) attachBtn.classList.add('hidden');
    if (workflowBadge) workflowBadge.classList.add('hidden');
    document.querySelector('.input-toolbar-btns').classList.add('hidden');
    document.getElementById('mode-select').classList.add('hidden');
    if (scrollTopBtn) scrollTopBtn.classList.add('hidden');
    if (scrollBottomBtn) scrollBottomBtn.classList.add('hidden');
    if (freshStartBtn) freshStartBtn.classList.add('hidden');
    document.getElementById('gchat-scroll-top-btn').classList.remove('hidden');
    document.getElementById('gchat-scroll-bottom-btn').classList.remove('hidden');

    // Show admin clear button if admin
    if (adminClearBtn) adminClearBtn.classList.toggle('hidden', !chatIsAdmin);

    input.value = '';
    input.style.height = 'auto';
    input.placeholder = 'say something...';

    // Update floating toggle button — show agent icon, mark active
    const toggleBtn = document.getElementById('chat-toggle-btn');
    toggleBtn.classList.add('active');
    toggleBtn.title = 'Back to Agent';
    toggleBtn.querySelector('.toggle-chat-icon').classList.add('hidden');
    toggleBtn.querySelector('.toggle-agent-icon').classList.remove('hidden');

    // Update title bar for global chat
    const chatStatsEl = document.getElementById('chat-online-stats');
    if (chatStatsEl && chatStatsEl.textContent) {
      const prefix = _appVersion ? `Pocket Agent v${_appVersion}` : 'Pocket Agent';
      document.title = `${prefix} — ${chatStatsEl.textContent}`;
    }

    // Deselect active session in sidebar
    document.querySelectorAll('.sidebar-session.active').forEach(el => el.classList.remove('active'));

    renderGlobalChatMessages();
    enterChatActive();
  } else {
    // Exit chat mode — restore message stats in title and re-render session tabs
    updateStats();
    renderTabs();
    leaveChatActive();
    clearAllTypingState();
    hideAdminTierPopover();
    gchatClearReply();
    gchatDismissMentionList();
    mentionHighlight.innerHTML = '';
    input.classList.remove('mention-active');
    messagesEl.classList.remove('hidden');
    globalMsgsEl.classList.add('hidden');
    toolbarRow.classList.remove('hidden');
    if (getBackgroundTaskCount(currentSessionId) > 0) {
      bgTasksArea.classList.remove('hidden');
    }
    if (attachBtn) attachBtn.classList.remove('hidden');
    if (workflowBadge) workflowBadge.classList.remove('hidden');
    document.querySelector('.input-toolbar-btns').classList.remove('hidden');
    document.getElementById('mode-select').classList.remove('hidden');
    if (scrollTopBtn) scrollTopBtn.classList.remove('hidden');
    if (scrollBottomBtn) scrollBottomBtn.classList.remove('hidden');
    if (freshStartBtn) freshStartBtn.classList.remove('hidden');
    if (adminClearBtn) adminClearBtn.classList.add('hidden');
    document.getElementById('gchat-scroll-top-btn').classList.add('hidden');
    document.getElementById('gchat-scroll-bottom-btn').classList.add('hidden');
    gchatScrollTopBtn.classList.remove('visible');
    gchatScrollBottomBtn.classList.remove('visible');
    input.value = '';
    input.style.height = 'auto';
    updateInputPlaceholder();

    // Update floating toggle button — show chat icon, remove active
    const toggleBtn = document.getElementById('chat-toggle-btn');
    toggleBtn.classList.remove('active');
    toggleBtn.title = 'Global Chat';
    toggleBtn.querySelector('.toggle-chat-icon').classList.remove('hidden');
    toggleBtn.querySelector('.toggle-agent-icon').classList.add('hidden');
  }
}

// Background tasks tracking
let backgroundTasksBySession = new Map(); // sessionId -> Map(taskId -> { type, description })

function addBackgroundTask(sessionId, taskId, type, description) {
  if (!backgroundTasksBySession.has(sessionId)) {
    backgroundTasksBySession.set(sessionId, new Map());
  }
  backgroundTasksBySession.get(sessionId).set(taskId, { type, description });
  updateBackgroundTasksUI();
}

function getBackgroundTaskCount(sessionId) {
  const tasks = backgroundTasksBySession.get(sessionId || currentSessionId);
  return tasks ? tasks.size : 0;
}

function updateBackgroundTasksUI() {
  const area = document.getElementById('background-tasks-area');
  const countEl = area.querySelector('.bg-task-count');
  const listEl = document.getElementById('background-tasks-list');
  const tasks = backgroundTasksBySession.get(currentSessionId);
  const count = tasks ? tasks.size : 0;

  if (count === 0) {
    area.classList.add('hidden');
    area.classList.remove('active');
    return;
  }

  area.classList.remove('hidden');
  countEl.textContent = count;

  // Update vertical list — only current session's tasks
  listEl.innerHTML = '';
  for (const [tid, task] of tasks) {
    const item = document.createElement('div');
    item.className = 'bg-task-item';
    item.innerHTML = `
      <span class="bg-task-dot"></span>
      <span class="bg-task-type">${escapeHtml(task.type)}</span>
      <span class="bg-task-label" title="${escapeHtml(task.description)}">${escapeHtml(task.description)}</span>
      <button class="bg-task-close" onclick="playNormalClick(); removeBackgroundTask('${currentSessionId}', '${tid}')" title="Stop task">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M18 6L6 18m12 0L6 6"/></svg>
      </button>`;
    listEl.appendChild(item);
  }
}

function removeBackgroundTask(sessionId, taskId) {
  const tasks = backgroundTasksBySession.get(sessionId);
  if (tasks) {
    tasks.delete(taskId);
    if (tasks.size === 0) backgroundTasksBySession.delete(sessionId);
  }
  updateBackgroundTasksUI();
}

function toggleBackgroundTasks() {
  const area = document.getElementById('background-tasks-area');
  if (area.classList.contains('active')) {
    closeBackgroundTasks();
  } else {
    area.classList.add('active');
  }
}

function closeBackgroundTasks() {
  document.getElementById('background-tasks-area').classList.remove('active');
}

function selectWorkflow(command) {
  activeWorkflow = command;
  closeWorkflows();
  const container = document.getElementById('workflow-badge-container');
  const escapedName = command.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  container.innerHTML = `<span class="workflow-badge">${escapedName}<button class="workflow-badge-remove" onclick="playNormalClick(); clearWorkflow()" title="Remove workflow"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M18 6L6 18m12 0L6 6"/></svg></button></span>`;
  input.placeholder = `add context for /${escapedName}...`;
  input.focus();
}

function clearWorkflow() {
  activeWorkflow = null;
  document.getElementById('workflow-badge-container').innerHTML = '';
  input.placeholder = "what's on your mind? \u{1F431}";
}

