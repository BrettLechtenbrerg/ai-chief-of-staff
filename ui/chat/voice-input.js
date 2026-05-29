/**
 * Voice-input button in the chat composer.
 *
 * Flow:
 *   idle  -> click -> request mic -> recording (GREEN button, live interim
 *            text appears in #message-input as the user speaks, courtesy
 *            of the Web Speech API)
 *   recording -> click -> stop -> transcribing (interim text removed,
 *            Whisper given the full audio blob for the accurate pass)
 *   transcribing -> Whisper returns -> final text inserted in place of
 *            the interim text -> idle
 *   (any error) -> notyf.error(...) -> idle
 *
 * Why two transcription engines:
 *   - Web Speech API (browser-native, free) gives instant interim text
 *     so the user sees their words appear as they speak. It's not
 *     reliably accurate enough to ship as the final transcription.
 *   - OpenAI Whisper (existing key, no new signup) is the accurate
 *     final pass. Slow (1-3s after stop) but right.
 *   The interim is overwritten by the final, so the user gets the live
 *   feel without the accuracy cost.
 *
 * "You" hallucination fix:
 *   Whisper outputs "you" / "Thanks for watching" / "okay" when handed
 *   a silent or near-silent blob. We do two things:
 *     1. start MediaRecorder with a 1000ms timeslice so chunks flush as
 *        audio arrives (some Chromium builds produce a malformed single
 *        chunk if no timeslice is set).
 *     2. measure total recorded audio bytes. Below a sane floor we treat
 *        it as silence and surface "didn't hear anything" instead of
 *        sending a junk blob to Whisper.
 *
 * Boot:
 *   On DOMContentLoaded we ask the main process whether transcription is
 *   available (= an OpenAI key is configured). If yes, the mic button is
 *   un-hidden. If not, it stays hidden — no half-broken UI surface.
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

  // Minimum bytes of recorded audio we'll bother sending to Whisper. Below
  // this, the recording is effectively silence and Whisper would hallucinate
  // ("you", "Thanks for watching", etc.) so we short-circuit with a toast.
  // 2KB ≈ a tiny fraction of a second of opus audio. A 1-second utterance at
  // opus/48kHz is typically 6-12KB.
  const MIN_AUDIO_BYTES = 2048;

  let state = STATE.IDLE;
  let mediaRecorder = null;
  let mediaStream = null;
  let chunks = [];
  let recordedFormat = 'webm';

  // --- Live interim transcription (Web Speech API) ---
  // We keep a snapshot of the input value at the moment recording starts so
  // we can correctly splice interim text in/out without nuking text the user
  // typed before clicking the mic.
  let speechRecognition = null;
  let interimSupported = false;
  let inputBaselineAtRecordStart = '';
  let lastInterimText = '';
  let speechRecognitionStoppedEarly = false;

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

  function getInput() {
    return document.getElementById('message-input');
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
      btn.setAttribute('data-tip', 'Listening… click to stop');
    } else if (next === STATE.TRANSCRIBING) {
      btn.setAttribute('data-tip', 'Transcribing\u2026');
    } else {
      // The button is only ever un-hidden when an OpenAI key is configured
      // (see init()), so the idle hint must not imply a key is missing.
      btn.setAttribute('data-tip', 'Record voice note');
    }
  }

  /**
   * Splice text into the input. mode='replace-interim' nukes whatever
   * interim text is currently shown (everything past inputBaselineAtRecordStart)
   * and writes `text` in its place. mode='append' just smart-joins onto the
   * end (used as a fallback if we don't have a baseline).
   */
  function writeToInput(text, mode) {
    const input = getInput();
    if (!input) return;
    const trimmed = String(text || '').trim();

    if (mode === 'replace-interim') {
      const baseline = inputBaselineAtRecordStart;
      const sep = baseline.length === 0
        ? ''
        : (/\s$/.test(baseline) || trimmed.length === 0)
          ? ''
          : ' ';
      input.value = baseline + sep + trimmed;
    } else {
      // append mode (legacy path)
      const cur = input.value;
      const sep = cur.length === 0 ? '' : /\s$/.test(cur) ? '' : ' ';
      input.value = cur + sep + trimmed;
    }
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    // Fire input event so the textarea auto-resizes (autoResizeTextarea is
    // bound to 'input' in input-handler.js).
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function pickMimeType() {
    // Prefer opus in webm — small, well-supported by MediaRecorder on
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

  // ---- Web Speech API: live interim transcription ----

  function setupSpeechRecognition() {
    // webkitSpeechRecognition is the Chromium-flavored Web Speech API. It's
    // present in Electron because Electron embeds Chromium. Quality varies
    // by OS — on macOS it routes through the system speech service which
    // is decent for English. We use it ONLY for the live as-you-speak
    // preview; Whisper is the authoritative final transcription.
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      interimSupported = false;
      return null;
    }
    interimSupported = true;
    const rec = new SR();
    rec.continuous = true;       // don't stop after the first pause
    rec.interimResults = true;   // emit partial guesses while speaking
    rec.lang = navigator.language || 'en-US';
    return rec;
  }

  function startInterimTranscription() {
    if (!interimSupported) return;
    try {
      speechRecognition = setupSpeechRecognition();
      if (!speechRecognition) return;
    } catch (err) {
      console.warn('[voice-input] interim setup failed', err);
      interimSupported = false;
      return;
    }
    lastInterimText = '';
    speechRecognitionStoppedEarly = false;

    speechRecognition.onresult = (event) => {
      // Concatenate everything Web Speech has emitted so far (both final
      // and interim segments). We want the user to see the running
      // transcript, not just the latest fragment.
      let combined = '';
      for (let i = 0; i < event.results.length; i++) {
        const res = event.results[i];
        combined += (res[0] && res[0].transcript) || '';
      }
      lastInterimText = combined;
      writeToInput(lastInterimText, 'replace-interim');
    };

    speechRecognition.onerror = (event) => {
      // Common errors: 'no-speech', 'audio-capture', 'not-allowed',
      // 'network', 'aborted'. We swallow most of these — Whisper will
      // still run on the recorded blob and be the source of truth. Only
      // surface a toast for permission denial, which the user needs to
      // know about because it'll affect Whisper too.
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        console.warn('[voice-input] interim transcription denied:', event.error);
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        console.warn('[voice-input] interim transcription error:', event.error);
      }
      speechRecognitionStoppedEarly = true;
    };

    speechRecognition.onend = () => {
      // Web Speech can auto-stop on long pauses even with continuous=true.
      // If we're still in RECORDING state, try to restart it so the user
      // keeps seeing live text. If they've already clicked stop, leave it.
      if (state === STATE.RECORDING && !speechRecognitionStoppedEarly) {
        try {
          speechRecognition.start();
        } catch {
          // Already started or in a bad state; nothing we can do.
        }
      }
    };

    try {
      speechRecognition.start();
    } catch (err) {
      // Often happens if a prior recognition session didn't fully tear
      // down. Non-fatal — Whisper still works.
      console.warn('[voice-input] interim start failed', err);
      interimSupported = false;
    }
  }

  function stopInterimTranscription() {
    if (!speechRecognition) return;
    speechRecognitionStoppedEarly = true;
    try {
      speechRecognition.onend = null;
      speechRecognition.onresult = null;
      speechRecognition.onerror = null;
      speechRecognition.stop();
    } catch {
      // ignore
    }
    speechRecognition = null;
  }

  // ---- MediaRecorder + Whisper (authoritative path) ----

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
      stopInterimTranscription();
      setBtnState(STATE.IDLE);
      toast('Recording error: ' + (e.error && e.error.message ? e.error.message : 'unknown'));
    };
    mediaRecorder.onstop = async () => {
      releaseStream();
      const totalSize = chunks.reduce((acc, c) => acc + (c.size || 0), 0);
      const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      chunks = [];

      // Silence guard. Below the floor, Whisper would hallucinate "you"
      // or similar; we'd rather tell the user honestly that we heard
      // nothing. Don't roll back the interim text — the user might have
      // gotten useful preview text from Web Speech even if Whisper
      // would have struggled.
      if (totalSize < MIN_AUDIO_BYTES) {
        setBtnState(STATE.IDLE);
        // If interim caught nothing either, fully roll back so the input
        // returns to whatever the user had typed before clicking the mic.
        if (!lastInterimText.trim()) {
          writeToInput('', 'replace-interim');
        }
        toast(
          'Didn\u2019t hear anything. Speak a bit louder or check that your mic is on, then try again.'
        );
        return;
      }

      await transcribeBlob(blob);
    };

    // Snapshot what the input contained before we started so interim
    // splicing knows where the user's typed text ends and our injected
    // text begins.
    const input = getInput();
    inputBaselineAtRecordStart = input ? input.value : '';
    lastInterimText = '';

    // Kick off live interim text BEFORE we start MediaRecorder so the
    // user sees something happening immediately. If Web Speech is
    // unsupported or fails, the recording still works — interim is
    // purely additive.
    startInterimTranscription();

    // 1000ms timeslice = MediaRecorder flushes a chunk every second.
    // Without this, some Chromium builds emit a single malformed chunk
    // at stop time, which Whisper "transcribes" as "you".
    mediaRecorder.start(1000);
    setBtnState(STATE.RECORDING);
  }

  function stopRecording() {
    if (state !== STATE.RECORDING) return;
    stopInterimTranscription();
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

      // Whisper is the source of truth. Replace whatever interim text
      // we showed with the accurate version. Also guard against the
      // empty-response case (Whisper sometimes returns empty string
      // for silence-ish blobs that squeaked past the byte floor).
      const finalText = (result.text || '').trim();
      if (!finalText) {
        // Roll back interim so the input matches what it was before
        // the user clicked the mic.
        writeToInput('', 'replace-interim');
        toast('Didn\u2019t catch anything clear. Try again, a bit louder.');
        setBtnState(STATE.IDLE);
        return;
      }

      writeToInput(finalText, 'replace-interim');
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
    // While transcribing, the button is disabled — nothing to do.
  }

  async function init() {
    const btn = getBtn();
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (typeof playNormalClick === 'function') playNormalClick();
      onClick();
    });
    setBtnState(STATE.IDLE);

    // Probe Web Speech support so we know whether to wire up interim text.
    // The flag itself isn't acted on here — startInterimTranscription
    // checks it at recording time — but setting it early surfaces a
    // console warning if the runtime lacks it.
    if (!(window.SpeechRecognition || window.webkitSpeechRecognition)) {
      console.warn('[voice-input] Web Speech API unavailable; interim transcription disabled. Final Whisper pass will still run.');
    }

    // Only reveal the mic if an OpenAI key is configured. Without one the
    // Whisper call would always fail — better to hide the surface entirely.
    try {
      const avail = await window.pocketAgent.audio.isAvailable();
      if (avail && avail.available) {
        btn.hidden = false;
      }
    } catch (err) {
      // Stale install (older main process without audio:isAvailable). Keep
      // the button hidden — same end result as no-key.
      console.warn('[voice-input] isAvailable check failed', err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
