---
name: wealth-crm
description: Meeting transcript parsing into decisions and action items, and CRM task payload construction, plus guidance for meeting preparation. Payloads are built locally and never sent to a CRM.
catalog_ids: ["T008", "T009", "T010", "T011", "T012", "T013", "T014", "T091"]
---

# Wealth CRM & Meeting Intelligence (`wealth-crm`)

This skill pack equips AI agents (**Claude Code, Devin, Cursor, Antigravity, OpenAI Codex**) to pull decisions and follow-ups out of client meeting notes, shape them into CRM task payloads for an advisor to import, and prepare for client reviews.

---

## When to Activate

Trigger this skill when the user asks to:
- Prepare a pre-meeting briefing pack for an upcoming client review.
- Parse a client meeting transcript or notes and extract key decisions and follow-up action items.
- Structure JSON task payloads for Salesforce FSC, Wealthbox or Practifi.

---

## Engine-Backed Capabilities

| Capability | Engine function | CLI |
|---|---|---|
| Line-level extraction of decisions and action items | `parseMeetingTranscript` | `crm parse-transcript` |
| CRM task payload construction (not sent) | `buildCrmPayload` | library only |

## Guidance Only (No Engine Support)

- Pre-meeting briefing packs and relationship intelligence
- Sending, syncing or reading data from any CRM

## Limits to State With Every Result

- Extraction is whole-word keyword matching. Review the extracted items against the transcript before creating tasks; it will miss follow-ups phrased without its keywords.
- Payloads are generic task JSON labelled with the target platform. Map them to the CRM's actual API before importing.

---

## CLI & Module Usage

```bash
node bin/wealth-skills.js crm parse-transcript --text "Client agreed to rebalance into bonds. Advisor will send proposal next week."
node bin/wealth-skills.js ui render --platform claude --data '{"title":"Meeting Notes","summary":"Rebalance approved"}'
```

```javascript
import { parseMeetingTranscript, buildCrmPayload } from './src/engines/crm.js';

const parsed = parseMeetingTranscript('Client agreed to rebalance.\nAdvisor will send proposal next week.');
const crmPayload = buildCrmPayload('Salesforce_FSC', 'HH-9812', '2026-09-09', parsed.actionItems);
```

---

## Conversational Use

Every CLI and MCP result carries two fields for the conversation itself:

- **`needsInput`** - questions to put to the user before the answer is usable. Ask them as written instead of assuming a value; the engines fail closed precisely so this question gets asked.
- **`suggestedNextSteps`** - what is worth doing next, each with a reason. Offer them rather than acting: anything with client impact still needs approval.

An error can carry `needsInput` too, so a refusal to guess becomes a question rather than a dead end. `node bin/wealth-skills.js capabilities` lists every tool with its required inputs and typical phrasings.

Typical requests this pack answers:
- "Summarize this client meeting."
- "What did we agree to?"
- "Turn these notes into tasks."

---

<!-- catalog:start -->
## Catalog Coverage

Generated from `catalog/catalog.json` by `npm run catalog`. See [CATALOG_CROSSWALK.md](../../CATALOG_CROSSWALK.md) for each item's name and what is and is not covered.

This pack is assigned **8** catalog items; **8** are backed by engine code.

| Tier | Items | IDs |
|---|---:|---|
| `partial-engine` | 3 | T013, T014, T091 |
| `payload-builder` | 5 | T008, T009, T010, T011, T012 |

---

<!-- catalog:end -->

## Output Standard

Every response MUST format output according to the target platform UI specifications ([`docs/UI_TEMPLATES.md`](../../docs/UI_TEMPLATES.md)) and include the `auditMetadata` block returned by the tool:
1. **Claude**: Use Artifact cards, GitHub Alerts (`> [!NOTE]`), and GFM tables.
2. **OpenAI Codex & Canvas**: Output structured JSON payloads and standard Markdown tables.
3. **Cursor & VS Code**: Output code diffs for CRM payload updates.
