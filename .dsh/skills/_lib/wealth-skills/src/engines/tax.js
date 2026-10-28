/**
 * Wealth Tax Engine - Capital gain netting, the capital-loss limitation and carryover, net investment
 * income tax, and cost basis by lot.
 */

import { inputError } from './guidance.js';

const round2 = (x) => Math.round(x * 100) / 100;

// IRC §1211(b): net capital losses offset ordinary income up to $3,000, or $1,500 when married filing
// separately. Fixed by statute, not indexed.
const CAPITAL_LOSS_LIMIT = { MFJ: 3000, SINGLE: 3000, HOH: 3000, QSS: 3000, MFS: 1500 };

// IRC §1411: 3.8% on the lesser of net investment income or MAGI above a statutory threshold. The
// thresholds are fixed by statute and not indexed for inflation.
const NIIT_RATE = 0.038;
const NIIT_THRESHOLDS = { MFJ: 250000, QSS: 250000, MFS: 125000, SINGLE: 200000, HOH: 200000 };

function statusFor(table, filingStatus) {
  const key = String(filingStatus).toUpperCase();
  if (!(key in table)) {
    throw inputError(`Unsupported filingStatus "${filingStatus}". Supported: ${Object.keys(table).join(', ')}.`, [{
      field: 'filingStatus',
      question: `What is the filing status (${Object.keys(table).join(', ')})?`,
      why: 'The limit or threshold depends on filing status.'
    }]);
  }
  return key;
}

function amount(value, name) {
  if (!(Number.isFinite(value) && value >= 0)) {
    throw new Error(`${name} must be a non-negative number; enter losses as positive amounts.`);
  }
  return value;
}

export function netCapitalGainsAndLosses({
  shortTermGains = 0,
  shortTermLosses = 0,
  longTermGains = 0,
  longTermLosses = 0,
  shortTermCarryover = 0,
  longTermCarryover = 0,
  filingStatus = 'MFJ',
  taxableIncome = null
} = {}) {
  [['shortTermGains', shortTermGains], ['shortTermLosses', shortTermLosses], ['longTermGains', longTermGains],
    ['longTermLosses', longTermLosses], ['shortTermCarryover', shortTermCarryover], ['longTermCarryover', longTermCarryover]]
    .forEach(([name, value]) => amount(value, name));
  if (taxableIncome !== null && !Number.isFinite(taxableIncome)) throw new Error('taxableIncome must be a number or null.');

  const status = statusFor(CAPITAL_LOSS_LIMIT, filingStatus);
  const limit = CAPITAL_LOSS_LIMIT[status];

  // IRC §1222 netting: each term nets within itself, with prior carryovers keeping their character,
  // then the two nets offset each other.
  const netShortTerm = shortTermGains - shortTermLosses - shortTermCarryover;
  const netLongTerm = longTermGains - longTermLosses - longTermCarryover;
  const net = netShortTerm + netLongTerm;

  const deduction = net < 0 ? Math.min(limit, -net) : 0;

  // §1212(b) carryover, following the Schedule D Capital Loss Carryover Worksheet: the deduction and
  // any long-term gain absorb short-term loss first, and only the part of the deduction that actually
  // reduced taxable income counts as used (worksheet lines 1-4).
  const deductionUsed = taxableIncome === null ? deduction : Math.min(deduction, Math.max(0, taxableIncome + deduction));
  const shortTermLoss = Math.max(0, -netShortTerm);
  const shortTermGain = Math.max(0, netShortTerm);
  const longTermLoss = Math.max(0, -netLongTerm);
  const longTermGain = Math.max(0, netLongTerm);

  const absorbedAgainstShortTerm = deductionUsed + longTermGain;
  const shortTermCarryoverOut = net < 0 ? Math.max(0, shortTermLoss - absorbedAgainstShortTerm) : 0;
  const leftoverForLongTerm = Math.max(0, absorbedAgainstShortTerm - shortTermLoss);
  const longTermCarryoverOut = net < 0 ? Math.max(0, longTermLoss - (shortTermGain + leftoverForLongTerm)) : 0;

  let netGainCharacter = null;
  if (net > 0) {
    if (netShortTerm >= 0 && netLongTerm >= 0) netGainCharacter = { shortTerm: round2(netShortTerm), longTerm: round2(netLongTerm) };
    else if (netShortTerm < 0) netGainCharacter = { shortTerm: 0, longTerm: round2(net) };
    else netGainCharacter = { shortTerm: round2(net), longTerm: 0 };
  }

  return {
    filingStatus: status,
    netShortTerm: round2(netShortTerm),
    netLongTerm: round2(netLongTerm),
    netCapitalGainOrLoss: round2(net),
    netGainCharacter,
    capitalLossLimit: limit,
    deductionAgainstOrdinaryIncome: round2(deduction),
    shortTermCarryover: round2(shortTermCarryoverOut),
    longTermCarryover: round2(longTermCarryoverOut),
    methodology: 'IRC §1222 netting, §1211(b) limitation and §1212(b) carryover, per the Schedule D Capital Loss Carryover Worksheet',
    note: 'Does not apply capital-gain rate tiers, collectibles or unrecaptured §1250 gain, or state tax.'
  };
}

export function calculateNetInvestmentIncomeTax({ magi, netInvestmentIncome, filingStatus = 'MFJ' } = {}) {
  if (!Number.isFinite(magi)) throw new Error('magi must be a number.');
  amount(netInvestmentIncome, 'netInvestmentIncome');

  const status = statusFor(NIIT_THRESHOLDS, filingStatus);
  const threshold = NIIT_THRESHOLDS[status];
  const excessMagi = Math.max(0, magi - threshold);
  const taxableAmount = Math.min(netInvestmentIncome, excessMagi);

  return {
    filingStatus: status,
    magi,
    netInvestmentIncome,
    threshold,
    excessMagi: round2(excessMagi),
    taxableAmount: round2(taxableAmount),
    rate: NIIT_RATE,
    netInvestmentIncomeTax: round2(taxableAmount * NIIT_RATE),
    note: 'IRC §1411 thresholds are fixed by statute and not indexed for inflation. Net investment income must already exclude items such as tax-exempt interest and qualified-plan distributions.'
  };
}

// More than one year: a lot sold on its one-year anniversary is still short-term.
function isLongTerm(acquired, sold) {
  const anniversary = new Date(Date.UTC(acquired.getUTCFullYear() + 1, acquired.getUTCMonth(), acquired.getUTCDate()));
  return sold.getTime() > anniversary.getTime();
}

function parseDate(value, name) {
  // new Date(null) is 1970-01-01, a valid date, so emptiness is rejected before parsing.
  const date = value === null || value === undefined || value === '' ? new Date(NaN) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${name} must be a date such as 2026-03-01, got "${value}".`);
  return date;
}

const COST_BASIS_METHODS = ['FIFO', 'SPECIFIC', 'AVERAGE'];

export function calculateCostBasis({ lots, sale, method = 'FIFO', specificLots = null } = {}) {
  if (!Array.isArray(lots) || lots.length === 0) {
    throw new TypeError('lots must be a non-empty array of { id, quantity, price, date }.');
  }
  if (!sale || !(Number.isFinite(sale.quantity) && sale.quantity > 0)) {
    throw new Error('sale must include a positive quantity and a date.');
  }

  const methodKey = String(method).toUpperCase();
  if (!COST_BASIS_METHODS.includes(methodKey)) {
    throw inputError(`Unsupported method "${method}". Supported: ${COST_BASIS_METHODS.join(', ')}.`, [{
      field: 'method',
      question: 'Which cost basis method applies: FIFO, specific identification, or average cost (funds only)?',
      why: 'The method changes both the basis and the holding-period split.'
    }]);
  }

  const saleDate = parseDate(sale.date, 'sale.date');
  const eligible = lots.map((lot, index) => {
    if (!lot.id) throw new Error(`Lot ${index + 1} needs an id.`);
    if (!(Number.isFinite(lot.quantity) && lot.quantity > 0)) throw new Error(`Lot ${lot.id} quantity must be positive.`);
    if (!(Number.isFinite(lot.price) && lot.price >= 0)) throw new Error(`Lot ${lot.id} price must be a non-negative number.`);
    return { ...lot, acquired: parseDate(lot.date, `lot ${lot.id} date`), order: index };
  }).filter(lot => lot.acquired.getTime() <= saleDate.getTime());

  const available = eligible.reduce((sum, lot) => sum + lot.quantity, 0);
  if (sale.quantity > available + 1e-9) {
    throw new Error(`Sale of ${sale.quantity} exceeds the ${available} shares held on ${sale.date}.`);
  }

  const byAcquisition = [...eligible].sort((a, b) => a.acquired - b.acquired || a.order - b.order);
  let consumption = [];

  if (methodKey === 'SPECIFIC') {
    if (!Array.isArray(specificLots) || specificLots.length === 0) {
      throw inputError('Specific identification needs the lots being sold.', [{
        field: 'specificLots',
        question: 'Which lots, and how many shares from each, are being sold?',
        why: 'Specific identification must be designated at the time of sale.'
      }]);
    }
    const total = specificLots.reduce((sum, pick) => sum + pick.quantity, 0);
    if (Math.abs(total - sale.quantity) > 1e-9) throw new Error(`specificLots total ${total} does not equal the sale quantity ${sale.quantity}.`);
    consumption = specificLots.map(pick => {
      const lot = eligible.find(candidate => candidate.id === pick.id);
      if (!lot) throw new Error(`Lot ${pick.id} is not held on the sale date.`);
      if (pick.quantity > lot.quantity) throw new Error(`Lot ${pick.id} holds ${lot.quantity}, fewer than the ${pick.quantity} designated.`);
      return { lot, quantity: pick.quantity };
    });
  } else {
    // Average cost still takes shares first-in first-out for the holding period.
    let remaining = sale.quantity;
    for (const lot of byAcquisition) {
      if (remaining <= 1e-9) break;
      const take = Math.min(lot.quantity, remaining);
      consumption.push({ lot, quantity: take });
      remaining -= take;
    }
  }

  const averagePrice = byAcquisition.reduce((sum, lot) => sum + lot.quantity * lot.price, 0) / available;

  const dispositions = consumption.map(({ lot, quantity }) => {
    const unitBasis = methodKey === 'AVERAGE' ? averagePrice : lot.price;
    return {
      lotId: lot.id,
      quantity,
      acquired: lot.acquired.toISOString().slice(0, 10),
      holdingPeriod: isLongTerm(lot.acquired, saleDate) ? 'LONG_TERM' : 'SHORT_TERM',
      basis: round2(quantity * unitBasis),
      proceeds: Number.isFinite(sale.price) ? round2(quantity * sale.price) : null
    };
  });

  const sumBy = (term, field) => round2(dispositions.filter(d => !term || d.holdingPeriod === term).reduce((sum, d) => sum + (d[field] ?? 0), 0));
  const hasProceeds = Number.isFinite(sale.price);

  const remainingLots = byAcquisition.map(lot => {
    const sold = consumption.filter(c => c.lot.id === lot.id).reduce((sum, c) => sum + c.quantity, 0);
    return { id: lot.id, quantity: round2(lot.quantity - sold), price: lot.price, date: lot.acquired.toISOString().slice(0, 10) };
  }).filter(lot => lot.quantity > 0);

  return {
    method: methodKey,
    saleDate: saleDate.toISOString().slice(0, 10),
    quantitySold: sale.quantity,
    averageUnitCost: methodKey === 'AVERAGE' ? round2(averagePrice) : null,
    dispositions,
    totalBasis: sumBy(null, 'basis'),
    totalProceeds: hasProceeds ? sumBy(null, 'proceeds') : null,
    shortTermGainOrLoss: hasProceeds ? round2(sumBy('SHORT_TERM', 'proceeds') - sumBy('SHORT_TERM', 'basis')) : null,
    longTermGainOrLoss: hasProceeds ? round2(sumBy('LONG_TERM', 'proceeds') - sumBy('LONG_TERM', 'basis')) : null,
    remainingLots,
    note: 'Average cost is permitted for regulated investment company shares; basis ignores wash-sale adjustments, return of capital and reinvested-dividend lots unless supplied as lots.'
  };
}
