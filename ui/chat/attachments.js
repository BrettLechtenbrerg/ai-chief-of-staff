function triggerAttach() {
  fileInput.click();
}

async function handleFileSelect(e) {
  const files = Array.from(e.target.files);
  if (files.length === 0) return;

  for (const file of files) {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';

    // Validate extension
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      addMessage('system', `Unsupported file type: ${file.name}`);
      continue;
    }

    // Validate size
    if (file.size > MAX_FILE_SIZE) {
      addMessage('system', `File too large (max 10MB): ${file.name}`);
      continue;
    }

    try {
      const attachment = await readFile(file, ext);
      const currentAttachments = getPendingAttachments();
      currentAttachments.push(attachment);
      setPendingAttachments(currentAttachments);
    } catch (err) {
      addMessage('system', `Failed to read file: ${file.name}`);
    }
  }

  // Reset file input and update UI
  fileInput.value = '';
  renderAttachmentPreviews();
  input.focus();
}

async function readFile(file, ext) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const attachment = {
        name: file.name,
        type: file.type,
        size: file.size,
        ext: ext,
        isImage: IMAGE_EXTENSIONS.has(ext),
      };

      if (attachment.isImage || BINARY_EXTENSIONS.has(ext) || EXTRACTABLE_EXTENSIONS.has(ext)) {
        // Store as data URL for images and binary/extractable documents
        attachment.dataUrl = e.target.result;
        attachment.content = null;
      } else {
        // Store as text for text files
        attachment.dataUrl = null;
        attachment.content = e.target.result;
      }

      resolve(attachment);
    };

    reader.onerror = () => reject(reader.error);

    if (IMAGE_EXTENSIONS.has(ext) || BINARY_EXTENSIONS.has(ext) || EXTRACTABLE_EXTENSIONS.has(ext)) {
      reader.readAsDataURL(file);
    } else {
      reader.readAsText(file);
    }
  });
}

function renderAttachmentPreviews() {
  const grid = document.getElementById('attachments-grid');
  const panel = document.getElementById('attachments-panel');
  const slideUp = document.getElementById('slide-up-panel');
  if (!grid || !panel || !slideUp) return;

  const attachments = getPendingAttachments();

  if (attachments.length === 0) {
    grid.innerHTML = '';
    panel.classList.add('hidden');
    // Close slide-up if no other panel is open
    const searchOpen = !document.getElementById('search-panel').classList.contains('hidden');
    const workflowsOpen = !document.getElementById('workflows-panel').classList.contains('hidden');
    if (!searchOpen && !workflowsOpen) {
      slideUp.classList.remove('open');
    }
    return;
  }

  grid.innerHTML = '';
  attachments.forEach((att, index) => {
    const preview = document.createElement('div');
    preview.className = 'attachment-preview';

    if (att.isImage && att.dataUrl) {
      const img = document.createElement('img');
      img.src = att.dataUrl;
      img.alt = att.name;
      preview.innerHTML = `
        <div class="attachment-info">
          <div class="attachment-name">${escapeHtml(att.name)}</div>
          <div class="attachment-size">${formatFileSize(att.size)}</div>
        </div>
        <button class="attachment-remove" onclick="playNormalClick(); removeAttachment(${index})">×</button>
      `;
      preview.insertBefore(img, preview.firstChild);
    } else {
      preview.innerHTML = `
        <div class="attachment-icon">${att.ext}</div>
        <div class="attachment-info">
          <div class="attachment-name">${escapeHtml(att.name)}</div>
          <div class="attachment-size">${formatFileSize(att.size)}</div>
        </div>
        <button class="attachment-remove" onclick="playNormalClick(); removeAttachment(${index})">×</button>
      `;
    }

    grid.appendChild(preview);
  });

  panel.classList.remove('hidden');
  slideUp.classList.add('open');
}

function removeAttachment(index) {
  const attachments = getPendingAttachments();
  attachments.splice(index, 1);
  setPendingAttachments(attachments);
  renderAttachmentPreviews();
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function clearAttachments() {
  setPendingAttachments([]);
  renderAttachmentPreviews();
}

// Drag and Drop handling
const dragOverlay = document.getElementById('drag-overlay');
let dragCounter = 0; // Track nested drag events

function showDragOverlay() {
  dragOverlay.classList.add('active');
}

function hideDragOverlay() {
  dragOverlay.classList.remove('active');
}

// Prevent default drag behaviors on the whole document
document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dragCounter++;

  // Only show overlay if dragging files (types may be DOMStringList or Array depending on Electron version)
  const types = e.dataTransfer?.types;
  if (types && (typeof types.includes === 'function' ? types.includes('Files') : types.contains('Files'))) {
    showDragOverlay();
  }
});

document.addEventListener('dragleave', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dragCounter--;

  // Hide overlay when drag leaves the window entirely
  if (dragCounter === 0) {
    hideDragOverlay();
  }
});

document.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
});

document.addEventListener('drop', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  dragCounter = 0;
  hideDragOverlay();

  const files = Array.from(e.dataTransfer?.files || []);
  if (files.length === 0) return;

  for (const file of files) {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';

    // Validate extension
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      addMessage('system', `Unsupported file type: ${file.name}`);
      continue;
    }

    // Validate size
    if (file.size > MAX_FILE_SIZE) {
      addMessage('system', `File too large (max 10MB): ${file.name}`);
      continue;
    }

    try {
      const attachment = await readFile(file, ext);
      const currentAttachments = getPendingAttachments();
      currentAttachments.push(attachment);
      setPendingAttachments(currentAttachments);
    } catch (err) {
      addMessage('system', `Failed to read file: ${file.name}`);
    }
  }

  renderAttachmentPreviews();
  input.focus();
});

// Paste handler for clipboard images (Cmd+V / Ctrl+V)
document.addEventListener('paste', async (e) => {
  const items = Array.from(e.clipboardData?.items || []);
  const imageItems = items.filter(item => item.type.startsWith('image/'));

  if (imageItems.length === 0) return; // Let normal text paste proceed

  e.preventDefault();

  for (const item of imageItems) {
    const file = item.getAsFile();
    if (!file) continue;

    // Determine extension from MIME type
    const mimeToExt = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/bmp': 'bmp',
    };
    const ext = mimeToExt[file.type] || 'png';

    // Give it a name since clipboard images don't have one
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const namedFile = new File([file], `clipboard-${timestamp}.${ext}`, { type: file.type });

    // Validate size
    if (namedFile.size > MAX_FILE_SIZE) {
      addMessage('system', `Pasted image too large (max 10MB)`);
      continue;
    }

    try {
      const attachment = await readFile(namedFile, ext);
      const currentAttachments = getPendingAttachments();
      currentAttachments.push(attachment);
      setPendingAttachments(currentAttachments);
    } catch (err) {
      addMessage('system', `Failed to read pasted image`);
    }
  }

  renderAttachmentPreviews();
  input.focus();
});

// Auto-resize textarea
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 150) + 'px';
});

// Sync mention highlight scroll with textarea
input.addEventListener('scroll', () => {
  mentionHighlight.scrollTop = input.scrollTop;
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Cmd/Ctrl + K to clear
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    clearChat();
  }
  // Cmd/Ctrl + , to open settings
  if ((e.metaKey || e.ctrlKey) && e.key === ',') {
    e.preventDefault();
    openSettings();
  }
});

