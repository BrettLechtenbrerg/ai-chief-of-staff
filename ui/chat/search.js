function toggleSearch() {
  const panel = document.getElementById('slide-up-panel');
  const searchPanel = document.getElementById('search-panel');
  const workflowsPanel = document.getElementById('workflows-panel');
  const searchInput = document.getElementById('search-input');
  const searchBtn = document.getElementById('search-toolbar-btn');

  if (panel.classList.contains('open') && !searchPanel.classList.contains('hidden')) {
    closeSearch();
  } else {
    // Close workflows if open, show search
    workflowsPanel.classList.add('hidden');
    searchPanel.classList.remove('hidden');
    panel.classList.add('open');
    if (searchBtn) searchBtn.classList.add('active');
    const wfBtn = document.getElementById('workflows-toolbar-btn');
    if (wfBtn) wfBtn.classList.remove('active');
    searchInput.focus();
  }
}

function closeSearch() {
  const panel = document.getElementById('slide-up-panel');
  const searchPanel = document.getElementById('search-panel');
  const searchInput = document.getElementById('search-input');
  const searchBtn = document.getElementById('search-toolbar-btn');

  searchPanel.classList.add('hidden');
  panel.classList.remove('open');
  if (searchBtn) searchBtn.classList.remove('active');
  searchInput.value = '';
  clearSearchHighlights();
  updateSearchResultsCount(0, 0);
  searchMatches = [];
  currentSearchIndex = -1;
}

function handleSearchInput(event) {
  // Debounce search
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    performSearch(event.target.value);
  }, 150);
}

function handleSearchKeydown(event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    if (event.shiftKey) {
      navigateSearch(-1);
    } else {
      navigateSearch(1);
    }
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeSearch();
  }
}

function performSearch(query) {
  clearSearchHighlights();
  searchMatches = [];
  currentSearchIndex = -1;

  if (!query || query.trim().length === 0) {
    updateSearchResultsCount(0, 0);
    updateNavButtons();
    return;
  }

  const searchTerm = query.trim().toLowerCase();
  const messages = messagesDiv.querySelectorAll('.message');

  messages.forEach(msg => {
    // Search in text nodes, excluding timestamps and other meta elements
    const walker = document.createTreeWalker(
      msg,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node) {
          // Skip timestamps and attachment meta
          if (node.parentElement.classList.contains('message-timestamp') ||
              node.parentElement.classList.contains('message-attachment') ||
              node.parentElement.classList.contains('attachment-icon')) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node;
    while (node = walker.nextNode()) {
      const text = node.textContent;
      const lowerText = text.toLowerCase();
      let startIndex = 0;
      let index;

      while ((index = lowerText.indexOf(searchTerm, startIndex)) !== -1) {
        searchMatches.push({
          node: node,
          startOffset: index,
          endOffset: index + searchTerm.length,
          message: msg
        });
        startIndex = index + 1;
      }
    }
  });

  // Apply highlights
  highlightMatches();
  updateSearchResultsCount(searchMatches.length > 0 ? 1 : 0, searchMatches.length);
  updateNavButtons();

  // Navigate to first match
  if (searchMatches.length > 0) {
    currentSearchIndex = 0;
    scrollToCurrentMatch();
  }
}

function highlightMatches() {
  // Process matches in reverse order to avoid offset issues
  const matchesByNode = new Map();

  searchMatches.forEach((match, index) => {
    if (!matchesByNode.has(match.node)) {
      matchesByNode.set(match.node, []);
    }
    matchesByNode.get(match.node).push({ ...match, index });
  });

  matchesByNode.forEach((nodeMatches, node) => {
    // Sort in reverse order for safe replacement
    nodeMatches.sort((a, b) => b.startOffset - a.startOffset);

    const text = node.textContent;
    const parent = node.parentNode;
    const fragment = document.createDocumentFragment();

    let currentText = text;
    let parts = [];

    // Build parts array
    for (const match of nodeMatches) {
      const before = currentText.slice(match.endOffset);
      const matchText = currentText.slice(match.startOffset, match.endOffset);
      const remaining = currentText.slice(0, match.startOffset);

      parts.unshift({ type: 'text', content: before });
      parts.unshift({ type: 'match', content: matchText, index: match.index });

      currentText = remaining;
    }
    parts.unshift({ type: 'text', content: currentText });

    // Create nodes from parts
    parts.forEach(part => {
      if (part.type === 'text') {
        if (part.content) {
          fragment.appendChild(document.createTextNode(part.content));
        }
      } else {
        const mark = document.createElement('mark');
        mark.className = 'search-highlight';
        mark.dataset.matchIndex = part.index;
        mark.textContent = part.content;
        fragment.appendChild(mark);
      }
    });

    parent.replaceChild(fragment, node);
  });
}

function clearSearchHighlights() {
  const marks = messagesDiv.querySelectorAll('mark.search-highlight');
  marks.forEach(mark => {
    const parent = mark.parentNode;
    const text = document.createTextNode(mark.textContent);
    parent.replaceChild(text, mark);
    // Normalize to merge adjacent text nodes
    parent.normalize();
  });
}

function navigateSearch(direction) {
  if (searchMatches.length === 0) return;

  // Remove current highlight
  const currentMark = messagesDiv.querySelector('mark.search-highlight.current');
  if (currentMark) {
    currentMark.classList.remove('current');
  }

  // Update index
  currentSearchIndex += direction;
  if (currentSearchIndex >= searchMatches.length) {
    currentSearchIndex = 0;
  } else if (currentSearchIndex < 0) {
    currentSearchIndex = searchMatches.length - 1;
  }

  // Update count display
  updateSearchResultsCount(currentSearchIndex + 1, searchMatches.length);

  // Scroll to and highlight current match
  scrollToCurrentMatch();
}

function scrollToCurrentMatch() {
  const marks = messagesDiv.querySelectorAll('mark.search-highlight');
  marks.forEach((mark, idx) => {
    const matchIndex = parseInt(mark.dataset.matchIndex);
    if (matchIndex === currentSearchIndex) {
      mark.classList.add('current');
      mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      mark.classList.remove('current');
    }
  });
}

function updateSearchResultsCount(current, total) {
  const countEl = document.getElementById('search-results-count');
  if (total === 0) {
    countEl.textContent = '';
    countEl.classList.remove('has-results');
  } else {
    countEl.textContent = `${current}/${total}`;
    countEl.classList.add('has-results');
  }
}

function updateNavButtons() {
  const prevBtn = document.getElementById('search-prev-btn');
  const nextBtn = document.getElementById('search-next-btn');
  const hasMatches = searchMatches.length > 0;

  prevBtn.disabled = !hasMatches;
  nextBtn.disabled = !hasMatches;
}

// Keyboard shortcut for search (Cmd/Ctrl + F)
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
    e.preventDefault();
    toggleSearch();
  }
});

