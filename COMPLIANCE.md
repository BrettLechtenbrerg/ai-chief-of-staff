# Local Improvement Compliance Register

Snapshot: 2026-09-05 · GG Coder compliance-guard · **ENGINEERING GUIDANCE, NOT LEGAL ADVICE**

Source: `53fbb5b` plus authorized, uncommitted local-upgrade work.
Scope: dated inline checkpoints below, not a full application/legal review.
Earlier source-only/install and pending-verification statements describe their
original checkpoints; they were not re-verified in the 2026-09-06 auth-policy pass.

## Exposure profile

- **Confirmed:** only Brett's Mac is authorized; no release, deployment, beta upload,
  new subscription or publication. The installed application is unchanged.
- **Confirmed:** current video evaluation uses synthetic text in isolated temporary
  workspaces. No provider generation, real business videos or paid services were used.
- **Confirmed:** installed external Remotion packages report 4.0.484. They are reused,
  not bundled, downloaded or upgraded by the new render worker.
- **User-confirmed (2026-09-05):** Brett operates this personally, one person,
  no business. The pinned v4.0.484 license explicitly permits individual use;
  the ownership licensing gate is resolved for this local-only scope.
- Existing public beta operations, other jurisdictions, finance flows, media rights,
  and full accessibility/privacy coverage are outside this checkpoint, not certified.

## Findings

| ID | Severity | Trigger | Evidence | Obligation | Status | Guard |
| --- | --- | --- | --- | --- | --- | --- |
| VIDEO-LICENSE-1 | BLOCKER for production use if entitlement is missing | Intended business use of Remotion | CODE: installed version; official v4.0.484 license inspected | Establish Free License eligibility or existing Company License before business use; do not buy anything automatically | Resolved for user-confirmed individual operation; reconsider if ownership or distribution changes | No installation/release; version check rejects unreviewed Remotion versions |
| VIDEO-DISCLOSURE-1 | MEDIUM | Generated video drafts and a silent typography preset | CODE | Do not imply missing sound/visual directions were generated, publication approved, or editorial guidance predicts results | Draft-only prompts, tool notes, metadata summary and explicit preview step implemented; preset-specific runtime checks pending | Existing exact execution approval remains required; source tests |

## License evidence

Verified official sources on 2026-09-05:

- https://raw.githubusercontent.com/remotion-dev/remotion/v4.0.484/LICENSE.md
- https://www.remotion.dev/license (currently redirects to the repository license)
- https://www.remotion.pro/faq (current FAQ; includes announced v5 changes, so do not
  silently substitute its people/team wording for the pinned v4 employee wording)

The v4 license permits free use by individuals, for-profit organizations with **up
to three employees**, nonprofit/not-for-profit organizations, and qualifying
non-commercial evaluation. Other entities require a Company License. The license
also prohibits selling/relicensing a derivative of Remotion. A future beta or
redistribution needs its own review; this local work is not release permission.
Remotion 5 has announced license changes; do not generalize this v4 finding to it.

## Implemented / evaluated

- The worker currently supplies no license key and makes no license-usage purchase.
  Synthetic preview/render evaluation does not establish permission for subsequent
  business use. No existing license key was requested, read, written or transmitted.
- Installed API/types were inspected directly after `source_path` failed on the
  packages' malformed monorepo repository URLs. This is not an advisory audit.
- A three-second synthetic video was rendered and measured separately from its
  AAC-padded container duration. That is runtime rendering evidence, not legal evidence.

## Ownership gate resolved

Brett confirmed: “this is operated by one person. me no business”. Individual
eligibility follows the official pinned v4.0.484 license re-fetched in this session.
No purchase, credential or subscription is required for that stated scope.
This is not permission to distribute a beta or certify another owner's use.

## Needs vendor/legal clarification if ambiguous

Entity aggregation, contractors/employees, client work or redistribution edge cases
should be clarified with Remotion or counsel. Do not infer those legal facts from
brand names, connected accounts or a local-only installation.

## Re-verify before relying

Re-check entitlement if ownership, intended distribution or Remotion version
changes. All changes remain source-only until the plan's final installation gate.

## Finance checkpoint (steps12–14, 2026-09-05)

Engineering guidance, not legal advice. Scope extends to Brett's local, personal
accounting-preparation feature on the authorized uncommitted source. This is not
an assessment of public beta users, tax treatment, or a regulated advice service.

| ID | Severity | Trigger | Evidence | Obligation / control | Status |
| --- | --- | --- | --- | --- | --- |
| FINANCE-CLAIMS-1 | MEDIUM | Financial summaries, budgets and scenarios | RUNTIME | Deterministic arithmetic; explicit incomplete-coverage and accounting-preparation labels; no audited/tax/filing claims; forecasts are entered what-ifs | Backend/export and visible UI labels exercised with synthetic records in step15 |
| FINANCE-PRIVACY-1 | HIGH | CSV originals and receipt references can contain identifiers | CODE | Private local database/backup/export modes; no automatic provider/index/memory ingestion; immutable originals retain source cells, so users should remove unnecessary identifiers before import | Step15 IPC/aggregate-only consent and hidden-chat attachment regressions passed; no live provider/raw finance data used |
| FINANCE-EXPORT-1 | HIGH | Accountant packets opened by browsers/spreadsheets | RUNTIME | Escape HTML; emit restrictive CSP; neutralize formula-like text; protect numbers beyond spreadsheet precision; unique packets and completion manifests, no overwrites/sharing | Synthetic injection and interrupted-export tests passed |
| FINANCE-STORAGE-1 | MEDIUM | Sensitive local files and pointers to external receipts | RUNTIME | Permissions are not encryption; local snapshots do not survive loss of the Mac; referenced receipts are not included in database backups | Disclosed in methodology; finance restore tested on synthetic stores |

Confirmed: no bank login, credentials, account-number field, money movement,
automatic sharing or filing is implemented. Existing CSV extra columns may contain
sensitive data; retaining source lineage is not data redaction. No real finances
were read, imported, exported or sent. Native destination/AI consent and complete
UI accessibility were later integration gates at that checkpoint, not verified by those tests.

Step15 follow-up (same authorized source lineage): 94 focused tests and three
real-renderer/synthetic-SQLite browser probes passed. Native dialog/approval tests
use inert Electron stubs. The real AI adapter was tested with a fake transport:
aggregate only, pinned HTTPS destination, no tools/history, and output limits.
No live provider call, financial import, identifier or receipt was sent. The UI
retains accounting-preparation/unknown-coverage disclosures. Complete native
assistive-technology and accessibility verification remains step16; no conformance
or legal-certification claim follows from these checks. Engineering guidance only.
Reassess licensing/privacy obligations before distributing this feature or changing
its personal-only scope; an accountant determines formal reporting/tax requirements.

## Claude authentication boundary (2026-09-06)

Engineering guidance, **not legal advice**. Source: `53fbb5b` plus authorized local
changes; scope is this private installation, not a fresh review of prior findings.
Official [Claude Code authentication policy](https://code.claude.com/docs/en/legal-and-compliance)
was fetched again on 2026-09-06.

| ID | Severity | Trigger | Evidence | Required boundary | Status / guard |
| --- | --- | --- | --- | --- | --- |
| CLAUDE-AUTH-1 | HIGH | Legacy third-party subscription OAuth integration | CODE: earlier local transport rejection; current official policy distinguishes native Claude Code from third-party login/token intermediation | Do not impersonate Claude Code, modify its authentication, collect/intermediate Claude.ai tokens, or switch to billable APIs without authorization | Kept the validated ChatGPT subscription selected; no Claude request, credential change, client-identity edit or API fallback performed |

The current policy permits users to sign in to an **unmodified official Claude
Code binary** with their own subscription, including permitted hosted/product
arrangements under the stated terms. This is not permission for this app's legacy
custom OAuth client. A future official-binary integration would need separate
implementation and a scope/terms check; it was neither implemented nor tested here.
Do not claim that all possible subscription-backed Claude integrations are banned,
or that the existing custom integration is now supported. Seek Anthropic/legal
clarification for an ambiguous private-use arrangement rather than spoofing identity.
Re-verify this time-sensitive policy before implementing or distributing a route.
