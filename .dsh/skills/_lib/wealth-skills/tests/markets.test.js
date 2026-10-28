import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSecurityIdentifier, calculateSettlementDate } from '../src/engines/markets.js';

test('Markets Engine: Real Apple Identifiers Pass Their Check Digits', () => {
  const cases = [['US0378331005', 'ISIN'], ['037833100', 'CUSIP'], ['BBG000B9XRY4', 'FIGI'], ['HWUPKR0MPOU8FGXBT394', 'LEI']];
  for (const [id, type] of cases) {
    const result = validateSecurityIdentifier(id);
    assert.equal(result.valid, true, `${id} should be a valid ${type}`);
    assert.equal(result.type, type);
    assert.equal(result.checkDigitVerified, true);
  }
});

test('Markets Engine: A Changed Check Digit Is Rejected', () => {
  assert.equal(validateSecurityIdentifier('US0378331006').valid, false);
  assert.equal(validateSecurityIdentifier('037833101').valid, false);
  assert.equal(validateSecurityIdentifier('HWUPKR0MPOU8FGXBT395').valid, false);
  assert.equal(validateSecurityIdentifier('037833101', 'CUSIP').expected, 0);
});

test('Markets Engine: MIC And CFI Are Format Checks Only, And Say So', () => {
  const mic = validateSecurityIdentifier('XNAS', 'MIC');
  assert.equal(mic.valid, true);
  assert.equal(mic.checkDigitVerified, false);

  assert.equal(validateSecurityIdentifier('ESVUFR', 'CFI').valid, true);
  assert.equal(validateSecurityIdentifier('ZSVUFR', 'CFI').valid, false); // Z is not an ISO 10962 category
});

test('Markets Engine: Unrecognized Formats Are Reported, Not Guessed', () => {
  const result = validateSecurityIdentifier('NOT-AN-ID');
  assert.equal(result.valid, false);
  assert.equal(result.type, null);
});

test('Markets Engine: T+1 Settlement Skips Weekends And Supplied Holidays', () => {
  assert.equal(calculateSettlementDate('2026-09-09').settlementDate, '2026-09-10'); // Wednesday -> Thursday
  assert.equal(calculateSettlementDate('2026-09-11').settlementDate, '2026-09-14'); // Friday -> Monday

  const labor = calculateSettlementDate('2026-09-04', { holidays: ['2026-09-07'] }); // Friday before Labor Day
  assert.equal(labor.settlementDate, '2026-09-08');
  assert.deepEqual(labor.skippedDates, ['2026-09-05', '2026-09-06', '2026-09-07']);
});

test('Markets Engine: Settlement Says When No Holidays Were Supplied', () => {
  const result = calculateSettlementDate('2026-09-12'); // a Saturday
  assert.equal(result.tradeDateIsBusinessDay, false);
  assert.match(result.note, /No market holidays/);
});

test('Markets Engine: A Null Trade Date Is Rejected, Not Treated As 1970', () => {
  assert.throws(() => calculateSettlementDate(null), /tradeDate must be a date/);
});
