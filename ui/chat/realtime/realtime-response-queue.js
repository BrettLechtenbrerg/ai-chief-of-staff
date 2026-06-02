/**
 * Pure coordinator for `response.create` sends on the Realtime data channel.
 *
 * The OpenAI Realtime API allows only one in-progress response per
 * conversation; sending `response.create` while another response is active
 * fails with `conversation_already_has_active_response`. Semantic VAD can also
 * auto-create a response the instant the user speaks, which races our own
 * tool-output and welcome creates. This tracks whether a response is active and
 * queues a single pending create, flushing it once the active response ends.
 *
 * Ported near-verbatim from Brah (MIT, KenKaiii):
 * src/renderer/realtime-response-queue.js. Wrapped as a global because the
 * AICOS chat renderer loads classic <script> files, not ESM.
 */
(function () {
  window.AcosRealtime = window.AcosRealtime || {};

  function createRealtimeResponseCoordinator() {
    let activeResponse = false;
    let pendingCreate = null;
    let lastSentCreate = null;

    return {
      // Decide whether a `response.create` event can be sent now. Returns the
      // event to send, or null when it was queued because a response is active.
      requestCreate(event) {
        if (activeResponse) {
          pendingCreate = event;
          return null;
        }
        activeResponse = true;
        pendingCreate = null;
        lastSentCreate = event;
        return event;
      },

      // Observe a Realtime server event. Returns a queued `response.create` to
      // flush now (because the active response just ended), or null.
      observe(event) {
        switch (event && event.type) {
          case 'response.created':
            activeResponse = true;
            return null;
          case 'response.done': {
            activeResponse = false;
            const flush = pendingCreate;
            pendingCreate = null;
            return flush;
          }
          default:
            return null;
        }
      },

      // Recover from a `conversation_already_has_active_response` error: a
      // create we sent was rejected, so mark a response active and re-queue that
      // create to retry once the active response ends.
      noteActiveResponseConflict() {
        activeResponse = true;
        if (pendingCreate === null) {
          pendingCreate = lastSentCreate;
        }
      },

      // Drop a queued `response.create` without disturbing active-response
      // tracking. Used on barge-in so a sentence speak that was waiting for the
      // prior response.done doesn't fire after the user interrupted.
      clearPending() {
        pendingCreate = null;
      },

      reset() {
        activeResponse = false;
        pendingCreate = null;
        lastSentCreate = null;
      },

      get state() {
        return { activeResponse, hasPending: pendingCreate !== null };
      },
    };
  }

  // True when an error means a response is already in progress, which is a
  // recoverable race rather than a fatal session error.
  function isActiveResponseConflictError(error) {
    const code = (error && error.code) || '';
    const message = ((error && error.message) || '').toLowerCase();
    return (
      code === 'conversation_already_has_active_response' ||
      /already has an? active response/.test(message)
    );
  }

  window.AcosRealtime.createRealtimeResponseCoordinator = createRealtimeResponseCoordinator;
  window.AcosRealtime.isActiveResponseConflictError = isActiveResponseConflictError;
})();
