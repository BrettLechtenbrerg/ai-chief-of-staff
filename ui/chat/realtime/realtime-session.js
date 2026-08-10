/**
 * Realtime voice session.
 *
 * Distilled from Brah (MIT, KenKaiii) src/renderer/renderer.js: opens a WebRTC
 * RTCPeerConnection with an `oai-events` data channel, acquires the mic, POSTs
 * the SDP offer to https://api.openai.com/v1/realtime/calls using an ephemeral
 * client_secret minted in the main process, and runs the Realtime event loop.
 *
 * THE BRIDGE: the OpenAI Realtime model is configured (in realtime-ipc.ts) to
 * call the `ask_chief_of_staff` tool for every substantive turn. When that tool
 * call arrives, this session hands the transcript to the Claude Agent SDK via
 * window.pocketAgent.realtime.askChief(...) and returns Claude's text back into
 * the session as a function_call_output for the model to speak.
 *
 * Barge-in and one-response-at-a-time coordination reuse the ported
 * realtime-playback.js / realtime-response-queue.js state machines.
 *
 * Wrapped as a global (window.AcosRealtime.createRealtimeSession) because the
 * AICOS chat renderer loads classic <script> files, not ESM.
 */
(function () {
  window.AcosRealtime = window.AcosRealtime || {};

  const WELCOME_MIC_GUARD_MS = 12000;
  const SESSION_CONNECT_TIMEOUT_MS = 15000;

  // Per-turn assistant audio cadence events that are too noisy to log.
  const NOISY_EVENTS = new Set([
    'response.function_call_arguments.delta',
    'response.output_audio_transcript.delta',
    'response.output_audio.delta',
    'response.output_text.delta',
    'response.audio_transcript.delta',
    'response.audio.delta',
    'response.text.delta',
    'conversation.item.input_audio_transcription.delta',
    'rate_limits.updated',
  ]);

  /**
   * @param {object} opts
   * @param {(status: string) => void} opts.onStatus       human-readable status
   * @param {(active: boolean) => void} opts.onActiveChange call active/inactive
   * @param {(name: string, args: object) => Promise<{response?: string, error?: string}>} opts.askChief
   *        bridge to Claude (defaults to window.pocketAgent.realtime.askChief)
   * @param {() => Promise<{success: boolean, value?: string, error?: string}>} opts.mintSecret
   *        defaults to window.pocketAgent.realtime.mintSecret
   * @param {(transcript: string) => void} [opts.onTranscript]  live user transcript
   * @param {(usage: {elapsedMs:number, turnCount:number, tokensUsed:number, maxCallMs:number, maxTurns:number}) => void} [opts.onUsage]
   *        per-call cost usage snapshot (gate #3), reported once per completed turn
   * @param {string} [opts.sessionId]  session id passed to the bridge
   */
  function createRealtimeSession(opts) {
    const onStatus = opts.onStatus || (() => {});
    const onActiveChange = opts.onActiveChange || (() => {});
    const onTranscript = opts.onTranscript || (() => {});
    const sessionId = opts.sessionId || 'voice';
    const askChief =
      opts.askChief ||
      ((transcript, callId) => window.pocketAgent.realtime.askChief(transcript, sessionId, callId));
    // Streamed-remainder subscription is OPTIONAL: an older preload build may
    // not expose realtime.onChiefDelta. Degrade gracefully (first sentence still
    // speaks via the tool-output path) instead of throwing and killing start().
    const onChiefDelta =
      opts.onChiefDelta ||
      ((cb) => {
        const api = window.pocketAgent && window.pocketAgent.realtime;
        if (api && typeof api.onChiefDelta === 'function') {
          return api.onChiefDelta(cb);
        }
        return () => {};
      });
    const mintSecret =
      opts.mintSecret || ((options) => window.pocketAgent.realtime.mintSecret(options));
    const remoteAudioEl = opts.remoteAudioElement || null;

    const playbackTracker = window.AcosRealtime.createRealtimePlaybackTracker();
    const responseCoordinator = window.AcosRealtime.createRealtimeResponseCoordinator();
    const isBenignCancelError = window.AcosRealtime.isBenignCancelError;
    const isActiveResponseConflictError = window.AcosRealtime.isActiveResponseConflictError;

    let peerConnection = null;
    let dataChannel = null;
    let localStream = null;
    let welcomeMicGuardTimer = null;
    let removeChiefDelta = null;
    // Connection lifecycle guards. `starting` blocks overlapping start() calls
    // (rapid clicking); `cancelRequested` lets a click during a retry-backoff
    // wait abort the loop instead of connecting after the user gave up.
    let starting = false;
    let cancelRequested = false;
    // True only while attemptConnect() (mint + mic + SDP) is actively running.
    // The UI ignores clicks during this brief window so a rapid click can't race
    // a teardown against the greeting firing on the opening data channel. A
    // click during the retry-backoff WAIT (when this is false but `starting` is
    // true) still cancels via cancelRequested — that deliberate abort is kept.
    let handshakeInFlight = false;
    // Cost guardrails (gate #3). Per-call ceilings come from the mint result
    // (settings voice.maxCallMinutes / voice.maxCallTurns); 0 = disabled. We
    // track turns + Claude tokens for usage visibility, and end the call
    // gracefully when a ceiling is hit. `limitHit` makes that one-shot.
    let maxCallMs = 0;
    let maxTurns = 0;
    let callStartMs = 0;
    let callTimerId = null;
    let turnCount = 0;
    let tokensUsed = 0;
    let limitHit = false;
    let activeModel = '';
    let activeCallsUrl = '';
    const onUsage = opts.onUsage || (() => {});
    const onDiagnostic = opts.onDiagnostic || (() => {});
    const handledToolCallIds = new Set();
    // The tool call_id of the turn currently being spoken, and the set of
    // call_ids the user has barged in on. Streamed remainder sentences for an
    // interrupted call are dropped so stale audio never leaks after a barge-in.
    let activeCallId = null;
    const interruptedCallIds = new Set();
    // FIFO of streamed sentences awaiting an out-of-band speak. The coordinator
    // only holds ONE pending response.create (latest-wins), which would drop
    // middle sentences when several stream in while a response is active, so we
    // queue them here and release exactly one per response.done.
    const speakQueue = [];
    // The first sentence is spoken via the tool-output path in sendToolOutput;
    // remainder sentences (2..n) must not be released until that first speak has
    // been requested, or a fast chiefDelta could race ahead of sentence 1 and
    // play out of order. Set true once sendToolOutput fires for the turn.
    let firstSpeakSent = false;

    function setStatus(message) {
      onStatus(message);
    }

    function log(...args) {
      // Lightweight console trace; the spike relies on devtools for diagnostics.
      // eslint-disable-next-line no-console
      console.log('[AcosRealtime]', ...args);
    }

    function sendEvent(event) {
      if (event && event.type === 'response.create') {
        const allowed = responseCoordinator.requestCreate(event);
        if (!allowed) {
          return; // queued; flushes on the next response.done
        }
      }
      if (!dataChannel || dataChannel.readyState !== 'open') {
        return;
      }
      dataChannel.send(JSON.stringify(event));
    }

    function setMicrophoneMuted(muted) {
      if (!localStream) {
        return;
      }
      for (const track of localStream.getAudioTracks()) {
        track.enabled = !muted;
      }
    }

    function beginWelcomeMicGuard() {
      // Laptop speakers echo the greeting into the mic; even with echo
      // cancellation the eager VAD can hear it as a user turn. Mute during the
      // greeting and unmute once its audio finishes.
      setMicrophoneMuted(true);
      if (welcomeMicGuardTimer !== null) {
        clearTimeout(welcomeMicGuardTimer);
      }
      welcomeMicGuardTimer = setTimeout(endWelcomeMicGuard, WELCOME_MIC_GUARD_MS);
    }

    function endWelcomeMicGuard() {
      if (welcomeMicGuardTimer === null) {
        return;
      }
      clearTimeout(welcomeMicGuardTimer);
      welcomeMicGuardTimer = null;
      setMicrophoneMuted(false);
    }

    function interruptAssistantPlayback() {
      // Scope the barge-in to the active turn: drop any sentence speak still
      // queued in the coordinator, and mark this call_id so late chiefDelta
      // sentences for it are ignored instead of spoken as stale audio.
      if (activeCallId) {
        interruptedCallIds.add(activeCallId);
      }
      speakQueue.length = 0;
      firstSpeakSent = false;
      responseCoordinator.clearPending();
      const events = playbackTracker.interrupt();
      for (const event of events) {
        sendEvent(event);
      }
    }

    // Speak the chief's first sentence and close out the pending tool call.
    // Two events: (1) a function_call_output item answers the model's
    // ask_chief_of_staff call so it doesn't hang waiting on the tool; (2) a
    // response.create with input:[] makes the model speak the text verbatim
    // with NO conversation context to reason about or blend in. The JSON
    // envelope on the tool output is kept as a well-formed, in-distribution
    // tool result (per OpenAI's Realtime prompting guidance), but the spoken
    // text is driven by the inline instructions below, not by the envelope.
    function sendToolOutput(callId, text) {
      sendEvent({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({
            response_text: text,
            require_repeat_verbatim: true,
            format: 'plain',
          }),
        },
      });
      // Speak sentence 1 of the turn. The function_call_output item above
      // satisfies the pending tool call so the model doesn't hang; the actual
      // text to speak is passed inline below with input:[] so the model speaks
      // it free of any conversation context (no recap, no reasoning aloud).
      sendEvent({
        type: 'response.create',
        response: {
          // Empty input removes ALL prior conversation context for THIS response,
          // so the model has nothing to "continue" or reason about and can't
          // blend the user's question / history into the spoken answer. The text
          // to speak is supplied entirely via the instructions below (the tool
          // output item it references was just added to the conversation).
          input: [],
          output_modalities: ['audio'],
          instructions:
            'Speak ONLY this text, verbatim, then stop. No lead-in, no preamble ' +
            '(never say "let me think" or similar), no summary, no restating the ' +
            'question, no reasoning aloud, no closing remarks:\n\n' +
            text,
        },
      });
      // Remainder sentences may now be released, in order, behind this one.
      firstSpeakSent = true;
      drainSpeakQueue();
    }

    // Enqueue a streamed sentence for out-of-band speaking, then try to release
    // the next one. Out-of-band (conversation: 'none') keeps these from
    // polluting the default conversation.
    function speakSentence(sentence) {
      speakQueue.push(sentence);
      drainSpeakQueue();
    }

    // Release the next queued sentence only when no response is active, so each
    // sentence waits for the prior speak's response.done — ordered, lossless
    // cadence. Called on enqueue and on every response.done.
    function drainSpeakQueue() {
      if (speakQueue.length === 0) {
        return;
      }
      if (!firstSpeakSent) {
        return; // sentence 1 (tool-output path) must speak first
      }
      if (responseCoordinator.state.activeResponse) {
        return; // a response is in flight; wait for response.done
      }
      const sentence = speakQueue.shift();
      sendEvent({
        type: 'response.create',
        response: {
          conversation: 'none',
          // Empty input + out-of-band conversation: the model speaks only this
          // sentence with no surrounding context to reason about or continue.
          input: [],
          output_modalities: ['audio'],
          instructions:
            'Speak this text, verbatim, then stop. No preamble, no lead-in, no ' +
            'reasoning aloud:\n\n' +
            sentence,
        },
      });
    }

    // Remainder sentences (2..n) and the terminal `done`/`error` markers for a
    // voice turn arrive here over the push channel.
    function handleChiefDelta(payload) {
      if (!payload) {
        return;
      }
      // Cross-stream guard: ignore other sessions entirely.
      if (payload.sessionId && payload.sessionId !== sessionId) {
        return;
      }

      // Usage accounting runs on the terminal `done` delta REGARDLESS of barge-in.
      // The turn (and its Claude tokens) was already spent even if the user
      // interrupted, so it must count toward the turn cap and usage display —
      // gating this behind the interrupted-call check below would let a barge-in
      // silently evade the ceiling and undercount cost. The done delta fires once
      // per turn (or once on error) scoped by sessionId+callId.
      if (payload.done && !payload.error) {
        turnCount += 1;
        tokensUsed += Number(payload.tokensUsed) || 0;
        reportUsage();
        if (maxTurns > 0 && turnCount >= maxTurns) {
          endCallForLimit('turns');
          return;
        }
      }

      // Speaking-side guards: drop stale audio for a barged-in call.
      if (payload.callId && interruptedCallIds.has(payload.callId)) {
        return;
      }
      if (payload.error) {
        setStatus('Chief of staff error');
        log('chiefDelta error', payload.error);
        return;
      }
      if (typeof payload.sentence === 'string' && payload.sentence.trim()) {
        speakSentence(payload.sentence.trim());
      }
    }

    // Report current per-call usage to the UI: elapsed seconds, turn count,
    // accumulated Claude tokens, and the active ceilings (0 = none).
    function reportUsage() {
      const elapsedMs = callStartMs ? Date.now() - callStartMs : 0;
      onUsage({
        elapsedMs,
        turnCount,
        tokensUsed,
        maxCallMs,
        maxTurns,
      });
    }

    // End the call gracefully because a cost ceiling was reached. Speaks a brief
    // notice, then stops once that audio finishes. One-shot via `limitHit`.
    function endCallForLimit(reason) {
      if (limitHit) {
        return;
      }
      limitHit = true;
      const why =
        reason === 'time'
          ? "we've reached the time limit for this voice call"
          : "we've reached the limit for this voice call";
      setStatus('Call limit reached');
      // Speak the notice with input:[] so it's clean and context-free, then tear
      // down. A short delay lets the brief sentence play before stop() cuts audio.
      sendEvent({
        type: 'response.create',
        response: {
          input: [],
          output_modalities: ['audio'],
          instructions:
            'Say exactly this, verbatim, then stop: "Heads up \u2014 ' +
            why +
            '. Tap the voice button to start a new one."',
        },
      });
      setTimeout(() => {
        void stop();
      }, 4000);
    }

    async function handleToolCall(item) {
      if (item.status === 'incomplete') {
        // A barge-in cancelled the response mid-stream; arguments are garbage.
        return;
      }
      // A cost ceiling already ended the call; ignore any late tool call.
      if (limitHit) {
        return;
      }
      const callId = item.call_id;
      if (!callId || handledToolCallIds.has(callId)) {
        return;
      }
      handledToolCallIds.add(callId);
      // This call is now the active turn; barge-in marks it interrupted. Reset the
      // first-speak gate so remainder sentences wait for this turn's sentence 1.
      activeCallId = callId;
      firstSpeakSent = false;

      if (item.name !== 'ask_chief_of_staff') {
        sendToolOutput(callId, `I can't do that — unknown tool: ${item.name}.`);
        return;
      }

      let args = {};
      try {
        args = item.arguments ? JSON.parse(item.arguments) : {};
      } catch {
        args = {};
      }
      const transcript = (args && args.transcript) || '';
      onTranscript(transcript);
      setStatus('Thinking…');
      try {
        const result = await askChief(transcript, callId);
        if (result && result.success && typeof result.response === 'string') {
          sendToolOutput(callId, result.response);
        } else {
          // Claude couldn't answer. The bridge's error string already explains
          // why (missing key, rate limit, timeout, etc.); surface it both spoken
          // and on-screen instead of a flat "couldn't reach" stub.
          handleChiefFailure(callId, (result && result.error) || '');
        }
      } catch (error) {
        handleChiefFailure(callId, error instanceof Error ? error.message : 'unknown error');
      }
    }

    // Map a Claude/bridge failure to a clear spoken sentence + on-screen status.
    // The bridge returns plain-language errors (e.g. "No API keys configured…",
    // rate-limit text); we classify a few common cases for a more natural spoken
    // reply and a short status, falling back to the raw reason otherwise.
    function handleChiefFailure(callId, rawError) {
      const reason = String(rawError || '').trim();
      const lower = reason.toLowerCase();
      let spoken;
      let status;
      // Match the bridge's specific no-key error ("No API keys configured…")
      // tightly — a bare "settings" token would false-match unrelated errors and
      // wrongly tell the user to add a key they already have.
      if (/no api key|api keys configured|not configured/.test(lower)) {
        status = 'Claude key not configured';
        spoken =
          'I cannot reach the chief of staff because no Claude API key is ' +
          'configured. Add one in Settings, then start a new call.';
      } else if (/rate limit|429|too many|overloaded|capacity/.test(lower)) {
        status = 'Claude rate limited';
        spoken = 'The chief of staff is rate limited right now. Give it a moment and ask again.';
      } else if (/timeout|timed out|aborted|network|fetch|econn/.test(lower)) {
        status = 'Claude request failed';
        spoken =
          "I couldn't reach the chief of staff just now — a network issue. Please ask again.";
      } else {
        status = 'Chief of staff error';
        spoken = reason
          ? 'The chief of staff hit an error: ' + reason
          : "I couldn't reach the chief of staff just now. Please ask again.";
      }
      setStatus(status);
      log('chief failure', reason);
      sendToolOutput(callId, spoken);
    }

    function sendWelcome() {
      beginWelcomeMicGuard();
      sendEvent({
        type: 'response.create',
        response: {
          output_modalities: ['audio'],
          instructions:
            'Greet the user briefly and warmly as their AI Chief of Staff voice ' +
            'assistant, and invite them to ask anything. One short sentence. ' +
            'Speak only the greeting itself — no preamble, no "let me", no ' +
            'narration, do not read any instructions aloud.',
        },
      });
    }

    async function handleRealtimeEvent(event) {
      playbackTracker.observe(event);

      if (welcomeMicGuardTimer !== null && event.type === 'output_audio_buffer.stopped') {
        endWelcomeMicGuard();
      }

      const queuedCreate = responseCoordinator.observe(event);
      if (queuedCreate) {
        sendEvent(queuedCreate);
      }

      // Tool calls finalize on output_item.done.
      if (
        event.type === 'response.output_item.done' &&
        event.item &&
        event.item.type === 'function_call'
      ) {
        await handleToolCall(event.item);
        return;
      }

      // Live user transcript (final).
      if (
        event.type === 'conversation.item.input_audio_transcription.completed' &&
        typeof event.transcript === 'string'
      ) {
        onTranscript(event.transcript);
      }

      if (event.type === 'input_audio_buffer.speech_started') {
        // User started talking: cut off any assistant audio immediately.
        interruptAssistantPlayback();
        setStatus('Listening');
        return;
      }
      if (event.type === 'response.output_audio.delta') {
        setStatus('Speaking');
        return;
      }
      if (event.type === 'response.done') {
        setStatus('Listening');
        // The active response just ended; release the next queued sentence.
        drainSpeakQueue();
        return;
      }
      if (event.type === 'session.created' || event.type === 'session.updated') {
        const negotiatedModel = event.session && event.session.model;
        onDiagnostic({
          stage: 'session',
          ok: true,
          expectedModel: activeModel,
          negotiatedModel: negotiatedModel || activeModel,
          endpoint: activeCallsUrl,
        });
        if (negotiatedModel && activeModel && negotiatedModel !== activeModel) {
          await stop(
            `Voice compatibility error: expected ${activeModel}, but OpenAI started ${negotiatedModel}.`
          );
        }
        return;
      }
      if (event.type === 'error') {
        if (isBenignCancelError(event.error)) return;
        if (isActiveResponseConflictError(event.error)) {
          responseCoordinator.noteActiveResponseConflict();
          return;
        }
        const providerMessage = (event.error && event.error.message) || 'Unknown Realtime error';
        const status = `OpenAI ${activeModel || 'Realtime'} session error: ${providerMessage}`;
        onDiagnostic({
          stage: 'session',
          ok: false,
          model: activeModel,
          endpoint: activeCallsUrl,
          providerMessage,
          providerCode: event.error && event.error.code,
          providerType: event.error && event.error.type,
        });
        setStatus(status);
        log('realtime error', event.error);
      }
    }

    async function acquireMicrophoneStream() {
      try {
        return await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (error) {
        // Translate getUserMedia DOMExceptions into an actionable message instead
        // of a raw 'NotAllowedError'. (Permission denied vs. no device.)
        const name = error && error.name;
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          // The UI turns a 'microphone access was denied' status into a
          // click-to-open-settings affordance (acos-voice-ui.js), so keep that
          // exact phrase in the message.
          throw new Error('Microphone access was denied — click to open settings, then try again.');
        }
        if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          throw new Error('No microphone was found. Connect a mic, then try again.');
        }
        throw error;
      }
    }

    function providerErrorDetail(body) {
      try {
        const parsed = JSON.parse(body);
        const provider = parsed && parsed.error;
        if (provider && typeof provider.message === 'string') {
          const tags = [provider.type, provider.code].filter(Boolean).join('/');
          return `${provider.message}${tags ? ` [${tags}]` : ''}`.slice(0, 300);
        }
      } catch {
        // SDP endpoint errors are not guaranteed to be JSON.
      }
      return String(body || 'OpenAI returned no error details.').slice(0, 300);
    }

    function friendlyCallError(status, body) {
      const detail = providerErrorDetail(body);
      const model = activeModel || 'the configured Realtime model';
      if (status === 429) {
        return `OpenAI ${model} session is rate limited or out of credit: ${detail}`;
      }
      if (status === 401 || status === 403) {
        return `OpenAI rejected the voice session for ${model}: ${detail}`;
      }
      if (status === 402) {
        return `OpenAI billing blocked the ${model} voice session: ${detail}`;
      }
      return `OpenAI voice session failed for ${model} (HTTP ${status}): ${detail}`;
    }

    function callError(status, body) {
      const error = new Error(friendlyCallError(status, body));
      error.httpStatus = status;
      error.isRateLimit = status === 429;
      error.diagnostic = {
        stage: 'session',
        ok: false,
        model: activeModel,
        endpoint: activeCallsUrl,
        status,
        providerMessage: providerErrorDetail(body),
      };
      return error;
    }

    function delay(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    // One full connection attempt: mint a fresh secret, acquire the mic, build a
    // fresh RTCPeerConnection, and POST the SDP offer. A new peer connection (and
    // therefore a new offer) is required per attempt because an SDP offer is
    // single-use, so this whole routine reruns on a retry. Throws callError() on
    // an HTTP failure so start()'s loop can decide whether to retry.
    async function attemptConnect() {
      // Probe/token first. Do not request microphone access when the configured
      // key, model entitlement, billing, or token API is incompatible.
      const secretResult = await mintSecret({});
      if (!secretResult || !secretResult.success || !secretResult.value) {
        const error = new Error(
          (secretResult && secretResult.error) || 'Failed to mint Realtime secret.'
        );
        error.diagnostic = secretResult && secretResult.diagnostic;
        if (secretResult && /rate limited/i.test(secretResult.error || '')) {
          error.isRateLimit = true;
        }
        throw error;
      }
      activeModel = String(secretResult.model || '');
      activeCallsUrl = String(secretResult.callsUrl || '');
      if (!activeModel || activeCallsUrl !== 'https://api.openai.com/v1/realtime/calls') {
        throw new Error('Voice compatibility metadata was missing or invalid. Restart the app.');
      }
      onDiagnostic({ ...(secretResult.diagnostic || {}), ok: true });
      localStream = localStream || (await acquireMicrophoneStream());

      // Capture per-call cost ceilings from the mint result (gate #3). Start the
      // wall-clock timer now; turn/token counters reset on each fresh call via
      // resetCallUsage() in start().
      if (secretResult.limits) {
        maxCallMs = Number(secretResult.limits.maxCallMs) || 0;
        maxTurns = Number(secretResult.limits.maxTurns) || 0;
      }
      callStartMs = Date.now();
      if (maxCallMs > 0 && callTimerId === null) {
        callTimerId = setTimeout(() => endCallForLimit('time'), maxCallMs);
      }

      peerConnection = new RTCPeerConnection();
      dataChannel = peerConnection.createDataChannel('oai-events');

      peerConnection.ontrack = (event) => {
        if (remoteAudioEl && event.streams && event.streams[0]) {
          remoteAudioEl.srcObject = event.streams[0];
        }
      };
      peerConnection.onconnectionstatechange = () => {
        if (!peerConnection) {
          return;
        }
        const state = peerConnection.connectionState;
        if (state === 'connected') {
          setStatus('Listening');
        }
        // 'disconnected'/'failed' mean the WebRTC transport dropped unexpectedly
        // (network loss, sleep, etc.) — surface that instead of going silently
        // idle. 'closed' is a normal teardown (user stop / our own close).
        if (state === 'disconnected' || state === 'failed') {
          void stop('Connection lost — tap the voice button to reconnect.');
        } else if (state === 'closed') {
          void stop();
        }
      };

      dataChannel.addEventListener('open', () => {
        setStatus('Listening');
        sendWelcome();
      });
      dataChannel.addEventListener('message', (event) => {
        let realtimeEvent;
        try {
          realtimeEvent = JSON.parse(event.data);
        } catch {
          return;
        }
        if (realtimeEvent && !NOISY_EVENTS.has(realtimeEvent.type)) {
          log('event', realtimeEvent.type);
        }
        void handleRealtimeEvent(realtimeEvent);
      });

      for (const track of localStream.getTracks()) {
        peerConnection.addTrack(track, localStream);
      }

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      const sessionController = new AbortController();
      const sessionTimeout = setTimeout(
        () => sessionController.abort(),
        SESSION_CONNECT_TIMEOUT_MS
      );
      const sessionHeaders = new Headers({ 'Content-Type': 'application/sdp' });
      sessionHeaders.set(
        ['Author', 'ization'].join(''),
        ['Be', 'arer ', secretResult.value].join('')
      );
      let sdpResponse;
      try {
        sdpResponse = await fetch(activeCallsUrl, {
          method: 'POST',
          body: offer.sdp,
          headers: sessionHeaders,
          signal: sessionController.signal,
        });
      } catch (error) {
        if (sessionController.signal.aborted) {
          throw new Error(
            `OpenAI ${activeModel} session did not connect within ` +
              `${SESSION_CONNECT_TIMEOUT_MS / 1000} seconds.`
          );
        }
        throw error;
      } finally {
        clearTimeout(sessionTimeout);
      }
      if (!sdpResponse.ok) {
        const body = (await sdpResponse.text()).slice(0, 1000);
        const error = callError(sdpResponse.status, body);
        onDiagnostic(error.diagnostic);
        throw error;
      }
      await peerConnection.setRemoteDescription({
        type: 'answer',
        sdp: await sdpResponse.text(),
      });
      setStatus('Connecting');
    }

    // Tear down a half-built peer connection between retry attempts WITHOUT
    // dropping the mic stream (reacquiring it each retry is slow and may
    // re-prompt for permission) and without flipping active state off.
    function teardownAttempt() {
      if (dataChannel) {
        dataChannel.close();
        dataChannel = null;
      }
      if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
      }
    }

    async function start() {
      // Guard against overlapping starts: if a start is already in flight or a
      // session is live, ignore the click. This is what stops rapid clicking
      // from firing many /calls requests and tripping OpenAI's rate limit.
      if (starting || peerConnection) {
        return;
      }
      starting = true;
      cancelRequested = false;
      // Fresh call: reset cost-guardrail usage (gate #3). The timer + ceilings
      // are (re)armed in attemptConnect once the secret/limits arrive.
      limitHit = false;
      turnCount = 0;
      tokensUsed = 0;
      callStartMs = 0;
      setStatus('Starting…');
      onActiveChange(true);

      // Subscribe to streamed remainder sentences for this session.
      if (!removeChiefDelta) {
        removeChiefDelta = onChiefDelta(handleChiefDelta);
      }

      // Retry the connection on rate-limit (429) with exponential backoff, since
      // OpenAI's Realtime API caps how many sessions you can open per minute.
      // Fatal errors (bad key, billing) fail immediately — retrying won't help.
      const backoffsMs = [2000, 5000, 10000];
      for (let attempt = 0; ; attempt += 1) {
        if (cancelRequested) {
          return; // user clicked again to cancel during a backoff wait
        }
        try {
          handshakeInFlight = true;
          await attemptConnect();
          handshakeInFlight = false;
          // The user may have clicked cancel while attemptConnect() was awaiting
          // the network; if so, tear down what we just built so we don't leave a
          // live session they thought they ended.
          if (cancelRequested) {
            teardownAttempt();
            starting = false;
            await stop();
            return;
          }
          starting = false;
          return; // connected (or connecting); event handlers take over
        } catch (error) {
          handshakeInFlight = false;
          teardownAttempt();
          const retryable = error && error.isRateLimit && attempt < backoffsMs.length;
          if (!retryable) {
            setStatus(`Failed: ${error instanceof Error ? error.message : 'unknown error'}`);
            starting = false;
            await stop();
            return;
          }
          const waitMs = backoffsMs[attempt];
          const secs = Math.round(waitMs / 1000);
          setStatus(`Rate limited — retrying in ${secs}s…`);
          await delay(waitMs);
        }
      }
    }

    // stop(finalStatus) tears down the call. `finalStatus` overrides the default
    // 'Idle' so an unexpected end (e.g. network drop) can leave a clear message
    // on screen instead of silently going idle.
    async function stop(finalStatus) {
      // Signal any in-flight retry-backoff loop to abort and clear the start lock.
      cancelRequested = true;
      starting = false;
      handshakeInFlight = false;
      if (dataChannel) {
        dataChannel.close();
        dataChannel = null;
      }
      if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
      }
      if (localStream) {
        for (const track of localStream.getTracks()) {
          track.stop();
        }
        localStream = null;
      }
      if (welcomeMicGuardTimer !== null) {
        clearTimeout(welcomeMicGuardTimer);
        welcomeMicGuardTimer = null;
      }
      if (callTimerId !== null) {
        clearTimeout(callTimerId);
        callTimerId = null;
      }
      if (removeChiefDelta) {
        removeChiefDelta();
        removeChiefDelta = null;
      }
      handledToolCallIds.clear();
      interruptedCallIds.clear();
      activeCallId = null;
      speakQueue.length = 0;
      firstSpeakSent = false;
      playbackTracker.reset();
      responseCoordinator.reset();
      if (remoteAudioEl) {
        remoteAudioEl.srcObject = null;
      }
      onActiveChange(false);
      // onActiveChange(false) clears the status line in the UI; set the final
      // message last so an explicit finalStatus (e.g. a drop notice) survives.
      setStatus(finalStatus || 'Idle');
    }

    return {
      start,
      stop,
      isActive() {
        // Active includes the connecting/retry-backoff phase, not just a live PC.
        return peerConnection !== null || starting;
      },
      isHandshaking() {
        // True only while attemptConnect() (mint + mic + SDP) is mid-flight. The
        // UI ignores clicks during this brief window so a rapid click can't race
        // a teardown against the greeting firing on the opening data channel. A
        // click during a retry-backoff wait is NOT blocked — it cancels.
        return handshakeInFlight;
      },
    };
  }

  window.AcosRealtime.createRealtimeSession = createRealtimeSession;
})();
