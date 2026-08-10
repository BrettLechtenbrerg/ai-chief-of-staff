# Voice setup and recovery

## Setup

1. Add an OpenAI API key in **Settings → OpenAI**. Secret values are encrypted with Electron `safeStorage` and never returned to renderer JavaScript.
2. Click the **Voice** button or press **Alt+Shift+V**.
3. Allow microphone access when the operating system asks. Only the trusted top-level chat page receives microphone permission.

The microphone is never always-on. Every call begins from the visible button or global shortcut and shows an active recording indicator. Realtime and transcription audio is sent to OpenAI.

## Architecture

- **Ears/mouth:** OpenAI WebRTC Realtime using the main-process-pinned `gpt-realtime-2.1` model, `gpt-4o-transcribe`, VAD, TTS, and barge-in.
- **Brain/tools:** the normal ACOS `AgentManager`, selected Anthropic/OpenAI reasoning model, mode allowlist, tool sandbox, and approval policy.
- **Fallback:** if token/session negotiation fails, ACOS records one utterance, calls the existing transcription path, runs a normal ACOS turn, and speaks the answer with local Chromium/OS `speechSynthesis`. Tap Voice to send the fallback recording; tap again for another turn.

Realtime startup diagnostics show the exact bounded provider/model/API stage without exposing the API key.

## Local voice commands

These phrases use deterministic exact matching rather than model interpretation:

- `stop`, `cancel`, `cancel that`
- `approve`, `approve it`, `deny`, `deny it`, `reject`
- `mute`, `unmute`
- `new chat`
- `open settings`, `open routines`, `open connect tools`
- `switch to chat mode`, `switch to coder mode`, `switch to research mode`, `switch to automation mode`

Approval requires a currently visible pending request and an exact completed user-audio transcript. Realtime model tool arguments cannot authorize approval.

## Troubleshooting

- **No microphone prompt:** confirm the installed app is signed and unmodified. Never hot-copy files into a signed `.app`; that invalidates microphone entitlements.
- **Realtime token/model error:** confirm the OpenAI key/project can access `gpt-realtime-2.1`. ACOS should automatically enter fallback mode.
- **Fallback transcription fails:** confirm the OpenAI key can use transcription and that the recording is under two minutes.
- **No local spoken response:** confirm system audio is unmuted and Chromium speech synthesis is available; the completed text remains in the dedicated voice session.
- **Cancel:** say `cancel`, click Voice, or press **Alt+Shift+V**. A cancelled approval is never interpreted as consent.
