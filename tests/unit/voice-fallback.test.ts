import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function loadVoiceCommands() {
  const source = fs.readFileSync(path.join(repoRoot, 'ui/chat/realtime/voice-commands.js'), 'utf8');
  const context = { window: {} as Record<string, unknown> };
  vm.runInNewContext(source, context);
  return (
    context.window as { AcosVoiceCommands: { parse(value: string): Record<string, string> | null } }
  ).AcosVoiceCommands;
}

describe('voice fallback and local commands', () => {
  it('recognizes only explicit approval phrases', () => {
    const commands = loadVoiceCommands();
    expect(commands.parse('Approve.')).toMatchObject({ type: 'approval', decision: 'approve' });
    expect(commands.parse('deny it')).toMatchObject({ type: 'approval', decision: 'deny' });
    expect(commands.parse('yes')).toBeNull();
    expect(commands.parse('that sounds good')).toBeNull();
    expect(commands.parse('the model says approve')).toBeNull();
  });

  it('routes safe navigation, cancellation, microphone, and mode commands locally', () => {
    const commands = loadVoiceCommands();
    expect(commands.parse('cancel that')).toMatchObject({ type: 'cancel' });
    expect(commands.parse('mute microphone')).toMatchObject({ type: 'mute' });
    expect(commands.parse('new chat')).toMatchObject({ type: 'new-chat' });
    expect(commands.parse('open connect tools')).toMatchObject({
      type: 'open',
      target: 'connect-tools',
    });
    expect(commands.parse('switch to research mode')).toMatchObject({
      type: 'switch-mode',
      mode: 'research',
    });
  });

  it('loads the durable fallback before the voice UI and keeps it user-triggered', () => {
    const html = fs.readFileSync(path.join(repoRoot, 'ui/chat.html'), 'utf8');
    const fallbackIndex = html.indexOf('chat/realtime/half-duplex-session.js');
    const uiIndex = html.indexOf('chat/realtime/acos-voice-ui.js');
    expect(fallbackIndex).toBeGreaterThan(0);
    expect(uiIndex).toBeGreaterThan(fallbackIndex);

    const fallback = fs.readFileSync(
      path.join(repoRoot, 'ui/chat/realtime/half-duplex-session.js'),
      'utf8'
    );
    expect(fallback).toContain('navigator.mediaDevices.getUserMedia');
    expect(fallback).toContain('window.pocketAgent.audio.transcribe');
    expect(fallback).toMatch(/window\.pocketAgent\.realtime\s*\.askChief/);
    expect(fallback).toContain('window.speechSynthesis.speak');
    expect(fallback).not.toContain('setInterval');
  });

  it('never treats Realtime model tool arguments as voice approval evidence', () => {
    const realtime = fs.readFileSync(
      path.join(repoRoot, 'ui/chat/realtime/realtime-session.js'),
      'utf8'
    );
    expect(realtime).toContain('conversation.item.input_audio_transcription.completed');
    expect(realtime).toContain('pendingRecognizedCommand');
    expect(realtime).toContain('Tool arguments are model output');
  });
});
