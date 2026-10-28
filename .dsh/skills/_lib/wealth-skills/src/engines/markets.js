/**
 * Wealth Markets Engine - Security and entity identifier validation, and settlement dates.
 */

import { inputError } from './guidance.js';

const charValue = (c) => (c >= '0' && c <= '9' ? c.charCodeAt(0) - 48 : c.charCodeAt(0) - 55); // A=10 ... Z=35
const sumDigits = (n) => Math.floor(n / 10) + (n % 10);

// ISO 6166: letters become two-digit numbers, then a Luhn check over the resulting digit string.
function isinCheck(code) {
  const digits = code.slice(0, 11).split('').map(c => String(charValue(c))).join('');
  let sum = 0;
  for (let i = digits.length - 1, double = true; i >= 0; i--, double = !double) {
    const d = Number(digits[i]);
    sum += double ? sumDigits(d * 2) : d;
  }
  return (10 - (sum % 10)) % 10;
}

// CUSIP: values for the first eight characters, every second one doubled, digits summed.
function cusipCheck(code) {
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    const c = code[i];
    let v = c === '*' ? 36 : c === '@' ? 37 : c === '#' ? 38 : charValue(c);
    if (i % 2 === 1) v *= 2;
    sum += sumDigits(v);
  }
  return (10 - (sum % 10)) % 10;
}

// FIGI: modulus 10 "double add double" over the first eleven characters.
function figiCheck(code) {
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    let v = charValue(code[i]);
    if (i % 2 === 1) v *= 2;
    sum += sumDigits(v);
  }
  return (10 - (sum % 10)) % 10;
}

// ISO 17442 LEI: ISO 7064 MOD 97-10, valid when the converted number mod 97 equals 1.
function leiValid(code) {
  const digits = code.split('').map(c => String(charValue(c))).join('');
  return BigInt(digits) % 97n === 1n;
}

const FIGI_BLOCKED_PREFIXES = ['BS', 'BM', 'GG', 'GB', 'GH', 'KY', 'VG'];
const CFI_CATEGORIES = ['E', 'C', 'D', 'R', 'O', 'F', 'S', 'H', 'I', 'J', 'K', 'L', 'T', 'M'];

const VALIDATORS = {
  ISIN: {
    pattern: /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/,
    check: (code) => ({ valid: isinCheck(code) === Number(code[11]), checkDigitVerified: true, expected: isinCheck(code) })
  },
  CUSIP: {
    pattern: /^[A-Z0-9*@#]{8}[0-9]$/,
    check: (code) => ({ valid: cusipCheck(code) === Number(code[8]), checkDigitVerified: true, expected: cusipCheck(code) })
  },
  FIGI: {
    pattern: /^[B-DF-HJ-NP-TV-Z]{2}G[A-Z0-9]{8}[0-9]$/,
    check: (code) => {
      if (FIGI_BLOCKED_PREFIXES.includes(code.slice(0, 2))) return { valid: false, checkDigitVerified: false, reason: `FIGI may not begin with ${code.slice(0, 2)}.` };
      return { valid: figiCheck(code) === Number(code[11]), checkDigitVerified: true, expected: figiCheck(code) };
    }
  },
  LEI: {
    pattern: /^[A-Z0-9]{18}[0-9]{2}$/,
    check: (code) => ({ valid: leiValid(code), checkDigitVerified: true })
  },
  MIC: {
    // ISO 10383 has no check digit; existence needs the published MIC list.
    pattern: /^[A-Z0-9]{4}$/,
    check: () => ({ valid: true, checkDigitVerified: false, reason: 'Format only; confirm the code against the ISO 10383 MIC list.' })
  },
  CFI: {
    pattern: /^[A-Z]{6}$/,
    check: (code) => (CFI_CATEGORIES.includes(code[0])
      ? { valid: true, checkDigitVerified: false, reason: 'Format and category only; attribute letters are not validated.' }
      : { valid: false, checkDigitVerified: false, reason: `"${code[0]}" is not an ISO 10962 category.` })
  }
};

export function validateSecurityIdentifier(identifier, type = null) {
  const code = String(identifier ?? '').trim().toUpperCase();
  if (!code) throw new Error('identifier is required.');

  if (type !== null) {
    const key = String(type).toUpperCase();
    const validator = VALIDATORS[key];
    if (!validator) throw new Error(`Unsupported type "${type}". Supported: ${Object.keys(VALIDATORS).join(', ')}.`);
    if (!validator.pattern.test(code)) {
      return { identifier: code, type: key, valid: false, checkDigitVerified: false, reason: `Does not match the ${key} format.` };
    }
    return { identifier: code, type: key, ...validator.check(code) };
  }

  // Formats overlap (a FIGI is also ISIN-shaped), so every matching format is tried and only a check
  // digit decides. Several passing means the caller has to say which one was meant.
  const candidates = Object.entries(VALIDATORS)
    .filter(([key, v]) => v.pattern.test(code) && !['MIC', 'CFI'].includes(key))
    .map(([key, v]) => ({ type: key, ...v.check(code) }));

  const passing = candidates.filter(c => c.valid);
  if (passing.length === 1) return { identifier: code, ...passing[0] };
  if (passing.length > 1) {
    throw inputError(`"${code}" is a valid ${passing.map(p => p.type).join(' and ')}.`, [{
      field: 'type',
      question: `Is ${code} meant as ${passing.map(p => p.type).join(' or ')}?`,
      why: 'The same string passes more than one check-digit scheme.'
    }]);
  }
  if (candidates.length > 0) {
    return { identifier: code, type: candidates[0].type, valid: false, checkDigitVerified: true, reason: `Matches the ${candidates.map(c => c.type).join('/')} format but the check digit is wrong.`, candidatesTried: candidates.map(c => c.type) };
  }
  return { identifier: code, type: null, valid: false, checkDigitVerified: false, reason: 'Does not match ISIN, CUSIP, FIGI or LEI formats. Pass type for MIC or CFI codes.' };
}

// SEC Rule 15c6-1 moved most US broker-dealer transactions to T+1 settlement on May 28, 2024. No market
// holiday calendar is embedded, so holidays must be supplied.
export function calculateSettlementDate(tradeDate, { holidays = [], settlementDays = 1 } = {}) {
  const trade = tradeDate === null || tradeDate === undefined || tradeDate === '' ? null : new Date(tradeDate);
  if (!trade || Number.isNaN(trade.getTime())) throw new Error(`tradeDate must be a date such as 2026-09-11, got "${tradeDate}".`);
  if (!(Number.isInteger(settlementDays) && settlementDays >= 0)) throw new Error('settlementDays must be a non-negative integer.');
  if (!Array.isArray(holidays)) throw new TypeError('holidays must be an array of YYYY-MM-DD dates.');

  const holidaySet = new Set(holidays.map(h => new Date(h).toISOString().slice(0, 10)));
  const isBusinessDay = (d) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !holidaySet.has(d.toISOString().slice(0, 10));

  const skipped = [];
  const current = new Date(trade.getTime());
  let counted = 0;
  while (counted < settlementDays) {
    current.setUTCDate(current.getUTCDate() + 1);
    if (isBusinessDay(current)) counted++;
    else skipped.push(current.toISOString().slice(0, 10));
  }

  return {
    tradeDate: trade.toISOString().slice(0, 10),
    settlementDate: current.toISOString().slice(0, 10),
    settlementDays,
    skippedDates: skipped,
    tradeDateIsBusinessDay: isBusinessDay(trade),
    rule: 'SEC Rule 15c6-1: T+1 for most US broker-dealer transactions since May 28, 2024',
    note: holidays.length === 0
      ? 'No market holidays were supplied, so only weekends were skipped.'
      : `${holidaySet.size} supplied holiday(s) were honored.`
  };
}
