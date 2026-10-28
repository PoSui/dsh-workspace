/**
 * Wealth Planning Engine - Self-Contained Financial Planning Calculations
 */

import { randomNormal, percentileSorted } from './stats.js';
import { inputError } from './guidance.js';

// Tax year 2026 federal ordinary-income brackets and standard deductions (IRS Rev. Proc. 2025-32).
// `limit` is the top of each bracket in taxable income. The previous table was labelled 2026 but
// held the 2024 brackets alongside the 2025 standard deduction.
const TAX_YEAR = 2026;

const TAX_BRACKETS_2026 = {
  MFJ: [
    { rate: 0.10, limit: 24800 },
    { rate: 0.12, limit: 100800 },
    { rate: 0.22, limit: 211400 },
    { rate: 0.24, limit: 403550 },
    { rate: 0.32, limit: 512450 },
    { rate: 0.35, limit: 768700 },
    { rate: 0.37, limit: Infinity }
  ],
  SINGLE: [
    { rate: 0.10, limit: 12400 },
    { rate: 0.12, limit: 50400 },
    { rate: 0.22, limit: 105700 },
    { rate: 0.24, limit: 201775 },
    { rate: 0.32, limit: 256225 },
    { rate: 0.35, limit: 640600 },
    { rate: 0.37, limit: Infinity }
  ]
};

const STANDARD_DEDUCTION_2026 = {
  MFJ: 32200,
  SINGLE: 16100
};

// IRS Uniform Lifetime Table, Treas. Reg. §1.401(a)(9)-9(c), for distribution calendar years from
// 2022. Complete from 72 through 120 and over; ages past 80 previously came from an invented linear
// formula that was wrong in both directions (10.0 instead of 8.9 at 95, understating the RMD).
const UNIFORM_LIFETIME_TABLE = {
  72: 27.4, 73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9, 78: 22.0, 79: 21.1, 80: 20.2,
  81: 19.4, 82: 18.5, 83: 17.7, 84: 16.8, 85: 16.0, 86: 15.2, 87: 14.4, 88: 13.7, 89: 12.9, 90: 12.2,
  91: 11.5, 92: 10.8, 93: 10.1, 94: 9.5, 95: 8.9, 96: 8.4, 97: 7.8, 98: 7.3, 99: 6.8, 100: 6.4,
  101: 6.0, 102: 5.6, 103: 5.2, 104: 4.9, 105: 4.6, 106: 4.3, 107: 4.1, 108: 3.9, 109: 3.7, 110: 3.5,
  111: 3.4, 112: 3.3, 113: 3.1, 114: 3.0, 115: 2.9, 116: 2.8, 117: 2.7, 118: 2.5, 119: 2.3, 120: 2.0
};

export function calculateTaxBracketHeadroom(agi, filingStatus = 'MFJ', customDeduction = null) {
  const statusKey = String(filingStatus).toUpperCase();
  const brackets = TAX_BRACKETS_2026[statusKey];

  // Other statuses (HOH, MFS) used to be computed silently with MFJ brackets.
  if (!brackets) {
    throw inputError(`Unsupported filingStatus "${filingStatus}". Supported: ${Object.keys(TAX_BRACKETS_2026).join(', ')}.`, [{
      field: 'filingStatus',
      question: 'Is the household filing jointly (MFJ) or single?',
      why: 'Only those two are modelled; head of household and married filing separately are not.'
    }]);
  }
  if (!(Number.isFinite(agi) && agi >= 0)) throw new Error('agi must be a non-negative number.');
  if (customDeduction !== null && !(Number.isFinite(customDeduction) && customDeduction >= 0)) {
    throw new Error('customDeduction must be a non-negative number or null.');
  }

  const stdDeduction = customDeduction !== null ? customDeduction : STANDARD_DEDUCTION_2026[statusKey];
  const taxableIncome = Math.max(0, agi - stdDeduction);

  const currentBracket = brackets.find(b => taxableIncome <= b.limit);
  const headroom = currentBracket.limit === Infinity ? 0 : Math.max(0, currentBracket.limit - taxableIncome);

  return {
    taxYear: TAX_YEAR,
    agi,
    filingStatus: statusKey,
    standardDeduction: stdDeduction,
    taxableIncome,
    currentBracketRate: `${(currentBracket.rate * 100).toFixed(1)}%`,
    currentBracketCeiling: currentBracket.limit,
    headroomForRothConversion: headroom
  };
}

export function calculateRMD(age, accountBalance, { birthYear } = {}) {
  if (!(Number.isInteger(age) && age >= 0)) throw new Error('age must be a whole number.');
  if (!(Number.isFinite(accountBalance) && accountBalance >= 0)) throw new Error('accountBalance must be a non-negative number.');

  // SECURE 2.0: RMDs begin at 73, or at 75 for anyone born in 1960 or later. Without a birth year
  // the age-73 rule applies, which is correct for everyone currently of RMD age.
  const startAge = Number.isInteger(birthYear) && birthYear >= 1960 ? 75 : 73;

  if (age < startAge) {
    return { age, accountBalance, rmdRequired: 0, message: `RMD age threshold (${startAge}) not reached.` };
  }

  const factor = UNIFORM_LIFETIME_TABLE[Math.min(age, 120)];
  const rmdAmount = Math.round(accountBalance / factor);

  return {
    age,
    accountBalance,
    distributionFactor: factor,
    rmdRequired: rmdAmount,
    monthlyDistribution: Math.round(rmdAmount / 12),
    table: 'Uniform Lifetime Table',
    note: 'accountBalance should be the prior December 31 balance. Use the Joint and Last Survivor Table instead when the sole beneficiary is a spouse more than 10 years younger.'
  };
}

export function runMonteCarloCashFlow(initialAssets, annualSpend, expectedReturn = 0.06, volatility = 0.12, years = 30, trials = 1000, inflationRate = 0.025, options = {}) {
  const { rng = Math.random } = options;

  if (!(Number.isFinite(initialAssets) && initialAssets > 0)) throw new Error('initialAssets must be a positive number.');
  if (!(Number.isFinite(annualSpend) && annualSpend >= 0)) throw new Error('annualSpend must be a non-negative number.');
  if (!Number.isFinite(expectedReturn)) throw new Error('expectedReturn must be a number.');
  if (!(Number.isFinite(volatility) && volatility >= 0)) throw new Error('volatility must be a non-negative number.');
  if (!(Number.isInteger(years) && years > 0)) throw new Error('years must be a positive integer.');
  if (!(Number.isInteger(trials) && trials > 0)) throw new Error('trials must be a positive integer.');
  if (!Number.isFinite(inflationRate)) throw new Error('inflationRate must be a number.');

  let successes = 0;
  const finalBalances = [];

  for (let t = 0; t < trials; t++) {
    let balance = initialAssets;
    let spend = annualSpend;
    let failed = false;

    for (let y = 0; y < years; y++) {
      const yearReturn = expectedReturn + randomNormal(rng) * volatility;
      balance = (balance - spend) * (1 + yearReturn);

      // Withdrawals rise with inflation. Holding them flat in nominal terms against nominal returns
      // overstated the success rate, increasingly so on long horizons.
      spend *= (1 + inflationRate);

      if (balance <= 0) {
        failed = true;
        balance = 0;
        break;
      }
    }

    if (!failed) successes++;
    finalBalances.push(balance);
  }

  finalBalances.sort((a, b) => a - b);

  return {
    initialAssets,
    annualSpend,
    inflationRatePercent: parseFloat((inflationRate * 100).toFixed(2)),
    years,
    trials,
    successRatePercent: parseFloat(((successes / trials) * 100).toFixed(1)),
    medianEndingBalance: Math.round(percentileSorted(finalBalances, 0.5)),
    downsidePercentile10: Math.round(percentileSorted(finalBalances, 0.1))
  };
}
