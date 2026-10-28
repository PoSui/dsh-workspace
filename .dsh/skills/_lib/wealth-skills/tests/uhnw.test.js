import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCollarStrategy, calculatePeMetrics } from '../src/engines/uhnw.js';

test('UHNW Engine: Collar Strikes, With Cost Unknown When No Premiums Are Supplied', () => {
  const result = calculateCollarStrategy('AAPL', 100000, 200, 25);

  assert.equal(result.symbol, 'AAPL');
  assert.equal(result.collarParameters.putStrikeFloor, 180); // 10% OTM
  assert.equal(result.collarParameters.callStrikeCap, 230); // 15% OTM
  assert.equal(result.premiums, null);
  assert.equal(result.zeroCostStructure, null);
});

test('UHNW Engine: Zero-Cost Is Evaluated From Supplied Premiums', () => {
  const balanced = calculateCollarStrategy('AAPL', 100000, 200, 25, { putPremium: 4.10, callPremium: 4.12 });
  assert.equal(balanced.zeroCostStructure, true);
  assert.equal(balanced.premiums.netPremiumPerShare, 0.02);
  assert.equal(balanced.premiums.netPremiumTotal, 2000);

  const debit = calculateCollarStrategy('AAPL', 100000, 200, 25, { putPremium: 6.00, callPremium: 3.50 });
  assert.equal(debit.zeroCostStructure, false);
  assert.equal(debit.premiums.netPremiumPerShare, -2.5);
  assert.equal(debit.premiums.effectiveFloorPrice, 177.5);
});

test('UHNW Engine: Tight Collars Are Flagged For Constructive Sale Review', () => {
  const wide = calculateCollarStrategy('AAPL', 1000, 200, 25);
  assert.equal(wide.constructiveSaleReview.required, true);
  assert.equal(wide.constructiveSaleReview.collarBandPct, 25);
  assert.equal(wide.constructiveSaleReview.narrowBand, false);

  const tight = calculateCollarStrategy('AAPL', 1000, 200, 25, { putStrikePct: 0.95, callStrikePct: 1.05 });
  assert.equal(tight.constructiveSaleReview.collarBandPct, 10);
  assert.equal(tight.constructiveSaleReview.narrowBand, true);
});

test('UHNW Engine: Private Equity MOIC / TVPI Metrics', () => {
  const result = calculatePeMetrics(5000000, 3000000, 1200000, 3200000);

  assert.equal(result.metrics.tvpiMoic, '1.47x');
  assert.equal(result.metrics.dpi, '0.4x');
  assert.equal(result.unfundedCommitment, 2000000);
});
