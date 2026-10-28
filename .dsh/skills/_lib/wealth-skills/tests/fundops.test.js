import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileLedger, tieOutNav, checkLpCapitalStatement, trackCloseChecklist } from '../src/engines/fundops.js';

test('Fund Ops Engine: Reconciliation Finds Every Kind Of Break', () => {
  const result = reconcileLedger(
    [{ account: 'A1', security: 'VTI', quantity: 100, marketValue: 27500 }, { account: 'A1', security: 'BND', quantity: 50, marketValue: 3600 },
      { account: 'A1', security: 'AGG', quantity: 10, marketValue: 1000 }, { account: 'A1', security: 'VXUS', quantity: 30, marketValue: 1950 }],
    [{ account: 'A1', security: 'VTI', quantity: 100, marketValue: 27500 }, { account: 'A1', security: 'BND', quantity: 40, marketValue: 2880 },
      { account: 'A1', security: 'VXUS', quantity: 30, marketValue: 1940 }, { account: 'A1', security: 'VEA', quantity: 5, marketValue: 250 }]
  );

  assert.equal(result.matched, 1);
  assert.deepEqual(result.breakCounts, { QUANTITY_BREAK: 1, VALUE_BREAK: 1, MISSING_AT_CUSTODIAN: 1, MISSING_IN_BOOK: 1 });
  assert.equal(result.reconciled, false);
  assert.equal(result.breaks.find(b => b.security === 'BND').quantityDifference, 10);
});

test('Fund Ops Engine: Split Rows Are Summed And Reported As Duplicates', () => {
  const result = reconcileLedger(
    [{ account: 'A1', security: 'VTI', quantity: 60, marketValue: 16500 }, { account: 'A1', security: 'VTI', quantity: 40, marketValue: 11000 }],
    [{ account: 'A1', security: 'VTI', quantity: 100, marketValue: 27500 }]
  );

  assert.equal(result.reconciled, true);
  assert.deepEqual(result.duplicateKeys.book, ['A1|VTI']);
});

test('Fund Ops Engine: NAV Tie-Out Recomputes, Flags Variance, Level 3 And Stale Prices', () => {
  const result = tieOutNav({
    assets: [{ name: 'Listed', value: 10500000, priceDate: '2026-08-31' }, { name: 'Private co', value: 2000000, level: 3, priceDate: '2026-03-31' }],
    liabilities: [{ name: 'Accrued fees', value: 500000 }],
    unitsOutstanding: 1000000,
    reportedNav: 12050000,
    asOf: '2026-08-31',
    maxPriceAgeDays: 90
  });

  assert.equal(result.computedNav, 12000000);
  assert.equal(result.computedNavPerUnit, 12);
  assert.equal(result.navVariance, 50000);
  assert.equal(result.levelThree.shareOfNavPct, 16.67);
  assert.deepEqual(result.stalePrices.map(p => p.name), ['Private co']);
  assert.equal(result.tiesOut, false);
});

test('Fund Ops Engine: A NAV Within Tolerance Ties Out', () => {
  const result = tieOutNav({ assets: [{ name: 'Listed', value: 10000000 }], unitsOutstanding: 500000, reportedNav: 10000500, tolerancePct: 0.01 });
  assert.equal(result.tiesOut, true); // 0.005% is inside a 0.01% tolerance
});

const STATEMENT = { beginningBalance: 1000000, contributions: 250000, distributions: 100000, incomeAllocation: 20000, realizedGainLoss: 30000, unrealizedGainLoss: 50000, managementFees: 12500, performanceAllocation: 0, otherExpenses: 2500 };

test('Fund Ops Engine: An LP Statement That Rolls Forward Passes', () => {
  const result = checkLpCapitalStatement({ ...STATEMENT, endingBalance: 1235000 });
  assert.equal(result.computedEndingBalance, 1235000);
  assert.equal(result.passed, true);
});

test('Fund Ops Engine: A Roll-Forward Break, Over-Called Commitment And Fee Mismatch Are Flagged', () => {
  const result = checkLpCapitalStatement({
    ...STATEMENT,
    endingBalance: 1240000,
    commitment: 1000000,
    contributionsToDate: 1050000,
    periodFractionOfYear: 0.25,
    expectedAnnualFeeRatePct: 1.5
  });

  assert.equal(result.difference, 5000);
  assert.equal(result.unfundedCommitment, -50000);
  assert.equal(result.impliedAnnualFeeRatePct, 5); // 12,500 a quarter on 1,000,000 is 5% a year
  assert.equal(result.exceptions.length, 3);
});

test('Fund Ops Engine: A Statement Missing Lines Asks For Each One', () => {
  assert.throws(() => checkLpCapitalStatement({ beginningBalance: 1 }), (err) => err.needsInput.length === 9);
});

const TASKS = [
  { id: 'bank', name: 'Bank recs', status: 'done', due: '2026-09-03' },
  { id: 'accr', name: 'Accruals', status: 'in_progress', due: '2026-09-04', dependsOn: ['bank'] },
  { id: 'fees', name: 'Fee calc', status: 'not_started', due: '2026-09-06', dependsOn: ['bank'] },
  { id: 'nav', name: 'NAV', status: 'not_started', due: '2026-09-08', dependsOn: ['accr', 'fees'] }
];

test('Fund Ops Engine: Close Status Shows Progress, Overdue Work And What Can Start', () => {
  const result = trackCloseChecklist(TASKS, { asOf: '2026-09-07' });

  assert.equal(result.percentComplete, 25);
  assert.deepEqual(result.overdue.map(t => t.id), ['accr', 'fees']);
  assert.deepEqual(result.readyToStart.map(t => t.id), ['fees']);
  assert.deepEqual(result.waitingOnDependencies.find(w => w.id === 'nav').waitingOn, ['accr', 'fees']);
  assert.equal(result.closeComplete, false);
});

test('Fund Ops Engine: Cycles, Unknown Dependencies And A Missing Date Are Rejected', () => {
  assert.throws(() => trackCloseChecklist([{ id: 'x', name: 'x', status: 'not_started', dependsOn: ['y'] }, { id: 'y', name: 'y', status: 'not_started', dependsOn: ['x'] }], { asOf: '2026-09-07' }), /cycle/);
  assert.throws(() => trackCloseChecklist([{ id: 'x', name: 'x', status: 'done', dependsOn: ['ghost'] }], { asOf: '2026-09-07' }), /unknown task ghost/);
  assert.throws(() => trackCloseChecklist(TASKS, {}), (err) => err.needsInput[0].field === 'asOf');
});

test('Fund Ops Engine: A Null Date Is Missing, Not 1970', () => {
  // new Date(null) is a valid date (the epoch), which once let close status run "as of 1970".
  assert.throws(() => trackCloseChecklist(TASKS, { asOf: null }), (err) => err.needsInput[0].field === 'asOf');
  assert.throws(() => tieOutNav({ assets: [{ name: 'x', value: 1, priceDate: '2026-01-01' }], unitsOutstanding: 1, maxPriceAgeDays: 5, asOf: null }), /asOf is required/);
});
