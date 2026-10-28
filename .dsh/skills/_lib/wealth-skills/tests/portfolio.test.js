import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePortfolioRebalance, scanTaxLossHarvesting, monitorPortfolioDrift, analyzePortfolioFactors, calculatePortfolioVar } from '../src/engines/portfolio.js';

test('Portfolio Engine: Rebalance Calculation', () => {
  const current = { equity: 68, bond: 22 };
  const target = { equity: 60, bond: 30 };
  const result = calculatePortfolioRebalance(current, target, 1000000);

  assert.equal(result.rebalancePlan.length, 2);
  const equityPlan = result.rebalancePlan.find(p => p.category === 'equity');
  assert.equal(equityPlan.action, 'SELL');
  assert.equal(equityPlan.tradeAmount, 80000);
});

test('Portfolio Engine: Portfolio Drift Monitor Breaches Threshold', () => {
  const current = { equity: 68, bond: 22 }; // 8% drift > 5% band
  const target = { equity: 60, bond: 30 };
  const result = monitorPortfolioDrift(current, target, 1000000, 5.0);

  assert.equal(result.isRebalanceTriggered, true);
  assert.equal(result.breachedCategories.length, 2);
  assert.ok(result.urgencyScore >= 50);
});

test('Portfolio Engine: Factor Exposure Analysis', () => {
  const holdings = [{ symbol: 'VTI', weightPct: 60 }, { symbol: 'BND', weightPct: 40 }];
  const result = analyzePortfolioFactors(holdings);

  assert.equal(result.assetClassBreakdown.equityPct, 60);
  assert.equal(result.assetClassBreakdown.fixedIncomePct, 40);
  // No factor or duration inputs were supplied, so nothing is invented.
  assert.equal(result.equityFactorExposures.valueFactorScore, null);
  assert.equal(result.fixedIncomeFactors.durationYears, null);
});

test('Portfolio Engine: Value at Risk (VaR) Calculation', () => {
  const result = calculatePortfolioVar(1000000, 0.14, 0.95, 1);

  assert.equal(result.confidenceLevelPercent, 95);
  assert.ok(result.valueAtRiskDollar > 0);
  assert.ok(result.conditionalVaR_ExpectedShortfallDollar > result.valueAtRiskDollar);
});

test('Portfolio Engine: Tax Loss Harvesting Scanner', () => {
  const lots = [
    { id: 'L1', symbol: 'IWM', quantity: 100, purchasePrice: 220, currentPrice: 150, purchaseDate: '2026-01-10' }
  ];
  const result = scanTaxLossHarvesting(lots, 1000);

  assert.equal(result.opportunities.length, 1);
  assert.equal(result.opportunities[0].unrealizedLoss, -7000);
  assert.equal(result.opportunities[0].recommendedReplacement, 'VB');
});

test('Portfolio Engine: TLH Never Suggests A Same-Index Replacement', () => {
  const sameIndexPairs = [['VOO', 'IVV'], ['IVV', 'VOO'], ['QQQ', 'QQQM'], ['SPY', 'VOO']];

  for (const [sold, forbidden] of sameIndexPairs) {
    const lots = [{ id: 'L1', symbol: sold, quantity: 100, purchasePrice: 500, currentPrice: 400, purchaseDate: '2020-01-01' }];
    const opp = scanTaxLossHarvesting(lots, 1000).opportunities[0];

    assert.notEqual(opp.recommendedReplacement, forbidden);
    assert.notEqual(opp.replacementDetail.replacementIndex, opp.replacementDetail.soldIndex);
    assert.equal(opp.substantiallyIdenticalReviewRequired, true);
  }
});

test('Portfolio Engine: TLH Returns No Replacement Rather Than Guessing', () => {
  const lots = [{ id: 'L1', symbol: 'BND', quantity: 1000, purchasePrice: 80, currentPrice: 70, purchaseDate: '2020-01-01' }];
  const opp = scanTaxLossHarvesting(lots, 1000).opportunities[0];

  assert.equal(opp.recommendedReplacement, null);
});

test('Portfolio Engine: TLH Flags A Sibling Lot Bought Inside The 30-Day Window', () => {
  const saleDate = new Date('2026-06-30');
  const recent = new Date('2026-06-15').toISOString().split('T')[0];
  const old = new Date('2026-01-15').toISOString().split('T')[0];

  const withRecentBuy = scanTaxLossHarvesting([
    { id: 'L1', symbol: 'VOO', quantity: 100, purchasePrice: 500, currentPrice: 400, purchaseDate: old },
    { id: 'L2', symbol: 'VOO', quantity: 10, purchasePrice: 410, currentPrice: 400, purchaseDate: recent }
  ], 1000, saleDate);

  const flagged = withRecentBuy.opportunities.find(o => o.lotId === 'L1');
  assert.equal(flagged.washSaleRisk, true);
  assert.deepEqual(flagged.washSaleDetail.conflictingPurchaseLotIds, ['L2']);

  const withoutRecentBuy = scanTaxLossHarvesting([
    { id: 'L1', symbol: 'VOO', quantity: 100, purchasePrice: 500, currentPrice: 400, purchaseDate: old }
  ], 1000, saleDate);

  assert.equal(withoutRecentBuy.opportunities[0].washSaleRisk, false);
});

test('Portfolio Engine: Factor And Duration Figures Are Weighted From Supplied Inputs', () => {
  const result = analyzePortfolioFactors([
    { symbol: 'VTI', weightPct: 30, factorScores: { value: 0.4, growth: 0.6 } },
    { symbol: 'VXUS', weightPct: 30, factorScores: { value: 0.8, growth: 0.2 } },
    { symbol: 'BND', weightPct: 30, durationYears: 6.0, creditQuality: 'AA' },
    { symbol: 'TLT', weightPct: 10, durationYears: 16.0, creditQuality: 'AAA' }
  ]);

  assert.equal(result.equityFactorExposures.valueFactorScore, 0.6);
  assert.equal(result.equityFactorExposures.coveragePct, 100);
  assert.equal(result.fixedIncomeFactors.durationYears, 8.5); // (30 x 6 + 10 x 16) / 40
  assert.equal(result.fixedIncomeFactors.creditQuality, 'MIXED');
});

test('Portfolio Engine: Unknown Symbols Are Unclassified, Not Counted As Equity', () => {
  const result = analyzePortfolioFactors([{ symbol: 'ZZZZ', weightPct: 25 }, { symbol: 'VTI', weightPct: 75 }]);

  assert.equal(result.assetClassBreakdown.unclassifiedPct, 25);
  assert.equal(result.assetClassBreakdown.equityPct, 75);
  assert.deepEqual(result.unclassifiedSymbols, ['ZZZZ']);
});

test('Portfolio Engine: VaR Uses The Exact Quantile And Normal Expected Shortfall', () => {
  const result = calculatePortfolioVar(5000000, 0.16, 0.99, 1);
  const horizonVol = 0.16 / Math.sqrt(252);

  assert.equal(result.zScore, 2.3263);
  assert.ok(Math.abs(result.valueAtRiskDollar - 5000000 * 2.3263478740 * horizonVol) <= 1);
  // At 99% the normal ES/VaR ratio is phi(z) / (0.01 z), about 1.146 -- not the old fixed 1.25.
  const ratio = result.conditionalVaR_ExpectedShortfallDollar / result.valueAtRiskDollar;
  assert.ok(Math.abs(ratio - 1.1457) < 0.002, `ratio ${ratio}`);
});

test('Portfolio Engine: Any Confidence Level Is Honoured And Invalid Ones Rejected', () => {
  assert.equal(calculatePortfolioVar(1000000, 0.14, 0.975, 1).zScore, 1.96);
  assert.throws(() => calculatePortfolioVar(1000000, 0.14, 95, 1), /confidenceLevel/);
});

test('Portfolio Engine: Minimum Trade Size Scales With Portfolio Value', () => {
  // A 0.01-point drift is $5,000 in a $50M account: above the old flat $500 cutoff, but noise.
  const big = calculatePortfolioRebalance({ equity: 60.01, fixedIncome: 39.99 }, { equity: 60, fixedIncome: 40 }, 50000000);
  assert.equal(big.tradeThreshold, 25000);
  assert.ok(big.rebalancePlan.every(p => p.action === 'HOLD'));

  const small = calculatePortfolioRebalance({ equity: 61, fixedIncome: 39 }, { equity: 60, fixedIncome: 40 }, 1000000);
  assert.equal(small.tradeThreshold, 500);
  assert.equal(small.rebalancePlan.find(p => p.category === 'equity').action, 'SELL');
});

test('Portfolio Engine: Allocations That Do Not Sum To 100 Are Flagged', () => {
  const result = calculatePortfolioRebalance({ equity: 68, bond: 22 }, { equity: 60, bond: 30 }, 1000000);
  assert.equal(result.allocationWarnings.length, 2);
});
