---
name: wealth-portfolio
description: Portfolio drift monitoring and rebalancing, parametric VaR and expected shortfall, tax-loss harvesting screens with a wash-sale look-back, cost basis by lot, time- and money-weighted returns, Sharpe ratio reliability, and small-universe historical and forward simulations - plus guidance for accounting, attribution and risk-model workflows that the engines do not implement.
catalog_ids: ["T015", "T016", "T017", "T018", "T020", "T021", "T022", "T024", "T025", "T026", "T027", "T028", "T029", "T030", "T031", "T032", "T033", "T087", "S066", "S070", "S071", "S072", "S081", "S083", "G001", "G002", "G003", "G004", "G005", "G006", "G007", "G008", "G009", "G010", "G012", "G013", "G014", "G015", "G016", "G020", "G021", "G022", "G023", "G024", "G025", "G026", "G027", "G028", "G029", "G030", "G050", "G051", "G052", "G053", "G054", "G055", "G058", "G061", "G086", "R001", "R002", "R003", "R004", "R005", "R006", "R007", "R008", "R009", "R010", "R011", "R012", "R013", "R014", "R015", "R016", "R017", "R018", "R019", "R020", "R021", "R022", "R023", "R024", "R041", "R042", "R043", "R051", "R052", "R053", "R054", "R055"]
---

# Wealth Portfolio & Risk Skill Pack (`wealth-portfolio`)

This skill pack equips AI agents (**Claude Code, Devin, Cursor, Antigravity, OpenAI Codex**) to monitor allocation drift, size rebalance trades, estimate parametric risk, screen for tax-loss harvesting, and run backtests and forward simulations with local, zero-dependency Node.js engines.

---

## When to Activate

Trigger this skill when the user asks to:
- Evaluate portfolio asset allocation against targets and monitor drift.
- Run historical backtests (CAGR, Sharpe, Sortino, max drawdown) or forward Monte Carlo simulations.
- Calculate Value at Risk and expected shortfall.
- Find tax-loss harvesting opportunities across taxable lots.

---

## Engine-Backed Capabilities

| Capability | Engine function | CLI |
|---|---|---|
| Drift monitoring and rebalance trade sizing | `monitorPortfolioDrift`, `calculatePortfolioRebalance` | `portfolio drift-monitor`, `portfolio rebalance` |
| Parametric VaR and expected shortfall at any confidence level | `calculatePortfolioVar` | `portfolio var` |
| Tax-loss harvesting screen with wash-sale look-back and cross-index replacement candidates | `scanTaxLossHarvesting` | `portfolio tlh` |
| Historical backtest (VTI, BND, VXUS, VNQ; 2015–2024 annual returns) | `backtestPortfolio` | `quant backtest` |
| Forward Monte Carlo under macro regimes | `forwardTestSimulation` | `quant forward-test` |
| Asset-class mix, and factor or duration averages of values you supply | `analyzePortfolioFactors` | `portfolio factors` |
| Cost basis and holding period by FIFO, specific identification or average cost | `calculateCostBasis` | `portfolio cost-basis` |
| Time-weighted return | `calculateTimeWeightedReturn` | `portfolio twr` |
| Money-weighted return (XIRR) | `calculateMoneyWeightedReturn` | `portfolio irr` |
| Sharpe ratio reliability: standard error, probabilistic and deflated Sharpe ratio | `assessSharpeRatio` | `quant sharpe-stats` |

## Guidance Only (No Engine Support)

- Portfolio accounting, performance attribution and client reporting (Addepar, Orion, Black Diamond, APX, Geneva)
- Risk-model factor exposures (BarraOne, Axioma): the engine only averages factor scores you supply
- Portfolio optimization, tax-aware transitions and direct indexing

## Limits to State With Every Result

- **Tax-loss harvesting** checks only purchases in the 30 days *before* the sale, across the lots supplied. Confirm separately that nothing substantially identical is bought in the 30 days after, including in IRA and spouse accounts. Replacement candidates track a different index, but whether a fund is "substantially identical" is a judgment for the advisor or tax professional. No replacement is suggested for total-bond funds.
- Backtests use approximate embedded annual returns and capture drawdowns at year-end only.
- Forward-simulation regime assumptions are illustrative, not forecasts; pass your firm's capital market assumptions for client work.
- VaR is parametric normal and only as good as the volatility you supply.

---

## CLI & Module Usage

```bash
node bin/wealth-skills.js portfolio drift-monitor --current '{"equity":68,"fixedIncome":32}' --target '{"equity":60,"fixedIncome":40}' --value 1000000 --band 5
node bin/wealth-skills.js portfolio var --value 1000000 --vol 0.14 --confidence 0.99
node bin/wealth-skills.js portfolio tlh --lots '[{"id":"L1","symbol":"VOO","quantity":100,"purchasePrice":500,"currentPrice":420,"purchaseDate":"2025-02-03"}]'
node bin/wealth-skills.js quant backtest --weights '{"VTI":0.6,"BND":0.4}' --initial 100000
node bin/wealth-skills.js quant forward-test --weights '{"VTI":0.6,"BND":0.4}' --regime stagflation
```

```javascript
import { monitorPortfolioDrift, calculatePortfolioVar } from './src/engines/portfolio.js';
import { backtestPortfolio } from './src/engines/quant.js';

const drift = monitorPortfolioDrift({ equity: 68, fixedIncome: 32 }, { equity: 60, fixedIncome: 40 }, 1000000, 5.0);
const risk = calculatePortfolioVar(1000000, 0.14, 0.99, 1);
const backtest = backtestPortfolio({ VTI: 0.6, BND: 0.4 }, 100000);
```

---

## Conversational Use

Every CLI and MCP result carries two fields for the conversation itself:

- **`needsInput`** - questions to put to the user before the answer is usable. Ask them as written instead of assuming a value; the engines fail closed precisely so this question gets asked.
- **`suggestedNextSteps`** - what is worth doing next, each with a reason. Offer them rather than acting: anything with client impact still needs approval.

An error can carry `needsInput` too, so a refusal to guess becomes a question rather than a dead end. `node bin/wealth-skills.js capabilities` lists every tool with its required inputs and typical phrasings.

Typical requests this pack answers:
- "Is the portfolio off target?"
- "Any losses worth harvesting?"
- "How much could this lose in a bad day?"
- "How would a 60/40 have done?"

---

<!-- catalog:start -->
## Catalog Coverage

Generated from `catalog/catalog.json` by `npm run catalog`. See [CATALOG_CROSSWALK.md](../../CATALOG_CROSSWALK.md) for each item's name and what is and is not covered.

This pack is assigned **91** catalog items; **22** are backed by engine code.

| Tier | Items | IDs |
|---|---:|---|
| `engine` | 3 | S072, R051, R055 |
| `partial-engine` | 19 | T015, T016, T017, T018, T020, T022, T025, T026, T028, T029, T030, T031, T032, T033, T087, S066, S070, S071, S081 |
| `guidance` | 3 | T021, T024, T027 |
| `standard-reference` | 1 | S083 |
| `integration-reference` | 35 | G001, G002, G003, G004, G005, G006, G007, G008, G009, G010, G012, G013, G014, G015, G016, G020, G021, G022, G023, G024, G025, G026, G027, G028, G029, G030, G050, G051, G052, G053, G054, G055, G058, G061, G086 |
| `research-reference` | 30 | R001, R002, R003, R004, R005, R006, R007, R008, R009, R010, R011, R012, R013, R014, R015, R016, R017, R018, R019, R020, R021, R022, R023, R024, R041, R042, R043, R052, R053, R054 |

---

<!-- catalog:end -->

## Output Standard & Platform Formatting

Every response MUST format output according to the target platform UI specifications ([`docs/UI_TEMPLATES.md`](../../docs/UI_TEMPLATES.md)) and include the `auditMetadata` block returned by the tool:
- **Claude**: Use GitHub Alerts (`> [!IMPORTANT]`) and Mermaid flowcharts.
- **OpenAI Codex & Canvas**: Use block LaTeX math (`$$\text{Sharpe} = \frac{\bar{R}_p - R_f}{\sigma}$$`) and GFM data tables.
- **Cursor & VS Code**: Use code diff blocks (`diff` with `+`/`-`) for proposed rebalance trades.
