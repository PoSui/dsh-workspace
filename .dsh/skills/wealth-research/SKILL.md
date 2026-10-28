---
name: wealth-research
description: Valuation ratios from supplied fundamentals, DCF valuation with sensitivity, keyword risk-factor summaries of filing text, XBRL fact extraction, and live FRED and SEC EDGAR fetches, plus guidance for earnings and market research that the engines do not perform.
catalog_ids: ["T034", "T035", "T036", "T037", "T038", "T039", "T052", "T053", "T054", "T055", "T056", "T057", "T058", "T059", "T060", "T061", "T092", "T093", "T094", "S020", "S021", "S022", "S023", "S024", "S025", "G017", "G031", "G032", "G033", "G034", "G035", "G036", "G037", "G038", "G039", "G040", "G042", "G043", "G044", "G045", "G046", "G047", "G048", "G049", "G056", "G057", "G059", "G060", "G063", "G064", "G065", "G066", "G067", "G070", "G071", "G072", "G073", "G074", "G075", "G076", "G077", "G078", "G079", "G080", "G097", "G098", "G099", "R039", "R040", "R056", "R057", "R058", "R059", "R060", "R061", "R062", "R063", "R064", "R065", "R066", "R067", "R068", "R069", "R070", "R071", "R072", "R073", "R074", "R075", "R076", "R077", "R078", "R079", "R080", "R081", "R082", "R083", "R084", "R085", "R086", "R087", "R088", "R089", "R090", "R093"]
---

# Wealth Research & Market Intelligence (`wealth-research`)

This skill pack equips AI agents (**Claude Code, Devin, Cursor, Antigravity, OpenAI Codex**) to compute valuation ratios, summarize risk-factor language in filings, pull the latest FRED observations and SEC EDGAR company facts, and structure broader equity research.

---

## When to Activate

Trigger this skill when the user asks to:
- Build a company tear sheet or valuation summary.
- Summarize risk factors in a 10-K or 10-Q.
- Look up the latest value of a FRED series or a company's EDGAR facts.
- Summarize earnings announcements or macro trends.

---

## Engine-Backed Capabilities

| Capability | Engine function | CLI |
|---|---|---|
| P/E, P/S, dividend yield and FCF conversion from supplied fundamentals | `generateCompanyTearSheet` | `research tear-sheet` |
| Keyword summary of Item 1A risk-factor text you supply | `parseEdgarFilingSummary` | library only |
| Latest observation of a FRED series (live) | `fetchLiveFredSeries` | library only |
| SEC EDGAR company facts (live; requires a declared User-Agent) | `fetchLiveEdgarCompanyFacts` | library only |
| Latest value of an XBRL concept from company facts | `extractCompanyFact` | library only |
| Discounted cash flow valuation with a sensitivity grid | `buildDcfValuation` | `research dcf` |

## Guidance Only (No Engine Support)

- Earnings call and press release summaries
- Market news synthesis and sector outlooks
- Time-series analysis beyond the latest observation (trends, yield-curve spreads, CPI decomposition)

## Limits to State With Every Result

- Ratios are only as current and accurate as the fundamentals supplied.
- The filing summary matches a short keyword list; it is not a reading of the filing.
- Live fetches that fail return `null` values with an explanation. Report the data as unavailable; never estimate it.
- SEC EDGAR requires `SEC_EDGAR_USER_AGENT` (or a `userAgent` option) naming your organization and a contact email.

---

## CLI & Module Usage

```bash
node bin/wealth-skills.js research tear-sheet --ticker AAPL --financials '{"marketCap":3.25e12,"price":215,"eps":7.3,"revenue":3.8e11,"netIncome":1e11,"freeCashFlow":1.08e11,"dividends":1.18}'
```

```javascript
import { generateCompanyTearSheet } from './src/engines/research.js';
import { fetchLiveFredSeries } from './src/engines/live.js';

const tearSheet = generateCompanyTearSheet('AAPL', { marketCap: 3.25e12, price: 215, eps: 7.3, revenue: 3.8e11 });
const tenYear = await fetchLiveFredSeries('GS10'); // source is FRED_LIVE_API, or FRED_UNAVAILABLE with nulls
```

---

## Conversational Use

Every CLI and MCP result carries two fields for the conversation itself:

- **`needsInput`** - questions to put to the user before the answer is usable. Ask them as written instead of assuming a value; the engines fail closed precisely so this question gets asked.
- **`suggestedNextSteps`** - what is worth doing next, each with a reason. Offer them rather than acting: anything with client impact still needs approval.

An error can carry `needsInput` too, so a refusal to guess becomes a question rather than a dead end. `node bin/wealth-skills.js capabilities` lists every tool with its required inputs and typical phrasings.

Typical requests this pack answers:
- "Build a tear sheet for this company."
- "What is it trading at?"
- "What are the latest 10-year Treasury yields?"

---

<!-- catalog:start -->
## Catalog Coverage

Generated from `catalog/catalog.json` by `npm run catalog`. See [CATALOG_CROSSWALK.md](../../CATALOG_CROSSWALK.md) for each item's name and what is and is not covered.

This pack is assigned **105** catalog items; **13** are backed by engine code.

| Tier | Items | IDs |
|---|---:|---|
| `partial-engine` | 13 | T037, T038, T055, T056, T057, T059, T060, T061, T092, T093, T094, S023, S024 |
| `guidance` | 8 | T034, T035, T036, T039, T052, T053, T054, T058 |
| `standard-reference` | 4 | S020, S021, S022, S025 |
| `integration-reference` | 42 | G017, G031, G032, G033, G034, G035, G036, G037, G038, G039, G040, G042, G043, G044, G045, G046, G047, G048, G049, G056, G057, G059, G060, G063, G064, G065, G066, G067, G070, G071, G072, G073, G074, G075, G076, G077, G078, G079, G080, G097, G098, G099 |
| `research-reference` | 38 | R039, R040, R056, R057, R058, R059, R060, R061, R062, R063, R064, R065, R066, R067, R068, R069, R070, R071, R072, R073, R074, R075, R076, R077, R078, R079, R080, R081, R082, R083, R084, R085, R086, R087, R088, R089, R090, R093 |

---

<!-- catalog:end -->

## Output Standard & Platform Formatting

Every response MUST format output according to the target platform UI specifications ([`docs/UI_TEMPLATES.md`](../../docs/UI_TEMPLATES.md)):
- **Claude**: Render tear sheets inside Artifact cards with GitHub Alerts (`> [!NOTE]`).
- **OpenAI Codex & Canvas**: Format financial ratios using GFM tables.
- **Antigravity / Gemini**: Include the `auditMetadata` block as a footer.
