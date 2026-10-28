import test from 'node:test';
import assert from 'node:assert/strict';
import { scanFinraRule2210 } from '../src/engines/compliance.js';

test('Compliance Engine: FINRA Rule 2210 Scanner Catches Prohibited Guarantee', () => {
  const result = scanFinraRule2210('We promise a guaranteed 15% return on your investment.');

  assert.equal(result.isCompliant, false);
  assert.equal(result.screenStatus, 'VIOLATION');
  assert.deepEqual(result.prohibitedTermsFound, ['guaranteed 15%']);
  assert.ok(result.complianceScore < 100);
});

test('Compliance Engine: Missing Disclosures Mean Not Compliant', () => {
  const result = scanFinraRule2210('Our fund returned 40% last year. Invest now.');

  assert.equal(result.isCompliant, false);
  assert.equal(result.screenStatus, 'NEEDS_REVIEW');
  assert.equal(result.missingDisclaimers.length, 3);
  assert.ok(result.complianceScore < 100);
});

test('Compliance Engine: Passing The Screen Is Not Presented As Rule 2210 Approval', () => {
  const result = scanFinraRule2210('Past performance is no guarantee of future results. Investments are subject to market risk and may lose value.');

  assert.equal(result.isCompliant, true);
  assert.equal(result.screenStatus, 'PASSED_AUTOMATED_SCREEN');
  assert.equal(result.requiresPrincipalReview, true);
  assert.doesNotMatch(result.regulatoryNotice, /passed FINRA Rule 2210/i);
});

test('Compliance Engine: Catches Guarantees At Any Percentage And Typographic Variants', () => {
  const cases = [
    ['We guarantee 12% annually.', 'guarantee 12%'],
    ['A guaranteed 7.5% yield.', 'guaranteed 7.5%'],
    ['You can’t lose.', "can't lose"],
    ['It is risk‑free.', 'risk-free'],
    ['Guaranteed income for life.', 'guaranteed income']
  ];

  for (const [text, phrase] of cases) {
    const result = scanFinraRule2210(text);
    assert.ok(result.prohibitedTermsFound.includes(phrase), `${text} -> ${JSON.stringify(result.prohibitedTermsFound)}`);
  }
});

import { checkSuitability, checkPerformanceAdvertisement } from '../src/engines/compliance.js';

const RETIREE = { age: 72, otherInvestments: 'CDs', financialSituation: 'retired', taxStatus: '12%', investmentObjectives: 'income', investmentExperience: 'limited', timeHorizonYears: 3, liquidityNeeds: 'high', riskTolerance: 'conservative', investableAssets: 400000 };

test('Compliance Engine: An Illiquid, Risky, Long-Dated Product Is Flagged For A Conservative Retiree', () => {
  const result = checkSuitability(RETIREE, { riskLevel: 4, minimumHorizonYears: 7, liquidity: 'illiquid', amount: 150000 }, { limits: { maxPositionPct: 25 } });

  assert.equal(result.status, 'FLAGGED');
  assert.deepEqual(result.flags.map(f => f.check).sort(), ['concentration', 'liquidity', 'risk', 'time horizon']);
  assert.equal(result.metrics.positionPctOfInvestableAssets, 37.5);
  assert.equal(result.requiresHumanApproval, true);
});

test('Compliance Engine: Missing Profile Factors Mean No View Rather Than A Pass', () => {
  const result = checkSuitability({ riskTolerance: 'moderate' }, { riskLevel: 2 });

  assert.equal(result.status, 'NEEDS_INFORMATION');
  assert.equal(result.missingProfileFactors.length, 8);
});

test('Compliance Engine: Turnover Is Reported But Only Flagged Against Firm Limits', () => {
  const activity = { averageEquity: 100000, purchases: 800000, costs: 25000 };
  const unlimited = checkSuitability(RETIREE, { riskLevel: 1 }, { activity });
  assert.equal(unlimited.metrics.annualTurnover, 8);
  assert.equal(unlimited.metrics.annualCostEquityPct, 25);
  assert.ok(!unlimited.flags.some(f => f.obligation === 'quantitative')); // FINRA 2111 sets no numeric threshold

  const limited = checkSuitability(RETIREE, { riskLevel: 1 }, { activity, limits: { maxTurnover: 6, maxCostEquityPct: 20 } });
  assert.equal(limited.flags.filter(f => f.obligation === 'quantitative').length, 2);
});

test('Compliance Engine: Gross Performance Without Net And Missing Periods Violate 206(4)-1(d)', () => {
  const result = checkPerformanceAdvertisement(
    { showsGrossPerformance: true, showsNetPerformance: false, isPrivateFund: false, portfolioInceptionDate: '2014-01-01', periodEndDate: '2025-12-31', periodsShown: ['1y', '5y'] },
    { asOf: '2026-09-13' }
  );

  assert.ok(result.violations.some(v => v.paragraph === '(d)(1)'));
  assert.ok(result.violations.some(v => v.paragraph === '(d)(2)' && /10y/.test(v.detail)));
  assert.equal(result.compliantWithPerformanceProvisions, false);
});

test('Compliance Engine: A Young Portfolio Substitutes Its Life For Longer Periods', () => {
  const result = checkPerformanceAdvertisement(
    { showsGrossPerformance: true, showsNetPerformance: true, netWithEqualProminence: true, netSamePeriodAndMethod: true, isPrivateFund: false, portfolioInceptionDate: '2023-03-01', periodEndDate: '2025-12-31', periodsShown: ['1y', 'life'] },
    { asOf: '2026-09-13' }
  );

  assert.deepEqual(result.requiredPeriods, ['1y', 'life']);
  assert.equal(result.compliantWithPerformanceProvisions, true);
});

test('Compliance Engine: Stale Periods, Extracted And Hypothetical Performance Are Checked', () => {
  const stale = checkPerformanceAdvertisement({ isPrivateFund: false, portfolioInceptionDate: '2010-01-01', periodEndDate: '2024-12-31', periodsShown: ['1y', '5y', '10y'] }, { asOf: '2026-09-13' });
  assert.ok(stale.violations.some(v => /calendar year-end/.test(v.requirement)));

  const extracted = checkPerformanceAdvertisement({ isPrivateFund: true, extractedPerformance: true, offersTotalPortfolioPerformance: false }, { asOf: '2026-09-13' });
  assert.ok(extracted.violations.some(v => v.paragraph === '(d)(5)'));

  const hypothetical = checkPerformanceAdvertisement({ isPrivateFund: true, hypotheticalPerformance: true, hypotheticalPoliciesAdopted: true, hypotheticalAssumptionsExplained: false }, { asOf: '2026-09-13' });
  assert.ok(hypothetical.violations.some(v => v.paragraph === '(d)(6)(ii)'));
  assert.ok(hypothetical.unanswered.some(u => u.field === 'hypotheticalRisksExplained'));
});
