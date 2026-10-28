#!/usr/bin/env node

/**
 * Empirical Proof Harness for `wealth-skills`
 * Runs 21 use cases across Simple (Tier 1), Intermediate (Tier 2) and Complex (Tier 3) tiers, checks
 * each output against stated expectations, records latency, and writes docs/EMPIRICAL_TEST_PROOFS.md.
 *
 * A use case is PASSED only when every one of its checks holds, and the process exits non-zero if
 * any fails. (The previous harness stamped PASSED on every row without checking anything.) Expected
 * values come from sources independent of the engine wherever possible: published IRS figures,
 * arithmetic on the inputs, or closed-form formulas.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { calculateTaxBracketHeadroom, calculateRMD } from '../src/engines/planning.js';
import { calculatePortfolioRebalance, monitorPortfolioDrift, analyzePortfolioFactors, calculatePortfolioVar, scanTaxLossHarvesting } from '../src/engines/portfolio.js';
import { backtestPortfolio, forwardTestSimulation } from '../src/engines/quant.js';
import { parseMeetingTranscript, buildCrmPayload } from '../src/engines/crm.js';
import { generateCompanyTearSheet, parseEdgarFilingSummary } from '../src/engines/research.js';
import { validatePreTradeCompliance } from '../src/engines/execution.js';
import { validateCipIdentity, checkOnboardingStatus } from '../src/engines/onboarding.js';
import { scanFinraRule2210 } from '../src/engines/compliance.js';
import { parseIapdFirmRecord } from '../src/engines/registration.js';
import { renderAdaptiveUI } from '../src/engines/ui.js';
import { seededRandom } from '../src/engines/stats.js';

const __filename = fileURLToPath(import.meta.url);
const OUTPUT_PATH = path.join(path.dirname(__filename), '../docs/EMPIRICAL_TEST_PROOFS.md');

// Fixed so wash-sale windows and simulations are reproducible between runs.
const SALE_DATE = '2026-09-09';
const Z_99 = 2.3263478740408408;

const TIER_1 = 'Tier 1 (Simple)';
const TIER_2 = 'Tier 2 (Intermediate)';
const TIER_3 = 'Tier 3 (Complex / HNW)';

const near = (actual, expected, tolerance) => Math.abs(actual - expected) <= tolerance;
const planFor = (output, category) => output.rebalancePlan.find(p => p.category === category);
const lotFor = (output, symbol) => output.opportunities.find(o => o.symbol === symbol);

export const USE_CASES = [
  // --- TIER 1: SIMPLE BASELINE USE CASES (7 VARIATIONS) ---
  {
    id: 'UC-101',
    tier: TIER_1,
    name: '1040 Tax Bracket Headroom Check (MFJ, $210k AGI, Tax Year 2026)',
    run: () => calculateTaxBracketHeadroom(210000, 'MFJ'),
    checks: [
      ['taxable income is AGI less the $32,200 MFJ standard deduction ($177,800)', o => o.taxableIncome === 177800],
      ['taxable income falls in the 22% bracket', o => o.currentBracketRate === '22.0%'],
      ['headroom to the $211,400 bracket ceiling is $33,600', o => o.headroomForRothConversion === 33600]
    ]
  },
  {
    id: 'UC-102',
    tier: TIER_1,
    name: 'Single-Account RMD Calculation at Age 75',
    run: () => calculateRMD(75, 500000),
    checks: [
      ['uses the Uniform Lifetime Table factor 24.6 for age 75', o => o.distributionFactor === 24.6],
      ['RMD is $500,000 / 24.6 = $20,325', o => o.rmdRequired === 20325]
    ]
  },
  {
    id: 'UC-103',
    tier: TIER_1,
    name: 'FINRA Rule 2210 Promissory Phrase Detection',
    run: () => scanFinraRule2210('We offer a guaranteed 15% return with past performance.'),
    checks: [
      ['"guaranteed 15%" is flagged', o => o.prohibitedTermsFound.includes('guaranteed 15%')],
      ['screen status is VIOLATION and the text is not compliant', o => o.screenStatus === 'VIOLATION' && o.isCompliant === false]
    ]
  },
  {
    id: 'UC-104',
    tier: TIER_1,
    name: 'Single-Stock Fundamental Valuation Tear-Sheet (AAPL Inputs)',
    run: () => generateCompanyTearSheet('AAPL', { marketCap: 3.25e12, price: 215, eps: 7.3, revenue: 3.8e11, netIncome: 1e11, freeCashFlow: 1.08e11, dividends: 1.18, sector: 'Technology' }),
    checks: [
      ['P/E is 215 / 7.3 = 29.45', o => o.valuationMetrics.peRatio === 29.45],
      ['P/S is 3.25T / 380B = 8.55', o => o.valuationMetrics.psRatio === 8.55],
      ['dividend yield is 1.18 / 215 = 0.55%', o => o.valuationMetrics.dividendYieldPercent === 0.55],
      ['FCF conversion is 108B / 100B = 108%', o => o.valuationMetrics.freeCashFlowConversionPercent === 108]
    ]
  },
  {
    id: 'UC-105',
    tier: TIER_1,
    name: 'SEC Filing Item 1A Risk Factor Keyword Search',
    run: () => parseEdgarFilingSummary('0000320193', '10-K', 'Item 1A Risk Factors: We face supply chain disruptions and cybersecurity risks.'),
    checks: [
      ['supply chain and cybersecurity risks are identified', o => o.item1ARiskSummary.includes('supply chain') && o.item1ARiskSummary.includes('cybersecurity')],
      ['no material change is flagged', o => o.hasMaterialChange === false]
    ]
  },
  {
    id: 'UC-106',
    tier: TIER_1,
    name: 'RMD at Age 95 (Uniform Lifetime Table Beyond Age 80)',
    run: () => calculateRMD(95, 1000000),
    checks: [
      ['uses the published factor 8.9 for age 95', o => o.distributionFactor === 8.9],
      ['RMD is $1,000,000 / 8.9 = $112,360', o => o.rmdRequired === 112360]
    ]
  },
  {
    id: 'UC-107',
    tier: TIER_1,
    name: 'Adviser Registration Record in the SEC IAPD Compilation Schema',
    run: () => parseIapdFirmRecord('<Firm><Info FirmCrdNb="900002" SECNb="802-900002" BusNm="SAMPLE RIDGE CAPITAL &amp; CO"/><Rgstn FirmType="ERA" St="ACTIVE" Dt="2022-01-10"/><Item11 Q11="Y"/><Item11C Q11C3="Y" Q11C5="N"/></Firm>'),
    checks: [
      ['an exempt reporting adviser is not counted as registered', o => o.exemptReportingAdviser === true && o.currentlyRegisteredWith.length === 0],
      ['Item 11 answers are grouped into disclosure categories', o => o.disclosures.anyReported === true && o.disclosures.categories[0].questions.join() === 'Q11C3']
    ]
  },

  // --- TIER 2: INTERMEDIATE MULTI-FACTOR USE CASES (7 VARIATIONS) ---
  {
    id: 'UC-201',
    tier: TIER_2,
    name: '3-Sleeve Portfolio Rebalance with 8-Point Equity Drift ($1M)',
    run: () => calculatePortfolioRebalance({ equity: 68, bond: 22, cash: 10 }, { equity: 60, bond: 30, cash: 10 }, 1000000),
    checks: [
      ['equity: SELL $80,000 (8 points of $1M)', o => planFor(o, 'equity').action === 'SELL' && planFor(o, 'equity').tradeAmount === 80000],
      ['bond: BUY $80,000', o => planFor(o, 'bond').action === 'BUY' && planFor(o, 'bond').tradeAmount === 80000],
      ['cash: HOLD with no trade', o => planFor(o, 'cash').action === 'HOLD' && planFor(o, 'cash').tradeAmount === 0],
      ['allocations sum to 100%, so there are no warnings', o => o.allocationWarnings.length === 0]
    ]
  },
  {
    id: 'UC-202',
    tier: TIER_2,
    name: '10-Year Historical 60/40 Portfolio Backtest',
    run: () => backtestPortfolio({ VTI: 0.6, BND: 0.4 }, 100000),
    checks: [
      ['covers ten annual returns, 2015-2024', o => o.sampleYears === 10 && o.dataPeriod === '2015-2024' && o.yearlyBalances.length === 11],
      ['CAGR agrees with the ending balance', o => near(((o.endingBalance / o.initialBalance) ** (1 / 10) - 1) * 100, o.metrics.cagrPercent, 0.01)],
      ['max drawdown is between 0% and 100%', o => o.metrics.maxDrawdownPercent >= 0 && o.metrics.maxDrawdownPercent < 100],
      ['Sharpe and Sortino are finite numbers', o => Number.isFinite(o.metrics.sharpeRatio) && Number.isFinite(o.metrics.sortinoRatio)]
    ]
  },
  {
    id: 'UC-203',
    tier: TIER_2,
    name: 'Client Meeting Transcript Decision & Action Item Extraction',
    run: () => parseMeetingTranscript("Client agreed to rebalance into bonds.\nAdvisor will send proposal next week."),
    checks: [
      ['one decision is extracted', o => o.extractedDecisionsCount === 1],
      ['one action item is extracted, due in 7 days ("next week")', o => o.extractedActionItemsCount === 1 && o.actionItems[0].dueDateDaysOut === 7]
    ]
  },
  {
    id: 'UC-204',
    tier: TIER_2,
    name: 'CIP Identity Verification (Screened vs. Unscreened Applicant)',
    run: () => {
      const applicant = { name: 'Arthur Pendelton', ssn: '123-45-6789', dob: '1985-04-12', address: '123 Main St' };
      return {
        screened: validateCipIdentity({ ...applicant, ofacStatus: 'CLEAR' }),
        unscreened: validateCipIdentity(applicant)
      };
    },
    checks: [
      ['a complete applicant with a CLEAR OFAC result passes with no flags', o => o.screened.cipPassed === true && o.screened.verificationFlags.length === 0],
      ['the same applicant with no OFAC result fails as NOT_SCREENED', o => o.unscreened.cipPassed === false && o.unscreened.ofacStatus === 'NOT_SCREENED']
    ]
  },
  {
    id: 'UC-205',
    tier: TIER_2,
    name: 'Tax-Loss Harvesting Scan (Single Loss Lot)',
    run: () => scanTaxLossHarvesting([{ id: 'LOT-1', symbol: 'IWM', quantity: 100, purchasePrice: 220, currentPrice: 150, purchaseDate: '2026-01-10' }], 1000, SALE_DATE),
    checks: [
      ['unrealized loss is 100 x (150 - 220) = -$7,000', o => o.opportunities[0].unrealizedLoss === -7000],
      ['replacement VB tracks a different index than IWM', o => {
        const lot = o.opportunities[0];
        return lot.recommendedReplacement === 'VB' && lot.replacementDetail.soldIndex !== lot.replacementDetail.replacementIndex;
      }],
      ['no other IWM lot was bought in the prior 30 days, so no wash-sale flag', o => o.opportunities[0].washSaleRisk === false],
      ['the substantially-identical determination is left to a human', o => o.opportunities[0].substantiallyIdenticalReviewRequired === true]
    ]
  },
  {
    id: 'UC-206',
    tier: TIER_2,
    name: 'Single-Account Pre-Trade Buy Validation',
    run: () => validatePreTradeCompliance({ settledCash: 25000 }, { symbol: 'VTI', action: 'BUY', quantity: 50, price: 275 }),
    checks: [
      ['estimated cost is 50 x $275 = $13,750', o => o.estimatedCost === 13750],
      ['passes because the cost is within $25,000 of settled cash', o => o.passed === true && o.errors.length === 0]
    ]
  },
  {
    id: 'UC-207',
    tier: TIER_2,
    name: 'Onboarding Workflow Progress Tracking',
    run: () => checkOnboardingStatus({ clientId: 'CL-8821', cipPassed: true, w9Signed: true, custodialAgreementSigned: false, accountFunded: false }),
    checks: [
      ['two of four steps complete = 50%', o => o.progressPercent === 50],
      ['not ready for trading, with two pending steps', o => o.isReadyForTrading === false && o.pendingSteps.length === 2]
    ]
  },

  // --- TIER 3: COMPLEX ENTERPRISE & HNW USE CASES (7 VARIATIONS) ---
  {
    id: 'UC-301',
    tier: TIER_3,
    name: 'HNW ($5M) Multi-Asset Drift Monitor + Tax-Loss Harvesting Scanner (5 Lots)',
    run: () => {
      const taxLots = [
        { id: 'LOT-1', symbol: 'IWM', quantity: 500, purchasePrice: 220, currentPrice: 150, purchaseDate: '2026-01-10' },
        { id: 'LOT-2', symbol: 'QQQ', quantity: 300, purchasePrice: 480, currentPrice: 410, purchaseDate: '2026-02-01' },
        { id: 'LOT-3', symbol: 'VTI', quantity: 1000, purchasePrice: 260, currentPrice: 275, purchaseDate: '2024-05-10' },
        { id: 'LOT-4', symbol: 'VNQ', quantity: 400, purchasePrice: 95, currentPrice: 80, purchaseDate: '2026-02-20' },
        { id: 'LOT-5', symbol: 'BND', quantity: 1200, purchasePrice: 76, currentPrice: 72, purchaseDate: '2025-11-15' }
      ];
      return {
        totalPortfolioValue: 5000000,
        tlhSummary: scanTaxLossHarvesting(taxLots, 1000, SALE_DATE),
        driftSummary: monitorPortfolioDrift(
          { US_Equity: 55, Intl_Equity: 25, Fixed_Income: 12, Cash: 8 },
          { US_Equity: 45, Intl_Equity: 20, Fixed_Income: 30, Cash: 5 },
          5000000,
          5.0
        )
      };
    },
    checks: [
      ['four lots show losses of at least $1,000 (VTI is at a gain)', o => o.tlhSummary.opportunities.length === 4],
      ['harvestable losses total $66,800 (35,000 + 21,000 + 6,000 + 4,800)', o => o.tlhSummary.totalHarvestableLosses === 66800],
      ['QQQ replacement tracks a different index (VUG, not QQQM)', o => {
        const qqq = lotFor(o.tlhSummary, 'QQQ');
        return qqq.recommendedReplacement === 'VUG' && qqq.replacementDetail.soldIndex !== qqq.replacementDetail.replacementIndex;
      }],
      ['no replacement is guessed for VNQ or BND', o => ['VNQ', 'BND'].every(sym => lotFor(o.tlhSummary, sym).recommendedReplacement === null)],
      ['drift breaches the 5-point band in US equity, intl equity and fixed income', o =>
        o.driftSummary.isRebalanceTriggered && o.driftSummary.breachedCategories.map(c => c.category).sort().join(',') === 'Fixed_Income,Intl_Equity,US_Equity']
    ]
  },
  {
    id: 'UC-302',
    tier: TIER_3,
    name: '5-Year Forward Monte Carlo Simulation (Stagflation, 3-Asset Portfolio)',
    run: () => forwardTestSimulation({ VTI: 0.5, VXUS: 0.2, BND: 0.3 }, 'stagflation', 5, 500, { rng: seededRandom(2026) }),
    checks: [
      ['expected return is the weighted sum of regime assumptions: 0.5(2%) + 0.2(1.5%) + 0.3(-1%) = 1.0%', o => o.expectedReturnPercent === 1],
      ['volatility is below the 16.6% weighted average of asset vols (diversification)', o => o.volatilityPercent < 16.6],
      ['percentiles are ordered p10 <= p50 <= p90', o => o.projections.downsidePercentile10 <= o.projections.medianPercentile50 && o.projections.medianPercentile50 <= o.projections.upsidePercentile90],
      ['the assumptions are disclosed as illustrative', o => /illustrative/.test(o.assumptionsSource)]
    ]
  },
  {
    id: 'UC-303',
    tier: TIER_3,
    name: 'Multi-Asset Asset-Class & Duration Exposure Analysis',
    run: () => analyzePortfolioFactors([{ symbol: 'VTI', weightPct: 50 }, { symbol: 'VXUS', weightPct: 20 }, { symbol: 'BND', weightPct: 30, durationYears: 6.0 }]),
    checks: [
      ['70% equity and 30% fixed income', o => o.assetClassBreakdown.equityPct === 70 && o.assetClassBreakdown.fixedIncomePct === 30],
      ['duration is the supplied 6.0 years with full coverage', o => o.fixedIncomeFactors.durationYears === 6 && o.fixedIncomeFactors.durationCoveragePct === 100],
      ['no factor scores were supplied, so none are reported', o => o.equityFactorExposures.valueFactorScore === null]
    ]
  },
  {
    id: 'UC-304',
    tier: TIER_3,
    name: 'Parametric Value at Risk (99%) & Expected Shortfall',
    run: () => calculatePortfolioVar(5000000, 0.16, 0.99, 1),
    checks: [
      ['z-score is the exact 99% normal quantile (2.3263)', o => o.zScore === 2.3263],
      ['VaR = $5M x 2.32635 x 16% / sqrt(252), within $1', o => near(o.valueAtRiskDollar, (5000000 * Z_99 * 0.16) / Math.sqrt(252), 1)],
      ['expected shortfall / VaR = phi(z) / (0.01 z) = 1.1457', o => near(o.conditionalVaR_ExpectedShortfallDollar / o.valueAtRiskDollar, 1.1457, 0.002)]
    ]
  },
  {
    id: 'UC-305',
    tier: TIER_3,
    name: 'Pre-Trade Sell Check: Oversell Error & Short-Term Gain Warning',
    run: () => validatePreTradeCompliance({ positions: { VTI: 60 } }, { symbol: 'VTI', action: 'SELL', quantity: 100, price: 275, holdingPeriodDays: 120 }),
    checks: [
      ['selling 100 shares against a 60-share position fails', o => o.passed === false && o.errors.length === 1 && /exceeds the 60 shares/.test(o.errors[0])],
      ['a 120-day holding period raises a short-term gain warning', o => o.warnings.length === 1 && /Short-term/.test(o.warnings[0])]
    ]
  },
  {
    id: 'UC-306',
    tier: TIER_3,
    name: 'Multi-Speaker Meeting Transcript Parsing & CRM Task Payload Builder',
    run: () => {
      const transcript = "Client agreed to rollover $500k 401k to IRA.\nAdvisor will draft tax illustration by Friday.\nOperations will issue ACAT transfer form.";
      const parsed = parseMeetingTranscript(transcript);
      const payload = buildCrmPayload('Salesforce_FSC', 'HH-HNW-9901', '2026-09-09', parsed.actionItems);
      return { transcriptParsed: parsed, crmSyncPayload: payload };
    },
    checks: [
      ['one decision and two action items are extracted', o => o.transcriptParsed.extractedDecisionsCount === 1 && o.transcriptParsed.extractedActionItemsCount === 2],
      ['the CRM payload carries both tasks for household HH-HNW-9901', o => o.crmSyncPayload.tasks.length === 2 && o.crmSyncPayload.householdId === 'HH-HNW-9901']
    ]
  },
  {
    id: 'UC-307',
    tier: TIER_3,
    name: 'Multi-Platform Adaptive UI Rendering (Claude, Codex, Cursor)',
    run: () => {
      const risk = calculatePortfolioVar(5000000, 0.16, 0.99, 1);
      const sample = {
        title: 'HNW Portfolio Review',
        summary: 'Rebalance triggered (+10 points US equity drift)',
        metrics: { Value: '$5,000,000', VaR99: '$' + risk.valueAtRiskDollar.toLocaleString('en-US') }
      };
      return {
        claudeFormat: renderAdaptiveUI(sample, 'claude'),
        codexFormat: renderAdaptiveUI(sample, 'codex'),
        cursorFormat: renderAdaptiveUI(sample, 'cursor')
      };
    },
    checks: [
      ['Claude output uses an alert and a bold-key metrics table', o => o.claudeFormat.includes('[!IMPORTANT]') && o.claudeFormat.includes('| **VaR99** |')],
      ['Codex output uses an H1 title and a metrics table', o => o.codexFormat.includes('# HNW Portfolio Review') && o.codexFormat.includes('| VaR99 |')],
      ['Cursor output uses an H3 title', o => o.cursorFormat.includes('### HNW Portfolio Review')]
    ]
  }
];

export function evaluateUseCase(useCase) {
  const { id, tier, name } = useCase;

  const start = performance.now();
  let output;
  try {
    output = useCase.run();
  } catch (err) {
    return { id, tier, name, status: 'FAILED', durationMs: null, output: null, checks: [], failures: [`threw: ${err.message}`] };
  }
  const durationMs = parseFloat((performance.now() - start).toFixed(3));

  const failures = [];
  const checks = useCase.checks.map(([description, predicate]) => {
    let passed = false;
    try {
      passed = predicate(output) === true;
    } catch {
      passed = false;
    }
    if (!passed) failures.push(description);
    return { description, passed };
  });

  // A use case with nothing to check cannot pass.
  if (checks.length === 0) failures.push('no checks defined');

  return { id, tier, name, status: failures.length === 0 ? 'PASSED' : 'FAILED', durationMs, output, checks, failures };
}

export function runProofs() {
  return USE_CASES.map(evaluateUseCase);
}

function renderDocument(results, generatedAt) {
  const passedCount = results.filter(r => r.status === 'PASSED').length;
  const latency = (r) => (r.durationMs === null ? 'n/a' : `\`${r.durationMs} ms\``);

  let doc = `# Empirical Test Proofs: ${results.length} Use-Case Variations

Generated by \`npm run proofs\` ([bin/run-empirical-proofs.js](../bin/run-empirical-proofs.js)) on ${generatedAt}.

Each use case runs a library function on fixed inputs and evaluates the checks listed under it. **PASSED means every check held; FAILED lists the checks that did not.** Expected values are derived independently of the engine wherever possible (published IRS figures, arithmetic on the inputs, or closed-form formulas), and the same checks run in CI through \`tests/empirical.test.js\`. Latencies are single-run wall-clock timings on the generating machine and are indicative only.

**Result: ${passedCount} of ${results.length} use cases passed.**

---

## Summary

| ID | Tier | Use Case | Checks Held | Latency | Status |
|---|---|---|---|---|---|
`;

  for (const r of results) {
    const held = r.checks.filter(c => c.passed).length;
    doc += `| **${r.id}** | ${r.tier} | ${r.name} | ${held}/${r.checks.length} | ${latency(r)} | ${r.status === 'PASSED' ? '✅ PASSED' : '❌ FAILED'} |\n`;
  }

  doc += `\n---\n\n## Detailed Results\n\n`;

  for (const r of results) {
    doc += `### ${r.id}: ${r.name} (${r.tier})\n\n`;
    doc += `- **Status**: \`${r.status}\`\n`;
    doc += `- **Latency**: ${latency(r)}\n`;
    doc += `- **Checks**:\n`;
    for (const c of r.checks) doc += `  - ${c.passed ? '✅' : '❌'} ${c.description}\n`;
    for (const f of r.failures.filter(msg => msg.startsWith('threw:') || msg === 'no checks defined')) doc += `  - ❌ ${f}\n`;
    doc += `\n\`\`\`json\n${JSON.stringify(r.output, null, 2)}\n\`\`\`\n\n---\n\n`;
  }

  return doc;
}

function isMainModule() {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  console.log(`Running ${USE_CASES.length} empirical use-case proofs...`);
  const results = runProofs();
  fs.writeFileSync(OUTPUT_PATH, renderDocument(results, new Date().toISOString()), 'utf-8');

  const failed = results.filter(r => r.status !== 'PASSED');
  for (const r of failed) console.error(`FAILED ${r.id}: ${r.failures.join('; ')}`);

  console.log(`${results.length - failed.length} of ${results.length} use cases passed.`);
  console.log(`Wrote ${OUTPUT_PATH}`);
  if (failed.length > 0) process.exitCode = 1;
}
