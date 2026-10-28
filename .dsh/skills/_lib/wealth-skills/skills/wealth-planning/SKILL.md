---
name: wealth-planning
description: US retirement and tax planning calculations - tax year 2026 bracket headroom for sizing Roth conversions, required minimum distributions, retirement Monte Carlo with inflation-adjusted withdrawals, capital-loss netting and carryover, and net investment income tax - plus guidance for broader household planning that the engines do not model.
catalog_ids: ["T001", "T002", "T003", "T004", "T005", "T006", "T007", "T082", "T083", "T084", "T085", "T086", "T089", "T090", "T100", "S061", "S062", "S063", "S064", "S065", "S067", "S068", "S069", "S073", "S074", "S075", "S076", "S079", "G082", "G083", "G084", "G085", "R031", "R032", "R033", "R034", "R035", "R036", "R037", "R038", "R044", "R045", "R046", "R047", "R048", "R049", "R050", "R091", "R092"]
---

# Wealth Planning Skill Pack (`wealth-planning`)

This skill pack equips AI agents (**Claude Code, Devin, Cursor, Antigravity, OpenAI Codex**) to run retirement and tax planning calculations with local, zero-dependency Node.js engines, and to guide the parts of household planning that need other tools or professional judgment.

---

## When to Activate

Trigger this skill when the user asks to:
- Build or evaluate a household financial plan or retirement income strategy.
- Estimate Roth conversion headroom from a client's AGI (read the AGI from the return yourself; there is no tax-return parser).
- Calculate Required Minimum Distributions (RMDs) for retirement accounts.
- Run Monte Carlo simulations for retirement success probability.

---

## Engine-Backed Capabilities

| Capability | Engine function | CLI |
|---|---|---|
| Roth conversion bracket headroom (tax year 2026, MFJ or Single, standard deduction) | `calculateTaxBracketHeadroom` | `planning tax-headroom` |
| Required minimum distributions (Uniform Lifetime Table; RMDs start at 73, or 75 if born 1960 or later) | `calculateRMD` | `planning rmd` |
| Retirement Monte Carlo with inflation-adjusted withdrawals | `runMonteCarloCashFlow` | `planning monte-carlo` |
| Capital gain and loss netting, the $3,000 limit and carryover by character (IRC §§1211, 1212, 1222) | `netCapitalGainsAndLosses` | `planning capital-losses` |
| Net investment income tax (IRC §1411) | `calculateNetInvestmentIncomeTax` | `planning niit` |

## Guidance Only (No Engine Support)

Work these from the client's documents, other tools, or a qualified professional, and never present them as calculated by this library:
- Parsing Form 1040 or other tax documents
- Estate document review and estate tax projections
- Household budgeting and cash-flow statements
- Insurance, Social Security claiming, and state tax analysis

## Limits to State With Every Result

- Bracket headroom uses only the standard deduction and ordinary-income brackets. It ignores itemized deductions, credits, capital-gain and qualified-dividend stacking, NIIT, IRMAA thresholds and state tax.
- RMDs use the prior December 31 balance. Use the Joint and Last Survivor Table instead when the sole beneficiary is a spouse more than 10 years younger.
- Monte Carlo assumes normally distributed annual returns and ignores taxes and fees.

---

## CLI & Module Usage

```bash
node bin/wealth-skills.js planning tax-headroom --agi 210000 --status MFJ
node bin/wealth-skills.js planning rmd --age 75 --balance 500000
node bin/wealth-skills.js planning monte-carlo --assets 1250000 --spend 50000 --inflation 0.025
```

```javascript
import { calculateTaxBracketHeadroom, calculateRMD } from './src/engines/planning.js';

const taxResult = calculateTaxBracketHeadroom(210000, 'MFJ');
console.log(taxResult.headroomForRothConversion); // 33600 = $211,400 ceiling - $177,800 taxable income

const rmd = calculateRMD(75, 500000);
console.log(rmd.rmdRequired); // 20325 = 500,000 / 24.6
```

---

## Conversational Use

Every CLI and MCP result carries two fields for the conversation itself:

- **`needsInput`** - questions to put to the user before the answer is usable. Ask them as written instead of assuming a value; the engines fail closed precisely so this question gets asked.
- **`suggestedNextSteps`** - what is worth doing next, each with a reason. Offer them rather than acting: anything with client impact still needs approval.

An error can carry `needsInput` too, so a refusal to guess becomes a question rather than a dead end. `node bin/wealth-skills.js capabilities` lists every tool with its required inputs and typical phrasings.

Typical requests this pack answers:
- "How much can they convert to a Roth this year?"
- "What is their RMD?"
- "Will their money last through retirement?"

---

<!-- catalog:start -->
## Catalog Coverage

Generated from `catalog/catalog.json` by `npm run catalog`. See [CATALOG_CROSSWALK.md](../../CATALOG_CROSSWALK.md) for each item's name and what is and is not covered.

This pack is assigned **49** catalog items; **15** are backed by engine code.

| Tier | Items | IDs |
|---|---:|---|
| `engine` | 4 | S073, S074, S075, S076 |
| `partial-engine` | 11 | T001, T002, T003, T006, T007, T082, T100, S061, S063, S068, S069 |
| `guidance` | 8 | T004, T005, T083, T084, T085, T086, T089, T090 |
| `standard-reference` | 5 | S062, S064, S065, S067, S079 |
| `integration-reference` | 4 | G082, G083, G084, G085 |
| `research-reference` | 17 | R031, R032, R033, R034, R035, R036, R037, R038, R044, R045, R046, R047, R048, R049, R050, R091, R092 |

---

<!-- catalog:end -->

## Output Standard

Every response MUST include:
1. **Household Summary & Projection Metrics**.
2. **Actionable Tax / RMD / Planning Headroom**, with the limits above.
3. **Audit Trail**: the `auditMetadata` block returned by the CLI or MCP tool.
