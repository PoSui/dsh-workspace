import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCompanyTearSheet, parseEdgarFilingSummary } from '../src/engines/research.js';

test('Research Engine: Stock Tear Sheet Generation', () => {
  const fin = { marketCap: 3e12, price: 200, eps: 8, revenue: 3e11, netIncome: 8e10, freeCashFlow: 8e10, dividends: 1.5, sector: 'Tech' };
  const result = generateCompanyTearSheet('AAPL', fin);

  assert.equal(result.ticker, 'AAPL');
  assert.equal(result.valuationMetrics.peRatio, 25);
  assert.equal(result.valuationMetrics.freeCashFlowConversionPercent, 100);
});

test('Research Engine: EDGAR Filing Parser', () => {
  const text = "Item 1A Risk Factors: We face supply chain disruptions and cybersecurity risks.";
  const result = parseEdgarFilingSummary('0000320193', '10-K', text);

  assert.equal(result.cik, '0000320193');
  assert.ok(result.item1ARiskSummary.includes('supply chain'));
});

import { buildDcfValuation, extractCompanyFact } from '../src/engines/research.js';

test('Research Engine: A Flat Cash Flow With No Growth Values As A Perpetuity', () => {
  const result = buildDcfValuation({ freeCashFlows: [100, 100, 100], discountRate: 0.10, terminalGrowthRate: 0, netDebt: 200, sharesOutstanding: 8 });

  assert.ok(Math.abs(result.enterpriseValue - 1000) < 0.01); // 100 / 10%
  assert.ok(Math.abs(result.equityValue - 800) < 0.01);
  assert.ok(Math.abs(result.valuePerShare - 100) < 0.01);
  assert.equal(result.sensitivity.length, 9);
});

test('Research Engine: A Growth Rate At Or Above The Discount Rate Is Rejected With A Question', () => {
  assert.throws(() => buildDcfValuation({ freeCashFlows: [100], discountRate: 0.03, terminalGrowthRate: 0.03 }), (err) => err.needsInput[0].field === 'terminalGrowthRate');
});

const FACTS = { cik: 1, entityName: 'Example Corp', facts: { 'us-gaap': { Revenues: { label: 'Revenues', units: { USD: [
  { start: '2023-10-01', end: '2024-09-28', val: 391, fy: 2024, fp: 'FY', form: '10-K', filed: '2024-11-01', accn: 'a1' },
  { start: '2024-09-29', end: '2025-09-27', val: 400, fy: 2025, fp: 'FY', form: '10-K', filed: '2025-10-31', accn: 'a2' },
  { start: '2024-09-29', end: '2025-09-27', val: 401, fy: 2025, fp: 'FY', form: '10-K/A', filed: '2026-01-15', accn: 'a3' },
  { start: '2025-09-28', end: '2025-12-27', val: 120, fy: 2026, fp: 'Q1', form: '10-Q', filed: '2026-01-30', accn: 'q1' }
] } } } } };

test('Research Engine: The Latest Annual XBRL Value Wins, Restatements Included', () => {
  const result = extractCompanyFact(FACTS, { concept: 'Revenues' });

  assert.equal(result.value, 401);
  assert.equal(result.periodEnd, '2025-09-27');
  assert.equal(result.accessionNumber, 'a3');
  assert.equal(extractCompanyFact(FACTS, { concept: 'Revenues', form: '10-Q', fiscalPeriod: 'Q1' }).value, 120);
});

test('Research Engine: An Unknown XBRL Concept Suggests Close Matches', () => {
  assert.throws(() => extractCompanyFact(FACTS, { concept: 'Revenue' }), (err) => /Revenues/.test(err.needsInput[0].question));
});
