# AEO visibility setup

`fetch_aeo_visibility` measures monthly AI visibility for the configured PMMA, TSAI, or Brett brand set. Each brand config must contain exactly 25 unique buyer questions, a normalized brand domain, and the brand terms used for mention matching.

## Credentials

Add one or more provider keys in Settings:

- OpenAI
- Perplexity
- Anthropic

Keys are encrypted through Electron `safeStorage`, remain main-process-only, and are never written to `aeo-credentials.json`. A legacy plaintext AEO credential file is migrated once and deleted.

## Run

Ask ACOS to run AEO visibility for `pmma`, `tsai`, or `brett`. The tool determines the configured providers and shows an approval before paid requests start.

- One provider: up to 25 requests.
- Two providers: up to 50 requests.
- Three providers: up to 75 requests.

The approval states the maximum provider-request count and that provider charges apply. Scheduled, Telegram, or other unattended calls fail closed because paid-batch approval is unavailable there.

## Reliability and output

- Strict Zod config validation rejects missing, duplicate, malformed, or unknown fields.
- Each provider request aborts after 30 seconds.
- HTTP 429 and 5xx responses use bounded retry/backoff; cancellation aborts in-flight work.
- Progress heartbeats report completed/total request counts.
- Citations match only the normalized hostname or its real subdomains—not substring lookalikes.
- Reports are written atomically with `0600` permissions under `~/Desktop/AEO Operating System/<brand>/reports/<timestamp>/`.

## Coverage contract (schema 2)

These are **external search-assisted API proxy observations**, not ChatGPT/Claude/Perplexity consumer-app rankings or a model leaderboard. Configured models are unchanged.

- `summary.measurements` and `summary.perEngine[engine]` use **successful measurements** as the observed-rate denominator and expose requested/successful/failed counts. `measurementSegments` and each engine's local/informational fields use the same rule.
- `summary.anyEngine.{overall,local,informational}` measures prompts with a positive answer from **any** engine, not the fraction of engine calls that were positive. Rates divide by `observed` prompts (at least one successful engine); `requested`, `complete`, `partial`, and `unobserved` expose coverage.
- `mentioned`/`cited` are known-positive prompt counts. `mentionUnknown`/`citeUnknown` count prompts without a positive whose engine coverage is incomplete. Remaining requested prompts are known negatives. A positive from an independent engine survives other failures.
- `mentionRateBounds`/`citeRateBounds` give conservative lower/upper percentages over **all requested prompts**, including unknown outcomes. Bounds round outward and remain null without observations; an observed-engine rate alone is not a complete-engine estimate.
- No successful observations means **null**, never a zero rate. Compatibility `mentionRate`/`citeRate` aliases remain any-engine observed rates; `localTotal`/`infoTotal` now consistently mean observed prompts, not requested prompts. Read requested totals from `anyEngine`.
- `ok` is true only for complete observations; partial runs return `status: partial`, all-error runs `status: error`, both with `ok: false` and retained evidence. Cancellation rejects without writing a completed snapshot. A separate `persistenceError` discloses report-write failure.

Returned JSON and snapshots include `metadata`: schema/run/prompt-set versions, SHA-256 of the exact ordered prompt list, that list verbatim (there is no separate prompt generator), config hash, requested engine/model map, returned-model sets when provided, observation counts, and API disclaimer. Reports serialize coverage and metadata, with null-safe rate labels. Each run gets a unique UUID subdirectory under the month; prior results are not overwritten.

`areAeoRunsComparable(a.metadata, b.metadata)` requires schema 2, identical versions, exact prompts/hash, config hash, requested/returned models, and **100% measurement coverage**. Legacy, partial, differently covered, differently configured or missing-returned-model runs fail closed. There is no automatic delta calculator in this repository. External Visibility Edge import/rendering is outside this repository and is not verified for schema 2: consumers must handle null and honor this comparison gate before calculating deltas.
