/* Deterministic, exact-match local commands for live and fallback voice. */
(function () {
  window.AcosVoiceCommands = window.AcosVoiceCommands || {};

  const EXACT_COMMANDS = new Map([
    ['stop', { type: 'cancel' }],
    ['cancel', { type: 'cancel' }],
    ['stop now', { type: 'cancel' }],
    ['cancel that', { type: 'cancel' }],
    ['approve', { type: 'approval', decision: 'approve' }],
    ['approve it', { type: 'approval', decision: 'approve' }],
    ['deny', { type: 'approval', decision: 'deny' }],
    ['deny it', { type: 'approval', decision: 'deny' }],
    ['reject', { type: 'approval', decision: 'deny' }],
    ['mute', { type: 'mute' }],
    ['mute microphone', { type: 'mute' }],
    ['unmute', { type: 'unmute' }],
    ['unmute microphone', { type: 'unmute' }],
    ['new chat', { type: 'new-chat' }],
    ['open settings', { type: 'open', target: 'settings' }],
    ['open routines', { type: 'open', target: 'routines' }],
    ['open connect tools', { type: 'open', target: 'connect-tools' }],
  ]);

  function normalizeVoiceCommand(transcript) {
    return String(transcript || '')
      .trim()
      .toLowerCase()
      .replace(/[.!?]+$/g, '')
      .replace(/\s+/g, ' ');
  }

  function parseVoiceCommand(transcript) {
    const normalized = normalizeVoiceCommand(transcript);
    const exact = EXACT_COMMANDS.get(normalized);
    if (exact) return { ...exact, normalized };

    const modeMatch = normalized.match(/^switch (?:to )?(chat|coder|research|automation) mode$/);
    if (modeMatch) return { type: 'switch-mode', mode: modeMatch[1], normalized };
    return null;
  }

  window.AcosVoiceCommands.normalize = normalizeVoiceCommand;
  window.AcosVoiceCommands.parse = parseVoiceCommand;
})();
