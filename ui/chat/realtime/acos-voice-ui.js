/**
 * Voice mode UI controller.
 *
 * Minimal call start/stop control + status text wired to the ported realtime
 * session (window.AcosRealtime.createRealtimeSession). Reuses AICOS theme
 * tokens via the .acos-voice-* classes in chat/realtime/acos-voice.css.
 *
 * The button is gated on an OpenAI key being configured — reusing the same
 * `pocketAgent.audio.isAvailable` probe the Whisper mic button uses, so Voice
 * mode never appears without the key needed to mint a Realtime secret.
 */
(function () {
  const button = document.getElementById('acos-voice-btn');
  const statusEl = document.getElementById('acos-voice-status');
  const remoteAudioEl = document.getElementById('acos-remote-audio');
  if (!button || !statusEl) {
    return;
  }

  let session = null;
  let active = false;
  // Guards the async gap between a start click and session.start(): toggle() now
  // awaits the voice.enabled read before starting, so without this a rapid
  // double-click could pass the active/session check twice and spawn two
  // sessions. Set true the moment a start begins, cleared once the session is
  // created (or the start is rejected).
  let starting = false;
  // Latest status text and latest usage snapshot are rendered together into the
  // single status span so they don't clobber each other (gate #3 usage
  // visibility alongside the status line).
  let lastStatus = '';
  let lastUsage = null;

  function renderStatusLine() {
    let text = lastStatus || '';
    if (lastUsage && active) {
      const mins = Math.floor(lastUsage.elapsedMs / 60000);
      const secs = Math.floor((lastUsage.elapsedMs % 60000) / 1000);
      const time = `${mins}:${String(secs).padStart(2, '0')}`;
      const turns = lastUsage.maxTurns > 0
        ? `${lastUsage.turnCount}/${lastUsage.maxTurns} turns`
        : `${lastUsage.turnCount} turns`;
      const tokens = lastUsage.tokensUsed > 0
        ? ` · ${lastUsage.tokensUsed.toLocaleString()} tok`
        : '';
      const usage = `${time} · ${turns}${tokens}`;
      text = text ? `${text} — ${usage}` : usage;
    }
    statusEl.textContent = text;
    statusEl.hidden = !text;
  }

  function setStatus(message) {
    lastStatus = message || '';
    renderStatusLine();
    // If the failure is a denied microphone, turn the status line into a
    // click-to-fix affordance that opens the OS mic-privacy settings. The
    // underlying handler is cross-platform (macOS System Settings /
    // Windows ms-settings:privacy-microphone), so this works on both. Clicking
    // the voice button again afterward retries.
    const isMicDenied = /microphone access was denied/i.test(lastStatus);
    statusEl.classList.toggle('acos-voice-status--action', isMicDenied);
    statusEl.onclick = isMicDenied
      ? () => {
          try {
            window.pocketAgent.permissions.openSettings('microphone');
          } catch {
            /* best-effort; the spoken/status message already told the user */
          }
        }
      : null;
  }

  function setUsage(usage) {
    lastUsage = usage;
    renderStatusLine();
  }

  function setActive(isActive) {
    active = isActive;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
    button.setAttribute(
      'data-tip',
      isActive ? 'End voice call' : 'Voice mode — hands-free call with your chief of staff',
    );
    if (!isActive) {
      // Route through setStatus('') so the mic-denied click affordance (onclick
      // + --action class) is cleared in one place, not just the status text.
      lastUsage = null;
      setStatus('');
    }
  }

  async function toggle() {
    // Active call: a click ends it (unless mid-handshake — see below).
    if (active && session) {
      // Ignore clicks only during the brief connect handshake (minting the
      // secret, acquiring the mic, posting the SDP). Routing such a click to
      // stop() races the teardown against the greeting firing on the opening
      // data channel, which made the model improvise off prior conversation
      // context. A click during a retry-backoff wait still cancels normally.
      if (typeof session.isHandshaking === 'function' && session.isHandshaking()) {
        return;
      }
      // Fire and forget: stop() drives the UI via callbacks.
      void session.stop();
      return;
    }

    // Starting a call. toggle() awaits the voice.enabled read before the session
    // exists, so `active`/`session` aren't set yet during that gap — guard with
    // `starting` so a rapid double-click can't spawn two sessions. Always reset
    // it in finally.
    if (starting) {
      return;
    }
    starting = true;
    try {
      // Voice mode is off by default. The button is always visible (so it's
      // discoverable), but starting a call is gated on `voice.enabled`: if it's
      // off, tell the user how to turn it on instead of connecting. This
      // replaces hide/show visibility logic.
      let enabled;
      try {
        enabled = await window.pocketAgent.settings.get('voice.enabled');
      } catch {
        setStatus('Voice mode unavailable — check Settings.');
        return;
      }
      if (String(enabled) !== 'true') {
        setStatus('Turn on Voice mode in Settings → LLM to start a call.');
        return;
      }

      // Voice always uses a dedicated, persistent 'voice' session — deliberately
      // NOT the active chat tab. Voice (short spoken turns) and typed chat (long
      // threads with tool output, code, attachments) are different modes;
      // keeping them separate stops the two histories from polluting each other
      // and makes the session deterministic. Multi-turn voice context still
      // works because every turn loads this same session's history (gate #2).
      session = window.AcosRealtime.createRealtimeSession({
        sessionId: 'voice',
        remoteAudioElement: remoteAudioEl,
        onUsage: setUsage,
        onStatus: setStatus,
        onActiveChange: setActive,
      });
      // Fire and forget: the retry loop inside start() runs in the background
      // and reports progress via onStatus; awaiting it would block a cancel
      // click during a retry-backoff wait.
      void session.start();
    } finally {
      starting = false;
    }
  }

  button.addEventListener('click', () => {
    void toggle();
  });

  // Show the Voice button whenever an OpenAI key is configured (same probe as
  // the voice-note mic button). The off-by-default `voice.enabled` setting is
  // NOT a visibility gate — it gates the click behavior instead (see toggle()),
  // so the button is discoverable and tells the user how to turn it on rather
  // than silently not existing.
  async function gateVisibility() {
    try {
      const result = await window.pocketAgent.audio.isAvailable();
      button.hidden = !(result && result.available);
    } catch {
      button.hidden = true;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      void gateVisibility();
    });
  } else {
    void gateVisibility();
  }
})();
