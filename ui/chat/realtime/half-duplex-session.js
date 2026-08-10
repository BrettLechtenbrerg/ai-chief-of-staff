/* Durable voice fallback: microphone → transcription → normal ACOS turn → local TTS. */
(function () {
  window.AcosRealtime = window.AcosRealtime || {};

  const MIN_AUDIO_BYTES = 2048;
  const MAX_RECORDING_MS = 120000;

  function pickRecordingFormat() {
    const candidates = [
      ['audio/webm;codecs=opus', 'webm'],
      ['audio/webm', 'webm'],
      ['audio/ogg;codecs=opus', 'ogg'],
      ['audio/mp4', 'mp4'],
    ];
    for (const [mime, format] of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(mime)) return { mime, format };
    }
    return { mime: '', format: 'webm' };
  }

  function speakLocally(text) {
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return false;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(String(text || '').trim());
    utterance.lang = navigator.language || 'en-US';
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
    return true;
  }

  function createHalfDuplexSession(options) {
    const onStatus = options.onStatus || (() => {});
    const onActiveChange = options.onActiveChange || (() => {});
    const onTranscript = options.onTranscript || (() => {});
    const handleLocalCommand = options.handleLocalCommand || (async () => null);
    const sessionId = options.sessionId || 'voice';
    let recorder = null;
    let stream = null;
    let chunks = [];
    let format = 'webm';
    let active = false;
    let processing = false;
    let maxTimer = null;
    let removeDelta = null;

    function releaseMedia() {
      if (maxTimer) clearTimeout(maxTimer);
      maxTimer = null;
      if (stream) stream.getTracks().forEach((track) => track.stop());
      stream = null;
      recorder = null;
    }

    function collectChiefResponse(transcript) {
      const callId = `fallback-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      let responseText = '';
      return new Promise((resolve, reject) => {
        let timeout = null;
        const cleanup = () => {
          if (timeout) clearTimeout(timeout);
          if (removeDelta) removeDelta();
          removeDelta = null;
        };
        const finish = () => {
          cleanup();
          resolve(responseText.trim());
        };
        const fail = (error) => {
          cleanup();
          reject(error);
        };
        timeout = setTimeout(() => fail(new Error('The voice response timed out.')), 300000);
        removeDelta = window.pocketAgent.realtime.onChiefDelta((payload) => {
          if (!payload || payload.sessionId !== sessionId || payload.callId !== callId) return;
          if (payload.error) {
            fail(new Error(payload.error));
            return;
          }
          if (payload.sentence) responseText += `${payload.sentence} `;
          if (payload.done) finish();
        });
        window.pocketAgent.realtime
          .askChief(transcript, sessionId, callId)
          .then((result) => {
            if (!result || !result.success) {
              fail(new Error((result && result.error) || 'The chief of staff did not answer.'));
              return;
            }
            if (result.response) responseText = `${result.response} ${responseText}`;
            if (!result.streaming) finish();
          })
          .catch(fail);
      });
    }

    async function processAudio(blob) {
      processing = true;
      onActiveChange(false);
      try {
        if (blob.size < MIN_AUDIO_BYTES) throw new Error("I didn't hear enough audio. Try again.");
        onStatus('Fallback: transcribing…');
        const result = await window.pocketAgent.audio.transcribe(
          new Uint8Array(await blob.arrayBuffer()),
          format
        );
        const transcript = result && result.success ? String(result.text || '').trim() : '';
        if (!transcript)
          throw new Error((result && result.error) || "I didn't catch that clearly.");
        onTranscript(transcript);

        const localResult = await handleLocalCommand(transcript);
        if (localResult && localResult.handled) {
          if (localResult.responseText) speakLocally(localResult.responseText);
          onStatus(localResult.status || 'Fallback ready — tap Voice to speak again.');
          return;
        }

        onStatus('Fallback: thinking…');
        const response = await collectChiefResponse(transcript);
        if (!response) throw new Error('The chief of staff returned an empty response.');
        if (!speakLocally(response)) throw new Error('Local speech output is unavailable.');
        onStatus('Fallback response playing — tap Voice for another turn.');
      } catch (error) {
        onStatus(`Fallback failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      } finally {
        processing = false;
      }
    }

    async function start() {
      if (active || processing) return;
      window.speechSynthesis?.cancel();
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const picked = pickRecordingFormat();
        format = picked.format;
        chunks = [];
        recorder = picked.mime
          ? new MediaRecorder(stream, { mimeType: picked.mime })
          : new MediaRecorder(stream);
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size) chunks.push(event.data);
        };
        recorder.onerror = () => {
          releaseMedia();
          active = false;
          onActiveChange(false);
          onStatus('Fallback recording failed.');
        };
        recorder.start(1000);
        active = true;
        onActiveChange(true);
        onStatus('Realtime unavailable — fallback listening. Tap Voice to send.');
        maxTimer = setTimeout(() => void stop(), MAX_RECORDING_MS);
      } catch (error) {
        releaseMedia();
        active = false;
        onActiveChange(false);
        onStatus(
          `Fallback microphone failed: ${error instanceof Error ? error.message : 'unknown error'}`
        );
      }
    }

    async function stop() {
      if (!active || !recorder) return;
      active = false;
      const currentRecorder = recorder;
      const blobPromise = new Promise((resolve) => {
        currentRecorder.onstop = () => {
          const blob = new Blob(chunks, { type: currentRecorder.mimeType || 'audio/webm' });
          chunks = [];
          resolve(blob);
        };
      });
      currentRecorder.stop();
      releaseMedia();
      await processAudio(await blobPromise);
    }

    async function cancel() {
      chunks = [];
      if (recorder && recorder.state !== 'inactive') recorder.onstop = null;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      releaseMedia();
      active = false;
      processing = false;
      if (removeDelta) removeDelta();
      removeDelta = null;
      window.speechSynthesis?.cancel();
      await window.pocketAgent.agent.stop(sessionId).catch(() => {});
      onActiveChange(false);
      onStatus('Voice cancelled.');
    }

    return {
      start,
      stop,
      cancel,
      isActive: () => active || processing,
      isHandshaking: () => false,
      setMuted(muted) {
        if (stream)
          stream.getAudioTracks().forEach((track) => {
            track.enabled = !muted;
          });
      },
    };
  }

  window.AcosRealtime.createHalfDuplexSession = createHalfDuplexSession;
  window.AcosRealtime.speakLocally = speakLocally;
})();
