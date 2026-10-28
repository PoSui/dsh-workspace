import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTimeWeightedReturn, calculateMoneyWeightedReturn, assessSharpeRatio } from '../src/engines/performance.js';
import { normalCdf, inverseNormalCdf } from '../src/engines/stats.js';

test('Stats: normalCdf Matches Known Values And Inverts inverseNormalCdf', () => {
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-9);
  assert.ok(Math.abs(normalCdf(1.959964) - 0.975) < 2e-7);
  for (const p of [0.01, 0.2, 0.5, 0.9, 0.999]) assert.ok(Math.abs(normalCdf(inverseNormalCdf(p)) - p) < 2e-7);
});

test('Performance Engine: Time-Weighted Return Links Sub-Periods Around A Contribution', () => {
  // +10% on 100,000, then 50,000 arrives and the 160,000 grows 5% to 168,000: 1.10 x 1.05 - 1 = 15.5%.
  const result = calculateTimeWeightedReturn([
    { date: '2026-01-01', value: 100000 },
    { date: '2026-06-30', value: 110000, cashFlow: 50000 },
    { date: '2026-12-31', value: 168000 }
  ]);

  assert.equal(result.cumulativeReturnPercent, 15.5);
  assert.deepEqual(result.periods.map(p => p.returnPercent), [10, 5]);
  assert.equal(result.annualizedReturnPercent, null); // under a year is not annualized
});

test('Performance Engine: Periods Of A Year Or More Are Annualized', () => {
  const result = calculateTimeWeightedReturn([{ date: '2024-01-01', value: 100 }, { date: '2026-01-01', value: 121 }]);
  assert.ok(Math.abs(result.annualizedReturnPercent - 10) < 0.02); // 21% over ~2 years
});

test('Performance Engine: Out-Of-Order Dates And Empty Portfolios Are Rejected', () => {
  assert.throws(() => calculateTimeWeightedReturn([{ date: '2026-02-01', value: 100 }, { date: '2026-01-01', value: 110 }]), /strictly increasing/);
  assert.throws(() => calculateTimeWeightedReturn([{ date: '2026-01-01', value: 0 }, { date: '2026-02-01', value: 10 }]), /undefined/);
  assert.throws(() => calculateTimeWeightedReturn([{ date: '2026-01-01', value: 100 }]), (err) => err.needsInput[0].field === 'valuations');
});

test('Performance Engine: IRR Of 1,000 In And 1,100 Out A Year Later Is 10%', () => {
  const result = calculateMoneyWeightedReturn([{ date: '2025-01-01', amount: -1000 }, { date: '2026-01-01', amount: 1100 }]);
  assert.equal(result.irrPercent, 10);
});

test('Performance Engine: IRR Discounts Every Flow To Zero', () => {
  const flows = [
    { date: '2021-03-31', amount: -1000000 }, { date: '2022-03-31', amount: -1000000 }, { date: '2023-03-31', amount: -1000000 },
    { date: '2024-06-30', amount: 400000 }, { date: '2025-06-30', amount: 800000 }, { date: '2026-06-30', amount: 3200000 }
  ];
  const rate = calculateMoneyWeightedReturn(flows).irrPercent / 100;
  const t0 = new Date(flows[0].date);
  const npv = (r) => flows.reduce((sum, f) => sum + f.amount / Math.pow(1 + r, (new Date(f.date) - t0) / 86400000 / 365), 0);

  // The reported rate is rounded to 4 decimals, so check the root lies within that rounding: NPV
  // changes sign across it.
  assert.ok(npv(rate - 0.000001) * npv(rate + 0.000001) < 0, `NPV should cross zero at ${rate}`);
});

test('Performance Engine: IRR Needs Money In And Money Out', () => {
  assert.throws(() => calculateMoneyWeightedReturn([{ date: '2025-01-01', amount: 100 }, { date: '2026-01-01', amount: 100 }]), /at least one negative/);
});

test('Performance Engine: Sharpe Ratio Standard Error And Probabilistic Sharpe Ratio', () => {
  // Alternating 2% and 0%: mean 1%, sample sd 1.0445%, per-period SR 0.9574, zero skew, kurtosis 1.
  const result = assessSharpeRatio(Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? 0.02 : 0)));

  assert.ok(Math.abs(result.sharpeRatioAnnualized - 3.3166) < 0.001);
  assert.ok(Math.abs(result.standardErrorAnnualized - 1.2076) < 0.001); // sqrt((1 + SR^2/2)/12) x sqrt(12)
  assert.equal(result.skewness, 0);
  assert.equal(result.kurtosis, 1);
  assert.ok(Math.abs(result.probabilisticSharpeRatio - 0.9993) < 0.0005); // Phi(0.9574 x sqrt(11))
  assert.equal(result.deflated, null);
});

test('Performance Engine: Deflating Across Many Trials Lowers Confidence', () => {
  const returns = Array.from({ length: 36 }, (_, i) => [0.012, -0.004, 0.009, 0.003][i % 4]);
  const single = assessSharpeRatio(returns);
  const deflated = assessSharpeRatio(returns, { trials: 200, sharpeVariance: 0.05 });

  assert.ok(deflated.deflated.deflatedSharpeRatio < single.probabilisticSharpeRatio);
  assert.ok(deflated.deflated.expectedMaxSharpeAnnualized > 0);
  assert.throws(() => assessSharpeRatio(returns, { trials: 200 }), /sharpeVariance/);
});

test('Performance Engine: A Flat Return Series Has No Sharpe Ratio', () => {
  assert.throws(() => assessSharpeRatio([0.01, 0.01, 0.01]), /no variation/);
});

test('Performance Engine: A Null Valuation Date Is Rejected, Not Dated 1970', () => {
  assert.throws(() => calculateTimeWeightedReturn([{ date: null, value: 100 }, { date: '2026-01-01', value: 110 }]), /must be a date/);
});
