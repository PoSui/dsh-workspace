import test from 'node:test';
import assert from 'node:assert/strict';
import { backtestPortfolio, forwardTestSimulation } from '../src/engines/quant.js';
import { seededRandom } from '../src/engines/stats.js';

test('Quant Engine: Historical Backtest (60/40 Portfolio)', () => {
  const result = backtestPortfolio({ VTI: 0.6, BND: 0.4 }, 100000);

  assert.equal(result.sampleYears, 10);
  assert.equal(result.dataPeriod, '2015-2024');
  assert.equal(result.yearlyBalances.length, 11);
  assert.ok(result.endingBalance > result.initialBalance);
  assert.ok(result.metrics.cagrPercent > 0);
  assert.ok(result.metrics.sharpeRatio > 0);
  assert.ok(result.metrics.maxDrawdownPercent >= 0);
  assert.ok(Number.isFinite(result.metrics.sortinoRatio));
});

test('Quant Engine: Unknown Tickers Are Rejected, Not Backtested On VTI Data', () => {
  assert.throws(() => backtestPortfolio({ TSLA: 1 }), /No return data for "TSLA"/);
});

test('Quant Engine: Sharpe Uses The Arithmetic Mean Excess Return', () => {
  const result = backtestPortfolio({ VTI: 0.6, BND: 0.4 }, 1e9);
  const balances = result.yearlyBalances;
  const returns = balances.slice(1).map((v, i) => v / balances[i] - 1);
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const sd = Math.sqrt(returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1));

  assert.ok(Math.abs(result.metrics.sharpeRatio - (mean - 0.03) / sd) < 0.006);
});

test('Quant Engine: Sortino Is Null When No Year Falls Below The Target', () => {
  // The worst 60/40 year here is about -17%, so a -50% target leaves no downside deviation.
  const result = backtestPortfolio({ VTI: 0.6, BND: 0.4 }, 100000, { riskFreeRate: -0.5 });
  assert.equal(result.metrics.sortinoRatio, null);
});

test('Quant Engine: Forward Simulation (Stagflation Regime)', () => {
  const result = forwardTestSimulation({ VTI: 0.6, BND: 0.4 }, 'stagflation', 5, 300, { rng: seededRandom(7) });

  assert.equal(result.regime, 'stagflation');
  assert.ok(result.probabilityOfGrowthPercent >= 0 && result.probabilityOfGrowthPercent <= 100);
  assert.ok(result.projections.downsidePercentile10 <= result.projections.medianPercentile50);
  assert.ok(result.projections.medianPercentile50 <= result.projections.upsidePercentile90);
});

test('Quant Engine: Forward Simulation Depends On The Weights', () => {
  const bonds = forwardTestSimulation({ BND: 1 }, 'baseline', 5, 10);
  const stocks = forwardTestSimulation({ VTI: 1 }, 'baseline', 5, 10);

  assert.equal(bonds.expectedReturnPercent, 4);
  assert.equal(stocks.expectedReturnPercent, 7);
  assert.ok(stocks.volatilityPercent > bonds.volatilityPercent);
});

test('Quant Engine: Portfolio Expected Return Is The Weighted Sum Of Asset Assumptions', () => {
  // Stagflation defaults: 0.5 x 2% + 0.2 x 1.5% + 0.3 x -1% = 1.0%
  const result = forwardTestSimulation({ VTI: 0.5, VXUS: 0.2, BND: 0.3 }, 'stagflation', 5, 10);
  assert.equal(result.expectedReturnPercent, 1);
});

test('Quant Engine: Imperfect Correlation Keeps Volatility Below The Weighted Average', () => {
  // Weighted average of the baseline vols is 0.6 x 16% + 0.4 x 5% = 11.6%.
  const result = forwardTestSimulation({ VTI: 0.6, BND: 0.4 }, 'baseline', 5, 10);
  assert.ok(result.volatilityPercent < 11.6);
});

test('Quant Engine: Unknown Regime Is Rejected', () => {
  assert.throws(() => forwardTestSimulation({ VTI: 1 }, 'recession'), /Unknown regime/);
});

test('Quant Engine: Caller Assumptions Override Library Defaults', () => {
  const result = forwardTestSimulation({ VTI: 1 }, 'baseline', 5, 10, {
    assumptions: { VTI: { expectedReturn: 0.05, volatility: 0.15 } }
  });

  assert.equal(result.expectedReturnPercent, 5);
  assert.equal(result.volatilityPercent, 15);
  assert.match(result.assumptionsSource, /caller-supplied/);
});

test('Quant Engine: Rejected Tickers And Regimes Carry The Question To Ask', () => {
  assert.throws(() => backtestPortfolio({ TSLA: 1 }), (err) => {
    assert.equal(err.needsInput[0].field, 'weights');
    assert.match(err.needsInput[0].question, /VTI, BND, VXUS, VNQ/);
    return true;
  });

  assert.throws(() => forwardTestSimulation({ VTI: 1 }, 'recession'), (err) => {
    assert.equal(err.needsInput[0].field, 'regime');
    assert.match(err.needsInput[0].question, /stagflation/);
    return true;
  });
});
