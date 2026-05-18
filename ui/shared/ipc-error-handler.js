/**
 * Stale-install IPC error handler.
 *
 * When the renderer was hot-copied over an older main-process build (a thing
 * that happens to beta testers who unzip on top of an existing install) the
 * renderer calls IPC channels the main process never registered. Electron
 * rejects with: `Error: No handler registered for 'cron:update'`.
 *
 * To users that error reads as "the app is broken". This helper detects the
 * specific Electron error wording, swaps in a clear "your install is out of
 * date" message pointing at the download page, and re-throws so call sites
 * can still decide what to do (most just toast the rejection).
 *
 * Usage:
 *   const result = await safeIpc('cron.create', () =>
 *     window.pocketAgent.cron.create(name, schedule, prompt, ...)
 *   );
 *
 * If the wrapped call rejects with "No handler registered", `safeIpc` shows
 * the reinstall toast itself and rejects with a friendlier Error message.
 * For any other rejection it simply rethrows the original error.
 */
(function () {
  var REINSTALL_URL = 'totalsuccessai.com/hidden/ai-chief-of-staff-app';
  var STALE_MESSAGE =
    'Your install is out of date. Please re-download from ' + REINSTALL_URL + '.';

  // Detect Electron's `Error invoking remote method ...: Error: No handler
  // registered for 'channel:name'` pattern. Match on the stable substring so
  // we don't depend on quoting.
  function _isStaleHandlerError(err) {
    if (!err) return false;
    var msg = err.message || err.toString();
    return typeof msg === 'string' && msg.indexOf('No handler registered') !== -1;
  }

  // Best-effort toast — use the page's own notyf instance if it has registered
  // one on window, otherwise fall back to a console error + alert. Onboarding,
  // settings-panel, routines-panel, and cron.html each create their own notyf;
  // expose it via `window.__acosToast(message, type)` (set below) for shared
  // helpers like this one.
  function _toast(message) {
    try {
      if (typeof window.__acosToast === 'function') {
        window.__acosToast(message, 'error');
        return;
      }
      if (window.Notyf) {
        var n = new window.Notyf({ duration: 8000, position: { x: 'right', y: 'top' } });
        n.error(message);
        return;
      }
    } catch (e) {
      // fall through to console
    }
    console.error('[acos]', message);
  }

  /**
   * Run an IPC call. On "No handler registered" rejection, show the reinstall
   * toast and reject with a friendlier Error. Other rejections pass through.
   */
  window.safeIpc = function safeIpc(name, fn) {
    var p;
    try {
      p = fn();
    } catch (err) {
      // Synchronous throw — treat like a rejected promise.
      p = Promise.reject(err);
    }
    return Promise.resolve(p).catch(function (err) {
      if (_isStaleHandlerError(err)) {
        console.error('[safeIpc] Stale install detected on channel "' + name + '":', err);
        _toast(STALE_MESSAGE);
        var friendly = new Error(STALE_MESSAGE);
        friendly.staleInstall = true;
        friendly.channel = name;
        throw friendly;
      }
      throw err;
    });
  };

  /**
   * Allow individual pages to register their preferred toast renderer so
   * safeIpc-driven toasts match the surrounding UI. Called like:
   *   window.__acosRegisterToast(function (msg, type) { notyf[type](msg); });
   */
  window.__acosRegisterToast = function (fn) {
    if (typeof fn === 'function') {
      window.__acosToast = fn;
    }
  };
})();
