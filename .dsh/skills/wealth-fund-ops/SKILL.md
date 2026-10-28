---
name: wealth-fund-ops
description: Fund administration and wealth operations checks - position reconciliation against the custodian, NAV tie-out with level 3 and stale-price flags, LP capital statement roll-forwards, and month-end close tracking - plus guidance for accounting and regulatory reporting that the engines do not perform.
catalog_ids: ["T019", "T023", "T095", "T096", "T097", "T098", "S028", "S029", "S030", "S055", "G087", "G088", "G089", "G090", "G091"]
---

# Wealth Fund Operations (`wealth-fund-ops`)

This skill pack equips AI agents (**Claude Code, Devin, Cursor, Antigravity, OpenAI Codex**) to run the mechanical checks in fund administration and wealth operations - reconciliations, NAV tie-outs, investor statement reviews and close tracking - and to route every exception to the people who resolve it.

---

## When to Activate

Trigger this skill when the user asks to:
- Reconcile book positions against a custodian or administrator file.
- Check whether a fund's NAV ties out, or review a valuation for level 3 exposure and stale marks.
- Audit an LP capital account statement.
- Report where the month-end close stands.

---

## Engine-Backed Capabilities

| Capability | Engine function | CLI |
|---|---|---|
| Position reconciliation: quantity, value and missing-position breaks | `reconcileLedger` | `fundops reconcile` |
| NAV tie-out with level 3 share and stale-price flags | `tieOutNav` | `fundops nav-tieout` |
| LP capital account roll-forward, unfunded commitment and fee-rate checks | `checkLpCapitalStatement` | `fundops lp-statement` |
| Month-end close progress, overdue tasks and dependency readiness | `trackCloseChecklist` | `fundops close-status` |

## Guidance Only (No Engine Support)

- General ledger posting, journal entries and accrual calculations
- Fund accounting systems such as SS&C Geneva
- Regulatory filings such as Form 13F, N-PORT and N-CEN
- Valuation methodology review and fair value committee work
- Custody Rule surprise examinations

## Limits to State With Every Result

- Reconciliation matches on account and security exactly as supplied; it does not map identifiers or apply corporate actions.
- NAV tie-out recomputes from the supplied assets and liabilities; it values nothing itself.
- Statement checks confirm the arithmetic and consistency with fund terms, not that the underlying values are right.
- Nothing here posts entries or strikes a NAV. Results go to the administrator or controller.

---

## Conversational Use

Every CLI and MCP result carries two fields for the conversation itself:

- **`needsInput`** - questions to put to the user before the answer is usable. Ask them as written instead of assuming a value; the engines fail closed precisely so this question gets asked.
- **`suggestedNextSteps`** - what is worth doing next, each with a reason. Offer them rather than acting: anything with client impact still needs approval.

An error can carry `needsInput` too, so a refusal to guess becomes a question rather than a dead end. `node bin/wealth-skills.js capabilities` lists every tool with its required inputs and typical phrasings.

Typical requests this pack answers:
- "Reconcile us against the custodian."
- "Does the NAV tie out?"
- "Check this LP capital statement."
- "Where are we on the month-end close?"

---

## CLI & Module Usage

```bash
node bin/wealth-skills.js fundops reconcile --book '[{"account":"A1","security":"VTI","quantity":100,"marketValue":27500}]' --custodian '[{"account":"A1","security":"VTI","quantity":90,"marketValue":24750}]'
node bin/wealth-skills.js fundops nav-tieout --fund '{"assets":[{"name":"Listed equities","value":10500000},{"name":"Private company stake","value":2000000,"level":3}],"liabilities":[{"name":"Accrued fees","value":500000}],"unitsOutstanding":1000000,"reportedNav":12050000}'
node bin/wealth-skills.js fundops lp-statement --statement '{"beginningBalance":1000000,"contributions":250000,"distributions":100000,"incomeAllocation":20000,"realizedGainLoss":30000,"unrealizedGainLoss":50000,"managementFees":12500,"performanceAllocation":0,"otherExpenses":2500,"endingBalance":1235000}'
node bin/wealth-skills.js fundops close-status --as-of 2026-09-07 --tasks '[{"id":"bank","name":"Bank reconciliations","status":"done","due":"2026-09-03"},{"id":"nav","name":"NAV strike","status":"not_started","due":"2026-09-08","dependsOn":["bank"]}]'
```

```javascript
import { reconcileLedger, tieOutNav, checkLpCapitalStatement, trackCloseChecklist } from './src/engines/fundops.js';

const nav = tieOutNav({ assets: [{ name: 'Listed equities', value: 10500000 }], liabilities: [], unitsOutstanding: 1000000, reportedNav: 10500000 });
console.log(nav.tiesOut); // true
```

---

<!-- catalog:start -->
## Catalog Coverage

Generated from `catalog/catalog.json` by `npm run catalog`. See [CATALOG_CROSSWALK.md](../../CATALOG_CROSSWALK.md) for each item's name and what is and is not covered.

This pack is assigned **15** catalog items; **6** are backed by engine code.

| Tier | Items | IDs |
|---|---:|---|
| `engine` | 2 | T096, T098 |
| `partial-engine` | 4 | T019, T023, T095, T097 |
| `standard-reference` | 4 | S028, S029, S030, S055 |
| `integration-reference` | 5 | G087, G088, G089, G090, G091 |

---

<!-- catalog:end -->

## Output Standard

Every response MUST format output according to the target platform UI specifications ([`docs/UI_TEMPLATES.md`](../../docs/UI_TEMPLATES.md)) and include the `auditMetadata` block returned by the tool. NAV tie-out results carry `requires_human_approval: true`.
