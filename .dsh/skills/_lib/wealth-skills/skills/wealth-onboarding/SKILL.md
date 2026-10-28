---
name: wealth-onboarding
description: Customer Identification Program field checks, application gaps by account type (CIP, beneficial ownership, FINRA 4512, 2090, 2111 and 2165), and onboarding milestone tracking. Records the result of an OFAC screen performed elsewhere; does not itself screen sanctions lists, verify identity documents, aggregate accounts or manage e-signatures.
catalog_ids: ["T062", "T063", "T064", "T065", "T066", "T067", "T068", "T069", "T070", "T079", "T088", "T099", "S009", "S010", "S016", "S018", "S032", "S033", "S039", "S046", "G081"]
---

# Wealth Onboarding & Identity (`wealth-onboarding`)

This skill pack equips AI agents (**Claude Code, Devin, Cursor, Antigravity, OpenAI Codex**) to check that a new-account application carries the Client Identification Program elements, record the outcome of an OFAC screen run in a proper screening system, and track onboarding milestones.

---

## Engine-Backed Capabilities

| Capability | Engine function | CLI |
|---|---|---|
| CIP field checks (legal name, SSN format, residential address, verifiable date of birth) and recording the OFAC screen result | `validateCipIdentity` | `onboarding validate-cip` |
| Onboarding milestone tracking (CIP, W-9, custodial agreement, funding) | `checkOnboardingStatus` | library only |
| Application gaps by account type: blocking, needed before recommendations, and recommended (CIP, FinCEN CDD, FINRA 2090/2111/2165/4512) | `identifyOnboardingGaps` | `onboarding gaps` |

## Guidance Only (No Engine Support)

- OFAC / SDN screening itself
- Documentary and non-documentary identity verification (Alloy, Socure, Trulioo)
- KYC document parsing
- Account aggregation (Plaid, Yodlee) and e-signature workflows (DocuSign)

## Limits to State With Every Result

- `ofacStatus` must come from an actual sanctions screen. If it is missing, CIP fails with `NOT_SCREENED`; never fill it in to make the check pass.
- The SSN check validates format only, not issuance or ownership.
- A passing result means the required fields are present and well-formed, not that the applicant's identity is verified.

---

## CLI & Module Usage

```bash
node bin/wealth-skills.js onboarding validate-cip --applicant '{"name":"Jane Doe","ssn":"123-45-6789","dob":"1990-05-15","address":"456 Elm St","ofacStatus":"CLEAR"}'
```

```javascript
import { validateCipIdentity, checkOnboardingStatus } from './src/engines/onboarding.js';

const applicant = { name: 'Jane Doe', ssn: '123-45-6789', dob: '1990-05-15', address: '456 Elm St', ofacStatus: 'CLEAR' };
const validation = validateCipIdentity(applicant);
const status = checkOnboardingStatus({ clientId: 'C1', cipPassed: validation.cipPassed, w9Signed: true, custodialAgreementSigned: false, accountFunded: false });
```

---

## Conversational Use

Every CLI and MCP result carries two fields for the conversation itself:

- **`needsInput`** - questions to put to the user before the answer is usable. Ask them as written instead of assuming a value; the engines fail closed precisely so this question gets asked.
- **`suggestedNextSteps`** - what is worth doing next, each with a reason. Offer them rather than acting: anything with client impact still needs approval.

An error can carry `needsInput` too, so a refusal to guess becomes a question rather than a dead end. `node bin/wealth-skills.js capabilities` lists every tool with its required inputs and typical phrasings.

Typical requests this pack answers:
- "Can we open this account?"
- "Is this application complete?"
- "Run the CIP check."

---

<!-- catalog:start -->
## Catalog Coverage

Generated from `catalog/catalog.json` by `npm run catalog`. See [CATALOG_CROSSWALK.md](../../CATALOG_CROSSWALK.md) for each item's name and what is and is not covered.

This pack is assigned **21** catalog items; **10** are backed by engine code.

| Tier | Items | IDs |
|---|---:|---|
| `engine` | 3 | T099, S016, S033 |
| `partial-engine` | 7 | T068, T069, T070, T079, S032, S039, S046 |
| `guidance` | 7 | T062, T063, T064, T065, T066, T067, T088 |
| `standard-reference` | 3 | S009, S010, S018 |
| `integration-reference` | 1 | G081 |

---

<!-- catalog:end -->

## Output Standard & Platform Formatting

Every response MUST format output according to the target platform UI specifications ([`docs/UI_TEMPLATES.md`](../../docs/UI_TEMPLATES.md)) and include the `auditMetadata` block returned by the tool:
- **Claude**: Use GitHub Alerts (`> [!NOTE]`) for onboarding milestones.
- **OpenAI Codex & Canvas**: Format KYC status tables using GFM markdown.
