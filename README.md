# AI Chief of Staff

<p align="center">
  <img src="assets/branding/logo-transparent.png" alt="AI Chief of Staff" width="200">
</p>

<p align="center">
  <strong>Strategic. Intelligent. Always In Support.</strong>
</p>

<p align="center">
  <a href="https://github.com/BrettLechtenbrerg/ai-chief-of-staff/releases/latest"><img src="https://img.shields.io/github/v/release/BrettLechtenbrerg/ai-chief-of-staff?include_prereleases&style=for-the-badge" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
  <a href="https://www.totalsuccessai.com/hidden/ai-chief-of-staff-app"><img src="https://img.shields.io/badge/Total%20Success%20AI-Download-0A1F44?style=for-the-badge" alt="Download from Total Success AI"></a>
</p>

**AI Chief of Staff** is a private desktop AI agent built for Total Success AI clients. It lives in your menu bar 24/7, remembers everything you tell it, learns how you work, and runs the small daily routines that drag on your time.

Not a chatbot. A real desktop agent with file access, scheduled routines, and integrations into the tools you already use.

---

## What it does

### Daily briefings
Wake up to a personalized morning briefing — weather, calendar, priorities — delivered as a desktop notification.

### Email management
Read your unread inbox, draft replies in your voice, and save them straight to Gmail for review.

### Calendar intelligence
Find conflicts, flag tight gaps, and surface the meetings that actually need attention.

### Reminders
Schedule daily, weekly, or monthly reminders that go out reliably via desktop notification, email, or your preferred channel.

### File & document access
Reads and edits files on your Mac or PC, runs scripts, and works directly in your real folders.

### Scheduled tasks
Build any scheduled task you can describe — research, reports, follow-ups. It just runs.

### Persistent memory
It extracts and organizes knowledge about you. Projects you're working on. People you mention. Decisions you've made. Preferences you've expressed. All searchable. When you mention something from three months ago, it knows what you're talking about.

### Browser automation with authenticated sessions
Two modes:
- **Basic mode:** hidden window for screenshots, clicking, form filling, data extraction
- **Chrome mode:** connects to your actual browser with all your logged-in sessions (Gmail, GitHub, whatever) — no re-authentication needed

### Multi-session isolation
Up to 20 separate conversation threads, each with isolated history. Work stuff doesn't bleed into personal stuff.

### Telegram integration (optional)
Same brain, different interface. Talk to it from your phone with the unattended remote-safe tool policy; actions requiring interactive approval fail closed.

### 40+ skill integrations
Notion, GitHub, Slack, Apple Notes, Apple Reminders, Google Workspace, Trello, Obsidian, and more. Plus MCP server support for adding your own. Terminal and file tools stay within approved workspaces and require approval for sensitive capabilities.

### Connections (MCP servers)
Settings → Connections shows every external tool your AI can use. Add/edit/disable any MCP server, test the connection before saving, and see live status (Ready / Failed / Disabled) at a glance. Edits are atomic — a crash mid-save leaves your previous config intact. Same `mcp-servers.json` shape as Claude Desktop, so you can copy configs between the two.

---

## Getting started

### Download

Available to Total Success AI clients from the [private download page](https://www.totalsuccessai.com/hidden/ai-chief-of-staff-app).

| Platform | Notes |
|----------|-------|
| **macOS** | Apple Silicon (M1/M2/M3/M4) recommended. Intel supported. macOS 12 or newer. |
| **Windows** | Windows 10 / 11, x64. The public beta.22 page currently serves the tested beta.20 x64 installer (SHA-256 `7464181a0dbb60bdce8aa3b9948ba164898b326aff84703c94468cf919c46d6e`); beta.23 will replace it with a fresh native x64 build. |

### Install

1. **Mac.** Open the DMG, drag *AI Chief of Staff* to Applications.
2. **Windows.** Download the x64 installer (not the universal installer), verify the SHA-256 shown on the download page, then run it.

### First launch

1. **Mac.** Open the signed/notarized app from Applications.
2. **Windows.** Verify the installer digest and publisher before continuing through any SmartScreen prompt. Unsigned prereleases remain blocked from publication by CI.
3. Click the menu-bar icon and add your Anthropic or OpenAI credential in Settings. Secret values stay main-process-only and are encrypted with Electron `safeStorage`.
4. Start chatting.

### First scheduled task

Tell it: *"Set up a daily briefing at 6 AM for [your city] that pulls my Google Calendar."* Build from there one capability at a time.

---

## Voice, privacy, and local recovery

- Click **Voice** or press **Alt+Shift+V** to start/stop an explicit call. ACOS never ships an always-listening background microphone.
- Live voice uses OpenAI `gpt-realtime-2.1` for speech/VAD/barge-in while the normal ACOS agent remains the reasoning/tool brain. If Realtime startup fails, ACOS falls back to record → transcription → normal agent turn → local system speech.
- Realtime/transcription audio is sent to OpenAI. The recording indicator stays visible while the microphone is active.
- Spoken `approve` / `deny` can resolve a visible pending tool approval; model-generated text cannot approve its own action.
- Conversations, memories, routines, and settings remain local. Provider credentials managed in Settings are `safeStorage`-encrypted and never returned to renderer JavaScript; connector config/tokens remain private app-data files protected by user-only permissions.
- ACOS creates seven rotating WAL-consistent local backups. Enable FileVault or BitLocker/Device Encryption for whole-database protection; see [`docs/DATA-PROTECTION.md`](docs/DATA-PROTECTION.md) and [`docs/VOICE.md`](docs/VOICE.md).

---

## AEO visibility

`fetch_aeo_visibility` runs one configured brand's exact 25-question monthly visibility set across the enabled OpenAI, Perplexity, and Anthropic providers. Configure provider keys in Settings; keys are encrypted and no plaintext `aeo-credentials.json` is used.

A three-provider run previews and requires approval for **up to 75 paid provider requests**. Requests have 30-second aborts, bounded retries, cancellation, progress heartbeats, exact hostname citation matching, and atomic `0600` reports under `~/Desktop/AEO Operating System/`. See [`docs/AEO-VISIBILITY.md`](docs/AEO-VISIBILITY.md).

---

## Privacy

- No third-party analytics or product telemetry.
- External model/tool traffic occurs only for the provider and connector features you configure.
- Scheduled and Telegram runs fail closed when a tool requires interactive confirmation.
- Tool logs record structural metadata, duration, status, and result size—not private tool input/result content.

---

## Telegram setup (optional)

If you want to talk to it from your phone:

1. Create a bot with [@BotFather](https://t.me/botfather) on Telegram
2. Copy the token into AI Chief of Staff settings → Telegram
3. Message your bot

**Group chats.** Add the bot to groups. Use `/link SessionName` to connect that group to a specific session. Each group can have its own isolated conversation. For the bot to see all messages in a group (not just commands), either make it an admin or disable privacy mode in BotFather.

**Commands.** `/status` · `/facts` · `/clear` · `/link <session>` · `/unlink` · `/mychatid`

---

## Browser automation details

**Default mode** runs in a hidden Electron window. No setup needed. Screenshots, clicks, typing, content extraction, running JavaScript, downloads.

**Chrome mode** connects to your actual browser. Start Chrome with remote debugging:

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# Windows
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222

# Linux
google-chrome --remote-debugging-port=9222
```

Then it can access your logged-in sessions and manage multiple tabs.

---

## Support

For Windows startup/chat/native-module failures, run the release's `tester-rescue.ps1` and send the local ZIP; see [`docs/WINDOWS-TESTER-RESCUE.md`](docs/WINDOWS-TESTER-RESCUE.md). It redacts known secrets and never copies the conversation database.

Built and supported by **Brett Lechtenberg** at Total Success AI. Get in touch through the [download page](https://www.totalsuccessai.com/hidden/ai-chief-of-staff-app).

---

## For developers

```bash
git clone https://github.com/BrettLechtenbrerg/ai-chief-of-staff.git
cd ai-chief-of-staff
npm install
npm run dev
```

Stack: Electron + Claude Agent SDK + SQLite + TypeScript.

See [`CLAUDE.md`](CLAUDE.md) for project conventions, [`RECOVERY.md`](RECOVERY.md) for release/rollback procedures, and [`docs/SECURITY-RELEASE-AUDIT-2026-08-10.md`](docs/SECURITY-RELEASE-AUDIT-2026-08-10.md) for the beta.23 trust gate.

---

## Credits & license

AI Chief of Staff is an MIT-licensed rebrand of **[Pocket Agent](https://github.com/KenKaiii/pocket-agent)** by **[Ken Kai](https://youtube.com/@kenkaidoesai)** (`KenKaiii`). All the heavy lifting on the core agent, memory system, browser automation, scheduler, and Telegram integration is his work. Total Success AI rebrands, distributes, and supports this build for our clients — please support the original by [subscribing to Ken's channel](https://youtube.com/@kenkaidoesai) and [joining his Skool community](https://skool.com/kenkai).

The **Voice mode** realtime stack (OpenAI Realtime over WebRTC, barge-in, and the response-coordination state machines) is ported from **Brah** by `KenKaiii`, also MIT-licensed. Its original notice is preserved in the source headers of the ported modules.

Released under the [MIT License](LICENSE). The original copyright (© 2025 KenKaiii) is preserved in the `LICENSE` file as required.
