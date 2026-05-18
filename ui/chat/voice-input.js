/**
 * Voice-input button in the chat composer.
 *
 * Flow:
 *   idle  -> click -> request mic -> recording
 *   recording -> click -> stop -> transcribing
 *   transcribing -> Whisper returns -> append text to #message-input -> idle
 *   (any error)  -> notyf.error(...) -> idle
 *
 * Boot:
 *   On DOMContentLoaded we ask the main process whether transcription is
 *   available (= an OpenAI key is configured). If yes, the mic button is
 *   un-hidden. If not, it stays hidden \u2014 no half-broken UI surface.
 *
 * Mic permission:
 *   On macOS the OS prompt fires on the first getUserMedia({ audio: true })
 *   call, gated by both the `NSMicrophoneUsageDescription` Info.plist string
 *   and the `com.apple.security.device.audio-input` entitlement (both wired
 *   in package.json + build/entitlements.mac.plist). If the user denies,
 *   getUserMedia rejects with NotAllowedError and we surface a toast telling
 *   them how to re-enable it in System Settings.
 */
(function () {
  const STATE = { IDLE: 'idle', RECORDING: 'recording', TRANSCRIBING: 'transcribing' };

  let state = STATE.IDLE;
  let mediaRecorder = null;
  let mediaStream = null;
  let chunks = [];
  let recordedFormat = 'webm';

  // notyf is initialized in global-chat.js and lives on window. We grab it
  // lazily so script load order doesn't matter.
  function toast(msg, type) {
    if (window.notyf && typeof window.notyf[type === 'success' ? 'success' : 'error'] === 'function') {
      window.notyf[type === 'success' ? 'success' : 'error'](msg);
    } else if (typeof showChatToast === 'function') {
      showChatToast(msg);
    } else {
      console.warn('[voice-input]', msg);
    }
  }

  function getBtn() {
    return document.getElementById('voice-btn');
  }

  function setBtnState(next) {
    state = next;
    const btn = getBtn();
    if (!btn) return;
    btn.classList.remove('is-idle', 'is-recording', 'is-transcribing');
    btn.classList.add('is-' + next);
    btn.disabled = next === STATE.TRANSCRIBING;
    // Use `data-tip` (custom CSS tooltip from shared/icon-buttons.css), not
    // `title=` — native HTML tooltips are unreliable in Electron windows.
    if (next === STATE.RECORDING) {
      btn.setAttribute('data-tip', 'Click to stop recording');
    } else if (next === STATE.TRANSCRIBING) {
      btn.setAttribute('data-tip', 'Transcribing\u2026');
    } else {
      btn.setAttribute('data-tip', 'Record voice note (needs OpenAI key)');
    }
  }

  function appendToInput(text) {
    const input = document.getElementById('message-input');
    if (!input) return;
    const trimmed = String(text || '').trim();
    if (!trimmed) return;
    const cur = input.value;
    // Smart-join: if there's already text and it doesn't end with whitespace,
    // separate with a single space; otherwise just append.
    const sep = cur.length === 0 ? '' : /\s$/.test(cur) ? '' : ' ';
    input.value = cur + sep + trimmed;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    // Fire input event so the textarea auto-resizes (autoResizeTextarea is
    // bound to 'input' in input-handler.js).
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function pickMimeType() {
    // Prefer opus in webm \u2014 small, well-supported by MediaRecorder on
    // Electron/Chromium, accepted by Whisper. Fall back through a chain in
    // case some future runtime drops opus support.
    const candidates = [
      { mime: 'audio/webm;codecs=opus', format: 'webm' },
      { mime: 'audio/webm', format: 'webm' },
      { mime: 'audio/ogg;codecs=opus', format: 'ogg' },
      { mime: 'audio/mp4', format: 'mp4' },
    ];
    for (const c of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(c.mime)) return c;
    }
    return { mime: '', format: 'webm' };
  }

  async function startRecording() {
    if (state !== STATE.IDLE) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('Microphone API not available in this build.');
      return;
    }
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = err && err.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        toast('Microphone access denied. Enable it in System Settings \u2192 Privacy & Security \u2192 Microphone.');
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        toast('No microphone found.');
      } else {
        toast('Could not access the microphone: ' + (err && err.message ? err.message : name || 'unknown error'));
      }
      return;
    }

    const picked = pickMimeType();
    recordedFormat = picked.format;
    chunks = [];

    try {
      mediaRecorder = picked.mime
        ? new MediaRecorder(mediaStream, { mimeType: picked.mime })
        : new MediaRecorder(mediaStream);
    } catch (err) {
      releaseStream();
      toast('Could not start recording: ' + (err && err.message ? err.message : 'unknown error'));
      return;
    }

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    mediaRecorder.onerror = (e) => {
      console.error('[voice-input] MediaRecorder error', e);
      releaseStream();
      setBtnState(STATE.IDLE);
      toast('Recording error: ' + (e.error && e.error.message ? e.error.message : 'unknown'));
    };
    mediaRecorder.onstop = async () => {
      releaseStream();
      const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      chunks = [];
      if (blob.size === 0) {
        setBtnState(STATE.IDLE);
        toast('Empty recording \u2014 nothing to transcribe.');
        return;
      }
      await transcribeBlob(blob);
    };

    mediaRecorder.start();
    setBtnState(STATE.RECORDING);
  }

  function stopRecording() {
    if (state !== STATE.RECORDING) return;
    setBtnState(STATE.TRANSCRIBING);
    try {
      mediaRecorder.stop();
    } catch (err) {
      console.error('[voice-input] stop failed', err);
      releaseStream();
      setBtnState(STATE.IDLE);
      toast('Could not stop recording.');
    }
  }

  function releaseStream() {
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => {
        try { t.stop(); } catch { /* noop */ }
      });
      mediaStream = null;
    }
  }

  async function transcribeBlob(blob) {
    try {
      const buf = await blob.arrayBuffer();
      const u8 = new Uint8Array(buf);
      // safeIpc is the project's pattern for surfacing "no handler registered"
      // toasts when a stale install lacks the new IPC channel.
      const call = typeof window.safeIpc === 'function'
        ? window.safeIpc('audio.transcribe', () => window.pocketAgent.audio.transcribe(u8, recordedFormat))
        : window.pocketAgent.audio.transcribe(u8, recordedFormat);
      const result = await call;
      if (!result || !result.success) {
        toast(result && result.error ? result.error : 'Transcription failed.');
        setBtnState(STATE.IDLE);
        return;
      }
      appendToInput(result.text);
      setBtnState(STATE.IDLE);
    } catch (err) {
      console.error('[voice-input] transcribe failed', err);
      toast('Transcription failed: ' + (err && err.message ? err.message : 'unknown error'));
      setBtnState(STATE.IDLE);
    }
  }

  function onClick() {
    if (state === STATE.IDLE) {
      startRecording();
    } else if (state === STATE.RECORDING) {
      stopRecording();
    }
    // While transcribing, the button is disabled \u2014 nothing to do.
  }

  async function init() {
    const btn = getBtn();
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (typeof playNormalClick === 'function') playNormalClick();
      onClick();
    });
    setBtnState(STATE.IDLE);

    // Only reveal the mic if an OpenAI key is configured. Without one the
    // Whisper call would always fail \u2014 better to hide the surface entirely.
    try {
      const avail = await window.pocketAgent.audio.isAvailable();
      if (avail && avail.available) {
        btn.hidden = false;
      }
    } catch (err) {
      // Stale install (older main process without audio:isAvailable). Keep
      // the button hidden \u2014 same end result as no-key.
      console.warn('[voice-input] isAvailable check failed', err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
