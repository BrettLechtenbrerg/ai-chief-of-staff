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

The report includes mention/citation rates, local-vs-informational splits, and competitor domains. Provider errors are recorded per query instead of silently changing the 25-question denominator.
