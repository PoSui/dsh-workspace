---
name: wealth-uhnw
description: Concentrated-stock collar construction with constructive-sale review, and private equity multiple tracking (TVPI, DPI, RVPI), plus guidance for trust, philanthropic and exchange-fund planning that the engines do not model.
catalog_ids: ["T040", "T041", "S045", "S077", "S078", "S080", "G011", "G018", "G019"]
---

# UHNW Family Office Skill Pack (`wealth-uhnw`)

This skill pack equips AI agents (**Claude Code, Devin, Cursor, Antigravity, OpenAI Codex**) to structure collars on concentrated positions, track private equity commitments, and frame the wider planning conversations for Ultra-High-Net-Worth ($10M+) clients and family offices.

---

## Engine-Backed Capabilities

| Capability | Engine function | CLI |
|---|---|---|
| Collar strikes, net premium and effective floor/cap from supplied option quotes, zero-cost test, and IRC §1259 review flag | `calculateCollarStrategy` | `uhnw collar` |
| Private equity multiples: TVPI/MOIC, DPI, RVPI and unfunded commitment | `calculatePeMetrics` | `uhnw pe-metrics` |
| Private fund IRR from dated capital calls and distributions | `calculateMoneyWeightedReturn` | `portfolio irr` |

## Guidance Only (No Engine Support)

- Covered-call overlays and exchange funds (§721 partnerships)
- J-curve capital-call and distribution forecasting
- Generation-skipping transfer planning with GRATs, IDGTs and CRTs
- Donor-advised funds and private foundations

## Limits to State With Every Result

- The engine does not price options. Whether a collar is zero-cost is unknown (`null`) until you supply live put and call premiums.
- Every collar needs tax counsel review for constructive-sale treatment under IRC §1259. No rule defines a safe band; spreads under roughly 15–20% of the share price are a common practitioner warning sign and are flagged as `narrowBand`.

---

## CLI & Module Usage

```bash
node bin/wealth-skills.js uhnw collar --symbol AAPL --shares 100000 --price 215 --basis 25
node bin/wealth-skills.js uhnw collar --symbol AAPL --shares 100000 --price 215 --basis 25 --put-premium 4.10 --call-premium 4.05
node bin/wealth-skills.js uhnw pe-metrics --commitment 5000000 --called 3000000 --distributions 1200000 --nav 3200000
```

```javascript
import { calculateCollarStrategy, calculatePeMetrics } from './src/engines/uhnw.js';

const collar = calculateCollarStrategy('AAPL', 100000, 215, 25);
console.log(collar.collarParameters.putStrikeFloor); // 193.5 (10% below the $215 share price)
console.log(collar.zeroCostStructure); // null until premiums are supplied

const pe = calculatePeMetrics(5000000, 3000000, 1200000, 3200000);
console.log(pe.metrics.tvpiMoic); // '1.47x'
```

---

## Conversational Use

Every CLI and MCP result carries two fields for the conversation itself:

- **`needsInput`** - questions to put to the user before the answer is usable. Ask them as written instead of assuming a value; the engines fail closed precisely so this question gets asked.
- **`suggestedNextSteps`** - what is worth doing next, each with a reason. Offer them rather than acting: anything with client impact still needs approval.

An error can carry `needsInput` too, so a refusal to guess becomes a question rather than a dead end. `node bin/wealth-skills.js capabilities` lists every tool with its required inputs and typical phrasings.

Typical requests this pack answers:
- "Hedge this concentrated stock position."
- "Protect it without selling."
- "How is this private equity fund performing?"

---

<!-- catalog:start -->
## Catalog Coverage

Generated from `catalog/catalog.json` by `npm run catalog`. See [CATALOG_CROSSWALK.md](../../CATALOG_CROSSWALK.md) for each item's name and what is and is not covered.

This pack is assigned **9** catalog items; **3** are backed by engine code.

| Tier | Items | IDs |
|---|---:|---|
| `partial-engine` | 3 | T040, T041, S078 |
| `standard-reference` | 3 | S045, S077, S080 |
| `integration-reference` | 3 | G011, G018, G019 |

---

<!-- catalog:end -->

## Output Standard

Every response MUST include the `auditMetadata` block returned by the tool and follow [`docs/UI_TEMPLATES.md`](../../docs/UI_TEMPLATES.md) for the target platform.
