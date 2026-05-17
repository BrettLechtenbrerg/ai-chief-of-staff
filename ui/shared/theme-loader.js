(function () {
  function _apply(p) {
    var r = document.documentElement;
    if (!p) {
      [
        'bg-primary','bg-secondary','bg-tertiary','border','text-primary','text-secondary','text-muted',
        'accent','accent-secondary','accent-hover','error','success','warning','orange',
        'user-bubble','user-bubble-solid','assistant-bubble',
      ].forEach(function (k) { r.style.removeProperty('--' + k); });
      return;
    }
    Object.keys(p).forEach(function (k) { r.style.setProperty('--' + k, p[k]); });
  }

  // Stamp the active skin onto <html> so CSS can scope skin-specific
  // overrides (e.g. dark text on the silver tsai pill).
  function _stamp(id) { document.documentElement.dataset.skin = id || ''; }

  window.addEventListener('DOMContentLoaded', function () {
    if (!window.pocketAgent) return;
    Promise.all([window.pocketAgent.themes.list(), window.pocketAgent.themes.getSkin()])
      .then(function (res) {
        var themes = res[0], skinId = res[1], t = themes[skinId];
        if (t) _apply(t.palette);
        _stamp(skinId);
        window.pocketAgent.themes.onSkinChanged(function (id) {
          var th = themes[id];
          if (th) _apply(th.palette);
          else _apply(null);
          _stamp(id);
        });
      })
      .catch(function () {});
  });
})();
