import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { listCapabilities, requiredInputs, missingInputs, guidanceFor, withGuidance, inputError } from '../src/engines/guidance.js';
import { validateCipIdentity } from '../src/engines/onboarding.js';
import { monitorPortfolioDrift, scanTaxLossHarvesting } from '../src/engines/portfolio.js';
import { calculateCollarStrategy } from '../src/engines/uhnw.js';
import { scanFinraRule2210 } from '../src/engines/compliance.js';

test('Guidance: Every Capability Describes Itself And Its Inputs', () => {
  const capabilities = listCapabilities();
  assert.ok(capabilities.length >= 20);

  for (const capability of capabilities) {
    assert.ok(capability.summary, `${capability.tool} has no summary`);
    assert.ok(capability.typicalRequests.length > 0, `${capability.tool} lists no typical requests`);
    assert.ok(capability.inputs.some(input => input.required), `${capability.tool} marks no required input`);
    for (const input of capability.inputs) {
      // Some questions add a clarifying sentence after the question mark, which is fine.
      assert.ok(input.question.includes('?'), `${capability.tool}.${input.field} is not phrased as a question`);
      assert.ok(input.why, `${capability.tool}.${input.field} gives no reason`);
    }
  }
});

test('Guidance: Every Tool The CLI Reports Has Guidance', () => {
  // Guards against a new CLI command shipping without questions or suggestions.
  const cli = fs.readFileSync(new URL('../bin/wealth-skills.js', import.meta.url), 'utf8');
  const cliTools = [...cli.matchAll(/tool: '([a-z-]+ [a-z-]+)'/g)].map(match => match[1]);
  const known = new Set(listCapabilities().map(capability => capability.tool));

  assert.ok(cliTools.length >= 15);
  for (const tool of cliTools) {
    assert.ok(known.has(tool), `CLI reports "${tool}" but guidance.js has no entry for it`);
  }
});

test('Guidance: Missing Required Inputs Become Questions', () => {
  assert.deepEqual(missingInputs('planning tax-headroom', {}).map(input => input.field), ['agi', 'filingStatus']);
  assert.deepEqual(missingInputs('planning tax-headroom', { agi: 210000, filingStatus: 'MFJ' }), []);
  assert.equal(requiredInputs('planning tax-headroom').length, 2);
});

test('Guidance: An Unscreened Applicant Produces The OFAC Question', () => {
  const unscreened = validateCipIdentity({ name: 'Jane Doe', ssn: '123-45-6789', dob: '1990-05-15', address: '456 Elm St' });
  const { needsInput } = guidanceFor('onboarding validate-cip', unscreened);

  assert.equal(needsInput.length, 1);
  assert.equal(needsInput[0].field, 'ofacStatus');
  assert.match(needsInput[0].question, /OFAC/);

  const screened = validateCipIdentity({ name: 'Jane Doe', ssn: '123-45-6789', dob: '1990-05-15', address: '456 Elm St', ofacStatus: 'CLEAR' });
  assert.deepEqual(guidanceFor('onboarding validate-cip', screened).needsInput, []);
});

test('Guidance: A Drift Breach Suggests Harvesting And Validation First', () => {
  const breached = monitorPortfolioDrift({ equity: 68, fixedIncome: 32 }, { equity: 60, fixedIncome: 40 }, 1000000, 5);
  const tools = guidanceFor('portfolio drift-monitor', breached).suggestedNextSteps.map(s => s.tool);
  assert.deepEqual(tools, ['portfolio tlh', 'execution validate', null]);

  const inBand = monitorPortfolioDrift({ equity: 61, fixedIncome: 39 }, { equity: 60, fixedIncome: 40 }, 1000000, 5);
  assert.ok(guidanceFor('portfolio drift-monitor', inBand).suggestedNextSteps.every(s => s.tool === null));
});

test('Guidance: Every Suggestion Explains Itself', () => {
  const results = [
    ['portfolio tlh', scanTaxLossHarvesting([{ id: 'L1', symbol: 'VOO', quantity: 100, purchasePrice: 500, currentPrice: 400, purchaseDate: '2020-01-01' }], 1000, new Date('2026-06-30'))],
    ['uhnw collar', calculateCollarStrategy('AAPL', 1000, 200, 25)],
    ['compliance scan', scanFinraRule2210('We offer a guaranteed 15% return.')]
  ];

  for (const [tool, result] of results) {
    const { suggestedNextSteps } = guidanceFor(tool, result);
    assert.ok(suggestedNextSteps.length > 0, `${tool} suggests nothing`);
    for (const suggestion of suggestedNextSteps) {
      assert.ok(suggestion.why, `${tool} suggestion has no reason`);
      assert.ok(suggestion.tool || suggestion.action, `${tool} suggestion names neither a tool nor an action`);
    }
  }
});

test('Guidance: A Collar Without Premiums Asks For Quotes', () => {
  const noQuotes = guidanceFor('uhnw collar', calculateCollarStrategy('AAPL', 1000, 200, 25));
  assert.equal(noQuotes.needsInput[0].field, 'premiums');

  const quoted = guidanceFor('uhnw collar', calculateCollarStrategy('AAPL', 1000, 200, 25, { putPremium: 4.1, callPremium: 4.12 }));
  assert.deepEqual(quoted.needsInput, []);
});

test('Guidance: Harvesting Without A Defined Replacement Asks Which Fund', () => {
  const bonds = scanTaxLossHarvesting([{ id: 'L1', symbol: 'BND', quantity: 1000, purchasePrice: 80, currentPrice: 70, purchaseDate: '2020-01-01' }], 1000, new Date('2026-06-30'));
  const { needsInput } = guidanceFor('portfolio tlh', bonds);

  assert.equal(needsInput[0].field, 'replacement');
  assert.match(needsInput[0].question, /BND/);
});

test('Guidance: Unknown Tools And Non-Objects Pass Through Untouched', () => {
  assert.deepEqual(guidanceFor('not a tool', { a: 1 }), { needsInput: [], suggestedNextSteps: [] });
  assert.deepEqual(withGuidance({ a: 1 }, 'not a tool'), { a: 1 });
  assert.equal(withGuidance('a string', 'portfolio var'), 'a string');
  assert.ok(!('needsInput' in withGuidance(scanFinraRule2210('Past performance is no guarantee of future results. Subject to market risk and may lose value.'), 'compliance scan')));
});

test('Guidance: inputError Carries The Question To Ask', () => {
  const error = inputError('missing thing', [{ field: 'conid', question: 'What is the conid?', why: 'routing' }]);

  assert.ok(error instanceof Error);
  assert.equal(error.message, 'missing thing');
  assert.equal(error.needsInput[0].field, 'conid');
});

// --- Every tool, exercised on a real engine result -------------------------------------------

import { calculateTaxBracketHeadroom, calculateRMD, runMonteCarloCashFlow } from '../src/engines/planning.js';
import { calculatePortfolioRebalance, calculatePortfolioVar, analyzePortfolioFactors } from '../src/engines/portfolio.js';
import { backtestPortfolio, forwardTestSimulation } from '../src/engines/quant.js';
import { validatePreTradeCompliance, buildTradePayload } from '../src/engines/execution.js';
import { buildFixOrderPayload } from '../src/engines/fix.js';
import { lookupAdviserRegistration } from '../src/engines/registration.js';
import { calculatePeMetrics } from '../src/engines/uhnw.js';
import { generateCompanyTearSheet } from '../src/engines/research.js';
import { parseMeetingTranscript } from '../src/engines/crm.js';
import { netCapitalGainsAndLosses, calculateNetInvestmentIncomeTax, calculateCostBasis } from '../src/engines/tax.js';
import { calculateTimeWeightedReturn, calculateMoneyWeightedReturn, assessSharpeRatio } from '../src/engines/performance.js';
import { validateSecurityIdentifier, calculateSettlementDate } from '../src/engines/markets.js';
import { identifyOnboardingGaps } from '../src/engines/onboarding.js';
import { checkSuitability, checkPerformanceAdvertisement } from '../src/engines/compliance.js';
import { buildDcfValuation } from '../src/engines/research.js';
import { reconcileLedger, tieOutNav, checkLpCapitalStatement, trackCloseChecklist } from '../src/engines/fundops.js';

const SALE_DATE = new Date('2026-06-30');
const IAPD_FIXTURE = new URL('./fixtures/iapd/sec-firms.xml', import.meta.url).pathname;
const IAPD_LOOKUP = await lookupAdviserRegistration({ feedPath: IAPD_FIXTURE, crd: '900002', asOf: '2026-09-13' });
const LOSS_LOT = { id: 'L1', symbol: 'VOO', quantity: 100, purchasePrice: 500, currentPrice: 400, purchaseDate: '2020-01-01' };
const ORDER = { symbol: 'VTI', action: 'BUY', quantity: 50, price: 275 };

// One real result per registered tool, so guidance is never checked against a hand-written shape.
const RESULTS = {
  'planning tax-headroom': () => calculateTaxBracketHeadroom(210000, 'MFJ'),
  'planning rmd': () => calculateRMD(75, 500000),
  'planning monte-carlo': () => runMonteCarloCashFlow(1000000, 40000, 0.06, 0.12, 10, 10),
  'portfolio drift-monitor': () => monitorPortfolioDrift({ equity: 68, fixedIncome: 32 }, { equity: 60, fixedIncome: 40 }, 1000000, 5),
  'portfolio rebalance': () => calculatePortfolioRebalance({ equity: 68, fixedIncome: 32 }, { equity: 60, fixedIncome: 40 }, 1000000),
  'portfolio var': () => calculatePortfolioVar(1000000, 0.14, 0.95, 1),
  'portfolio factors': () => analyzePortfolioFactors([{ symbol: 'VTI', weightPct: 60 }, { symbol: 'BND', weightPct: 40 }]),
  'portfolio tlh': () => scanTaxLossHarvesting([LOSS_LOT], 1000, SALE_DATE),
  'quant backtest': () => backtestPortfolio({ VTI: 0.6, BND: 0.4 }, 100000),
  'quant forward-test': () => forwardTestSimulation({ VTI: 0.6, BND: 0.4 }, 'baseline', 2, 10),
  'execution validate': () => validatePreTradeCompliance({ settledCash: 25000 }, ORDER),
  'execution payload': () => buildTradePayload('Alpaca', 'ACC-1', ORDER),
  'execution fix-payload': () => buildFixOrderPayload({ symbol: 'VTI', quantity: 10, price: 275 }),
  'onboarding validate-cip': () => validateCipIdentity({ name: 'Jane Doe', ssn: '123-45-6789', dob: '1990-05-15', address: '456 Elm St', ofacStatus: 'CLEAR' }),
  'compliance scan': () => scanFinraRule2210('We offer a guaranteed 15% return.'),
  'compliance lookup': () => IAPD_LOOKUP,
  'uhnw collar': () => calculateCollarStrategy('AAPL', 1000, 200, 25),
  'uhnw pe-metrics': () => calculatePeMetrics(5000000, 3000000, 1200000, 3200000),
  'research tear-sheet': () => generateCompanyTearSheet('AAPL', { marketCap: 3.25e12, price: 215, eps: 7.3, revenue: 3.8e11 }),
  'crm parse-transcript': () => parseMeetingTranscript('Client agreed to rebalance.\nAdvisor will send the proposal next week.'),
  'planning capital-losses': () => netCapitalGainsAndLosses({ shortTermLosses: 10000, longTermGains: 4000 }),
  'planning niit': () => calculateNetInvestmentIncomeTax({ magi: 300000, netInvestmentIncome: 80000 }),
  'portfolio cost-basis': () => calculateCostBasis({ lots: [{ id: 'A', quantity: 100, price: 50, date: '2024-01-10' }, { id: 'B', quantity: 100, price: 80, date: '2025-09-01' }], sale: { quantity: 150, date: '2026-03-01', price: 90 } }),
  'portfolio twr': () => calculateTimeWeightedReturn([{ date: '2026-01-01', value: 100000 }, { date: '2026-12-31', value: 110000 }]),
  'portfolio irr': () => calculateMoneyWeightedReturn([{ date: '2025-01-01', amount: -1000 }, { date: '2026-01-01', amount: 1100 }]),
  'quant sharpe-stats': () => assessSharpeRatio([0.02, -0.01, 0.015, 0.005, -0.004, 0.012]),
  'execution identifier': () => validateSecurityIdentifier('US0378331005'),
  'execution settlement-date': () => calculateSettlementDate('2026-09-11'),
  'onboarding gaps': () => identifyOnboardingGaps({ accountType: 'individual', applicants: [{ name: 'Jane Doe' }], asOf: '2026-09-13' }),
  'compliance suitability': () => checkSuitability({ riskTolerance: 'conservative' }, { riskLevel: 4 }),
  'compliance performance-ad': () => checkPerformanceAdvertisement({ showsGrossPerformance: true, showsNetPerformance: false, isPrivateFund: true }, { asOf: '2026-09-13' }),
  'research dcf': () => buildDcfValuation({ freeCashFlows: [100, 110], discountRate: 0.09, terminalGrowthRate: 0.02 }),
  'fundops reconcile': () => reconcileLedger([{ account: 'A', security: 'X', quantity: 1, marketValue: 10 }], [{ account: 'A', security: 'X', quantity: 2, marketValue: 20 }]),
  'fundops nav-tieout': () => tieOutNav({ assets: [{ name: 'Private co', value: 100, level: 3 }], unitsOutstanding: 10 }),
  'fundops lp-statement': () => checkLpCapitalStatement({ beginningBalance: 100, contributions: 0, distributions: 0, incomeAllocation: 0, realizedGainLoss: 0, unrealizedGainLoss: 0, managementFees: 0, performanceAllocation: 0, otherExpenses: 0, endingBalance: 100 }),
  'fundops close-status': () => trackCloseChecklist([{ id: 'a', name: 'A', status: 'not_started', due: '2026-09-01' }], { asOf: '2026-09-07' })
};

test('Guidance: Every Registered Tool Has A Result To Exercise It', () => {
  const registered = listCapabilities().map(capability => capability.tool).sort();
  assert.deepEqual(Object.keys(RESULTS).sort(), registered);
});

test('Guidance: Every Tool Produces Well-Formed Guidance On A Real Result', () => {
  for (const [tool, produce] of Object.entries(RESULTS)) {
    const { needsInput, suggestedNextSteps } = guidanceFor(tool, produce());

    assert.ok(Array.isArray(needsInput) && Array.isArray(suggestedNextSteps), `${tool} returned a non-array`);
    assert.ok(suggestedNextSteps.length > 0, `${tool} suggests nothing at all`);

    for (const question of needsInput) {
      assert.ok(question.field && question.question && question.why, `${tool} has an incomplete question`);
    }
    for (const suggestion of suggestedNextSteps) {
      assert.ok(suggestion.why, `${tool} has a suggestion with no reason`);
      assert.ok(suggestion.tool || suggestion.action, `${tool} has a suggestion naming neither tool nor action`);
    }
  }
});

test('Guidance: Suggested Tools Always Name A Tool That Exists', () => {
  // A typo here would route an agent to a command that does not exist.
  const known = new Set(listCapabilities().map(capability => capability.tool));

  for (const [tool, produce] of Object.entries(RESULTS)) {
    for (const suggestion of guidanceFor(tool, produce()).suggestedNextSteps) {
      if (suggestion.tool !== null) {
        assert.ok(known.has(suggestion.tool), `${tool} suggests unknown tool "${suggestion.tool}"`);
      }
    }
  }
});

// --- Per-tool behavior ------------------------------------------------------------------------

test('Guidance: Bracket Headroom Suggests Checking The RMD, Unless The Bracket Is Full', () => {
  const withRoom = guidanceFor('planning tax-headroom', calculateTaxBracketHeadroom(210000, 'MFJ'));
  assert.ok(withRoom.suggestedNextSteps.some(step => step.tool === 'planning rmd'));

  // $900k of AGI lands in the top bracket, where there is no headroom left to fill.
  const topBracket = guidanceFor('planning tax-headroom', calculateTaxBracketHeadroom(900000, 'MFJ'));
  assert.ok(topBracket.suggestedNextSteps.every(step => step.tool !== 'planning rmd'));
});

test('Guidance: An RMD Suggests Re-Checking Headroom And Flags The Spouse Table', () => {
  const due = guidanceFor('planning rmd', calculateRMD(75, 500000));
  assert.ok(due.suggestedNextSteps.some(step => step.tool === 'planning tax-headroom'));
  assert.ok(due.suggestedNextSteps.some(step => /10 years younger/.test(step.action ?? '')));

  const notYet = guidanceFor('planning rmd', calculateRMD(70, 500000));
  assert.ok(notYet.suggestedNextSteps.every(step => step.tool === null));
});

test('Guidance: Pre-Trade Failures Ask For The Cash Or Position That Was Missing', () => {
  const noCash = guidanceFor('execution validate', validatePreTradeCompliance({}, ORDER));
  assert.ok(noCash.needsInput.some(question => question.field === 'settledCash'));

  const noPosition = guidanceFor('execution validate', validatePreTradeCompliance({ settledCash: 1e6 }, { ...ORDER, action: 'SELL' }));
  assert.ok(noPosition.needsInput.some(question => question.field === 'positions'));

  const noPrice = guidanceFor('execution validate', validatePreTradeCompliance({ settledCash: 1e6 }, { symbol: 'VTI', action: 'BUY', quantity: 10 }));
  assert.ok(noPrice.needsInput.some(question => question.field === 'price'));

  const passed = guidanceFor('execution validate', validatePreTradeCompliance({ settledCash: 25000 }, ORDER));
  assert.deepEqual(passed.needsInput, []);
  assert.ok(passed.suggestedNextSteps.some(step => step.tool === 'execution payload'));
});

test('Guidance: Factor Analysis Asks For The Inputs It Has No Model For', () => {
  const sparse = guidanceFor('portfolio factors', analyzePortfolioFactors([
    { symbol: 'ZZZZ', weightPct: 20 },
    { symbol: 'VTI', weightPct: 50 },
    { symbol: 'BND', weightPct: 30 }
  ]));
  const fields = sparse.needsInput.map(question => question.field);

  assert.ok(fields.includes('assetClass'));
  assert.ok(fields.includes('durationYears'));
  assert.ok(fields.includes('factorScores'));
  assert.match(sparse.needsInput.find(q => q.field === 'assetClass').question, /ZZZZ/);

  const complete = guidanceFor('portfolio factors', analyzePortfolioFactors([
    { symbol: 'VTI', weightPct: 60, factorScores: { value: 0.4 } },
    { symbol: 'BND', weightPct: 40, durationYears: 6 }
  ]));
  assert.deepEqual(complete.needsInput, []);
});

test('Guidance: A Communication Missing Disclosures Asks Whether To Add Them', () => {
  const missing = guidanceFor('compliance scan', scanFinraRule2210('Our fund returned 40% last year.'));
  assert.equal(missing.needsInput[0].field, 'disclosures');

  const violation = guidanceFor('compliance scan', scanFinraRule2210('We offer a guaranteed 15% return.'));
  assert.ok(violation.suggestedNextSteps.some(step => /Rewrite/.test(step.action ?? '')));

  const clean = scanFinraRule2210('Past performance is no guarantee of future results. Investments are subject to market risk and may lose value.');
  assert.deepEqual(guidanceFor('compliance scan', clean).needsInput, []);
  assert.ok(guidanceFor('compliance scan', clean).suggestedNextSteps.some(step => /principal/.test(step.action ?? '')));
});

test('Guidance: A Registration Lookup Escalates Disclosures And Always Points At BrokerCheck', async () => {
  const withDisclosures = guidanceFor('compliance lookup', IAPD_LOOKUP).suggestedNextSteps;
  assert.ok(withDisclosures.some(step => /escalate to compliance/.test(step.action ?? '')));
  assert.ok(withDisclosures.some(step => /BrokerCheck by hand/.test(step.action ?? '')));

  const miss = await lookupAdviserRegistration({ feedPath: IAPD_FIXTURE, crd: '1', asOf: '2026-09-13' });
  assert.ok(guidanceFor('compliance lookup', miss).suggestedNextSteps.some(step => /other IAPD compilation files/.test(step.action ?? '')));

  const stale = await lookupAdviserRegistration({ feedPath: IAPD_FIXTURE, crd: '900001', asOf: '2026-12-01' });
  assert.ok(guidanceFor('compliance lookup', stale).suggestedNextSteps.some(step => /Download a current file/.test(step.action ?? '')));

  const ambiguous = await lookupAdviserRegistration({ feedPath: IAPD_FIXTURE, name: 'capital', asOf: '2026-09-13' });
  assert.match(guidanceFor('compliance lookup', ambiguous).needsInput[0].question, /2 records match "capital"/);
});

test('Guidance: A Narrow Collar Adds A Widen-The-Strikes Suggestion', () => {
  const wide = guidanceFor('uhnw collar', calculateCollarStrategy('AAPL', 1000, 200, 25));
  assert.ok(wide.suggestedNextSteps.every(step => !/widening/.test(step.action ?? '')));

  const tight = guidanceFor('uhnw collar', calculateCollarStrategy('AAPL', 1000, 200, 25, { putStrikePct: 0.95, callStrikePct: 1.05 }));
  assert.ok(tight.suggestedNextSteps.some(step => /widening/.test(step.action ?? '')));
  assert.ok(tight.suggestedNextSteps.some(step => /§1259/.test(step.action ?? '')));
});

test('Guidance: Harvesting With A Known Replacement Asks Nothing But Still Warns', () => {
  const harvest = scanTaxLossHarvesting([LOSS_LOT], 1000, SALE_DATE);
  const { needsInput, suggestedNextSteps } = guidanceFor('portfolio tlh', harvest);

  assert.deepEqual(needsInput, []);
  assert.ok(suggestedNextSteps.some(step => /30 days after/.test(step.action ?? '')));
  assert.ok(suggestedNextSteps.some(step => /substantially identical/.test(step.action ?? '')));

  const nothingToHarvest = scanTaxLossHarvesting([{ ...LOSS_LOT, currentPrice: 505 }], 1000, SALE_DATE);
  assert.ok(guidanceFor('portfolio tlh', nothingToHarvest).suggestedNextSteps.every(step => step.tool === null));
});

test('Guidance: New Tools Ask The Questions Their Engines Cannot Answer', () => {
  const settlement = guidanceFor('execution settlement-date', calculateSettlementDate('2026-09-11'));
  assert.equal(settlement.needsInput[0].field, 'holidays');

  const suitability = guidanceFor('compliance suitability', checkSuitability({ riskTolerance: 'moderate' }, { riskLevel: 2 }));
  assert.equal(suitability.needsInput.length, 8);
  assert.ok(suitability.needsInput.every(q => q.field.startsWith('profile.')));

  const nav = guidanceFor('fundops nav-tieout', tieOutNav({ assets: [{ name: 'Private co', value: 100, level: 3 }], unitsOutstanding: 10 }));
  assert.equal(nav.needsInput[0].field, 'priceDate');

  const gaps = guidanceFor('onboarding gaps', identifyOnboardingGaps({ accountType: 'individual', applicants: [{ name: 'Jane Doe' }], asOf: '2026-09-13' }));
  assert.ok(gaps.needsInput.length > 0 && gaps.needsInput.length <= 8);
});
