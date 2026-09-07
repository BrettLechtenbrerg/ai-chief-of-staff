# Budget & Books — local accounting preparation

Source-only checkpoint: steps12–14. Native UI/consent wiring remains step15; the
installed app and real data have not been changed. Engineering guidance, not legal
or tax advice. Read `CONTEXT.md` for the settled finance vocabulary.

## Data and recovery

`FinanceDatabase` owns one private `userData/finance/finance.db` connection, inside
one finance worker. WAL, FULL sync, foreign keys, checked tables and checksummed,
additive migrations are used. Finance identity is distinct from application/chat
memory. Never edit an applied migration or restore a finance snapshot into memory.

Automatic backup eligibility is 20h, checked every 20 minutes while active; retain
up to 30 snapshots, not 30 guaranteed days. Target active RPO is 21h, extended by
sleep/failure. Pre-bulk snapshot failure prevents imports/void operations; post-save
failure returns the successful write with a warning. Old data and edit history stay
available through corrections/voids. Exact requests/imports can be retried without
creating another original. Stop the finance worker before a maintenance restore.
Restore drills use independent temporary stores; see the review log for timings.

Directories use 0700; database, sidecars, snapshots and export files use 0600.
These permissions are **not encryption**. Same-Mac copies do not survive loss of the
Mac. Receipt references are pointers: receipt originals are neither copied nor
covered by database backups. No off-machine backup or automatic sharing is added.

## Import and edits

- UTF-8 CSV, explicit comma/semicolon/tab delimiter, four-digit date convention,
  decimal convention, and signed/expense-positive/debit-credit amount mapping.
- At most 8 MiB, 50,000 source records, 64 columns, 7,000 encoded characters/record.
  Quoted newlines belong to a record; source record numbers are not physical lines.
- Exact integer minor units (0–4 currency digits, bounded to 9 trillion per value),
  no floating-point money parsing or automatic currency conversion.
- Worker-held preview expires after ten minutes; only 100-row pages reach the UI.
  Invalid rows need explicit exclusion; duplicate candidates need keep/skip review.
  Reviewed totals are recomputed by the backend before commitment.
- Original source cells are retained. Remove unnecessary account/tax identifiers
  from the CSV before import. No credentials or identifiers are required fields.
- Exact file + account + mapping identity is idempotent. Candidate fingerprints are
  not unique constraints: equal legitimate purchases can both be kept.
- Manual previews validate exact splits and reveal matching originals without
  writing. All allocations must sum to the signed original. Retried creation/entry
  identifiers bind the original inputs; stale allocation revisions are rejected.
- Commit is a single bounded transaction. Once commitment begins, cancellation is
  not a promise to undo it; inspect the result and use reversible batch void/restore.
  Canceling an uncommitted preview releases retained source data.

## Analysis

Only balanced originals from committed, non-voided imports contribute to category
actuals. Income stays signed; expenses reverse allocation sign, so positive expense
allocations reduce spending as refunds. Transfers/card payments are separate, not
expenses. Uncategorized flows and excluded originals remain visible as exceptions.

Reports are entity/currency/calendar-year specific. Monthly and calendar-year
budgets are independent comparisons, never summed. Expense favorable variance is
budget minus actual; income favorable variance is actual minus budget. Totals use
BigInt and cross UI/export boundaries as exact decimal strings.

Reconciliation compares the latest entered statement on/before year end with the
opening balance plus original account flows from the opening date through that
statement date. Pre-opening transactions are excluded from that calculation.
Opening balance precedes opening-date transactions; debt balances are negative.
Missing statements remain unavailable. Matching a statement does not prove that
all transactions have been imported or that the books are complete.

Recurring charges are candidates from at least three same-description/same-amount
positive expense observations with weekly/monthly/quarterly gaps. The heuristic
examines at most 5,000 description/amount groups and 64 observations/group and labels
limited coverage. Merchant rules create reviewable suggestions, not automatic edits.
Scenarios project only entered assumptions over 1–60 months, not bank forecasts.

Analysis ceilings: 200,000 originals/year, 500,000 allocations/year, 60,000 category/
month groups, 5,000 budget rows, 1,000 account aliases, and 2 million historical
reconciliation rows. Limits fail explicitly rather than silently return partial
money totals. Registers disclose truncation. Larger data needs a measured, paged or
incremental implementation before raising ceilings; do not relax accuracy checks.

## Accountant packet

Exports go to a user-selected local destination, each in a new private UUID folder.
They include accounts/opening balances, original transaction and allocation detail,
category/month totals, independent budget comparisons, imports/exclusions, receipt
index, reconciliation status, review exceptions, methodology and a readable HTML
summary. Originals/allocations explicitly mark inclusion/exclusion. No receipt files
or raw extra CSV cells are copied into the packet; source record lineage is retained.

`COMPLETE.json` is written last with source scope and artifact checksums. Without it,
preserve the incomplete packet and retry into a new folder. Existing packets are
never overwritten. Exporting does not approve publishing, emailing or sharing.
HTML is escaped with a restrictive CSP and no active scripts/resources. Formula-like
text is apostrophe-prefixed in CSV; numbers beyond spreadsheet precision are also
preserved as text. Import those values as text when using spreadsheet software.

All reports state accounting preparation, unverified import coverage, not audited
statements, tax advice or completed filings. An accountant decides formal treatment.
No bank connection, money movement or automatic tax filing exists in this module.

## Verification boundary

77 finance/shared-backup tests, typecheck and lint passed at step14. Native worker
fixtures exercised 50,000-row previews, cancellation, idempotent commit, reports,
exports and clean worker exit under network/live-data/Keychain denial. These are
synthetic backend checks, not a complete rendered-UI, legal or security certification.
Read `LOCAL-IMPROVEMENT-REVIEW.md` for timings, memory observations and later gates.
