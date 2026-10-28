---
name: wealth-compliance
description: Automated screen of advisory communications for promissory language and missing standard disclosures, FINRA 2111 suitability and Marketing Rule performance checks, investment adviser registration lookups in SEC IAPD compilation files, and guidance for supervisory review. BrokerCheck research stays manual.
catalog_ids: ["T072", "T073", "T074", "T075", "T076", "T077", "T078", "T080", "T081", "S026", "S027", "S031", "S034", "S035", "S036", "S037", "S038", "S040", "S044", "S047", "S048", "S050", "S051", "S052", "S053", "S054", "S056", "S057", "S060", "S082", "S084", "S085", "S086", "S087", "S088", "S089", "S090", "S091", "S092", "S093", "S094", "S095", "S096", "S097", "R094", "R095", "R096", "R097", "R098", "R099", "R100"]
---

# Wealth Compliance & Supervision (`wealth-compliance`)

This skill pack equips AI agents (**Claude Code, Devin, Cursor, Antigravity, OpenAI Codex**) to pre-screen client communications before principal review, and to guide registration research and supervisory workflows toward the authoritative sources.

---

## ⚠️ What a Registration Lookup Can and Cannot Tell You

> [!WARNING]
> `compliance lookup` and the `sec-iapd-lookup` MCP server read the SEC's daily IAPD compilation files, which the operator downloads from https://adviserinfo.sec.gov/compilation. They cover **investment adviser** registration only.
>
> - A miss does not mean someone is unregistered. They may be in another IAPD file (SEC firms, state firms, representatives), or registered only as a broker-dealer.
> - Disclosure flags say a disclosure exists, not what it is. Open the IAPD page before saying anything about it.
> - Check the file date. Results older than 7 days are flagged `stale`.
> - Nothing here queries FINRA BrokerCheck. Its terms prohibit automated access and use with AI tools, so broker-dealer checks stay manual at https://brokercheck.finra.org.

---

## Engine-Backed Capabilities

| Capability | Engine function | CLI |
|---|---|---|
| Promissory-language and missing-disclosure screen (`VIOLATION`, `NEEDS_REVIEW` or `PASSED_AUTOMATED_SCREEN`) | `scanFinraRule2210` | `compliance scan` |
| Investment adviser registration, notice filings, employers, exams and disclosure flags by CRD or name, from SEC IAPD compilation files | `lookupAdviserRegistration` | `compliance lookup` |
| Customer-specific and quantitative suitability (FINRA 2111), with missing profile factors | `checkSuitability` | `compliance suitability` |
| Marketing Rule performance provisions, 206(4)-1(d) | `checkPerformanceAdvertisement` | `compliance performance-ad` |

## Guidance Only (No Engine Support)

- FINRA BrokerCheck research (manual, per FINRA terms of use)
- Disclosure details and Form ADV brochures (on the IAPD site)
- Communication surveillance and archiving (Smarsh, Global Relay)
- Supervisory logging and FINRA Rule 3110 review workflows
- Marketing Rule provisions beyond performance (testimonials, endorsements, third-party ratings)

## Limits to State With Every Result

- The screen is pattern matching. It does not understand negation, judge whether a communication is fair and balanced, or review performance presentations.
- Passing the screen is not approval. Retail communications still need review by a registered principal.

---

## CLI & Module Usage

```bash
node bin/wealth-skills.js compliance scan --text "We offer a guaranteed 15% return with past performance."
node bin/wealth-skills.js compliance lookup --feed tests/fixtures/iapd/sec-firms.xml --crd 900002 --as-of 2026-09-13
```

```javascript
import { scanFinraRule2210 } from './src/engines/compliance.js';

const scanResult = scanFinraRule2210('We offer a guaranteed 15% return');
console.log(scanResult.screenStatus); // 'VIOLATION'
```

---

## Conversational Use

Every CLI and MCP result carries two fields for the conversation itself:

- **`needsInput`** - questions to put to the user before the answer is usable. Ask them as written instead of assuming a value; the engines fail closed precisely so this question gets asked.
- **`suggestedNextSteps`** - what is worth doing next, each with a reason. Offer them rather than acting: anything with client impact still needs approval.

An error can carry `needsInput` too, so a refusal to guess becomes a question rather than a dead end. `node bin/wealth-skills.js capabilities` lists every tool with its required inputs and typical phrasings.

Typical requests this pack answers:
- "Is this email compliant?"
- "Can we send this to clients?"
- "Look up this CRD."
- "Does this RIA have any disclosures?"

---

<!-- catalog:start -->
## Catalog Coverage

Generated from `catalog/catalog.json` by `npm run catalog`. See [CATALOG_CROSSWALK.md](../../CATALOG_CROSSWALK.md) for each item's name and what is and is not covered.

This pack is assigned **51** catalog items; **14** are backed by engine code.

| Tier | Items | IDs |
|---|---:|---|
| `partial-engine` | 14 | T072, T073, T074, T076, T077, T078, T081, S031, S037, S051, S052, S054, S091, S094 |
| `guidance` | 2 | T075, T080 |
| `standard-reference` | 28 | S026, S027, S034, S035, S036, S038, S040, S044, S047, S048, S050, S053, S056, S057, S060, S082, S084, S085, S086, S087, S088, S089, S090, S092, S093, S095, S096, S097 |
| `research-reference` | 7 | R094, R095, R096, R097, R098, R099, R100 |

---

<!-- catalog:end -->

## Output Standard & Platform Formatting

Every response MUST format output according to the target platform UI specifications ([`docs/UI_TEMPLATES.md`](../../docs/UI_TEMPLATES.md)) and include the `auditMetadata` block returned by the tool:
- **Claude**: Highlight regulatory violations with GitHub Alerts (`> [!WARNING]`).
- **OpenAI Codex & Canvas**: Format screening results and missing disclosures as tables.
