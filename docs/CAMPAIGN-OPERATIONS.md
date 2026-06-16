# Campaign Operations — Design Doc

> Status: **draft / Phase 1 planning** · Created June 16, 2026 · Owner: Brett
> Companion to `RESUME-PROMPT.md` ("NEW WORKSTREAM — Campaign Operations") and
> `RECOVERY.md`. This doc is the concrete plan that the resume-prompt's "first
> concrete step" produced. Read those two first for the why.

## Goal

One agent surface to **set up → test → verify → run → report** marketing
campaigns across GoHighLevel (GHL), Meta, and (soon) Google Ads — without
logging in/out of three dashboards and without checking five places to confirm
the wiring is correct.

The agent should be able to, in one conversation:

1. **Set up** a campaign's moving parts in GHL (contacts, tags, custom fields,
   enroll into a pre-built workflow, drip campaigns, messaging).
2. **Test** it with a synthetic contact end-to-end.
3. **Verify** the wiring (fields written? tag applied? enrolled? SMS sent?) and
   report pass/fail in plain English.
4. **Run** it for real.
5. **Report** results — and, in Phase 2, true ad→enrollment ROI by joining ad
   spend (Meta / Google Ads) to GHL leads.

---

## What's already built (verified by reading the code, June 16)

This was the open question from the resume prompt — *"confirm GHL tools are
callable, not just present."* **They are callable, automatically.** No per-tool
wiring is required.

### MCP architecture (the registration path)

- **`src/mcp/manager.ts`** — `MCPServerManager` singleton, started once at app
  boot from `src/main/index.ts`. On `start()` it reads `mcp-servers.json`,
  spawns each non-disabled server, then `rebuildToolIndex()` walks every
  **ready** client and maps the agent-facing name `mcp__<server>__<tool>` →
  `{serverName, toolName}`. `callTool()` dispatches by that index.
- **`src/mcp/config.ts`** — loads `<userData>/mcp-servers.json` (same shape as
  Claude Desktop's `claude_desktop_config.json`). Atomic write (tmp + fsync +
  rename); preserves unknown forward-compat keys.
- **`src/agent/chat-tools.ts`** — `buildMCPAgentTools()` appends every ready
  MCP server's tools to the agent toolset. Called in **both** `getAgentTools`
  (General mode, line ~148) and `getCoderAgentTools` (Coder mode, line ~198).
  So if the GHL server is `ready`, its **92 tools** are live to the agent every
  turn. Returns `[]` when nothing is connected (no-op for unconfigured users).

**Implication:** Phase 1's "make GHL callable" worry is resolved. What's left is
*ergonomics + safety*: a small set of campaign wrapper tools and a verify loop.

### GHL connector (token model #1: two-field env injection)

- Connect Tools card `id: 'ghl'` (`src/main/ipc/connect-tools-ipc.ts`),
  `authType: 'two-field'`: **Private Integration Token** (`pit-...`, secret) +
  **Location ID**.
- `buildEntry()` writes an `mcp-servers.json` entry that spawns the vendored
  Node port via Electron's own Node:
  - `command: process.execPath`
  - `args: [resolveGhlNodePath(...)]`  → `vendor/ghl-mcp-node/index.js`
  - `env: { ELECTRON_RUN_AS_NODE: '1', GHL_PRIVATE_TOKEN, GHL_LOCATION_ID }`
- **Token storage:** inside `<userData>/mcp-servers.json` as env on the server
  entry. No separate token file. Python-free; works on macOS + Windows.
- Aliases `flo-ghl` / `flo-ghl-brett` (Brett's hand-built Python venv entries)
  still resolve to "Connected".

### Meta connector (token model #3: remote OAuth cache — the Google Ads template)

- Connect Tools card `id: 'meta-ads'`, `authType: 'auto'`.
- `buildEntry()` spawns a **remote MCP bridged over stdio**:
  `npx -y mcp-remote https://mcp.pipeboard.co/meta-ads-mcp --auth-timeout 120`.
- OAuth runs in the browser via **Pipeboard** (Meta's own
  `mcp.facebook.com/ads` endpoint rejected `mcp-remote`'s dynamic client
  registration). Tokens cache in **`~/.mcp-auth`**, so restarts are silent.
- **Read-only by design** — the Ad Analyzer never writes; the Ad Creator is
  draft-only (`metaAds.autopost` is dormant).

### Google connector (token model #2: OAuth token-path)

- Gmail/Calendar/Drive/Docs/Bookmarks (the "Flo" servers) spawn via
  `process.execPath` + `ELECTRON_RUN_AS_NODE=1`, with
  `FLO_TOKEN_PATH=<userData>/google-tokens.json` and `FLO_CREDENTIALS_PATH`.

### The three auth-once models (reference for everything new)

| Model | Used by | How a token is acquired | Where it lives |
|---|---|---|---|
| Two-field env injection | GHL | User pastes token + location ID into the card | env on the `mcp-servers.json` entry |
| OAuth token-path | Gmail/Cal/Drive | Browser Google OAuth | `<userData>/google-tokens.json` |
| Remote OAuth cache | Meta (→ Google Ads) | Browser OAuth via hosted MCP (`mcp-remote`) | `~/.mcp-auth` |

**Google Ads (Phase 2) should mirror the Meta model**: a hosted MCP +
`mcp-remote`, no bespoke OAuth code in ACOS.

---

## The campaign-driveable surface (what the agent can/can't do)

From `vendor/ghl-mcp-node/index.js` (92 tools). Relevant subset:

**CAN drive via API — data & messaging:**
`create_contact`, `update_contact`, `get_contact`, `search_contacts`,
`add_contact_tags`, `get_tags`, `get_custom_fields`, `create_custom_value`,
`update_custom_value`, `list_custom_values`, `add_contact_note`,
`get_contact_notes`, `create_opportunity`, `update_opportunity`,
`search_opportunities`, `get_pipelines`, `create_appointment`,
`get_appointments`, `send_message`, `get_messages`, `get_conversation`,
`search_conversations`.

**CAN drive — campaigns (legacy drip) & enrollment:**
`create_campaign`, `update_campaign`, `delete_campaign`, `get_campaign`,
`list_campaigns`, `list_drip_campaigns`, `schedule_campaign`,
`send_campaign_now`, `add_contact_to_campaign`, `add_contact_to_workflow`,
`list_workflows`.

**STAYS MANUAL — workflow/funnel *logic*:** the visual canvas has **no
create/edit API**. There is no `create_workflow` — only `list_workflows` (read)
and `add_contact_to_workflow` (enroll). **Build the workflow once in the GHL UI;
the agent drives everything around it.**

**NOT in GHL at all — ad performance:** spend / CTR / CPL / ROAS live in the
Meta Marketing API and (later) Google Ads API. GHL only sees leads after they
arrive. True ad→enrollment ROI needs a **join layer** (Phase 2).

---

## Proposed wrapper tools (6–8)

Thin, safe, plain-English tools layered over the raw 92. They exist to (a) make
intent obvious to the agent, (b) bundle multi-call sequences, and (c) enforce
the test/verify discipline. **Naming TBD** — align with existing in-process
tool conventions before implementing.

1. **`campaign_setup_contact`** — upsert a contact, set custom fields, apply
   tags. (Wraps `search_contacts`/`create_contact`/`update_contact` +
   `add_contact_tags`.) Idempotent by email/phone.
2. **`campaign_enroll`** — enroll a contact into a named, pre-built workflow or
   drip campaign. (Wraps `list_workflows`/`list_drip_campaigns` to resolve a
   name → id, then `add_contact_to_workflow`/`add_contact_to_campaign`.)
3. **`campaign_send_message`** — send an SMS/email to a contact via
   `send_message`, with a dry-run flag.
4. **`campaign_smoke_test`** — **the verify loop.** Create a synthetic test
   contact (tagged `acos-smoke-test`), run setup + enroll, poll GHL
   (`get_contact`, `get_messages`, `search_conversations`) and **assert**:
   fields written? tag applied? enrolled? message queued/sent? Returns a
   plain-English pass/fail report. Cleans up after itself (mirror PMMA's
   `ghl-cleanup-test-contacts.mjs`).
5. **`campaign_verify`** — run the same assertions against a **real** contact
   without creating one (post-launch confidence check).
6. **`campaign_status`** — summarize a campaign: enrolled count, recent
   message activity, opportunity stage distribution. Read-only.
7. *(Phase 2)* **`campaign_ad_report`** — join Meta/Google Ads spend to GHL
   leads → cost-per-enrollment. Read-only.
8. *(Phase 2)* **`campaign_morning_digest`** — scheduled rollup (reuse the
   `croner` scheduler + PMMA daily-digest blueprint).

**Safety posture:** every send/enroll tool defaults to a propose→approve step
(consistent with `system-guidelines.ts`: never bypass the MCP safety layer with
raw shell+curl). Smoke tests are clearly namespaced and self-cleaning.

---

## The one-command flow (setup → test → verify → run → report)

Target UX — a single agent instruction drives:

```
1. SETUP    campaign_setup_contact  → upsert + fields + tags
2. ENROLL   campaign_enroll         → into the pre-built workflow (built once in UI)
3. TEST     campaign_smoke_test     → synthetic contact, assert wiring, auto-clean
4. VERIFY   campaign_verify         → confirm on a real contact (optional)
5. RUN      campaign_send_message / schedule_campaign / send_campaign_now
6. REPORT   campaign_status (+ Phase 2: campaign_ad_report / morning digest)
```

The agent reports each stage in plain English ("✅ tag `summer-2026` applied;
✅ enrolled in `New Lead Nurture`; ✅ welcome SMS queued") so Brett never has to
open GHL to confirm.

---

## Phasing

- **Phase 1 (now):** wrapper tools 1–6 + the smoke-test/verify loop. Reuses the
  proven 92-tool GHL layer; kills ~70–80% of the pain. No new auth work.
- **Phase 2:** Google Ads connector (mirror the Meta/Pipeboard `mcp-remote`
  model) + stats-join layer → cost-per-enrollment dashboard / morning digest.
- **Phase 3 (optional, only if GHL limits us):** graduate SMS→Twilio (own the
  A2P 10DLC registration once) / email→Postmark, one channel at a time, behind
  the same agent tools, reusing the PMMA Supabase data model. **Don't
  pre-build.**

**Build-our-own-CRM verdict: NOT now.** ACOS already owns a tested 92-tool GHL
automation layer; rebuilding means re-acquiring Twilio + A2P 10DLC + email
deliverability from scratch.

---

## Blueprint to generalize (PMMA repo)

`~/dev/PMMA-Website-2026-Master` has a working, tested GHL integration — the
proven template for the wrapper tools and the verify loop:

- `lib/ghl.ts`, `lib/ghl-admin.ts`, `lib/ghl-config.ts` — client + config.
- `lib/student-create.ts` (`syncIntakeToGhl`), `lib/student-intake.ts` — the
  upsert + field-write path to generalize into `campaign_setup_contact`.
- `scripts/ghl-create-intake-fields.mjs`, `ghl-create-outreach-fields.mjs`,
  `ghl-create-event-custom-fields.mjs`, `ghl-create-event-tags.mjs` —
  field/tag provisioning patterns.
- `scripts/ghl-verify-contact.mjs` — the assertion model for `campaign_verify`.
- `scripts/ghl-cleanup-test-contacts.mjs` — self-cleaning smoke-test teardown.
- `scripts/backfill-registrations-from-ghl.mjs` — bulk read/reconcile pattern.
- `scripts/rotate-ghl-token.sh` — token rotation (also a RECOVERY.md chore).
- A daily digest cron — blueprint for `campaign_morning_digest`.

---

## Open questions before implementation

1. **Tool naming** — match existing in-process custom-tool conventions
   (`src/tools/`) vs. the `campaign_*` prefix proposed here.
2. **Where do wrapper tools live?** In-process custom tools (`src/tools/`,
   surfaced via `getCustomTools`) calling `getMCPManager().callTool(...)`, vs.
   a new bundled MCP server. In-process is lighter and lets us compose multiple
   GHL calls per wrapper — **leaning in-process.**
3. **Workflow/drip naming contract** — agent resolves a human name →
   id via `list_workflows`/`list_drip_campaigns`. Confirm names are stable /
   unique per location.
4. **Smoke-test isolation** — dedicated `acos-smoke-test` tag + a test location,
   or guard rails so synthetic contacts never enter real nurture.
5. **Approval UX** — reuse the existing propose/approve path for sends/enrolls.

---

## First implementation step (when this resumes)

Build **`campaign_smoke_test`** first as a vertical slice: it exercises
setup + enroll + assert + cleanup in one tool, proving the whole loop against a
live sub-account (`OfcMDEmwDKM6qQZahiuf`) before we polish the other wrappers.
Model its create/verify/cleanup directly on the three PMMA scripts above.
