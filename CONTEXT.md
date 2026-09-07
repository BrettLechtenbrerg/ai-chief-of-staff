# Domain glossary

- **Entity** — A separate reporting boundary, personal or business; not an application brand. Brett's current use is personal, one person, no business.
- **Original transaction** — An immutable signed inflow/outflow with source lineage. A correction voids and replaces it rather than rewriting its original fields.
- **Allocation** — A signed portion of a transaction assigned to an expense, income, transfer or uncategorized category.
- **Balanced allocations** — Allocations sum exactly to the original amount; this does not mean reconciled or complete books. Mixed signs are allowed (a net deposit can include income and a fee).
- **Refund** — A positive allocation in an expense category that reduces spending; not automatically income.
- **Import fingerprint** — Exact source-file identity; together with account and mapping identity, prevents repeated imports.
- **Candidate duplicate** — A matching normalized transaction requiring review; equal legitimate purchases must not be silently discarded.
- **Committed import** — An import with its expected rows present and allocations balanced. This does not establish complete account coverage.
- **Void** — Exclude a record from current totals while preserving its original data and history.
- **Reconciliation difference** — Calculated balance minus the manually entered statement balance; zero is not proof that every transaction is present.
- **Opening balance** — The account balance immediately before transactions on its opening date; debt is signed negative.
- **Favorable budget variance** — Budget minus actual for expenses; actual minus budget for income. Monthly and calendar-year budgets are independent, never added together.
- **Receipt reference** — A local pointer, not a copy or backup of a receipt. Missing references and unavailable referenced files are different exceptions.
- **Scenario** — A what-if calculation from entered balances, income and expense assumptions, not a prediction or verified bank balance.
