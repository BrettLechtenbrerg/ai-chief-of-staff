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

  function toggle() {
    // start() flips active=true synchronously (via onActiveChange) before it
    // yields, so a second click always sees active===true.
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
    // Voice always uses a dedicated, persistent 'voice' session — deliberately
    // NOT the active chat tab. Voice (short spoken turns) and typed chat (long
    // threads with tool output, code, attachments) are different modes; keeping
    // them separate stops voice history from polluting chat context and vice
    // versa, and makes the session deterministic instead of depending on which
    // chat tab happens to be open. Multi-turn voice context still works because
    // every turn loads this same session's history (verified: gate #2).
    const sessionId = 'voice';

    session = window.AcosRealtime.createRealtimeSession({
      sessionId,
      remoteAudioElement: remoteAudioEl,
      onUsage: setUsage,
      onStatus: setStatus,
      onActiveChange: setActive,
    });
    // Fire and forget: the retry loop inside start() runs in the background and
    // reports progress via onStatus; awaiting it would block a cancel click
    // during a retry-backoff wait.
    void session.start();
  }

  button.addEventListener('click', () => {
    void toggle();
  });

  // Gate the Voice button on BOTH the off-by-default `voice.enabled` toggle AND
  // OpenAI key availability (same key probe as the mic button). With the toggle
  // off — the default — the button stays hidden and the whole voice path is
  // inert, so existing chat/voice-note behavior is unaffected.
  async function gateVisibility() {
    try {
      const enabled = await window.pocketAgent.settings.get('voice.enabled');
      if (String(enabled) !== 'true') {
        button.hidden = true;
        return;
      }
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
