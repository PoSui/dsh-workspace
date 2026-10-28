import test from 'node:test';
import assert from 'node:assert/strict';
import { netCapitalGainsAndLosses, calculateNetInvestmentIncomeTax, calculateCostBasis } from '../src/engines/tax.js';

test('Tax Engine: A Short-Term Loss Offsets Long-Term Gain, Then $3,000, Then Carries', () => {
  // -10,000 short-term against +4,000 long-term leaves -6,000: 3,000 deducted, 3,000 carried as short-term.
  const result = netCapitalGainsAndLosses({ shortTermLosses: 10000, longTermGains: 4000 });

  assert.equal(result.netCapitalGainOrLoss, -6000);
  assert.equal(result.deductionAgainstOrdinaryIncome, 3000);
  assert.equal(result.shortTermCarryover, 3000);
  assert.equal(result.longTermCarryover, 0);
});

test('Tax Engine: A Long-Term Loss Carries As Long-Term', () => {
  const result = netCapitalGainsAndLosses({ longTermLosses: 10000, shortTermGains: 2000 });

  assert.equal(result.shortTermCarryover, 0);
  assert.equal(result.longTermCarryover, 5000); // 8,000 net loss less the 3,000 deduction
});

test('Tax Engine: The Deduction Absorbs Short-Term Loss Before Long-Term', () => {
  // Schedule D worksheet: 2,000 short-term is used up by the deduction; 1,000 of it reduces long-term.
  const result = netCapitalGainsAndLosses({ shortTermLosses: 2000, longTermLosses: 6000 });

  assert.equal(result.shortTermCarryover, 0);
  assert.equal(result.longTermCarryover, 5000);
});

test('Tax Engine: Married Filing Separately Is Limited To $1,500', () => {
  assert.equal(netCapitalGainsAndLosses({ shortTermLosses: 5000, filingStatus: 'MFS' }).deductionAgainstOrdinaryIncome, 1500);
});

test('Tax Engine: Deduction That Did Not Reduce Taxable Income Carries Forward', () => {
  // Taxable income of -2,000 means only 1,000 of the 3,000 deduction was used (worksheet lines 1-4).
  const result = netCapitalGainsAndLosses({ shortTermLosses: 10000, taxableIncome: -2000 });
  assert.equal(result.shortTermCarryover, 9000);
});

test('Tax Engine: Prior Carryovers Keep Their Character', () => {
  const result = netCapitalGainsAndLosses({ longTermGains: 5000, longTermCarryover: 2000, shortTermCarryover: 1000 });

  assert.equal(result.netCapitalGainOrLoss, 2000);
  assert.deepEqual(result.netGainCharacter, { shortTerm: 0, longTerm: 2000 });
  assert.equal(result.deductionAgainstOrdinaryIncome, 0);
});

test('Tax Engine: NIIT Is 3.8% Of The Lesser Of NII Or Excess MAGI', () => {
  assert.equal(calculateNetInvestmentIncomeTax({ magi: 300000, netInvestmentIncome: 80000 }).netInvestmentIncomeTax, 1900); // 3.8% of 50,000
  assert.equal(calculateNetInvestmentIncomeTax({ magi: 300000, netInvestmentIncome: 20000 }).netInvestmentIncomeTax, 760); // 3.8% of 20,000
  assert.equal(calculateNetInvestmentIncomeTax({ magi: 180000, netInvestmentIncome: 50000, filingStatus: 'SINGLE' }).netInvestmentIncomeTax, 0);
  assert.equal(calculateNetInvestmentIncomeTax({ magi: 150000, netInvestmentIncome: 50000, filingStatus: 'MFS' }).threshold, 125000);
});

test('Tax Engine: An Unsupported Filing Status Comes Back As A Question', () => {
  assert.throws(() => calculateNetInvestmentIncomeTax({ magi: 1, netInvestmentIncome: 1, filingStatus: 'XYZ' }), (err) => err.needsInput[0].field === 'filingStatus');
});

const LOTS = [{ id: 'A', quantity: 100, price: 50, date: '2024-01-10' }, { id: 'B', quantity: 100, price: 80, date: '2025-09-01' }];

test('Tax Engine: FIFO Sells The Oldest Lot First', () => {
  const result = calculateCostBasis({ lots: LOTS, sale: { quantity: 150, date: '2026-03-01', price: 90 } });

  assert.equal(result.totalBasis, 9000); // 100 x 50 + 50 x 80
  assert.equal(result.longTermGainOrLoss, 4000);
  assert.equal(result.shortTermGainOrLoss, 500);
  assert.deepEqual(result.remainingLots.map(l => [l.id, l.quantity]), [['B', 50]]);
});

test('Tax Engine: Specific Identification Sells The Designated Lots', () => {
  const result = calculateCostBasis({ lots: LOTS, sale: { quantity: 100, date: '2026-03-01', price: 90 }, method: 'SPECIFIC', specificLots: [{ id: 'B', quantity: 100 }] });

  assert.equal(result.totalBasis, 8000);
  assert.equal(result.shortTermGainOrLoss, 1000);
  assert.equal(result.longTermGainOrLoss, 0);
});

test('Tax Engine: Average Cost Uses One Unit Cost With FIFO Holding Periods', () => {
  const result = calculateCostBasis({ lots: LOTS, sale: { quantity: 150, date: '2026-03-01', price: 90 }, method: 'AVERAGE' });

  assert.equal(result.averageUnitCost, 65);
  assert.equal(result.totalBasis, 9750);
  assert.equal(result.longTermGainOrLoss, 2500);
  assert.equal(result.shortTermGainOrLoss, 1250);
});

test('Tax Engine: A Lot Sold On Its Anniversary Is Still Short-Term', () => {
  const term = (date) => calculateCostBasis({ lots: [{ id: 'X', quantity: 1, price: 1, date: '2025-03-01' }], sale: { quantity: 1, date } }).dispositions[0].holdingPeriod;

  assert.equal(term('2026-03-01'), 'SHORT_TERM');
  assert.equal(term('2026-03-02'), 'LONG_TERM');
});

test('Tax Engine: Overselling And Undesignated Specific Lots Are Rejected', () => {
  assert.throws(() => calculateCostBasis({ lots: LOTS, sale: { quantity: 500, date: '2026-03-01' } }), /exceeds/);
  assert.throws(() => calculateCostBasis({ lots: LOTS, sale: { quantity: 10, date: '2026-03-01' }, method: 'SPECIFIC' }), (err) => err.needsInput[0].field === 'specificLots');
  // A lot bought after the sale date cannot be part of it.
  assert.throws(() => calculateCostBasis({ lots: LOTS, sale: { quantity: 150, date: '2025-06-01' } }), /exceeds the 100 shares/);
});

test('Tax Engine: A Lot With A Null Date Is Rejected, Not Dated 1970', () => {
  assert.throws(() => calculateCostBasis({ lots: [{ id: 'A', quantity: 1, price: 1, date: null }], sale: { quantity: 1, date: '2026-01-01' } }), /lot A date/);
});
