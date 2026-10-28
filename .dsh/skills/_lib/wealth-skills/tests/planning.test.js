import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTaxBracketHeadroom, calculateRMD, runMonteCarloCashFlow } from '../src/engines/planning.js';
import { seededRandom } from '../src/engines/stats.js';

test('Planning Engine: Tax Bracket Headroom Uses Tax Year 2026 Figures', () => {
  // Rev. Proc. 2025-32: MFJ standard deduction $32,200; the 22% bracket ends at $211,400.
  const result = calculateTaxBracketHeadroom(210000, 'MFJ');

  assert.equal(result.taxYear, 2026);
  assert.equal(result.standardDeduction, 32200);
  assert.equal(result.taxableIncome, 177800);
  assert.equal(result.currentBracketRate, '22.0%');
  assert.equal(result.headroomForRothConversion, 33600);
});

test('Planning Engine: Single Filer Brackets And Deduction', () => {
  // 120,000 - 16,100 = 103,900, inside the single 22% bracket that ends at 105,700.
  const result = calculateTaxBracketHeadroom(120000, 'single');

  assert.equal(result.taxableIncome, 103900);
  assert.equal(result.currentBracketRate, '22.0%');
  assert.equal(result.headroomForRothConversion, 1800);
});

test('Planning Engine: Taxable Income Exactly At A Ceiling Has No Headroom Left', () => {
  const result = calculateTaxBracketHeadroom(211400 + 32200, 'MFJ');

  assert.equal(result.currentBracketRate, '22.0%');
  assert.equal(result.headroomForRothConversion, 0);
});

test('Planning Engine: Unsupported Filing Status Is Rejected, Not Treated As MFJ', () => {
  assert.throws(() => calculateTaxBracketHeadroom(150000, 'HOH'), /Unsupported filingStatus/);
});

test('Planning Engine: RMD Calculation for Age 75', () => {
  const result = calculateRMD(75, 500000);
  assert.equal(result.rmdRequired, 20325); // 500,000 / 24.6
  assert.equal(result.monthlyDistribution, 1694);
});

test('Planning Engine: RMD Uses The Published Table Beyond Age 80', () => {
  const expected = { 85: 16.0, 90: 12.2, 95: 8.9, 100: 6.4, 120: 2.0, 125: 2.0 };

  for (const [age, factor] of Object.entries(expected)) {
    const result = calculateRMD(Number(age), 1000000);
    assert.equal(result.distributionFactor, factor, `age ${age}`);
    assert.equal(result.rmdRequired, Math.round(1000000 / factor), `age ${age}`);
  }
});

test('Planning Engine: RMDs Start At 73, Or 75 For Those Born In 1960 Or Later', () => {
  assert.equal(calculateRMD(72, 500000).rmdRequired, 0);
  assert.ok(calculateRMD(73, 500000).rmdRequired > 0);
  assert.equal(calculateRMD(74, 500000, { birthYear: 1960 }).rmdRequired, 0);
  assert.ok(calculateRMD(75, 500000, { birthYear: 1960 }).rmdRequired > 0);
});

test('Planning Engine: Monte Carlo Is Reproducible With A Seeded RNG', () => {
  const run = () => runMonteCarloCashFlow(1000000, 40000, 0.06, 0.12, 30, 500, 0.025, { rng: seededRandom(42) });
  const first = run();

  assert.deepEqual(run(), first);
  assert.ok(first.successRatePercent >= 0 && first.successRatePercent <= 100);
  assert.ok(first.downsidePercentile10 <= first.medianEndingBalance);
});

test('Planning Engine: Withdrawals Grow With Inflation', () => {
  // Zero volatility makes every path deterministic. At a 5% return a flat $40k draw never depletes
  // $1M, but growing the draw 5% a year exhausts it in year 25.
  const flat = runMonteCarloCashFlow(1000000, 40000, 0.05, 0, 30, 10, 0);
  const inflating = runMonteCarloCashFlow(1000000, 40000, 0.05, 0, 30, 10, 0.05);

  assert.equal(flat.successRatePercent, 100);
  assert.equal(inflating.successRatePercent, 0);
});

test('Planning Engine: An Unsupported Filing Status Comes Back As A Question', () => {
  assert.throws(() => calculateTaxBracketHeadroom(150000, 'HOH'), (err) => {
    assert.equal(err.needsInput[0].field, 'filingStatus');
    assert.match(err.needsInput[0].question, /jointly \(MFJ\) or single/);
    return true;
  });
});
