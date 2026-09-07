# Local improvement review

## Scope and checkpoint

2026-09-05. Approved local-only plan: Brett's Intel Mac; no release, push,
deployment, external test actions, subscriptions, or provider spending.
Steps 1–2 recorded below. Later steps are not complete unless explicitly
recorded. Evidence labels: **CODE** inspected source, **RUNTIME** executed locally,
**DOCS** existing documentation, **UNVERIFIED** not established.

## Installation baseline

- **RUNTIME:** source initially clean at `53fbb5b`; application code checkpoint
  `f8a6507`. Repository: `/Users/brettlechtenberg/dev/ai-chief-of-staff`.
- **RUNTIME:** installed `/Applications/AI Chief of Staff.app` reports
  `1.0.0-beta.25`. Exact PID 7842 holds the expected
  `~/Library/Application Support/ai-chief-of-staff/ai-chief-of-staff.db` open.
  Startup-health flags: IPC registered, SQLite loaded, initialization complete,
  no recorded error. No private records or credentials printed.
- **RUNTIME:** installed bundle is unsigned (`codesign --verify --deep --strict`
  fails). Do not treat this as permission to disable signing on its replacement.
  **DOCS:** RESUME-PROMPT records an unsigned local installation and Keychain
  prompts. Installed/source byte equivalence remains **UNVERIFIED**.
- **RUNTIME:** Intel x86_64; Node 22.16.0, installed Electron 43.3.0,
  better-sqlite3 13.0.3; in-memory SQLite opens under the system Node ABI.
- **RUNTIME:** FileVault is on. This is disk protection, not database encryption.
  The Desktop copied-data folder was not read or changed.

## Existing checks and synthetic baseline

**RUNTIME:** 73 unit files / 1,334 tests pass; 10.08 seconds total, two workers.
Typecheck and lint pass. Test execution used a fresh temporary HOME and macOS
sandbox rules denying outbound network and access to live ACOS data/Keychains.
No application startup, scheduler execution against live records, or provider
requests were used. Command from the repository:

```sh
HOME="$(mktemp -d /private/tmp/acos-baseline-home.XXXXXX)" \
  /usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network-outbound)(deny file-read* file-write* (subpath "/Users/brettlechtenberg/Library/Application Support/ai-chief-of-staff"))(deny file-read* file-write* (subpath "/Users/brettlechtenberg/Library/Keychains"))' \
  node node_modules/vitest/vitest.mjs run tests/unit --maxWorkers=2 --silent
npm run typecheck
npm run lint
```

Representative synthetic suite runtimes, one sample each (not user latency):
chat engine 51 tests / 91 ms; memory 60 / 335 ms; backup 5 / 62 ms;
diagnostics 26 / 22 ms; AEO 7 / 31 ms; approvals 6 / 10 ms.
Providers/models are mocked; paid/network time is zero. Fake-timer tests cannot
establish real deadline latency. Vitest's transform/import time was 1.25/5.88 s.

**RUNTIME:** existing app main-process RSS sampled once: 255,488 KiB, elapsed
1:07:45. Not whole-app RAM, an idle baseline, or evidence of a leak.

**UNVERIFIED:** cold/warm startup-to-usable, actual first streamed response,
panel switching, SEO HTTP latency, real render timing, repeated open/cancel
memory/process behavior. Launching the credentialed app can start MCP services,
model discovery, Telegram, and due routines; it was deliberately not restarted
for this baseline. Synthetic UI/process harness and before/after measurements
remain verification work; no speed improvement is claimed.

## Subsystem coverage

| Area | Evidence and boundary | Next checkpoint |
| --- | --- | --- |
| Startup/model routing | **CODE:** `initializeAgent` resolves model and credentials, initializes memory/MCP and enabled scheduler/Telegram. **RUNTIME:** existing startup health clean; model/provider tests pass. Live model quality not benchmarked. | Keep routing; isolate runtime probes from credentials. |
| Memory | **CODE:** `compactMemoryIfNeeded` skips non-shrinking upserts but deletes original IDs/aspects anyway; overlapping soul replacement/deletion can lose the replacement. **RUNTIME:** existing memory tests pass but do not establish safe compaction. | Reproduce and implement validated atomic transformation in step 4. |
| Sessions/brands | **RUNTIME:** session-scoped, brand, agent-mode, memory tests pass with fixtures. Live session isolation not audited. | Preserve existing ownership boundaries. |
| Scheduling | **CODE:** handlers installed before scheduler initialization; SEO routines seeded on launch. **RUNTIME:** scheduler fixtures pass. No live routines run. | Cover indirect execution/approval in step 3. |
| MCP/connections | **CODE:** manager owns clients, indexes tools and exposes status snapshots. The plan's `src/mcp/diagnostics.ts` does not exist: diagnostics are `src/tools/diagnostics.ts`, status in `src/mcp/manager.ts`. **RUNTIME:** connection/config tests pass. Live connector health unverified. | Reuse these actual modules; inventory capabilities without sending. |
| Approvals/execution | **CODE:** unfamiliar MCP names inherit read access; shell/local-execute and unknown capabilities do not require approval. Browser argument policy covers only four acting verbs. | Close direct and indirect paths with inert fixtures. |
| Browser/desktop | **RUNTIME:** browser safety, launcher, manager and macOS tool fixtures pass. No real click/type/upload performed. OS sandbox is not proven by shell regex checks. | Inspect all dispatch paths, not just labels. |
| Voice/Telegram | **RUNTIME:** audio, transcription, realtime, fallback, Telegram/auth/tool fixtures pass. No microphone recordings or real messages used. | Preserve delivery approval and private data boundaries. |
| Content creation | **RUNTIME:** synthetic image/daily-packet tests pass; no paid generation. Model prose quality and brand evidence unverified. | Local drafts remain distinct from publishing. |
| SEO | **CODE:** query-detail subset is used for totals; UTC date helper; no request cancellation in inspected flow. No SEO-specific test file yet. | Authoritative totals and equal Pacific-date windows before concurrency work. |
| AEO | **CODE:** successful prompts form headline denominator; configured prompts form segment denominator; engines merged. Existing bounded worker pool/atomic file writer reusable. | Missing observations must remain missing. |
| Hook Lab | **CODE:** embedded panel launches a branded chat using full five-element framework. **DOCS/CODE:** existing framework requires five options per element. | Preserve Full Lab, add optional focused work. |
| Video Studio | **CODE:** render builds shell command, uses elapsed heartbeat, writes slug-based output, copies with overwrite; dimensions are requested not verified. | Inspect exact external workspace in step 10; not touched now. |
| Recovery | **CODE:** online SQLite backup, private permissions, seven-backup rotation, quick_check and emergency pre-restore backup exist. **RUNTIME:** five fixture tests pass. Live restore not yet exercised. | Fresh private backup and separate restore before live changes. |
| UI/themes | **CODE:** existing embedded panels share dismiss/navigation conventions. **RUNTIME:** preload/renderer security fixtures pass. No rendered/a11y certification. | Match shared theme system; synthetic before/after screens. |
| Packaging | **CODE:** packaged updater auto-downloads/installs on quit; local installer uses broad pkill, guessed sleep and remove-before-copy. **RUNTIME:** existing updater fixture tests pass. | Personal marker, staged verified installation and rollback. |
| Budget & Books | **UNVERIFIED/not implemented:** no finance changes made during baseline. | Separate private store, deterministic arithmetic, reviewed imports/exports. |

## Step 2 — private backup and restore drill

**RUNTIME:** checkpoint stored only on this Mac at
`~/Library/Application Support/acos-local-improvement-backups/checkpoint-19RBWC`
under private 0700 directories. Existing online SQLite backup/restore helpers
were reused from the local compiled build. SQLite source and compiled helper
were inspected; the installed better-sqlite3 13.0.3 backup implementation was
verified through its resolved source. No live rows were edited.

- Fresh WAL-consistent main database snapshot created; separate restore replaced
  a synthetic sentinel database. Full integrity_check passed, sentinel absent,
  schema and every table's row fingerprints matched the snapshot without
  printing contents. Restore plus verification: **38 ms**; snapshot and drill
  combined: **54 ms**. Existing live database was not restored or replaced.
- Previous app copied without altering installed bundle. **28,251** file,
  directory and symlink entries matched by relative path, SHA-256 file contents
  and link target. This preserves the original unsigned state; it does not make
  that app signed.
- Persistent-file snapshot includes root JSON configuration, Preferences, Local
  State, attachments, workspace, Local Storage and Session Storage. Nine roots,
  39 entries, no symlinks. Source/copy fingerprints matched before/after each
  copy. A separate restored copy matched; copy plus verification: **64 ms**.
- Chromium caches, cookies/trust stores and transient process locks were not
  included. Browser sessions may need login after recovery. Keychain items are
  not exported; encrypted provider settings still depend on this Mac's Keychain.
  Ancillary files and SQLite are not a single cross-store atomic snapshot.
- The running app was not quit, restarted or disturbed. No updater installation,
  external commands through the app, or scheduled actions were triggered.

Recovery point is this snapshot, not subsequent edits. These are local-copy drill
measurements, not a complete operational recovery-time guarantee. Refresh the
checkpoint before installation/live migrations. Loss of this Mac/disk is **not**
covered; no off-machine financial or application backup was created.

## Step 3 — approval paths implemented and regression-tested

**RUNTIME (2026-09-05):** step-3 checkpoint: **77 unit files / 1,416 tests pass**,
13.81 seconds, two workers, fresh temporary HOME and the recorded outbound-network,
live-data and Keychain deny rules. Typecheck and lint pass. No private records,
real sends or paid providers were used. The installed app remains unchanged.

### Implemented and exercised

- Reproduced ten approval failures before changing policy: shell/program and
  unknown-tool execution, unreviewed browser actions, argument mutation during
  approval, and cancellation immediately after approval. These regressions pass.
- Shell/program execution, unreviewed MCP capabilities and project-authority
  changes now require confirmation. Browser actions outside the inspected read
  allowlist require confirmation. Inspected bundled MCP reads/previews are recognized;
  unreviewed tools remain available with approval, not silently labeled reads.
  MCP annotations can escalate but not downgrade. Proposal staging is not assumed
  harmless: Gmail staging, for example, loads supplied attachments.
- Snapshot arguments before awaiting approval and execute that snapshot. Show
  arguments/destination in a text-only desktop preview; redact credential-named
  fields. Bound pending requests and preview size. Deny missing/failed UI, expired
  requests, canceled sessions and aborted execution. Grants remain single-use.
- Missing execution context no longer bypasses guards in either tool factory.
  Shell fixture tests now explicitly approve inert commands and still exercise
  underlying dangerous-command checks. The local-write fixture uses an approved
  temporary-directory path rather than an unrelated absolute project path.
- Canonical/private-path checks apply at filesystem-operation boundaries,
  including symlinked parents of new files. App private state, finance and backup
  locations are blocked. Explicit app workspace/attachment roots remain usable.
  Recursive search rejects unsafe/mixed trees; async traversal has a 10,000-entry
  cap. Verified installed native read/list/grep/find behavior with synthetic data.
  Approved attachment roots are passed into both factories' operations.
- Reproduced child timeout that left the actual child running. Child-owned abort
  now propagates deadlines/parent cancellation; timers/listeners are cleaned up.
  Child tools retain the parent's guards. Narrow read/write/edit operations
  remain available for delegated local drafts without granting unrestricted shell.

### Boundaries and remaining work

**CODE/UNVERIFIED:** cooperative cancellation cannot forcibly stop a provider/tool
that ignores AbortSignal. Filesystem validation is not an OS sandbox; concurrent
path replacement, hard-link aliases and unrecognized sensitive locations remain
limitations. Recursive search conservatively rejects whole mixed/private trees;
choose a narrower draft directory. GUI appearance, keyboard trapping, VoiceOver
and 200% zoom are not yet verified. No complete approval certification is implied.

**Telegram delivery checkpoint (2026-09-05):** the approved rule is STRICT:
no auto-reply exception, including authenticated incoming messages, help, errors,
typing indicators, edits, deletes, reactions and scheduled notifications. A shared
first/innermost grammY API transformer now snapshots each exact wire payload and
requires one desktop confirmation for that invocation, including every formatted
chunk and uploaded media item. Missing/failed UI, denial, expiry and cancellation
deny. The narrowly named `ApprovalManager.requestTelegramDelivery` can present on
desktop for these deliveries; generic remote tool approval still rejects remote
channels. Generic tool approval and final delivery approval may both prompt; no
blanket grant or mutable bypass flag was introduced.

**Consequence:** remote Telegram conversations now depend on desktop confirmation.
Polling startup's hidden `deleteWebhook` also requires approval; rejection leaves
polling stopped and is logged rather than becoming an unhandled rejection. Known
initialization/read calls (`getMe`, `getUpdates`, `getFile`, reviewed chat reads)
remain available; unreviewed methods fail closed. Scheduler start/completion
heartbeats use the same boundary and also retain local notifications; local job
results/reminders are delivered before attempting Telegram. Completion history is
recorded before waiting for the final heartbeat's confirmation.

**CODE:** verified grammY 1.42.0 source and installed version. `out/bot.js` copies
transformers into `ctx.api`; `out/core/client.js` places the first transformer
nearest transport. Local-path/byte uploads are captured asynchronously before
approval; show filename, size and SHA256, then send the same captured bytes.
Aggregate media cap is 50MiB per request, matching the installed API's standard
upload bound. Growth/overflow/cancellation checks close file handles on every path.
Unknown methods remain available with explicit approval. Pending capture, approval
and delivery participate in session/UI cancellation. Tests cover >64KB media,
mutated sources, missing UI, direct replies and actual polling-startup interception
using inert transport. Lazy/stream/URL-backed InputFile sources fail closed;
there is no visual binary preview yet. No live Telegram/provider calls were used.

**CODE/RUNTIME:** bundled Flo Gmail/Calendar/Docs now expose read-only previews.
The app validates complete IDs/types/hashes and displays stored destination/body,
attachment metadata and captured override arguments before approval. Model-supplied
hashes are replaced with server snapshot hashes. Execute atomically claims the
batch in SQLite before external awaits, verifies hashes and uses captured payloads.
The additive claim ledger preserves proposals; failed/ambiguous executions retain
claims and require reconciliation, not automatic retries. Tests cover competing
connections, stale payloads, rollback, restart, invalid/missing previews, overrides,
mutation, denial, single-use and cancellation. Preview requests check cancellation
before/after but are not actively transport-aborted; no execution follows an abort.
Old servers missing preview support fail closed. No live proposals were migrated.

**CODE/RUNTIME:** read-only approval audit traced chat/coder, voice/realtime,
scheduler, delegation, native operations, GHL wrappers, MCP and Telegram. Found
navigation scheme validation missing at the shared browser dispatch boundary.
Eight inert cases reproduced reaching mocked tiers; now only absolute HTTP(S)
navigation reaches either tier. Page-script execution via this route was not
claimed as demonstrated in Chromium. Explicit evaluate remains approval-gated.
No further concrete approval bypass established in inspected paths; this is not
an OS sandbox or a certification of all future tools/third-party server behavior.

Step 3 implementation and inert regression checkpoint complete; proceed to step 4.
Rendered/accessibility verification remains scheduled for step 16. Refresh the
private snapshot before any eventual live-data operation or installation.

## Step 4 — atomic memory compaction regression checkpoint

**RUNTIME (2026-09-05):** before changing production code, two new tests invoked
`ChatEngine.compactMemoryIfNeeded` with a real temporary MemoryManager/SQLite store
and an inert stream mock. Both failed: a non-shrinking fact proposal left zero
facts; overlapping soul upsert/delete removed the retained approval instruction.
Initial run: **2 failed / 2**, 1.44 seconds. No real conversation/provider was run.

**CODE:** `src/memory/compaction.ts` now captures frozen raw rows (IDs, keys,
contents, timestamps, importance/access metadata) using the existing connection.
The unknown JSON boundary rejects malformed/extra fields, wrong types, duplicate
IDs/keys, missing/out-of-snapshot references, deletion-only and non-shrinking plans.
All sections validate before any write. An immediate SQLite transaction checks
raw-row equality plus connection total_changes/data_version before applying the
whole fact+soul transformation. Same-key replacements retain their original IDs
and metadata; only reviewed content changes or selected snapshot IDs are removed. Cancellation is checked
before writes and before commit. Cache invalidation happens only after success.
Brand/session tables and the existing global fact/soul scope are unchanged.

**Implemented review boundary:** exact category+subject+content duplicates can be
removed automatically; differently labelled equal text is not a duplicate. Useful
semantic summaries are now supported through `reviewAndApplyCompaction`, called by
the real chat-compaction path. Every semantic change requires complete desktop
before/after review; no model-supplied boolean grants authority. Oversized previews
fail closed without truncation. Missing UI, denial, expiry, replay or cancellation
cannot change memory. Review is bound to immutable proposed content and the original
snapshot; concurrent edits cause rejection even after approval.

The same transaction archives full original facts/soul rows and the transformation
in the additive private `memory_compaction_history` table before any modification.
SQL/archive failures roll back everything. `getCompactionHistory(id)` provides local
recovery evidence, never automatic model context or logs. No automated archive
purge or blind restore overwrites current memory. Instructions are not classified
by unreliable keywords: unique text is immutable without explicit full review, and
review cannot modify the separate tool-policy/approval controls.

**Limitations:** prompt-budget truncation is unchanged; storage preservation does
not mean every instruction enters every prompt. Broad revision checks may reject
unrelated concurrent writes. Cancellation prevents applying results after abort,
not forced termination of a provider ignoring cancellation. GUI/VoiceOver review
verification remains step16. No live memory changes or provider tests occurred.

**RUNTIME:** final parent checkpoint: **79 files / 1,466 tests passed**, 14.48s,
fresh HOME and recorded outbound/live-data/Keychain deny profile. Compaction: 27
chat-boundary tests plus 23 storage tests. Covers accepted fact+soul shortening,
same-key survival, original archives, all-section validation, invalid model output,
FTS/SQL/archive rollback, concurrency during both model and approval waits,
cancellation, denial, replay and excluded-store/brand/session preservation.
Typecheck and lint passed. Test edits were new coverage plus notifier cleanup;
previous assertions were retained. Step4 complete; proceed to step5. Nothing has
been installed, committed, deployed or sent through a real provider.

## Step 5 — personal updater and installer; live migration gated

**CODE:** `src/main/update-policy.ts` reads `app.getAppPath()/package.json` at
startup and every updater operation. An absent `acosUpdatePolicy` preserves normal
beta behavior; `"personal-local-v1"` disables updates. Any other present value,
invalid JSON/shape or unreadable metadata fails closed. This is not a settings,
development-mode or environment toggle. Main startup independently checks the
policy; direct initializer and all four updater IPC operations also check it.
The lazy `electron-updater.autoUpdater` getter is no longer accessed at module
load: personal builds create no updater instance/native hooks, event handlers,
startup timer or update request. Check/status return an explanatory error;
download/install fail without touching the updater. Beta autoDownload and
autoInstallOnAppQuit remain true, with the existing delayed startup check.

**INSTALLER CONTRACT:** `npm run dist:personal` uses `build/personal.cjs` and
`--publish never`. The reusable config sets `publish: null`, output
`release/personal`, and `extraMetadata.acosUpdatePolicy = "personal-local-v1"`.
Current `asar: false` places the durable marker in
`AI Chief of Staff.app/Contents/Resources/app/package.json` (Windows:
`resources/app/package.json`). Installer must verify this exact marker in the
staged app, not source package.json or an environment variable. Source/default
beta metadata remains unmarked. Config preserves Developer ID identity,
hardened runtime, notarization, entitlements and both build hooks. Inspected
`afterPack.cjs` native validation/signing branches and `afterAllArtifactBuild.cjs`
notarization/stapling controls; neither was edited.

**VALIDATION:** inert updater tests preserve all existing assertions and add
packaged startup/automatic incoming-release simulation, manual beta operations,
no lazy-getter access/hooks/timers/network for personal or malformed metadata,
direct IPC rejection, and policy rechecks against stale update status. Separate
`personal-build.test.ts` invokes the installed electron-builder package transformer
(without packaging) to prove embedded metadata and default-beta isolation, and
checks signing/config/startup contracts. Electron/update transport are mocked.
Executed `vitest run tests/unit/updater.test.ts tests/unit/personal-build.test.ts`:
**2 files / 21 tests passed**. `npm run typecheck`, `npm run lint` and
`git diff --check` passed. No original updater assertions were removed or weakened.
Installed electron-updater is **6.8.9**, not merely the package.json lower bound:
inspected `out/main.js:78` lazy getter, `MacUpdater.js:18` native hooks,
`AppUpdater.js:109` defaults and `AppUpdater.js:422` automatic download.
`source_path` failed with response decoding errors; installed source was inspected
directly instead. No dependency APIs were guessed or changed.

### Step 5 installer unit — implemented, live installation gated

**CODE:** `scripts/install-local.cjs` now stages a unique private copy, validates
required files, architecture, bundle identity and exact persistent personal marker,
requires Apple-trusted Developer ID team `2HQTY95NHD` with strict deep codesign and
Gatekeeper assessment, and compares SHA-256 manifests before/after copying. Paths,
file modes, bytes and symlink targets are covered; escaping links are refused.
No signing hook, quarantine attribute or sealed bundle content is modified.
Unsigned/ad-hoc candidates are denied; the original need not be signed to be
retained byte-for-byte via rename as `previous.app` in the private job directory.

Installation takes an exclusive destination lock, checks updater risk BEFORE
signaling, signals only path/UID/start-identity-confirmed main PIDs with SIGTERM,
and polls actual process exit with a deadline. Helpers must also exit. No broad
name kill, forced kill, assumed shutdown delay or remove-before-copy remains.
Replacement uses same-filesystem renames; caught rename/launch/readiness failures
restore the original without launching it. If the failed candidate refuses exit,
rollback stops rather than killing it or discarding either bundle. Crash/power-loss
recovery is not automatic: retained job bundles and a stale lock require inspection.

**CLI for step18 (only after all preceding checks and operational gates):**
- `npm run install:local -- x64 --validate-only` (also the default, or `--no-launch`)
  validates source and a unique temporary copy, removes that temporary copy, never
  inspects live health/updater state, quits, launches or changes `/Applications`.
- Source defaults to `release/personal/mac/AI Chief of Staff.app` for x64 or
  `release/personal/mac-arm64/AI Chief of Staff.app` for arm64. Optional
  `--source /absolute/path/to/candidate.app`; positional architecture is x64/arm64.
- Only `--install --launch` together permit switching and launching. They cannot
  combine with validation/no-launch. Launch can activate integrations/routines.
  There is deliberately no install-without-readiness mode or updater bypass flag.
- Readiness reads only the small existing local startup-health marker, requires
  all startup flags, matching version and fresh timestamp/mtime, plus the newly
  spawned PID's owned executable path. It makes no health-check network request
  and prints no health contents. Launch itself is NOT an inert operation.
- Timeout is 30 seconds for observed shutdown/readiness; no CLI timeout override.
  Success prints status and retained rollback/job paths (validation prints a digest).
  Failure exits nonzero. Other OS installers/build configurations are unchanged;
  this previously Mac-specific script now explicitly refuses non-Mac execution.

**GENUINE GATES:** running legacy is refused BEFORE any signal; the installer never
quits it, including if it restarts during the final recheck. Already-stopped,
unmarked legacy is eligible only after a complete UID/start/comm census finds no
exact installed-app processes, no ShipIt/Squirrel/Updater executor (even unrelated),
and no other non-root user's loginwindow session. Other GUI users cause explicit
multi-user refusal; current-user checks do not claim to cover their state.
The exact `com.totalsuccessai.ai-chief-of-staff.ShipIt` service must be authoritatively
absent in `gui/<uid>`, `user/<uid>` and `system`: only status 113 with the exact
expected service/domain absence diagnostic is accepted. PID absence alone is insufficient
because native Squirrel supports queued Mach messages and respawns. The current
home's `Library/Caches/<label>/ShipItState.plist` must be absent, and current-host
CFPreferences `SQRLInstallerOwnedBundle` / `SQRLShipItInstallationAttempts` must each
return the exact domain/key absence diagnostic (status 1). Present, unreadable,
permission-denied or unrecognized observations refuse without printing private
probe output. All observations repeat before the first rename. Inert cached bytes
alone cannot execute without jobs/executors; no caches/preferences are removed and
there is no CLI bypass. This is a bounded observation, not an atomic OS-wide lock
against external actors starting legacy after the final check. Personal installed
bundles retain signature/marker validation and their existing graceful-stop path.
Unreadable or unknown installed policy refuses. Rollback never starts the old app.
Candidate requires the existing valid Developer ID signing/notarization controls
and destination write access. Old `dist:install`/`dist:signed:install` commands do
not produce the required personal output; use the separately approved personal
build path, not an unsigned fallback. Package scripts were intentionally untouched.

**RUNTIME:** parent full regression checkpoint: **81 files / 1,517 tests passed**,
14.84s, same fresh HOME/outbound-network/live-data/Keychain deny profile. Includes
36 installer tests, 18 updater tests and 3 personal-build tests. Typecheck, source
lint and Node installer syntax passed. Existing assertions were retained except
the incorrect unconditional legacy refusal was replaced with stronger explicit
quiescence cases; process fixtures track the real census contract.

Independent read-only native checks: exact ShipIt job absent in this Mac's GUI,
user and system domains with the documented diagnostics; current-host preference
and native-state-file absence observed. Real installer process census identified
four owned app processes and refused live migration without signaling any process.

Step5 source implementation/test checkpoint complete; proceed to step6. Actual
signed artifact, OS shutdown, readiness/rollback and final installation remain
step18 operational gates. No installer CLI, app launch/quit, signing, packaging,
live-data modification, cache removal, commit, provider request or release occurred.

## Step 6 — SEO correctness (source/unit checkpoint)

**REPRO:** added `tests/unit/seo-report.test.ts` first and ran the actual
`fetchSeoData` path with mocked Google connection/profile/HTTP transport. A 301
unique-query fixture has authoritative totals of 900 clicks / 9,000 impressions.
The pre-change test failed with 25 clicks, not 900: this checkout actually used
`ROW_LIMIT = 25` (the task described top-250). No provider/account data was read.

**CODE:** each exact current/previous window now uses a separate ungrouped
`dimensions: []`, `aggregationType: byProperty`, `dataState: final` request.
Query and page details cannot supply property totals. Property CTR (percent) and
provider position are returned, alongside exact previous dates and nullable prior
metrics. Windows use America/Los_Angeles calendar dates, a conservative three-day
cutoff, and equal inclusive periods, independent of DST and the host timezone.

Runtime input validation matches registered days bounds (integer 1–365); profile
URLs, response aggregation/finality metadata, row/key shape, safe integer counts,
CTR/position and duplicate keys are checked. Response bodies are stream-bounded to
2 MB. Errors expose source/kind/status, not provider bodies. Empty property rows,
observed zero, invalid responses, permissions, missing profiles and all-failed
reports remain distinguishable. Missing brands remain entries. Partial detail
failures preserve validated evidence and do not manufacture prior zero totals.

Details are sequential, at most four 250-row pages per query/page dimension per
period (1,000 rows each). Maximum 18 requests per readable site, or 19 with one
property-variant access failure. Top lists and paired-key rising/falling evidence
are deterministic. A missing key is unknown, never an invented zero; there is no
query-to-page attribution. `coverage.complete` means pagination ended, NOT that
Google exposed all search activity. Anonymized/omitted rows cannot be recovered.
No retries, parallelism, shared kickoff, deadlines or abort integration added;
these remain step7. Existing tool registration imports this schema directly.

**RUNTIME:** parent final targeted checkpoint: **37 tests passed**, 443ms total.
Typecheck and source lint passed. Fixtures cover >250 queries, pagination budget,
sparse/zero/empty data, PST/PDT/leap/year edges, invalid JSON/rows/null keys/page
URLs/oversize/duplicates, missing profiles, permissions, partial/all-failed sources,
paired rising/falling evidence and returned aggregation metadata. These were new
regressions and additions, not weakened existing assertions. No live settings,
provider calls, installations, dependencies, commits or deployments occurred.

**Official contracts fetched and checked by parent (2026-09-05):**
- https://developers.google.com/webmaster-tools/v1/searchanalytics/query
- https://developers.google.com/webmaster-tools/v1/how-tos/all-your-data

Current query reference (updated 2026-08-11) confirms inclusive Pacific dates,
ungrouped property totals, final-only data, pagination bounds and returned
aggregation types. Completeness guide confirms detail omissions and typical 2–3
day availability, not a guarantee. Parent aligned page grouping with documented
`aggregationType:auto`, retained returned aggregation metadata per source, and
allowed empty final metadata while rejecting incomplete-date/hour indicators.
No live-account reconciliation or freshness certification is implied. Existing
URL-prefix www/non-www fallback remains; domain-property input/cross-property
merging was not added. Step6 source/regression checkpoint complete; proceed step7.

## Step 7 — fetching/performance unit (shared report definition still pending)

**RUNTIME, synthetic only (2026-09-05):** measured actual `fetchSeoData({})`
with three inert profiles, empty details, authoritative synthetic totals and fixed
20ms transport latency. Same fixture, three consecutive runs, 18 requests/run:
pre-change sequential **421 / 376 / 374ms**, max in-flight **1**; first bounded
run **162 / 107 / 106ms**, max in-flight **4**. Final expanded-suite rerun measured
**152 / 106 / 109ms**, max **4**. Both versions made **54 requests** across their
three samples. First samples include cold process effects; these are wall-time
samples, not Google/provider performance claims. Regression fixture remains in
`tests/unit/seo-performance.test.ts`; no concurrency override was added.

**CODE:** one whole-run four-slot semaphore covers all brands and independent
current/previous query/page and previous-total reads. Property candidates and
pages within each dimension/period remain sequential and ordered. Caps: 90 HTTP
attempts including retries, 12,006 accepted rows across the run, existing 1,000
rows/dimension/period and 250/page, 2,000,000 bytes/response, 15-second request
(fetch plus streamed body) and token-wait deadlines, 90-second whole-run deadline.
Internal second-argument deadline options can only lower those limits; they are
not model JSON parameters. HTTP 429/5xx and explicitly identified transient
network codes get at most two retries (500/1,000ms minimum backoff). Retry-After
seconds or HTTP dates are honored; requests are not retried early when that delay
exceeds remaining run time. Permission/invalid-response failures are not retried.

ToolContext signal already reaches chat-tools/diagnostics; the SEO registration
now explicitly forwards it to the handler and `fetchSeoData` second argument.
Owned controllers, listeners and timers are cleaned; queued work drains without
starting transport after cancellation. Failed/stalled bodies are canceled and
reader locks released. Late values are discarded, including token resolution;
this bounds our wait, **not a claim that an OAuth API ignoring signals forcibly
cancels its upstream refresh**. Valid independent totals survive partial detail
failure. Top-level canceled/timed_out/all_failed/partial labels distinguish run
outcomes; aborted runs cannot return ok:true. Provider bodies/tokens are not
returned in errors. AEO helper inspected but not reused: its fetch-only deadline
and broad retry policy do not cover streamed-body/ignored-signal requirements.

**RUNTIME:** `npx vitest run tests/unit/seo-report.test.ts tests/unit/seo-performance.test.ts`
passed **57 tests**, preserving all original **37** unchanged. Added checks cover
global cap, pagination order, exact 90-attempt exhaustion, retries/backoff,
Retry-After beyond budget, no auth retry, abort before/during/queued/network/body/
token work, app and fallback token stalls, whole-run partial totals, transient
network recovery, oversized stream cancel/unlock, and timer cleanup.
`npm run typecheck` and `npm run lint` passed at that checkpoint. Subsequent
code-only review added a final cancellation check after the inner result await,
closing the microtask boundary before returning success; this final guard has not
been rerun through checks (per the review instruction). No live network/account settings,
provider/model spend, dependencies, installs, commits or deployments used.
Shared manual/scheduled report definition, kickoff/UI/crons and later steps are
not part of this unit; parent owns the remaining step7 work.

## Step 7 — shared report definition/manual + scheduled integration checkpoint

**Step7 source/regression checkpoint complete.** `src/tools/seo-report-definition.ts`
exports the versioned pure kickoff helper and deterministic maximum-five near-win
ranking. `src/tools/seo-report.ts` attaches `definitionVersion` and `actions` to
returned reports without changing HTTP/performance logic. Actions use only observed
page/query rows, complete nonfailed current source evidence, finite metrics and
validated property/page URLs. Each carries property/source URL, actual date window,
coverage and returned aggregation type. Query actions deliberately have no page URL
or inferred landing-page mapping. Partial brands may contribute independently sound
evidence; absent totals, failed detail sources and canceled results cannot rank as zero.

`src/main/seo-crons.ts` builds new weekly prompts with the same helper used by
`seoReport:getDefinition` in `src/main/ipc/brands-ipc.ts`. The exact read-only channel
is chat-only in `trusted-ipc.ts` and exposed in both preload implementation/interface.
`ui/chat/seo-report-panel.js` awaits that definition and sends its prompt through the
existing chat flow; there is no new result-rendering pipeline or duplicated prompt.
The shared contract requires corrected property totals, equal Pacific finalized
windows, source/date/coverage/errors, and the tool-computed action order. Manual
output stays local; scheduler routing remains unchanged through the existing Telegram
API approval guard. Site edits stay local drafts; sends/publication remain gated.

Seeding uses `getAllJobs()` (including disabled stored routines), creates missing
names only and never deletes/overwrites existing jobs. No reliable ownership marker
exists for legacy seeds, so **existing weekly routines require explicit user refresh**
to adopt this definition; customized prompts and disabled schedules are preserved.
No real routine store, provider, scheduler execution or live state was read/called.

**VERIFIED:** targeted SEO correctness (original 37 unchanged), performance (20),
shared definition (18), and trusted IPC (5) suites; manual parity executes the actual
renderer function in a VM against the registered mocked trusted handler, and cron
seeding uses inert scheduler doubles. Typecheck and source lint passed. No dependency,
install, commit, push or unrelated feature changes. Actual Electron rendering/model
compliance, real Google reconciliation and live scheduled delivery remain untested.

**Parent final verification:** full sandboxed suite **84 files / 1,592 tests pass**
(17.82s), with typecheck and lint passing. Existing SEO37/performance20 assertions
were retained; new integration18 and added trusted-IPC assertions establish shared
parity and channel restriction. Synthetic speed samples are not live latency claims.
Proceed step8; live reconciliation, legacy routine refresh and rendered checks remain
explicit operational limitations rather than hidden completion claims.

## Risks and future-beta candidates

No beta action is authorized. Candidate fixes after local validation: atomic
compaction, fail-closed approval policy, accurate SEO/AEO coverage, cancellable
render jobs. Personal updater behavior must not change beta users' settings.
Dependency advisories, live SEO reconciliation, actual accessibility, complete
external-action coverage and backup recovery are not certified by this baseline.

## Step 8 — AEO coverage and comparability (2026-09-05)

- **CODE / regression:** old `summarize` OR-merged successful engine answers into
  prompts and excluded wholly failed prompts from headline rates, while local/info
  totals stayed requested counts. Inert 25-prompt/two-engine fixture with only one
  positive success would report headline 100%, local 1/10, hiding 49 failed calls.
  Regression was run against the exported old summarizer and failed on missing
  measurement coverage; existing seven assertions/tests were preserved (Response
  construction qualified with globalThis for lint).
- **CODE:** `src/tools/aeo-visibility.ts:93` defines explicit measurement and prompt
  coverage; `:368` summarizes successful observations separately from unknowns.
  Overall/local/informational and per-engine rates label observed denominators and
  retain requested counts. All-error rates are null. Known-positive/unknown prompt
  counts avoid converting missing engine observations into negatives. Requested-
  prompt lower/upper bounds are also returned/displayed (rounded outward); all-error
  bounds are null, not 0%. API names and paid-batch wording avoid consumer-ranking
  or unmeasured cost claims.
- **CODE:** `src/tools/aeo-visibility.ts:121` versioned metadata and `:129`
  `areAeoRunsComparable` gate require identical versions, exact prompts/hash,
  config, requested/returned models and full coverage. Missing returned-model
  evidence, empty model sets and unknown engine names are not comparable. No historical auto-delta
  consumer exists here. Snapshots include exact configured prompt strings (no
  separate generated prompt layer), model identities, counts and proxy disclaimer.
  UUID run directories preserve prior snapshots; atomic private writes, bounded
  pool and cancellation remain. Partial runs retain independent citation evidence
  with ok:false; all errors unavailable; persistence errors are disclosed.
- **CODE / caller audit:** actual registration is `src/tools/index.ts:280`;
  `src/tools/aeo-visibility.ts:630` JSON-stringifies the tool result. Renderer
  `ui/chat/message-renderer.js:433` handles generic tool status text, not AEO
  numeric metrics. Repository searches found no AEO-specific UI/IPC numeric
  formatter or .toFixed caller; other .toFixed uses are unrelated. Markdown and
  JSON export are the in-repository numeric consumers and now support null.
  External Visibility Edge importer/UI is **UNVERIFIED**, not part of this repo;
  report/tool wording no longer promises import compatibility. No live UI run.
- **RUNTIME:** `tests/unit/aeo-visibility.test.ts:95` onwards covers synthetic
  mixed coverage, any-engine vs measurement rates, all-success, all-failure,
  local/info, persisted metadata, comparison mismatches, invalid JSON/citations,
  Anthropic evidence, cancellation and distinct run files using temporary report
  roots and mocked fetch. No real settings keys/providers/data were read or used.
  Parent full sandboxed checkpoint: **84 files / 1,600 tests passed**, 13.21s,
  including **15 AEO tests**, with typecheck and lint passing. Added assertions
  preserve the original seven tests and independently check missing model evidence
  and known/unknown bounds; none were weakened, skipped or suppressed. No paid
  benchmark, install, commit or deployment occurred.
- **CODE / final review correction:** reject explicitly incomplete OpenAI response
  status and Anthropic web-search error objects even when answer text is present
  (`src/tools/aeo-visibility.ts:273`, `:347`). Added synthetic assertions without
  weakening existing tests. Parent rechecked these changes in the full run above;
  the earlier worker's unverified note is superseded. Official OpenAI Responses
  and Anthropic web-search documentation was fetched; provider accuracy itself
  was not benchmarked.
- **Limits:** one API observation per prompt/engine is not a statistically stable
  consumer-ranking estimate. Full coverage is a conservative comparability policy,
  not proof of unchanged provider internals or quality. External schema-2 adoption
  needs its own caller audit. Output contract documented in `docs/AEO-VISIBILITY.md:36`.
  Step8 source/regression checkpoint complete; continue step9.

## Step 9 — Hook Lab (2026-09-05)

**CODE:** `ui/chat/hook-lab-panel.js` preserves Full Lab's 5×5 default;
explicit Quick Pass requests a single coherent five-element combination;
targeted mode requests one replacement only, without modifying selection fields.
The existing brand/session/composer path is reused. Platform, audience, duration,
offer and evidence are bounded; supplied links are not fetched automatically.
Editorial model assessments are qualitative, explained, and explicitly not
virality predictions. Prompts require spoken-time/repetition/promise/evidence
checks, refuse fabricated evidence and keep output draft-only. Skill instructions
in `assets/skills/hook-lab/SKILL.md` mirror these conditional contracts.

**CODE:** `ui/chat.html` adds neighboring card/form controls and five explicit
paste/edit selection fields (no chat-output extraction claim). No theme change.
Saved combinations use `hl-combinations-v1`, `{version:1,items:[draft]}`;
a draft has `{version,id,name,brandId,context,elements}`. Unique IDs preserve
repeated names; brands isolate the visible list. Exact-key/prototype/length/brand
validation and 100-record/1.6M-character bounds fail closed; invalid/full/quota
errors preserve existing storage, never evict selections. No library expansion
into prompts. localStorage follows existing Video Studio preference usage.

**CODE:** separate `hl-video-draft-v1` carries the exact user-selected five
strings plus context/brand. Existing pending drafts cannot silently be replaced.
Video Studio reads and displays them via textContent across panel/session/reload,
and offers explicit confirmed clearing. This is a local review prefill, NOT
publish approval. With a pending draft, the legacy render kickoff is blocked;
step 10 must wire the reviewed exact text into planning, not ask for recreation.
No renderer/tool/recipe changes or external workspace inspection were performed.

**RUNTIME (narrow follow-up):** `node node_modules/vitest/vitest.mjs run
tests/unit/hook-lab.test.ts --maxWorkers=2 --silent` passes **12 synthetic
VM/DOM/store tests** (398 ms total, 188 ms tests), with temporary HOME and the
recorded sandbox outbound-network/live-data/Keychain deny rules. The original
six tests remain; the malicious-name assertion now addresses the load button
inside its new paired load/remove row rather than the former standalone button.
Added coverage exercises orphan preservation/current-brand usability and rejection
of unknown active inputs; named/canceled removal, reachable capacity recovery,
concurrent confirmation changes, quota failures, undo with later records,
deterministic advisory/nonmutation/privacy, brand-load failure retaining selection,
escaped pending JSON above 30K, and review-card expansion.
Both panel files pass `node --check`; `node node_modules/eslint/bin/eslint.js
tests/unit/hook-lab.test.ts` and `git diff --check` pass. Earlier typecheck/lint
results above are not rerun in this narrow follow-up; parent owns global checks.
No live user data, provider calls, paid benchmarks, generation, sends,
dependencies, commits or pushes.

**UNVERIFIED / deferred:** model adherence/quality is not measured by prompt
contract tests; no paid model-quality claim. Real Electron rendered/visual check
is deferred to step 16. Step 10 storyboard/render integration remains pending;
the external recipe/source directory must be inspected only when that step starts.
**CODE (narrow usability follow-up):** saved rows now pair native load/remove
buttons, using neighboring chips and explicit focus-visible styling. Remove names
the exact draft and ID in native confirmation, checks the storage snapshot again
after confirmation, and leaves originals intact on write failure. One in-memory
undo merges the exact record back without overwriting later records. Another
removal explicitly warns it replaces undo; closing the window loses undo. A
reserved record slot and explicit confirmed discard make the 100-record cap
recoverable entirely through UI. Orphan records are structurally validated,
preserved without automatic migration/deletion, and shown disabled for loading;
explicit named removal is available even when all brands are unavailable.
Current-brand loading/saving and strict active-brand validation remain separate.
The localStorage snapshot guard is not a transactional cross-window lock.

A textContent/role=status advisory and pre-handoff native confirmation report
approximate selected-verbal spoken time at labeled 150 words/minute (whitespace
word count), exact full-element repetition ignoring case/spacing, and missing
supplied evidence. Partial repetition, actual delivery time, evidence quality and
truth are not detected. Supplied claims/strings are never rewritten; advisory
checks do not send library content to a model. Native dialog and focus-visible
source semantics are inspected, but real keyboard/VoiceOver, contrast, reflow,
rendered appearance and accessibility conformance remained **UNVERIFIED** at that checkpoint.

**FINAL STEP 9 CHECKPOINT:** Full unit suite passed: **85 files / 1,613 tests**
(15.39 seconds), using temporary HOME with outbound network, live application-data
and Keychain access denied. Typecheck, lint and renderer syntax checks passed.
The 13 Hook Lab tests include added goal-state/targeted-field regression coverage.
AEO tests added coverage without relaxing existing assertions; explicit
`globalThis.Response` leaves constructor behavior unchanged. Hook Lab is a new
suite; its malicious-name assertion follows the new nested load button and still
requires literal text, with the harness rejecting innerHTML writes. No skipped
checks or assertion suppressions were introduced to obtain these results.

**INDEPENDENT RENDER EVIDENCE:** Actual markup/styles/renderer scripts in isolated
Chrome 152.0.7977.77, synthetic content, six Full/Rewrite states at widths
1280/800/320: no page errors, horizontal control overflow or clipped card content.
Screens and runtime/accessibility reports are under ignored `.gg/screenshots/`.
The idea textbox has its expected accessible name; optional goal disclosure and
selected-goal state are exposed. Secondary text now uses the existing higher-
contrast token; summary focus is inset to avoid clipping. Native Chrome sandbox
was retained; an inert proxy rejected 15 requests and the temporary profile was
removed. This is not OS-wide egress certification or installed-Electron evidence.
Real VoiceOver, complete keyboard/state/theme coverage and 200% zoom remain step16.
Model adherence and live-provider quality remain unverified; no paid calls occurred.

Step9 source/regression checkpoint is **COMPLETE**. Step10 starts next; no video
render implementation or external workspace changes have occurred in step9.

## Step10 — verified local Video Studio jobs

**COMPLETE (source/runtime checkpoint, 2026-09-05).** No application installation,
provider call, purchase or release occurred. Brett explicitly confirmed personal
operation by one person, no business. The pinned license permits individual use;
`COMPLIANCE.md` records that fact rather than inferring eligibility from one Mac.
The pinned v4.0.484 license and current official FAQ were inspected; current FAQ
v5/team wording is not silently applied to the installed v4 employee wording.
This licensing assessment is engineering guidance, not legal advice.

### Implementation checkpoint (source only)

- `video-render.ts` replaces shell-string/npx rendering with private UUID jobs and
  an owned Node worker using installed 4.0.484 renderer/bundler/media-parser APIs.
  Omitting `previewJobId` creates three frames; a later call binds exact normalized
  inputs and the preview bundle digest. Existing desktop execution approval is
  still required. A preview is not publication consent.
- Composition and encoded metadata are validated, including exact video frame
  count, dimensions, FPS and duration. Video time and container padding are separate
  measurements. Fresh destination folders and exclusive copies avoid name collisions;
  copy/abort failures retain original artifacts and report recovery locations.
- Bounds: two active jobs, 100 retained jobs, 20-minute deadlines, 64 KiB props,
  1 GiB/10,000-entry bundles, 2 GiB encoded files, 180-second compositions and disk
  reserve checks. No automatic archive deletion or dependency/browser installation.
- Owned-process cancellation discovers actual ancestry, records process identities,
  signals only owned groups, and escalates after a grace period. Process discovery
  now runs before launch so unavailable enumeration cannot leave a launched job.
- The installed renderer supplies sandbox/site-isolation-disabling Chrome arguments.
  A copied, private launcher filters those flags while using already-installed Chrome;
  browser requests use a job-owned local-asset proxy. This is not an OS boundary for
  arbitrary project code; `render_video` remains approval-gated local execution.
- **Additional CODE finding:** installed `port-config.js:23–28` selects wildcard
  listener addresses. A worker-scoped, version-specific compatibility guard now
  restricts the two inspected Node listener call sites to `127.0.0.1`; unknown
  socket configurations fail closed. It does not modify external dependencies.
- A bundled silent typography preset (`ACOS-Storyboard`) and deterministic SRT helper
  use the actual existing Hook Lab fields: `verbal`, `text`, `visual`, `audio`,
  `caption`. `caption` is post copy; video subtitles derive from `verbal`. Original
  visual/audio/post-copy directions remain review data, not fabricated realizations.
  The preset checks estimated speech rate, text lengths and color contrast.
- Video Studio passes the exact saved selection as data, explicitly sets/clears its
  brand, retains pending drafts, stops on brand-setting failure, and adds a separate
  terminal `preview_ready` marker before the final render trigger. Invalid records
  are preserved and block kickoff. No model message can grant tool approval.

### Regression and runtime evidence

**Original reproduction:** all four initial render tests failed against the old
implementation: non-object props reached execution, and a fake MP4 was reported
successful. The assertions remain; the metadata test additionally verifies that
it reaches the new worker/metadata validation boundary rather than failing preflight.

**Earlier targeted checks:** 47 tests across six files passed (13 existing Hook Lab;
34 new video tests). Typecheck, lint and worker/renderer/shell syntax checks passed.
These are not a full-suite result after step10. No tests were skipped or assertions
relaxed. The UI fixture was corrected to the existing strict stored-record schema;
production validation was not loosened. The new preset was corrected to those same
persisted field names instead of inventing a competing schema.

**Test environment finding:** macOS `ps` is setuid and cannot be executed inside
our outer `sandbox-exec` test profile. Four inert Node lifetime tests therefore ran
separately with temporary HOME, outside that profile; all assertions still ran.
The other 43 targeted tests used outbound/live-data/Keychain denial. An early failing
cleanup test left one deliberately stubborn synthetic child; it was identified by
its exact command/start time/PID, terminated by exact PID, and confirmed absent.
Preflight and test-finally cleanup were fixed before re-running. Subsequent lifetime
tests confirmed both owned PIDs absent and an unrelated sentinel still alive.

**Independent RUNTIME:** a three-second, 1080×1080, 30 FPS synthetic composition
rendered through the new worker. Preview: 5,974 ms; MP4: 7,600 ms; actual video count
90 frames; counted video time 3s; measured container time 3.051s. The initial strict
container/video-time comparison rejected AAC padding; the fix counts video frames
exactly and separately validates/reports container time (100ms maximum difference).
This is a stronger video-content-length check, not removal of duration verification.
Report: ignored `.gg/step10-benchmark.json`; private synthetic artifacts are under
`/private/tmp/acos-video-bench-S9TXqX`. No real user assets were used. The native run
predates the final listener guard and preset; do not present it as full final-build
verification. Two later real socket tests verified the listener guard binds IPv4
loopback and rejects unknown socket configurations, restoring the test prototype.

### Final acceptance evidence

- **RUNTIME:** 89 unit files / 1,644 tests passed with outbound network and live
  app/Keychain access denied. All four native process tests passed separately in
  temporary HOME; no test was skipped. Combined: **90 files / 1,648 tests**.
  Typecheck, lint, renderer syntax and 18 final Hook Lab/Video Studio tests passed.
- **RUNTIME:** seven additional isolated native integration cases passed through
  actual `renderVideo`, worker, installed Chrome and encoder. Three-second presets
  in 1:1, 9:16 and 16:9 produced verified MP4s, preview PNGs and SRT. Missing
  compositions, aspect mismatch, changed props/bundle, bundling/preview/render
  cancellation, repeated names and a simulated destination-copy failure were
  exercised without changing the external workspace or any live data.
- **Measured:** preview times 5,328 / 5,171 / 5,231 ms for square/portrait/landscape;
  rendering 7,630 / 7,952 / 8,339 ms. Peak sampled owned-process RSS respectively
  1,259 / 1,797 / 1,772 MiB while rendering. Three repeated render/cancel cycles
  completed in 3,338 / 3,195 / 3,334 ms (whole job time, not cancel-only latency),
  with peaks 787 / 714 / 756 MiB. No observed owned process identities survived
  any of the 18 operations. Sampling every 200 ms is not a global leak proof.
- Prior named outputs remained byte-identical after a repeated-name render;
  failed copying retained the source MP4 and recovery folder. Temporary synthetic
  artifacts and ignored `.gg/step10-final-native.json` retain inspection evidence.
  Full renders and cancellation used real Chrome; only destination failure was
  deliberately injected. Output-path isolation/concurrency also has unit coverage.
- **RUNTIME/UI:** six real-markup Chrome states at 1280, 800 and 320 CSS pixels
  reproduced then eliminated flex-shrunk cards and capped long-draft clipping.
  Aspect choices are now native buttons with selected state; keyboard Enter
  selects aspects and toggles optional setup. Collapsed setup fields leave the
  tab order. Final probes found zero clipping, horizontal overflow or page errors.
  Secondary text reuses the higher-contrast existing token. Empty draft removal
  is disabled; planning is distinct from rendering/publication. Screenshots and
  probe are ignored `.gg` evidence, not public artifacts.
- Preset preview PNGs were visually inspected, including 160-character text in
  portrait/landscape safe areas. The first oversized test string was correctly
  rejected; the fixture was corrected to the documented bound, not the validator.
- **Type verification:** strict TS/checked JS passed against actual external
  React/Remotion declarations. Added the missing numeric JSDoc on our caption
  timestamp helper. Remotion's published types reference an undeclared global
  `Timer`; the isolated check supplies the exact host `ReturnType<typeof
  globalThis.setTimeout>` matching its source assignment, with no `skipLibCheck`,
  assertion weakening or external dependency edit. This type-package defect is
  recorded, not disguised as an upstream clean check.

Full Electron/VoiceOver, live model quality, long/complex custom compositions and
machine-wide memory stability remain unverified; the relevant integrated gates
are steps16–18. No accessibility/performance certification is claimed. Continue
with Orbital Command (step11); do not install or release yet.

## Step11 — Orbital Command source checkpoint

Added an opt-in palette using the existing theme loader, shared CSS and bundled
fonts. Existing skins and stored/default settings remain unchanged. Added a
small real review-sequence path, common creative/chat content rails, compact
controls, violet creative navigation accents and conspicuous amber approvals.
No font/icon service, renderer framework, canvas or recurring animation was added.
The actual utility layer is `ui/shared/ui.css`, not the plan's proposed nonexistent
`utilities.css`; reusing it avoided another stylesheet/loader.

**RUNTIME:** 20 targeted tests passed (including new theme/contrast coverage),
typecheck and lint passed. Eighteen synthetic before/after Chrome scenes cover
chat, Video Studio and approval prompts at 1280/800/320 widths. Final Orbital
checks observed no horizontal overflow or hidden ancestors, 0s reduced-motion
transitions, amber approval buttons and restored composer focus after Escape.
The fixture initially masked a panel with its own inline style; that was corrected
and visibility checks now prevent accepting an empty screenshot. No app visibility
control was weakened. Narrow composer sizing and focus outlines were reproduced
and fixed within the new skin. See DESIGN.md for screenshots, the 20/24 scoped
critique, 5.98:1 minimum tested text-token contrast and explicit unverified gates.

**Not installed or activated:** activation on this Mac stays at the final backed-up
installation checkpoint. Full Electron/VoiceOver, RTL/zoom/forced-colors and all
panel/state checks remain step16. The existing TSAI 320px composer overflow is
recorded for that integrated pass, not hidden by relaxing its baseline report.
Continue with the private finance store (step12). No public beta action occurred.

## Step12 — private finance store checkpoint

**CODE:** Separate finance/finance.db, one connection owner, WAL/FULL sync, foreign
keys, strict checked tables, versioned transactional migration and checksum/schema
identity validation. Original transactions/import lineage and history cannot be
rewritten/deleted; allocations must balance and imports must have all expected rows
before commitment. Committed imports cannot be reopened or appended. Equal purchases
remain valid distinct records. Migration SQL is included in local packaging.

Shared backup reuse now validates store identity and schema, publishes snapshots
exclusively, protects interrupted restore artifacts and uses unique names. Finance
has a separate private backup namespace; open owners prevent restores. Directories
are 0700, database/sidecars/backups 0600. This is access restriction, **not encryption**.
Automatic backup threshold is 20h with 20-minute polling while active, retaining up
to 30 snapshots, not 30 guaranteed days. Target RPO is 21h while active; sleep and
failures extend it. Failed backup attempts surface warnings. Same-Mac copies do not
survive loss of this Mac; no off-machine copy is authorized.

**RUNTIME:** 25 finance/shared-backup tests passed; typecheck and lint passed.
Synthetic independent WAL backup/restore took 18ms, verified original values,
absence of a newer source edit, integrity, foreign keys, private modes and source
preservation. This tiny fixture's observed restore time is not a production RTO.
Tests include ownership, repeated migrations, money/date constraints, entity
isolation, balanced splits, import completeness, rollback, wrong-store/version
rejection, symlinks and interrupted-restore preservation.

**Boundaries:** No real finance data exists in this implementation checkpoint; only
throwaway stores were opened. Brett's scope remains personal, one operator, no
business. No bank connection, provider call, live import or installation occurred.
Continue with previewed CSV/manual import (step13), then deterministic analysis and
UI; these are not yet claimed complete.

## Step13 — previewed CSV/manual import checkpoint

**CODE:** Explicit delimiter/date/decimal/sign mapping, UTF-8/BOM and quoted-record
handling, exact bounded minor-unit parsing, 8 MiB/50,000-row/64-column limits.
Worker-held expiring snapshots expose 100-row pages and reviewed totals. Invalid
rows need explicit exclusion; overlapping and repeated candidates require review.
Exact file/account/mapping re-imports are idempotent; equal purchases remain valid.
Manual previews validate splits without writing. Creation/manual retries bind exact
identifiers and inputs. Allocations and append-only history change transactionally;
void/restore preserves originals. Fresh pre-bulk backups gate writes; post-save backup
failures return saved results with warnings rather than encouraging duplicate retries.
FIFO/symlink files are rejected, filesystem errors do not serialize private paths,
and the owned worker caps its request queue and clears previews/timers on close.

**Dependency snapshot:** Reused the already pinned csv-parse 7.0.2 worktree addition;
verified resolved package source, sync parser/options, MIT license, no runtime package
dependencies. OSV version query on 2026-09-05 returned no matching advisories (`{}`),
not a security certification. No new installation, subscription or provider call.

**RUNTIME:** 53 finance/import/shared-backup tests passed, strict TypeScript emit and
lint passed. Native worker probe used network/live-data/Keychain denial and temporary
synthetic stores. Eight 50,000-row preview/cancel/close cycles: 981–1107ms preview,
2–3ms maximum main-thread timer delay. Final 50,000-row transactional commit including
backups took 7167ms; exact retry imported no additional rows. FIFO rejection, canceled
consent rejection, 100-row paging and clean worker exits passed. Process RSS after
worker exits rose 79→114 MiB before the final large commit (166 MiB afterward).
This is NOT evidence of steady memory: allocation retention/churn needs the step17
long-lived-worker lifecycle pass; no claim of leak freedom is made.

**Boundary:** Step13 backend checkpoint complete. Native pickers, visible review/
confirmation and final UI integration remain step15; no live data or installed app
changed. Step14 deterministic analysis/exports is next.

## Step14 — deterministic analysis and accountant-packet checkpoint

**CODE:** Calendar-month/year budgets with exact favorable variance and stale-edit
checks; entity/currency separation; refund-aware expense math; transfers/card
payments excluded from spending; explicit uncategorized/excluded observations.
Latest entered statement comparisons preserve edit history and do not claim complete
books. Recurrence candidates state observation reasons/coverage; merchant rules
produce pending suggestions. Scenarios store explicit what-if assumptions. Receipt
references expose unavailable files and are not represented as copied/backed up.

Accountant packets contain account/opening inputs, original transaction/allocation
status, category/month summaries, budget comparisons, import review exclusions,
receipt index, reconciliation, review exceptions, methodology and escaped HTML.
Formula-like CSV text and numbers beyond spreadsheet precision are protected;
unique private directories prevent overwrites. Completion manifests/checksums are
written last; interrupted packets survive without a false completion marker.
Migrations remain additive; version-three indexes/category/budget constraints were
exercised against a populated version-two fixture with a preserved prior snapshot.

**RUNTIME:** 77 finance/import/analysis/shared-backup tests, typecheck and lint passed.
Native network/live-data/Keychain-denied 50k-row fixture: report 538ms, packet export
3222ms, 2ms maximum main-thread timer delay. Indexed-store commit including backups
was 9922ms in that run (step13's earlier run was 7167ms); no throughput improvement
is claimed. The packet was emitted and its completion manifest observed. Subsequent
small account-export/metadata validation changes were covered by targeted tests.

**Boundaries:** Source-only; native pickers, visible review/consent and financial-data
IPC boundaries are step15. No real financial row or provider was read/sent; no app
installation, subscription or release. Read `docs/FINANCE.md` for exact conventions,
ceilings and recovery limitations. Continue step15 UI/IPC/aggregate-only AI consent.

## Step15: Budget & Books UI and consent integration

**COMPLETE as a source/integration checkpoint.** The existing sidebar/panel shell
now exposes Overview, Transactions, Import and Plan & setup. Native confirmation
precedes local writes; account aliases, entities, exact amounts, duplicate decisions,
allocation revisions and reversible corrections retain their backend checks.
Optional mapped currency columns reject mismatches rather than converting amounts.
Manual drafts remain in bounded, scope-keyed renderer memory, not localStorage.
CSV/receipt paste or drop cannot silently populate the hidden chat attachment tray.

**RUNTIME:** 94 targeted tests passed across finance database, import, analysis,
IPC, attachment boundary and AI transport; typecheck and lint passed. The real
provider adapter was exercised with an inert transport: one anonymous aggregate,
no history/tools/browsing, fixed HTTPS origin, POST only, redirect rejection,
output bounds and incomplete-output labeling. No provider was contacted.
Native dialog/IPC tests use inert Electron stubs, including Cancel defaults,
exact requests, invisible/untrusted owners, cancellation and renderer loss.

Three explicit browser probes passed using the actual panel, shared sidebar
bindings, validators and a real temporary SQLite ledger. Covered initial setup,
exact manual amounts, rejected confirmation retaining fields, unsaved tab drafts,
CSV duplicate decisions/foreign-currency exclusion, denied AI, and failed scope
switches. Twenty budget scenes covered four sections at 1600/1280/800/640/320px;
no panel horizontal overflow or unnamed visible controls was observed.

Two gaps found during verification were corrected: native manual/allocation
confirmations now identify ledger/account/request instead of showing only amounts;
failed year/currency/entity loading clears prior-scope figures and disables their
AI/export actions. Their regression tests failed first and passed after correction.
The initial browser harness omitted the shared event-bindings module; it now loads
that real module rather than bypassing sidebar navigation.

Repeat the browser check with `node node_modules/vitest/vitest.mjs run --config
 tests/manual/finance-ui.config.ts` from the repository. Its explicit local Chrome
profile/proxy denies external traffic; screenshots and synthetic records remain in
ignored `.gg/finance-ui-*`. Chrome is an existing installation, not downloaded.
`source_path` could not fetch gg-ai/puppeteer's upstream repositories; installed
package code/types and existing probes were inspected instead.

**Not established here:** native Electron/VoiceOver output, full keyboard/zoom/theme
coverage, real provider output, live-account reconciliation or installed-app health.
These remain steps16–18; this checkpoint is not an accessibility/security claim.
No live data, app installation, paid calls, publishing or release occurred.

## Step16: scoped renderer and human accessibility checkpoint complete

The initial local finance probe rerun passed
12 Chrome cases and 13 isolated Electron cases, including the new regression
refusing an unattended read of the real synthetic local ledger page. Evidence:
`.gg/finance-ui-7lcT3o` (Chrome) and `.gg/finance-ui-WLQPPA` (Electron).
These use synthetic SQLite records, inert bridge/approval answers, temporary
profiles and network denial; they do not start the installed application.

Covered setup/manual/import paths, scope failure and retry, retained drafts,
AI denial, keyboard focus/restoration, named regions and controls, narrow layout,
contrast samples, reduced motion, forced colors, RTL, connector disclosures and
polling cleanup. Electron additionally passed native 200% zoom. The shared UI
probe passed 18 scenes; Hook Lab passed six scenes without reported errors or
overflow and confirmed profile deletion. These are scoped fixture results,
not full-app accessibility or performance certification.

Local-document browser regressions were reproduced and corrected across CDP,
Electron and MCP read paths. HTTP(S) URL validation and shared read guards now
reject local/internal content, discard results when the URL changes during a
read, and redact local tab titles/paths. The focused browser/safety run passed
133 tests, followed by typecheck and lint. This is not an OS-level privacy boundary
or proof covering every possible navigation race or approved execution path.

**Completed human checkpoint:** Brett confirmed spoken control labels, keyboard
access to Export/Analyze, the synthetic denial announcement, and the requested
approval/focus checks. After an additional reading check, he explicitly confirmed
actual table amounts were spoken. Apparent autonomous checkbox changes were the
moving VoiceOver reading outline, not changed checkmarks. Disabled financial
actions were traced to a selected synthetic entity without an account; choosing
the populated entity restored both actions without weakening data guards.

Approval focus containment now includes the scrollable argument preview and both
buttons; background content is inert while the dialog is open and restored on
dismissal. An initial test incorrectly treated preview focus as escaping the
dialog; both the assertion and focus loop were corrected. Verification passed
13 Chrome and 14 isolated Electron cases (`.gg/finance-ui-2YqJLT` and
`.gg/finance-ui-b0lQmn`). The review window lifetime increased from 15 to 60 minutes
to avoid interrupting Brett; another 14-case Electron run passed afterward
(`.gg/finance-ui-islShl`). The final visible session closed normally with all 15
harness cases passing (`.gg/finance-ui-6ShuDB`); only Brett's reports establish
actual listening results, not that test count. VoiceOver is off and the owned
fixture is closed. No installed-app or live-data change occurred.

**Scope:** representative synthetic flows, not an exhaustive screen-reader,
per-cell navigation, accessibility-conformance, or security certification.
Native AX inspection corroborated table/currency exposure without logging rows;
no speculative table rewrite was made. `tests/manual/README.md` records the
chronology, isolation, exact commands and limitations. Continue with step17
integrated regression and lifecycle/performance evidence; installation remains
gated at step18.

## Step17: integrated regression and measured lifecycle checkpoint

**RUNTIME, local synthetic data only:** 1,819 unit tests passed across 141 files
with one pre-existing Electron-specific skipped case; four native process tests
passed separately without the Seatbelt process-list restriction. The first run
found 40 failures because two complete provider-module mocks omitted the moved
`THINKING_TO_REASONING` export. They now preserve real module exports and mock
provider registration/transport; no production routing or assertions were weakened.
Full rerun passed. Unit runs used temporary HOME, denied outbound network and
blocked the live app directory/Keychain; native process fixtures had no provider
operations. Exact logs: `~/.gg/bg/42a42fc0.log`.

### Current runtime measurements and comparisons

Measurements are on this Intel i9-10910 Mac, Node 22.16.0. They do not establish
installed-app startup, provider/model response latency, or an all-day memory bound.

| Surface / fixture | Earlier evidence | Current step17 observation |
| --- | --- | --- |
| SEO, same 18 requests with inert 20 ms transport, three samples | Serial 421/376/374 ms; bounded final 152/106/109 ms | 142/104/103 ms; max four simultaneous reads; 54 requests total. No Google/account traffic. |
| Three-second square/portrait/landscape preset previews | 5328/5171/5231 ms | 6154/5650/5855 ms. Separate run; no speed improvement claimed. |
| Corresponding verified MP4 renders | 7630/7952/8339 ms | 7887/8802/8845 ms. Sampled owned-process peaks 1276/1724/1700 MiB; not whole-Mac RAM. |
| Native render cancel, three cycles | 3338/3195/3334 ms whole-job time | 3380/3372/3537 ms whole-job time; no owned process survivors. Not cancel-only latency. |
| Finance 50k-row preview/cancel with worker restarts | Eight previews 981–1107 ms; rising RSS left unresolved | 16 restarts: p50 988 ms, p95 1051 ms; post-close RSS 145.4→146.7 MiB, last eight 146.2–146.7 MiB; zero worker MessagePorts after every close. |
| Finance 50k-row preview/cancel using one persistent worker | No comparable long-lived baseline | 32 cycles: p50 860 ms, p95 1031 ms; main-thread timer delay max 9 ms. Process RSS 141→222.6 MiB, last eight 218.9–222.6 MiB; main heap 4.5 MiB throughout warm cycles. |
| Budget/Connect Tools renderer, 40 open/switch/close cycles | Initial probe retained its own automation handles | Corrected probe: Chrome nodes/listeners 5556/213 unchanged; Electron 5532/213 unchanged after forced renderer GC. Heap growth 138,056 / 131,216 bytes, respectively. |
| Fresh-profile fixture startup and sampled warm Budget opens | No comparable full-app baseline | Chrome 981 ms / 32–43 ms; Electron 1309 ms / 20–48 ms. Nine warm samples per renderer; includes driver/fixture setup and inert IPC, not full application startup. |

**Memory limits:** process RSS remained 146.7 MiB after all finance workers closed,
versus 44.6 MiB before warm-up. This is not a return-to-baseline or leak-freedom
claim; allocator/runtime retention is a hypothesis, not a proven cause. The tail
of repeated worker restarts was bounded in this run, main heap finished at 4.7
MiB, and owned worker handles returned to zero. No production worker rewrite or
forced-GC workaround was added. The probe forces main-isolate GC only, not worker
GC. Source: `.gg/step17-worker-lifecycle.cjs`; measurements:
`~/.gg/bg/add3ac39.log`. Temporary synthetic stores were removed on completion.

**Renderer false positive:** each ignored Puppeteer `waitForSelector` result
retained an old connector card (45 nodes/four listeners per cycle). Disposing the
ElementHandle removed that measured growth, with the same unchanged regression
assertions. Earlier fixture selector/visibility errors were corrected against
existing panel code. No production UI performance change was needed. Retention
guards and opt-in commands live in `tests/manual/finance-ui.probe.ts` and its
README. Evidence: `.gg/finance-ui-YWyV9i` and `.gg/finance-ui-SvRBZM`; 14 Chrome
and 15 Electron cases passed, including 40-cycle guards and real Electron zoom.

**Video:** all seven native integration cases passed, comprising 18 operations
with zero sampled owned survivors. Covered metadata/aspect validation, preview
integrity, bundling/preview/render cancellation, repeated names, and recoverable
copy failure. Reused installed Remotion and sandboxed Chrome through a disposable
workspace; no downloads, paid generation, or external source changes. Evidence:
`.gg/acos-video-final-7E8Z6g-native.json`. The probe now creates unique reports
instead of overwriting its step10 baseline. Full integration/SEO log:
`~/.gg/bg/49b89c96.log` (20 SEO lifecycle tests also passed).

**CODE sweep:** finance remains a lazy single worker with an eight-request queue,
120-second watchdog, 256 MiB worker heap ceiling and explicit shutdown. Connector
polling stops when hidden; drafts and detail rendering are bounded. Reused SQLite,
Electron, themes and fonts; this checkpoint adds no runtime dependency, font,
renderer framework, model downgrade, or speculative cache/optimization.

**Unverified:** whole installed-app cold/warm startup; first real streamed response;
provider/content quality, live Search Console reconciliation, connected-account
health, full-workday/system-wide RAM and crash recovery across the entire app.
These require the protected operational gate or cost/account approval; synthetic
checks are not substitutes. No live routines, messages, financial imports or
public actions were run.

### Evidence-backed future-beta candidates (discussion only)

- Atomic memory compaction and approval fail-closed behavior: strong regression
  coverage; broader integration/user-workflow review still required before release.
- SEO authoritative totals and bounded reads, AEO coverage metadata: synthetic
  contracts pass; read-only live reconciliation/comparability remains outstanding.
- Hook selection handoff and recoverable/cancellable local video: rendered/native
  fixtures pass; representative real-brand content quality has not been benchmarked.
- Orbital Command: local visual/keyboard/VoiceOver evidence, not universal
  accessibility conformance or a decision to change beta users' default theme.
- Budget & Books: deterministic arithmetic/privacy/restore tests and bounded
  synthetic lifecycle evidence; longer sessions and accountant-reviewed packets
  should precede any wider financial feature release.

**Final verification:** `npm run typecheck`, `npm run lint`, and `git diff --check`
passed after the checkpoint's code changes (`~/.gg/bg/05b06579.log`). Step17 is
complete with the explicit measurement limitations above.

No beta release, push, deployment, subscription, or publishing action is authorized
by this candidate list. Only the rollback-capable local installation is next.

## Step18: personal update installed and verified

**Decision:** Brett explicitly approved private Apple submission: “you can submit
to apple if that is what you need to do. please do it”. This does not authorize
GitHub publishing, beta release, deployment, paid provider requests or live routines.
No signing/notarization or application/browser sandbox control was disabled.

**RUNTIME:** rebuilt with `BUILD_KIND=release npm run build`, then
`APPLE_KEYCHAIN_PROFILE=AC_PASSWORD electron-builder --mac --x64 --dir --config build/personal.cjs --publish never`.
The first guarded-startup candidate was signed with Developer ID team `2HQTY95NHD`;
the build log records successful Apple notarization. The hook verified 16 native
modules and 25,053 payload files. `install-local.cjs --validate-only --no-launch`
passed source/staged signature, Gatekeeper, architecture, manifest and copy checks.
Result: **validated-not-installed**. Candidate manifest:
`2a780317bf8a46335337d77b66ce877db8db77d35129683d96ac3538afe37ee5`.

**CODE + synthetic tests:** credential injection avoids logging values/fragments
and substitutes literals safely. Personal payload inspection rejects private data,
dotenv files, logs/caches, escaping links and missing runtime/policy metadata.
Installer fixes put the executable before `lipo -verify_arch` and prefix literal
`codesign -R` requirements with `=`. This Mac returns launchctl status 113 plus
`Bad request.` followed by the exact service/domain absence diagnostic. Reproduced
the false refusal with that output, then accepted only that exact variant or the
original exact form. Wrong service/domain, permissions, standalone Bad request,
unexpected stdout, wrong exit codes, queued jobs and running legacy still refuse.

**CODE:** personal metadata includes `acosInstallValidation: 1`. Installer launches
set process-only `ACOS_INSTALL_VALIDATION=1`; unsupported candidates are rejected
before replacement and again before launch. The app requires personal update policy,
reports the temporary mode in health and a local notification, and pauses automatic
MCP, scheduler, Telegram, browser reconnect and model discovery. Verification keeps
the configured model instead of resolving/persisting a fallback. Normal launches
retain normal behavior and saved service settings. This pauses automatic startup;
it is not a general network sandbox or permission to exercise live IPC/tool actions.
Installer health now requires validation mode. Full quit and ordinary reopen resume
normal services; do not automatically reopen normally during verification.

**RUNTIME:** 83 targeted updater/packaging/installer/credential/payload tests passed
under outbound-network/live-data/Keychain denial. Typecheck, lint and whitespace
checks passed after the main-process change. An inert packaged-executable smoke
check verified emitted updater/validation policy, app/Flo native SQLite and packaged
finance worker/migrations under network/live-data/Keychain denial. Only temporary
synthetic data was used, not normal app startup or live integrations.

**RUNTIME — private recovery checkpoint:** machine-recorded start
`2026-09-06T14:35:00.851Z`, under
`~/Library/Application Support/acos-local-improvement-backups/checkpoint-step18-RaqlEs`.
Runtime UID, executable and open database matched the installed app and expected
userData. SQLite-consistent snapshot restored into a separate sentinel store with
matching schema/data fingerprints: 19 tables, 610 rows; 27 ms restore/verification,
67 ms backup/drill. Nine persistent roots / 39 entries copied/restored with matching
manifests in 94 ms. Previous bundle copy/verification took 38,697 ms; manifest
`c21d3381a199ea3ce46e9b9978834db5097012c318e89a3ee4406d2033a4febb`.
Finance store was absent; none was fabricated. Earlier checkpoint
`checkpoint-step18-rJ6m9H` remains retained. No restore touched live data.

Seatbelt refuses `ps` execution. Initial checkpoint attempts stopped before snapshot
creation. Process discovery now runs read-only outside that wrapper; `lsof` rechecks
the supplied PID's UID, exact executable and open database inside it. Snapshot,
restore and file-copy operations retain network/Keychain denial. Copies exclude
Chromium caches, cookies, transient locks and Keychain, are not cross-store atomic,
and do not protect against loss of this Mac.

### Completion evidence (machine date: 2026-09-06)

**RUNTIME — resolved legacy gate:** Brett quit the old app. The exact-process census
returned no owned processes and the queued-updater checks passed. A fresh stopped-data
checkpoint was created under
`~/Library/Application Support/acos-local-improvement-backups/checkpoint-step18-LQMpoJ`.
It preserved 19 tables / 614 rows, with a matching separately restored fingerprint:
25 ms restore/verification, 66 ms database backup/drill, 82 ms persistent-file copying
and verification, and 37,961 ms previous-bundle copying/verification. All sensitive
backup operations retained network/Keychain denial. The earlier runtime-confirmed
userData path was retained and stopped database handles were checked with `lsof`.

**RUNTIME — startup regression found and fixed:** the first installation attempt
failed its startup-health deadline. The installer restored the previous bundle and
retained the rejected candidate; no live restore was performed. A synthetic Electron
main-import probe reproduced an ESM missing-export error before application startup.
The preload CommonJS compilation was overwriting shared ESM modules reached through
type-only imports. `tsconfig.preload.json` now emits into ignored `.preload-build/`;
the existing post-build script stages only the four preload output files into `dist`.
The compiler regression test failed before this change and passed afterward, including
a real Node ESM import. Both current build/dev callers follow this corrected path.

**RUNTIME — replacement build:** a clean release-mode build passed, followed by the
same personal packaging command with `--publish never`. Apple notarization succeeded
again; native and payload gates passed. All 84 targeted updater, installer, credential,
payload and preload-build tests passed, as did typecheck, lint and whitespace checks.
The packaged policy/native SQLite/finance smoke passed again. The full packaged-main
import also passed with a temporary profile and live-data/Keychain/network denial.
That import probe is not a renderer test: an unused Chromium child reported a nested
sandbox initialization refusal during fixture teardown; no sandbox was disabled.
The installed application was verified separately outside that synthetic wrapper.

**RUNTIME — installed:** `install-local.cjs --install --launch` returned
`installed-ready`. The installed Developer ID/Gatekeeper/architecture checks passed;
its complete bundle manifest matched the rebuilt candidate:
`d1d211a0ffe7832fa66fd47941239cffe082c0b0ec1cf7967c49509835f51a43`.
The previous installed bundle remains at `/Applications/.acos-install-lQ5dIf/previous.app`.
The prior failed candidate remains in `/Applications/.acos-install-q1LRt7/failed.app`.
Base version remains `1.0.0-beta.25`; this is a personal build, not a new beta release.

**RUNTIME — startup and preservation:** the installed process opened the expected
live database under UID 501. Its fresh health record reported validation mode,
SQLite loaded, IPC registered, initialization complete and no startup error. A
read-only comparison against the checkpoint found no missing or changed original
rows in any of the 18 non-`sqlite_%` tables, including stored settings/model/theme,
messages and scheduled jobs; credential and MCP configuration files were byte-identical.
SQLite integrity checks passed. The native window server reported the app window
on-screen, and its renderer process was present. The bounded native accessibility
probe exposed menu roles but not renderer controls in this session; it does not add
a live-renderer accessibility claim to the prior synthetic/manual Step16 evidence.
No provider request, financial import, message, post or scheduled routine was used
as an installation test.

**Initial handoff (corrected):** the 18 steps were reported complete after the
installation gates passed. That did not establish functional chat acceptance.
The handoff used process-only verification mode; Brett subsequently reopened
normally. Local-only scope and preserved VoiceOver evidence remain unchanged;
no public release, Git commit or push occurred.

### Post-install repair: confirmed provider rejection, not yet repaired

Brett reported the unchanged appearance and broken features, then authorized
repair. The active process belongs to the new installed bundle, not either rollback
candidate. Its current health record reports validationStartup=false. Per-app
accessibility support was enabled using Electron's documented AXManualAccessibility
attribute (no system VoiceOver change); a native Budget & Books navigation action
succeeded and exposed the ledger heading. This verifies navigation, not every
ledger workflow. The saved tsai theme explains the intentionally preserved shell.

Only structured provider diagnostics from the two failed assistant responses were
examined; private chat text and credentials were not printed. Anthropic rejects the
selected claude-fable-5-1 because the OAuth client identifies as Claude Code 2.1.75;
the error requires 2.1.251 or newer. Both the current and preserved old SDK bundles
contain the same 2.1.75 identity. When the server requirement changed is unknown.

`.gg/repair-installed-ui.cjs` runs the installed HTML and actual preload with the
real trusted-IPC boundary, a temporary profile, renderer network/file filtering and
synthetic service handlers. It confirms the bridge, startup class and exported
chat/budget functions, not a successful chat response. Unimplemented service stubs
are reported rather than treated as production failures.
`.gg/repair-auth-transport.cjs` replays the provider rejection with the actual SDK,
fake credentials, fake fetch and OS network/live-profile/Keychain denial. OAuth
reproduces the rejection (red); API-key mode completes only a synthetic response.
No live provider request or billing was used to infer this result.

No client-identity spoof, model downgrade, credential change or library upgrade was
applied. Current SDK latest metadata/source was inspected without installation;
its default OAuth identity is still stale, so a blind upgrade is not a proven fix.
Brett explicitly selected subscription-only repair: keep the existing Claude Max
and ChatGPT logins, with no separately billed API-key route. Read-only presence
checks confirmed both OAuth connections in the current and pre-install databases;
OpenAI access, refresh, account and expiry fields are present. Tokens were not
printed or copied into a separate client. The existing OpenAI strategy uses the
ChatGPT/Codex route when OAuth is selected and does not fall back to an API key
when refreshing that session fails. Current official Codex model documentation
lists GPT-5.6 Sol as a capable subscription option for complex work.

Native navigation included New Chat and opening the model selector. Model selection
could not be automated reliably: a successful AXValue return did not change the
stored model. A read-only follow-up confirmed Sol was not selected and OpenAI OAuth
was still selected. No automated test message was sent at that point. Brett later
manually selected GPT-5.6 Sol and confirmed: “I switched and it worked great.”
The diagnostic replay was tightened so changed OAuth identities cannot create fake
successful results; UI-entrypoint and native-action failure checks were tightened
as well. At Brett's subsequent explicit verification request, both JavaScript
syntax checks and all three Swift typechecks passed. The isolated installed-UI
probe passed its scoped bridge, ready state and chat/budget function checks;
expected synthetic service-handler errors remain outside that limited coverage.
Strict network-denied transport checks reproduced the recorded OAuth rejection
and rejected an unknown client identity. The unknown-identity assertion initially
exposed SDK wrapping of fetch exceptions into a generic connection error; the
helper now retains its own guard reason separately. Both strict replay checks
passed after that change, with the diagnostic's expected failing OAuth exit status
preserved. No live provider request or native UI mutation was used. Passing Swift
typecheck does not establish working native selection; that limitation remains.

Anthropic's current [authentication policy](https://code.claude.com/docs/en/legal-and-compliance)
does not permit third-party Claude.ai token intermediation. Do not conceal this by
changing only the advertised client version. ChatGPT subscription chat now has
Brett's direct acceptance; the Claude incompatibility has not been repaired.

**Limitations:** prior production audit identified transitive dependency advisories;
no blanket upgrade was applied. Beyond Brett's successful chat, connector health,
network latency, live reporting, normal autonomous routines and universal
accessibility/security conformance remain unverified.

## Installed-workflow acceptance continuation — 2026-09-06

**RUNTIME:** `.gg/repair-installed-ui.cjs` now exercises installed HTML and preload
with real trusted finance/approval IPC and the real finance worker. It uses a new
private synthetic profile, an inert renderer proxy/file filter, denied Node fetch,
synthetic settings/sessions/chat transport and controlled native-dialog responses.
It does not launch the app's main process, scheduler or live connectors.

Latest evidence: `.gg/installed-workflows-ioYAsC/result.json` and `last-state.png`.
All 12 scoped checks passed:

1. A finance catalog request from a hidden owner is refused; this is not a
   separate hidden-window write attempt.
2. Native confirmation options default to Cancel; denied entry reports cancellation
   and preserves its amount field. Accepted entry displays the exact synthetic amount.
3. CSV preview marks one invalid row; keep/skip decisions yield two total ledger
   entries. This probe does not inspect the committed row identities.
4. Confirmed export creates one entry in the private destination; packet contents
   and completeness are not asserted by this probe.
5. Finance AI preview names the selected model and excludes the synthetic manual
   entry description; Deny ends the operation without a provider fetch. This probe
   does not exhaustively assert aggregate-only fields or the no-tool policy.
6. Hook Lab preserves exact saved elements through remove/undo and video handoff;
   handoff opens review without generation and markup remains literal text.
7. Full/quick/rewrite prompts reach the intended synthetic Hook Lab conversation.
8. Video Studio planning carries the exact selection, retains the pending draft
   and does not render, install dependencies or call a provider.
9. SEO kickoff equals the actual shared backend definition.
10. Every installed theme ID updates the renderer dataset and synthetic setting.
    This is not a visual-quality check of every theme.
11. Saved selection, pending draft and real synthetic finance rows survive reload.
12. Installed startup and real preload complete with no captured error-level
    console messages or preload errors; this is not exhaustive exception coverage.

Zero unsupported fixture calls or attempted non-data fetches. One blocked local
data-URL fetch originates in Yoga's bundled WASM loader; it is not a provider call.
The initial probe used `new Function`, which the installed CSP correctly rejected;
the harness now supplies its fixed polling function directly through Electron's
existing evaluation API, without changing CSP. Other probe corrections matched
the actual approval-modal selector, session-create response and full-hook prompt.
No product bug was inferred from an inaccurate fixture.

**Boundary:** finance operations above were real but confined to synthetic records.
Chat dispatch/settings were synthetic, not evidence of live generation quality.
No live records, credentials, preferences, provider requests, Google/AEO calls,
scheduled jobs or external sends were used. No build, typecheck, lint, test suite,
dependency installation, app replacement or production-code change in this pass.
Finance-AI responses, live SEO/AEO reports, completed videos and connector health
are not established by these checks. Brett's ChatGPT success is separate user
evidence, not a claim derived from the synthetic transport.

### Follow-up code review (no execution)

Corrected stale chat-blocker wording and narrowed coverage claims to the actual
assertions. The diagnostic now derives its private profile from its own directory,
bounds asynchronous cleanup with a second deadline that writes failure evidence,
and rejects polling exceptions instead of waiting for the overall timeout. These changes were read
but not rerun; the recorded passing result applies to the preceding probe version.
No builds, typechecks, linters or test suites ran during this review.

### Requested verification after review

`node --check .gg/repair-installed-ui.cjs` and the updated isolated Electron
workflow probe both exited 0. All 12 scoped checks passed; normal cleanup
completed. Fresh evidence: `.gg/installed-workflows-suL2WQ/result.json` and
`last-state.png`. Zero captured console/preload errors, unsupported fixture calls
or non-data fetch attempts; the one blocked Yoga data-URL fetch remains local.
No live records or provider calls were used. This re-run does not broaden the
coverage claims above. Forced cleanup timeout and polling-exception branches
were not fault-injected.

## Finance output acceptance and subscription stream repair — 2026-09-06

Brett asked to continue. The expanded installed workflow passed **17 checks**:
`.gg/installed-workflows-tVlmia/result.json`. No renderer errors, unsupported fixture
calls, provider fetches, real records, credentials, schedules or external sends.

**RUNTIME, installed:** added source-row identity, exact transaction/allocation,
private file permissions and SHA-256 manifest checks. A USD 1,200 expense plus a
USD 20 refund yields USD 1,180 expense; USD 100 card payment remains a transfer;
USD 2,000 income stays income; USD 12.34 stays explicitly uncategorized. Monthly
USD 1,250 and annual USD 15,000 budgets independently produce favorable variances
USD 70 / USD 13,820. The statement reconciles to USD 707.66 with zero difference.
A saved scenario renders USD 1,300 / 1,600 / 1,900. A populated accountant packet
contains budgets/reconciliation and escaped literal category markup, leaving the
original packet and its hashes unchanged. The actual approval preview contains
exact anonymous aggregates and the pinned ChatGPT subscription destination, not
names, descriptions, identifiers or paths. Denial sends nothing.

**RUNTIME, defect reproduced:** installed `runFinanceAi` incorrectly returns
`complete:true` after a synthetic subscription stream closes without a terminal
event. gg-ai 4.3.151 Codex derives `end_turn` merely from absence of tool calls.
A fragmented CRLF fixture also exposed its LF-only SSE parser returning no text.
Both observations came from fake credentials and inert transports, not live calls.

**Source correction:** `src/finance/ai-worker.ts` normalizes Codex SSE line endings
and requires a terminated `response.completed`/`response.done` event with response
status `completed` before labeling analysis complete. The existing 2 MiB response
cap also bounds retained completion evidence. Closed/incomplete/missing-status
responses retain their partial text but are not marked complete. Routing, approval,
billing path and ledger data remain unchanged. This fixes the finance worker, not
the dependency's other callers.

**RUNTIME, corrected source:**
`node --experimental-strip-types .gg/repair-finance-stream.mjs` passed six examples:
closed connection, completed response, completed done, incomplete response,
incomplete done and missing status. Checks include exact subscription destination,
selected model, no tools/history/storage, redirect refusal, fragmented UTF-8/CRLF
and fetch-guard restoration. Evidence: `.gg/finance-stream-oVTkH6/result.json`.
Six matching regression cases were added to `tests/unit/finance-ai.test.ts`.

**Not run:** suites, typecheck, lint, builds, signing or installation, respecting
the requested `/commit` gate. No commit/push, dependency install, real credential
access or paid call occurred. The signed installed app still contains the defect;
required checks and guarded reinstall are outstanding. Never hot-patch that bundle.
Live SEO/AEO, connector health, generated-content quality and live finance-AI
acceptance still need specific consent. Existing renderer/kickoff checks and prior
native-video evidence are not a fresh end-to-end model-driven video check. All
probes in this continuation exited normally.

### Review follow-up — not runtime-verified

Code reading found the new terminal validator treated whitespace after `[DONE]`
as malformed JSON, although the installed adapter accepts it. Matched the adapter's
trimming and added a seventh subscription case to the regression file and offline
reproduction. The prior six-case passing artifact predates this correction.

The packet diagnostic now requires checksum/size metadata for every manifest file;
it no longer silently skips a missing hash. It also compares exact budget and
reconciliation CSV values, and records blocked external renderer requests separately
from main-process fetch attempts. The existing 17-check artifact predates these
changes. No builds, typechecks, linters, suites or probes ran during this review;
compiler cleanliness and revised-runtime behavior are not claimed. Product correction
and updated diagnostics still require the `/commit` checks before private rebuild
and guarded installation.

### Explicit verification gate after review — passed

The user subsequently requested verification of all four revised code files.
Completed after their latest edits:

- `node_modules/.bin/vitest run tests/unit/finance-ai.test.ts`: 11 tests passed.
  Direct Vitest uses the project config while avoiding the unrelated npm pretest
  hook that can rebuild native SQLite modules. This file needs no SQLite binding.
- `node --experimental-strip-types .gg/repair-finance-stream.mjs`: all seven cases
  passed; `.gg/finance-stream-4xhIFu/result.json`.
- `node --check .gg/repair-installed-ui.cjs`: passed.
- `npm run typecheck`: passed, exit 0.
- Isolated Electron `.gg/repair-installed-ui.cjs`: all 17 revised workflow checks
  passed; `.gg/installed-workflows-zvldgt/result.json`. Zero renderer errors,
  unsupported fixture calls, provider fetches and external renderer-request attempts.
  One blocked local Yoga data-URL fetch remains distinct from external network use.

No code changed after those checks; only these verification records were updated.
No full suite, lint, build, signing, commit, push or reinstall ran. Real data and
credentials were not used. The installed workflow probe covers installed UI/finance
IPC; the corrected stream worker was tested from source, not a rebuilt signed app.
Private rebuild/guarded reinstall and live-provider acceptance remain outstanding.

## Release continuation — corrected candidate verified, installation awaiting quit

After Brett said “ok so lets go”, `npm test && npm run lint && npm run typecheck`
passed: **101 files / 1,793 tests**, lint and typecheck, exit 0 (`642f74e2`). The
normal pretest verified the system-Node SQLite binding without rebuilding it.
`git diff --check` also passed. No product code changed during this continuation.

`BUILD_KIND=release npm run build` and the existing private x64 packaging command
(`APPLE_KEYCHAIN_PROFILE=AC_PASSWORD ... --dir --config build/personal.cjs --publish never`)
completed successfully (`cf1fc093`). Developer ID signing and Apple notarization
succeeded. Existing payload inspection checked 25,053 files and 16 native modules.
Build hooks warned about missing legacy Flo bindings shims; actual app/Flo native
SQLite checks subsequently passed, rather than treating the warning as proof of
failure or assuming it harmless. No Git commit, push, beta release or publishing.

The fresh guarded candidate validation (`12459b72`) returned
`validated-not-installed`, manifest
`3f0e3e4432fd94ca9a194acb52d7216b6449863f735a08768d9c84fd4293a854`.
This checked candidate/staged signatures, Gatekeeper, architecture and copy
integrity without stopping the installed app. Packaged policy/validation mode,
app/Flo native SQLite, finance-worker/migration smoke passed (`54b52337`). The
existing offline stream diagnostic gained a fixed `packaged` target, without
changing its assertions; all seven cases passed against packaged code
(`.gg/finance-stream-TLnDQU/result.json`) and source
(`.gg/finance-stream-tVwJ0o/result.json`). No live provider calls were made.

The installed finance store now exists. The existing checkpoint helper previously
refused this condition; it now checks ownership and uses the existing
`FINANCE_IDENTITY` backup/restore helpers in a separate checkpoint subdirectory.
It restores only a disposable copy containing a sentinel, compares full schema/data
fingerprints, and emits verification booleans/timings, not finance values. Stopped
mode additionally refuses open finance handles. No live database was restored.
Runtime checkpoint (`722f43ef`):
`~/Library/Application Support/acos-local-improvement-backups/checkpoint-step18-2eeE6K`.
Main restore/verify 26 ms, finance 15 ms; persistent file restore/verify 92 ms;
previous bundle copy/manifest check 44,121 ms. Backups remain local to this Mac,
exclude the previously documented transient/Keychain roots, and this running-app
checkpoint is not cross-store atomic. The running-app checkpoint path executed
successfully; the new stopped-finance refusal branch awaits quiescent execution.

**Boundary:** installed app still running after validation; no stop signal,
replacement or relaunch occurred. Await explicit user quit, take a fresh stopped
checkpoint, install via the guarded installer in paused validation mode, then check
main/finance data and configuration plus installed stream/workflow behavior.
The current installed app still contains the old stream defect. Live-provider,
connector/content-quality acceptance and Claude compatibility remain pending.
All background commands in this continuation finished; no hidden work continues.

## Installation attempt after confirmed quit — safely refused by updater guard

Brett replied “closed”; exact-bundle process census confirmed AI Chief of Staff
closed. The stopped checkpoint completed (`e0ff6f1e`):
`~/Library/Application Support/acos-local-improvement-backups/checkpoint-step18-37gnp0`.
Both restored database fingerprints matched, including finance identity/schema;
main restore/verify 26 ms, finance 15 ms, persistent file restore 92 ms, original
bundle copy/verification 36,050 ms. No live database was restored. The stopped
finance path successfully verified absent open handles; its rejection branch was
not fault-injected.

Guarded install (`91da34b4`) exited 1 before any replacement or launch:
`Possible queued updater helper; reconcile before installation, do not bypass`.
Read-only process inspection identified Windsurf's Squirrel ShipIt executor
(PID 71307), with Windsurf still running. No unrelated process was signaled or
stopped, and no installer check was bypassed or relaxed. User must save Windsurf
work and finish its update/quit it before retrying; AI Chief of Staff stays closed.

Prepared `.gg/step18-installed-data-check.cjs` to reuse its existing read-only
original-row comparison for both app and finance stores, additionally checking
finance presence, application ID and foreign-key integrity. No record values or
credentials are printed. This helper extension is **unrun**: the installer cannot
reach post-install verification while the updater guard is blocking. No passing
post-install, compiler or preservation claim is made for that edit. Previous tests
and packaged checks do not substitute for running the revised installed-data probe.
`node --check .gg/step18-installed-data-check.cjs` passed syntax validation only.

The verified candidate and both old/new checkpoints remain retained. No app
replacement, validation startup, live provider call, commit or push occurred.
All commands launched in this attempt exited; resumption needs the user's action.

## Corrected build installed after Windsurf quit — live acceptance pending

Brett confirmed Windsurf closed. Read-only census verified no AI Chief of Staff
processes and no matching updater helpers. The existing guarded installer then
returned `installed-ready` (`edcdd195`), without any bypass or force-kill. Rollback
bundle: `/Applications/.acos-install-0dYpOC/previous.app`. Installed app started in
validation mode; automatic services remain paused.

**Preservation result is not an unconditional pass:** the extended read-only helper
ran (`f4d8a7c8`) and returned 2 for exactly one changed settings row. All original
finance rows, app records outside that row, Google/MCP configuration, database
integrity, finance foreign keys and validation startup health checks passed.
Subsequent value-free comparison identified only `window.chatBounds`, changed in
its value and updated_at. Numeric inspection found identical width/height
(1450×1253) and changed coordinates: (1263,30) → (1550,809). The window factory saves
bounds on move/resize/close; the specific cause of that movement was not established.
No settings were reset, no changed record was suppressed, and the strict assertion
was not weakened. Separate byte comparisons found all 3 original workspace files
and all 10 original attachments unchanged. No private record/credential values
were printed; only numeric window geometry was inspected.

Because the strict preservation command stopped its `&&` chain, the installed
stream reproduction was run separately. All seven cases passed against installed
code: `.gg/finance-stream-9zSVwr/result.json`. All **17** revised isolated installed
UI workflows passed (`7679c7ef`): `.gg/installed-workflows-UIOuPY/result.json`.
Zero renderer errors, unsupported fixture calls, provider fetches or blocked
external renderer requests; one separately counted blocked local Yoga data-URL
fetch. This checks the actual installed correction, not just source or packaging.
No product/diagnostic code changed during this installation pass.

**Next boundary:** explicit permission for one synthetic finance-AI request via
Brett's existing ChatGPT subscription, with no real financial records or API-key
billing. That permission is not yet given. No live AI/Google/Telegram/routine calls
were made during verification. Live content/connector acceptance and Claude
subscription compatibility remain pending. Do not resume normal automatic services
or describe the full plan as complete without the remaining acceptance decisions.
All verification commands exited; the corrected installed app remains running in
validation mode. No commit or push occurred.

## Approved synthetic subscription check — blocked at OS credential access

Brett approved exactly one synthetic finance-AI request. Added an ignored local
helper `.gg/repair-live-finance.cjs`, not product code. It uses installed finance
code, canonical aggregates from the existing synthetic ledger, a private Electron
profile and read-only access to six selected OAuth/model settings. It never reads
an API key or refresh token, writes real settings, initializes the real ledger,
or supplies chat history/tools. Exact destination/model/message/prompt/credential
checks and an exclusive consumed-approval marker precede its sole permitted fetch.
No automatic retry after a consumed request is allowed. Response text stays in a
private JSON evidence file and is refused if it echoes the selected credentials.

Initial metadata inspection found the expiry encrypted as well as the access token;
a false raw numeric comparison is NOT evidence that the token expired. The helper
uses safeStorage to decrypt it, matching the installed app's configured name using
Electron 43.3.0's actual initialization behavior. Package source resolution failed;
official versioned Electron source was read instead. No OAuth client identity,
credential protection or OS authorization policy was changed.

Preflight `d11f16a9` blocked beyond the in-process timer. Sampling only static
credential-access stack frames established a synchronous Keychain content read
(SecItemCopyMatching / SecKeychainItemCopyContent). Read-only accessibility showed
a SecurityAgent window with four buttons and one text field; no password value,
full prompt content or private conversation was read. No OS authorization button
was pressed. The preflight task was stopped; its remaining exact Electron PID
79521 subsequently received SIGTERM. The real installed app was left running.

After `node --check` passed, approved task `5967e9a7` launched with an external
300-second watchdog. Last observed waiting for Keychain access, without a consumed
request marker or any analysis request sent. This is NOT a successful live test;
helper boundaries beyond credential access remain unexercised. User must unlock
the macOS prompt and choose Allow for this use, not grant permanent Always Allow
access or send a password in chat. Check task outcome and the consumed marker
before any resumption; do not resend an analysis without authorization. Real
services remain paused, and no live connector/provider acceptance is claimed.

Before any request was consumed, the first approved diagnostic was stopped at its
exact owned Electron PID 81046. Moved its model-response timer after credential
access so waiting for macOS cannot exhaust that timer. Syntax passed again; current
approved task is `2fc60324`, still with an external 300-second watchdog. The one-use
request marker was confirmed absent before restart; no extra provider request was
spent. Live transport/response verification remains blocked on the OS prompt.

**Completion-gate cleanup:** read `2fc60324` output and waited through its watchdog.
The 300-second timeout emitted its stop notice, but SIGTERM did not interrupt the
native credential call. Verified the exact descendant Electron PID 82026 and used
SIGKILL only on that isolated read-only diagnostic. Collected completion output for
both approved tasks; PID checks confirmed all three diagnostic mains absent. The
real installed app was untouched. The consumed marker remains absent, so zero live
finance requests occurred. No diagnostic is being left running. Resume only when
the user is ready to handle a fresh macOS prompt, under the still-unused approval;
future watchdogs must escalate only for their exact owned child after a grace period.

**Review correction (not run):** moved supervision from an ad-hoc shell launcher
into `.gg/repair-live-finance.cjs`. Invoke it via Node; it spawns only the existing
repository Electron binary, refuses direct unsupervised invocation, and checks the
consumed marker before accessing credentials. The supervisor forwards cancellation
signals and escalates SIGTERM to SIGKILL after five seconds, using only its owned
ChildProcess handle, with a five-minute total deadline. No package download is
triggered. This addresses the observed stuck shutdown without touching the real
app or weakening Keychain access. This new supervisor has not been executed or
syntax-checked; prior syntax evidence predates it. No build/typecheck/lint/suite
or live call ran during review. All earlier diagnostics remain stopped.

**Explicit verification gate after that review:** a narrow offline check against
the actual script failed when a timed-out child exited gracefully with code 0:
the supervisor incorrectly reported success. Fixed stopping-state tracking rather
than relaxing the assertion. Re-ran `node --check` and ten offline checks; all passed.
Coverage: normal success, child failure, spawn error, timeout failure despite exit
0, five-second forced-stop escalation, idempotent SIGINT/SIGTERM cancellation,
consumed approval, invalid mode, and direct unsupervised invocation refusal.

The checks execute the real supervisor branch in Node VM with controlled child,
timer and filesystem-presence doubles. They do not launch Electron, touch Keychain,
or send a provider request. Verified source SHA-256:
`1ad19286668077da128fadbd641bcd8b776e8bb335473ed593d0b8cbd5d98fd3`.
This is offline control-flow evidence, not a successful OS credential or live-model
check. No code changed afterward; only verification notes were updated. All prior
diagnostics remain stopped, and the one-request approval is still unused.

## User-requested restart — access canceled, no finance request sent

Brett reported several unsuccessful attempts and explicitly requested a restart.
Ran `node .gg/repair-live-finance.cjs --approved-once` under the new supervisor
(`cee162d8`). It exited 1 normally, with macOS reporting
`NSOSStatusErrorDomain Code=-128 userCanceledErr` and the helper reporting
`Secure storage unavailable` while reading OAuth settings. Evidence:
`.gg/live-finance-XvWtN2/result.json`, `analysisRequests:0`, `httpStatus:null`.
No timeout kill was needed, and no diagnostic remains running. No product code,
stored credential, real financial record, or provider request was changed/sent.

This does not establish an incorrect password or broken ChatGPT login in the
installed app. Stop repeating the separate helper's Keychain prompt. The proposed
alternative is an in-app finance check using a clearly labelled sample budget/entity,
which would persist in the real app. Explicit permission is required for that change
to the no-live-finance-writes testing constraint; no sample has been created. The
single synthetic subscription request remains unused, and automatic services remain
paused. No claim is made that the alternative avoids authentication prompts or that
existing UI supports deleting the sample afterward.

## Explicitly approved sample ledger — created through installed UI

Brett showed the empty Budget & Books setup screen, then replied “yes create” to
creating “Sample — TEST ONLY”, with persistence and no bank/AI request disclosed.
A read-only preflight found zero existing ledgers with that name. Verified the
installed main PID (77513) and used a bounded native accessibility helper,
`.gg/repair-create-sample-ledger.swift`, scoped to that exact application bundle.
It found one Ledger name input and one enabled Review and create ledger button.

The first value assignment succeeded but its immediate readback was stale; an
inspection then observed the exact sample name. Added bounded readback waiting,
retaining the exact-name assertion. Re-ran prepare → review → confirm; all exited
0. Confirmation required native dialog JSON with exactly four keys: createEntity
action, valid UUID, exact sample name and personal kind. No generic approval button,
Keychain action, direct IPC call or direct database write was used.

Read-only postcheck verified exactly one matching personal ledger, zero accounts,
zero transactions, SQLite integrity `ok` and zero foreign-key issues. Standard
ledger initialization aside, no additional financial setup was performed. The
sample persists in the app as disclosed. No bank connection or AI request occurred;
no production code changed. All commands completed, with no background helper left.
At that checkpoint, further fake account/transaction setup and in-app analysis
remained pending. The following section supersedes that approval status.

## Approved fake-data population and installed subscription analysis — completed

**RUNTIME (2026-09-06):** after Brett approved population (“yes populate”), the
installed UI and native confirmations created one `Sample cash — NOT A REAL ACCOUNT`
USD account with zero opening balance, synthetic income `TEST ONLY — sample income`
(+2000.00, Income), and synthetic rent `TEST ONLY — sample rent` (-1200.00, General
expenses). No direct IPC or SQLite mutation was used. Read-only verification found
one sample ledger, one account, exactly two balanced transactions and allocations,
net USD 800.00, integrity `ok`, and zero foreign-key issues. All original finance
rows matched the stopped `checkpoint-step18-37gnp0` snapshot.

**RUNTIME:** category selection first failed with zero matches. Inspection showed
Chromium's focused web controls/menu were absent from the native application child
tree; option names were in AXValue, not AXTitle. The bounded helper now also scans
focused ancestors and matches exact option values. Native tab/disclosure roles and
numeric calendar-year values were matched to the installed controls. Both synthetic
transactions then passed selection, review, exact confirmation and database checks.
No product code or signed bundle changed.

**RUNTIME:** only after that verification, requested the in-app aggregate preview.
Verified its entire JSON against the expected synthetic-only annual report and
required `openai`, `gpt-5.6-sol`, and destination `https://chatgpt.com`. Read-only
settings inspection confirmed OAuth without accessing credentials. Consumed the
existing one-analysis authorization exclusively in
`.gg/finance-live-approval-2026-09-06.consumed`, then pressed **Approve once** in the
installed approval dialog. Never remove that marker or retry without new permission.
The separate Keychain helper was not rerun and no OS authorization was bypassed.

**RUNTIME:** installed output reported saved and non-partial. A read-only database
check found exactly one new approved aggregate and one complete saved finance
response. Its review correctly identified the synthetic USD 2000 income and 1200
expense, missing statement/receipt, September-only activity, anonymized expense
classification and accountant-review limitations. The model did not calculate the
USD 800 net; that number is independently verified ledger arithmetic. The sample
ledger and approved-aggregate chat remain in the app.

**RUNTIME:** original app rows matched except the previously documented saved-window
position setting; main integrity `ok`. Validation startup remains enabled and no
automatic services were resumed. No build, typecheck, lint or test suite ran during
this acceptance work. No real financial mutations, bank connections or API-key route
were used.

**UNVERIFIED:** exact HTTP attempt count/provider billing records were not observed;
one installed UI analysis invocation is verified, using the subscription route.
The app's existing approval notice permits up to three HTTP attempts. Broader live
SEO/AEO, connector/content-quality acceptance and Claude compatibility decisions
remain pending; this is not full-plan completion.

## Resumed checkpoint — local navigation and next live boundary

**RUNTIME (2026-09-06):** Brett approved continuing from the newer completed
checkpoint ("yes continue"). Reconfirmed installed PID 77513 and the native saved,
non-partial finance result before navigating. The consumption marker remains intact;
no additional AI analysis was invoked.

Added navigation-only Hook Lab inspection modes to the existing private Swift
helper. Through native accessibility, opened Hook Lab and found enabled idea,
brand, build-mode and duration controls; Build My Hooks was disabled. No input was
entered, draft saved, model invoked, or private field value printed. Returned to
Budget & Books with the same sample ledger selected.

**RUNTIME/CODE:** leaving Budget clears the inline AI result through
`budgetPanelDismissed`; returning therefore reports no inline saved-result notice.
This is not evidence of a lost saved chat. A separate read-only database check
confirmed exactly one new approved aggregate matching the synthetic totals and
one nonempty, non-partial saved finance response. Main integrity remained `ok`.
No regeneration was attempted to restore the inline display.

**RUNTIME:** strict preservation verification still exits 2, not a full pass:
exactly one original settings row differs. A value-free follow-up confirmed it is
only the previously documented `window.chatBounds`. All other original rows and
checked Google/MCP configuration files matched; finance integrity/foreign-key
checks and startup-health flags passed. Validation startup remains enabled and
automatic services were not resumed. No build, typecheck, lint or suite ran.

**RUNTIME:** non-secret settings still select `gpt-5.6-sol` and OpenAI OAuth.
File-presence-only checks found no ACOS Google token file, but found both legacy
Flo Google files and the TSAI brand profile. Their contents were not opened by
these presence checks; token validity, Search Console scope and live connection
health remain unverified. No reconnect, conversion or credential helper was run.

**CODE / next approval boundary:** the SEO sidebar button immediately starts an
AI report for all three brands; it is not passive navigation. Do not click it as
a readiness check. Recommend one explicitly approved, narrowly scoped installed
chat request for `fetch_seo_data` with `brandSlug: "tsai"`, `days: 28`, using only
Google Search Console and the selected ChatGPT subscription. That would transmit
TSAI's returned search metrics/query/page evidence to ChatGPT and may refresh the
existing Google login through the normal app route. No paid API, other brand,
publication, outbound message or automatic-service resumption is included.
Brett subsequently approved this single report ("approved"). It remains **unsent**:
pre-send inspection identified additional context not disclosed in that approval.
Broader AEO, connector, content-quality and Claude compatibility acceptance remains
pending.

**CODE — installed privacy boundary:** both source `ChatEngine.buildSystemPrompt`
and `/Applications/AI Chief of Staff.app/Contents/Resources/app/dist/agent/chat-engine.js`
(lines 638–666) add soul guidance, saved profile/brand context, remembered facts and
recent daily-log conversation context to ordinary desktop chat, including a new
session. A new SEO chat is therefore not a metrics-only transmission. A prompt
asking the model to ignore memory would not prevent those bytes being sent.
The earlier metrics-only disclosure was incomplete; do not treat the SEO approval
as permission to transmit that additional saved context. No SEO chat was created,
no Google/AI request was initiated, and no credential contents or personal memory
contents were inspected. No installed code or settings were changed. The existing
finance approval marker remains consumed and unrelated.

**Historical gate — satisfied below:** ask whether Brett also authorizes the normal saved profile,
remembered facts and recent daily-log context for this single SEO report.
If not, retain the metrics-only boundary; the normal chat route cannot meet it and
would need a separately scoped isolated implementation rather than a prompt-only
workaround. Do not restart services or run builds/typechecks/linters/suites here.

## Approved TSAI SEO report — saved in the installed app

**RUNTIME (2026-09-06):** Brett answered the saved-context consent request with
"yes save it". Proceeded with the single previously approved TSAI-only, 28-day
report, including the disclosed normal saved context, through the installed UI.
The app had 21 stored sessions (normal New Chat caps at 20), so reused a verified
empty, unlinked general chat without deleting or renaming any conversation.

The private `.gg/repair-live-seo.cjs` wrapper uses read-only SQLite for target and
non-secret OAuth/model checks, then invokes native Swift accessibility actions.
It never reads credentials or calls a provider directly. The native helper checks
active-chat identity, exact draft readback, no attachment previews and the idle
Send control; an exclusive `.gg/seo-live-approval-2026-09-06.consumed` marker is
written before the one Send press. Initial send-state validation stopped because
the runtime button title is "Send it!", not the HTML's initial "Pounce!" title.
After matching the inspected runtime label, exactly one UI submission was made.
Do not remove the marker or retry; the finance approval is independently consumed.

**RUNTIME:** native inspection confirmed the rendered "TSAI SEO validation" heading,
an empty composer and idle send control. Read-only DB verification found one user
prompt and one saved assistant report in the previously empty chat. The report
states `available`, no errors, final data, a three-day cutoff, exact current and
previous 28-day windows, property totals, query/page coverage and one computed
action. Unknown prior CTR/position and zero-denominator percentage deltas remain
unknown rather than fabricated. Actual search metrics/evidence stay in the saved
chat, not this repository. The report's recommendation was not executed; nothing
was published or exported.

**RUNTIME/CODE — preservation:** the strict checkpoint comparison returns 2.
Value-free field comparison narrowed differences to 13 fact-access timestamps,
the selected chat's activity timestamp and the previously known window setting;
full-text index storage also changed while indexed fact contents matched. Normal
`getFactsForContext` updates `last_accessed_at`, explaining the memory-read side
effect. No original message, fact content/importance, soul or daily-log content
changed; original finance rows and checked Google/MCP files matched. Main integrity
is `ok`, foreign-key issues zero, validation startup remains enabled, and services
were not resumed. No product/bundle changes, builds, typechecks, linters or suites.

**UNVERIFIED:** underlying tool-call/HTTP attempt counts and provider billing were
not instrumented. The wrapper verified the selected ChatGPT OAuth/GPT-5.6 Sol
route before sending, and the prompt restricted the run to `fetch_seo_data` for
TSAI; one UI invocation and a saved report are verified, not a full network audit.
Other-brand SEO, AEO, broader connectors/content quality and Claude compatibility
remain outside this completed report acceptance.

## Continued acceptance — Hook Lab output and connector preservation stop

Brett confirmed the SEO report looked good, then authorized continuing remaining
work. Automatic services and the no-paid-API restriction remained in effect.

**RUNTIME:** the installed Hook Lab Quick Pass produced one synthetic index-card
sorting draft through ChatGPT OAuth/GPT-5.6 Sol. The existing Hook Lab session had
two messages and a selected brand; both were preserved. Its brand was explicitly
matched in the UI before Build My Hooks. Empty idea/context fields, 30-second
duration and Quick Pass were verified. Native selectors were corrected for the
brand's displayed `(default)` suffix, foreground menu behavior and the numeric
accessibility value of the duration field. No request was sent on failed checks.
The independent `.gg/hook-live-approval-2026-09-06.consumed` marker was created
before the one Build press. Do not remove it to retry.

One new prompt and one assistant draft persisted. Native inspection confirmed the
four expected report headings and an idle chat. The response supplies one verbal,
text, visual, audio and caption element, a format recommendation, script and
editorial notes. Independent counting confirmed 73 spoken words / 29.2 seconds at
150 words/minute. **Editorial limitation:** its opener uses 15 words in a labelled
four-second slot (six seconds at that rate), and its CTA uses 12 words in a
three-second slot (4.8 seconds). Overall duration is not per-scene timing approval.
The draft is not publication-ready on that evidence; no media, publication, library
rewrite or Video Studio handoff was performed.

**RUNTIME:** Connect Tools opened and proposed adopting hand-managed entries.
The native dialog was matched and canceled, not approved. Eight connector status
cards rendered. The initial zero status counts were later found unreliable
because the helper read empty status text; see the correction below.
This is paused-service UI evidence, not proof that all connectors work or lack
credentials. No connect/reconnect/test button was invoked. The panel was closed,
which stops its UI status polling. No account labels, credits or secrets were
printed by the native inspection.

**RUNTIME — preservation failure requiring reconciliation:** the strict comparison
still exits 2, now including a byte and semantic difference in `mcp-servers.json`.
Exactly one of nine entries, `flo-docs`, changed `command`, `args` and `env`; its
new executable and arguments reference the installed app. No entry was added or
removed, no managed flag was added, other entries remain semantically equal, and
Google credential-file bytes match. Values and secrets were not printed. The
file's modification time is 467 seconds after Hook submission. The preservation
command is reproducibly red; no check was weakened and the file was not restored.

**CODE / unresolved cause:** the inspected status/detection handlers only read
configuration (the loader can tighten permissions), while the canceled adoption
handler adds metadata rather than changing command/args/env. The changed entry is
not the browser connector. These observations do not establish who wrote it.
At this checkpoint a concurrent user/other-session change remained possible.
The temporary gate was to ask Brett before further live requests or configuration edits;
do not attribute it to the app or overwrite potentially legitimate work without
evidence. This is not a successful full preservation result.

All original message/fact contents and fact count remained intact. Changed main
rows were limited to fact-access timestamps, the two report chats' activity
timestamps and the prior window setting; related full-text index storage changed.
Main integrity is `ok`, foreign-key issues zero and startup-health flags pass.

**Verification:** after the final helper edits, `swiftc -typecheck` and
`node --check .gg/repair-live-hook.cjs` passed; native close-panel/result inspection
passed. These are helper checks and installed workflow observations, not a fresh
full product suite/build or a provider-billing audit.

**Boundaries:** AEO remains unrun because its paid-batch implementation conflicts
with the no-paid-API requirement. Official Claude authentication policy was
re-fetched; the custom subscription client must not be repaired by impersonation.
Keep ChatGPT selected. An unmodified official Claude Code integration is a separate
potential implementation, not a tested capability here. Engineering guidance,
not legal advice; see the dated `COMPLIANCE.md` entry.

## Google access clarification and corrected status inspection

Brett confirmed granting access in the Google popup during validation. Preserve
that authorized access and the newer Google Docs configuration; no reauthorization
or rollback was requested. This reconciles the intended workflow, not independent
proof of which process wrote the configuration. A fresh value-free comparison
still finds only `flo-docs` different, with the same nine server names. Historical
byte equality remains false; its check was not relaxed or replaced.

**RUNTIME/CODE:** the native connector inspector had treated unreadable status
text as zero connected labels. A new guard failed with all eight statuses unreadable.
The fix reads nonempty values/labels and bounded text descendants, retaining that
fail-closed guard. The same installed-UI check then passed: eight readable cards,
one connected label, no connecting/failed/reconnect-needed labels. The earlier
zero count must not be used as evidence of disconnection. Nor does the corrected
count prove all eight tools connected. No account names, balances or secrets were
printed. The extra app-named PID was verified as a child of the installed UI
process; it was not killed as a presumed duplicate app.

Each inspection closed Connect Tools afterward. No connection, migration, OAuth
or model request was repeated. No settings/configuration file was written by this
continuation. Swift typechecking passed after the fix, and startup flags still
show validation enabled, initialization complete and no startup error. Full
DB integrity/preservation was not rerun in this clarification; the earlier content
preservation evidence stands with its explicitly recorded configuration/metadata
differences. All three one-use AI approval markers remain consumed.