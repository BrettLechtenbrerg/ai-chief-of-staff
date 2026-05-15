# Pocket Agent - Features & Systems Index

**Quick reference guide to all features, tools, and systems in Pocket Agent**

---

## 🚀 QUICK START

**New to Pocket Agent?** Start with:
1. [Chat Tools](#chat-tools) - What you can do conversationally
2. [Memory System](#memory-system) - How it remembers you
3. [Channels](#channels) - Where you can use it

---

## 📋 FULL INDEX

### TOOLS (45+)

#### Browser Tools
- **browser** - Automate web tasks
  - 14 actions: navigate, screenshot, click, type, evaluate, extract, scroll, hover, download, upload, tabs_list, tabs_open, tabs_close, tabs_focus
  - Two tiers: Electron (default) or CDP (Chrome)
  - [Full docs](FEATURES_MAPPING.md#browser-tool)

#### Memory Tools (5)
- **remember** - Save facts to long-term memory
- **forget** - Remove facts
- **list_facts** - View all memories
- **memory_search** - Semantic + keyword search
- **daily_log** - Journal entries with auto-timestamps
- [Full docs](FEATURES_MAPPING.md#memory-tools)

#### Soul Tools (4)
- **soul_set** - Record relationship dynamics
- **soul_get** - Retrieve specific aspect
- **soul_list** - View all aspects
- **soul_delete** - Remove aspect
- [Full docs](FEATURES_MAPPING.md#soul-tools)

#### Scheduler Tools (4)
- **create_routine** - Schedule LLM-executed prompts
- **create_reminder** - Simple notifications
- **list_routines** - View all scheduled jobs
- **delete_routine** - Remove routine
- [Full docs](FEATURES_MAPPING.md#scheduler-tools)

#### Calendar Tools (4)
- **calendar_add** - Create events with reminders
- **calendar_list** - View events by date
- **calendar_upcoming** - Get next N hours of events
- **calendar_delete** - Remove event
- [Full docs](FEATURES_MAPPING.md#calendar-tools)

#### Task Tools (5)
- **task_add** - Add todo with priority & due date
- **task_list** - View tasks by status
- **task_complete** - Mark done
- **task_delete** - Remove task
- **task_due** - Filter by due date
- [Full docs](FEATURES_MAPPING.md#task-tools)

#### Project Tools (3)
- **set_project** - Switch working directory
- **get_project** - View active project
- **clear_project** - Reset to default
- [Full docs](FEATURES_MAPPING.md#project-tools)

#### System Tools (2)
- **notify** - Send desktop notifications
- **diagnostics** - Monitor tool health
- [Full docs](FEATURES_MAPPING.md#macos-tools)

---

### MEMORY SYSTEM

**Core Features:**
- Persistent storage in SQLite
- Semantic search (vector + keyword)
- 7 main tables (sessions, messages, facts, chunks, daily_logs, soul_aspects, summaries)
- 45+ public methods
- Auto-embeddings (OpenAI text-embedding-3-small)
- Context compaction (rolling summaries)
- Per-session isolation (up to 5 sessions)

**Key Capabilities:**
1. **Long-term memory** - Save and retrieve facts
2. **Semantic search** - Find relevant memories
3. **Daily journaling** - Log entries with timestamps
4. **Relationship tracking** - Soul aspects about working dynamics
5. **Smart context** - Recent + relevant + compressed messages
6. **Multi-session** - Isolated conversation threads

[Full docs](FEATURES_MAPPING.md#memory-system)

---

### SCHEDULING & AUTOMATION

**Schedule Types:**
- Cron: `0 9 * * MON` (standard cron format)
- At: `tomorrow 3pm`, `in 10 minutes` (one-time)
- Every: `every 30m`, `every 2h` (recurring)
- Duration: `30m`, `2h` (shorthand one-time)

**Job Types:**
1. **Routine** - Full LLM execution with all tools
2. **Reminder** - Simple notification (no LLM)

**Features:**
- Calendar event reminders
- Task due date reminders
- Channel routing (desktop/telegram/ios)
- Job history (last 100)
- Auto-reload every 60 seconds

[Full docs](FEATURES_MAPPING.md#scheduling--automation)

---

### BROWSER AUTOMATION

**Three-Tier System:**

1. **Electron Tier** (default)
   - Hidden window rendering
   - No setup required
   - Cannot access logged-in sessions
   - Single tab

2. **CDP Tier** (Chrome DevTools Protocol)
   - Connects to user's Chrome
   - Requires: `chrome --remote-debugging-port=9222`
   - Access to logged-in sessions
   - Multi-tab support

3. **Smart Selection**
   - Auto-picks best tier
   - Falls back if needed
   - User can force specific tier

**14 Actions:**
- navigate, screenshot, click, type, evaluate, extract, scroll, hover
- download, upload, tabs_list, tabs_open, tabs_close, tabs_focus

**Extract Types:**
- text, html, links, tables, structured

[Full docs](FEATURES_MAPPING.md#browser-automation)

---

### CHANNELS

#### Desktop
- Electron notifications
- Window focus
- Built-in (always available)

#### Telegram
- **8 Commands**: /start, /status, /facts, /clear, /link, /unlink, /mychatid
- **Message Types**: Text, photo, voice, audio, document, location
- **Features**: Reactions, inline keyboards, typing indicator, document processing
- **Security**: User ID allowlist
- **Groups**: Multi-group session linking
- [Full docs](FEATURES_MAPPING.md#telegram-channel)

#### iOS
- **Modes**: Cloud relay (default) or local WebSocket
- **25+ Handlers**: Core messaging, sessions, models, memory, automation
- **Features**: Push notifications, pairing codes, device tracking
- **Full Parity**: Desktop feature access from iOS
- [Full docs](FEATURES_MAPPING.md#ios-channel)

---

### SETTINGS & CONFIGURATION

**Categories (60+):**

| Category | Examples |
|----------|----------|
| Auth | API keys, OAuth tokens |
| Agent | Model, mode, thinking level |
| Telegram | Bot token, user allowlist |
| iOS | Relay URL, instance ID, port |
| Browser | Use My Browser, CDP URL |
| Personalization | Name, timezone, personality |
| UI/Theme | Dark/light, font size, compact |
| Features | Enable/disable channels |

**All Settings Encrypted** via Electron safeStorage

[Full docs](FEATURES_MAPPING.md#settings--configuration)

---

### AUTHENTICATION

- **OAuth** - PKCE flow with Anthropic
- **API Key** - Direct API key option
- **Token Refresh** - Auto-refresh on expiry
- **Encryption** - Stored in OS keychain
- **Fallback** - Graceful degradation

[Full docs](FEATURES_MAPPING.md#authentication)

---

### AGENT & CHAT ENGINE

**Modes:**

| Mode | Features | Use Case |
|------|----------|----------|
| **Coder** (default) | Full SDK, code exec, debugging | Development, code analysis |
| **General** | Lightweight, memory + tools | Fast queries, casual chat |

**System Prompt Building:**
1. Developer guidelines (memory usage, soul, CLI)
2. User facts (from long-term memory)
3. Soul aspects (relationship dynamics)
4. Daily logs (last 3 days)
5. User customizations (personality, rules)

**Multi-Provider:**
- Anthropic (primary)
- Moonshot/Kimi
- Z.AI GLM

[Full docs](FEATURES_MAPPING.md#agent--chat-engine)

---

### USER INTERFACE

**10 Templates:**

| Template | Purpose |
|----------|---------|
| chat.html | Main chat interface |
| settings.html | Configuration & keys |
| facts.html | Memory browser |
| soul.html | Relationship editor |
| daily-logs.html | Journal viewer |
| cron.html | Routine manager |
| customize.html | Personality editor |
| facts-graph.html | Knowledge visualization |
| setup.html | Initial onboarding |
| splash.html | Launch screen |

**Features:**
- Real-time updates via EventEmitter
- IPC communication
- Dark/light themes
- Custom theme support

[Full docs](FEATURES_MAPPING.md#user-interface)

---

### MCP SERVERS

**Browser MCP**
- JSON-RPC 2.0
- Tools: browser, notify
- Standalone browser automation

**Project MCP**
- Project management via MCP
- Tools: set_project, get_project
- SQLite backed

[Full docs](FEATURES_MAPPING.md#mcp-servers)

---

## 📊 DATABASE

**11 Tables:**
1. sessions - Conversation threads
2. messages - Chat history + embeddings
3. facts - Long-term memory
4. chunks - Vector embeddings
5. daily_logs - Daily journaling
6. soul_aspects - Relationship dynamics
7. cron_jobs - Scheduled tasks
8. calendar_events - Calendar items
9. tasks - Todo items
10. telegram_sessions - Chat links
11. settings - Configuration (encrypted)

[Full schema](FEATURES_MAPPING.md#database-schema)

---

## 🏗️ ARCHITECTURE

**5 Layers:**
1. **UI** - HTML templates + IPC
2. **Main** - Electron main process
3. **Agent** - AgentManager + SDK/ChatEngine
4. **Systems** - Memory, Browser, Scheduler, Settings
5. **Storage** - SQLite + filesystem

**Key Patterns:**
- Singleton (managers)
- Factory (channels)
- Observer (status updates)
- Repository (persistence)
- Strategy (browser tiers)

[Full architecture](FEATURES_MAPPING.md#-architecture-summary)

---

## 🔌 EXTENSIBILITY

**Add a Tool:**
→ Create `/src/tools/my-tool.ts`
→ Export definition + handler
→ Register in index.ts

**Add a Channel:**
→ Extend BaseChannel
→ Implement start/stop/send
→ Register in main process

**Add MCP Server:**
→ Create MCP server
→ JSON-RPC 2.0 protocol
→ Register in buildMCPServers()

[Full guide](FEATURES_MAPPING.md#-extensibility-points)

---

## ⚡ QUICK REFERENCE

**What to use for...**

| Need | Tool |
|------|------|
| Save important info | remember |
| Search your memory | memory_search |
| Schedule LLM action | create_routine |
| Set working dir | set_project |
| Create todo | task_add |
| Add event | calendar_add |
| Automate browser | browser |
| Quick reminder | create_reminder |
| Record learning | soul_set |
| Log entry | daily_log |
| Desktop notification | notify |

---

## 📚 DOCUMENT STRUCTURE

- **FEATURES_MAPPING.md** (1,418 lines, 42.4 KB)
  - Complete feature reference
  - Every tool documented
  - All systems explained
  - Database schema
  - Architecture diagrams
  - Extensibility guide

- **FEATURES_INDEX.md** (this file)
  - Quick reference
  - Cross-links to full docs
  - At-a-glance tables
  - Quick start guide

---

## 🎯 WHERE TO GO NEXT

**I want to...**

- **Use a specific tool** → See [Tools section](#tools-45) or [FEATURES_MAPPING.md](FEATURES_MAPPING.md)
- **Understand memory** → [Memory System section](#memory-system) or [full docs](FEATURES_MAPPING.md#memory-system)
- **Set up Telegram** → [Telegram Channel](FEATURES_MAPPING.md#telegram-channel)
- **Add a feature** → [Extensibility guide](FEATURES_MAPPING.md#-extensibility-points)
- **See all settings** → [Settings section](FEATURES_MAPPING.md#settings--configuration)
- **Understand architecture** → [Architecture section](FEATURES_MAPPING.md#-architecture-summary)
- **Check database schema** → [Database section](FEATURES_MAPPING.md#database-schema)
- **See data flows** → [Data Flow Diagrams](FEATURES_MAPPING.md#-data-flow-diagrams)

---

## 📊 BY THE NUMBERS

| Item | Count |
|------|-------|
| Tools | 45+ |
| Browser actions | 14 |
| Memory tools | 5 |
| Scheduler tools | 4 |
| Calendar tools | 4 |
| Task tools | 5 |
| Project tools | 3 |
| Channels | 3 |
| Telegram commands | 8 |
| iOS handlers | 25+ |
| Database tables | 11 |
| Settings | 60+ |
| MCP servers | 2 |
| Session modes | 2 |
| Schedule types | 4 |
| UI templates | 10 |
| API providers | 3 |

---

**Last Updated:** March 11, 2025  
**Documentation Version:** 1.0  
**Status:** Complete & Exhaustive

For detailed information on any feature, see [FEATURES_MAPPING.md](FEATURES_MAPPING.md)
