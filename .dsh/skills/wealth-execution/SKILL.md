---
name: wealth-execution
description: Pre-trade validation (buying power, oversell, short-term gain), order payload construction for Alpaca, Interactive Brokers and FIX 4.4, ISIN/CUSIP/FIGI/LEI check digits and T+1 settlement dates, for human-approved execution. Builds payloads only - never submits orders or connects to a custodian.
catalog_ids: ["T042", "T043", "T044", "T045", "T046", "T047", "T048", "T049", "T050", "T051", "T071", "S001", "S002", "S003", "S004", "S005", "S006", "S007", "S008", "S011", "S012", "S013", "S014", "S015", "S017", "S019", "S041", "S042", "S043", "S049", "S058", "S059", "S098", "S099", "S100", "G041", "G062", "G068", "G069", "G092", "G093", "G094", "G095", "G096", "G100", "R025", "R026", "R027", "R028", "R029", "R030"]
---

# Wealth Execution & Custody (`wealth-execution`)

This skill pack equips AI agents (**Claude Code, Devin, Cursor, Antigravity, OpenAI Codex**) to validate proposed orders and build order payloads locally for a licensed advisor to review and submit through their own systems.

---

## ⚠️ MANDATORY SAFETY & COMPLIANCE GUARDRAIL

> [!CAUTION]
> All trade order construction is classified as **`requires_human_approval: true`**. Nothing in this pack submits an order. Agents must NEVER submit live orders without explicit approval and signature by a licensed advisor.

---

## Engine-Backed Capabilities

| Capability | Engine function | CLI |
|---|---|---|
| Pre-trade checks: buying power, oversell against the held position, short-term gain warning | `validatePreTradeCompliance` | `execution validate` |
| Alpaca and Interactive Brokers REST order payloads | `buildTradePayload` | `execution payload` |
| FIX 4.4 New Order Single (35=D) with BodyLength and CheckSum | `buildFixOrderPayload` | `execution fix-payload` |
| ISIN, CUSIP, FIGI and LEI check digits; MIC and CFI formats | `validateSecurityIdentifier` | `execution identifier` |
| T+1 settlement dates under SEC Rule 15c6-1 | `calculateSettlementDate` | `execution settlement-date` |

## Guidance Only (No Engine Support)

- Schwab, Fidelity and Pershing custodian workflows (there are no custodian connectors)
- Order submission, routing and best execution
- Block allocations, corporate actions and ACAT transfers

## Limits to State With Every Result

- Checks fail closed: a buy needs a reference price and settled cash, and a sell needs the held position. Missing data is an error, not a pass.
- Interactive Brokers routes on the contract ID. Resolve the `conid` with `GET /iserver/secdef/search?symbol=<ticker>` and pass it explicitly; the builder refuses to guess.
- FIX `MsgSeqNum` must come from the live FIX session; the generator's counter is a placeholder.

---

## CLI & Module Usage

```bash
node bin/wealth-skills.js execution validate --order '{"symbol":"VTI","action":"BUY","quantity":50,"price":275}' --settled-cash 25000
node bin/wealth-skills.js execution validate --order '{"symbol":"VTI","action":"SELL","quantity":40,"price":275}' --positions '{"VTI":100}'
node bin/wealth-skills.js execution payload --broker Alpaca --account ACC-123 --order '{"symbol":"VTI","action":"BUY","quantity":50,"price":275}'
node bin/wealth-skills.js execution payload --broker IBKR --account "$IBKR_ACCOUNT" --conid "$VTI_CONID" --order '{"symbol":"VTI","action":"BUY","quantity":50,"price":275}'
node bin/wealth-skills.js execution fix-payload --custodian Pershing_NetX360 --symbol VTI --side BUY --qty 500 --price 275.50
```

```javascript
import { validatePreTradeCompliance, buildTradePayload } from './src/engines/execution.js';

const order = { symbol: 'VTI', action: 'BUY', quantity: 50, price: 275 };
const validation = validatePreTradeCompliance({ settledCash: 25000 }, order);
const payload = buildTradePayload('Alpaca', 'ACC-123', order);
```

---

## Conversational Use

Every CLI and MCP result carries two fields for the conversation itself:

- **`needsInput`** - questions to put to the user before the answer is usable. Ask them as written instead of assuming a value; the engines fail closed precisely so this question gets asked.
- **`suggestedNextSteps`** - what is worth doing next, each with a reason. Offer them rather than acting: anything with client impact still needs approval.

An error can carry `needsInput` too, so a refusal to guess becomes a question rather than a dead end. `node bin/wealth-skills.js capabilities` lists every tool with its required inputs and typical phrasings.

Typical requests this pack answers:
- "Can they afford this trade?"
- "Is this sell allowed?"
- "Build the order for Alpaca."

---

<!-- catalog:start -->
## Catalog Coverage

Generated from `catalog/catalog.json` by `npm run catalog`. See [CATALOG_CROSSWALK.md](../../CATALOG_CROSSWALK.md) for each item's name and what is and is not covered.

This pack is assigned **51** catalog items; **17** are backed by engine code.

| Tier | Items | IDs |
|---|---:|---|
| `engine` | 2 | S013, S059 |
| `partial-engine` | 8 | T043, T045, T071, S001, S014, S015, S019, S058 |
| `payload-builder` | 7 | T042, T044, T046, T047, T049, T050, T051 |
| `guidance` | 1 | T048 |
| `standard-reference` | 17 | S002, S003, S004, S005, S006, S007, S008, S011, S012, S017, S041, S042, S043, S049, S098, S099, S100 |
| `integration-reference` | 10 | G041, G062, G068, G069, G092, G093, G094, G095, G096, G100 |
| `research-reference` | 6 | R025, R026, R027, R028, R029, R030 |

---

<!-- catalog:end -->

## Output Standard & Platform Formatting

Every response MUST format output according to the target platform UI specifications ([`docs/UI_TEMPLATES.md`](../../docs/UI_TEMPLATES.md)):
- **Claude**: Highlight approval status with GitHub Alerts (`> [!CAUTION]`).
- **Cursor & VS Code**: Output JSON payload diffs.
- **Codex & Antigravity**: Include the `auditMetadata` block, with `requires_human_approval: true`.
