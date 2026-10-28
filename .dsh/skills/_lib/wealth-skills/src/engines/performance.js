/**
 * Wealth Performance Engine - Time-weighted and money-weighted returns, and the statistical reliability
 * of a Sharpe ratio.
 */

import { normalCdf, inverseNormalCdf } from './stats.js';
import { inputError } from './guidance.js';

const DAY_MS = 86400000;
const round = (x, dp) => (x === null ? null : parseFloat(x.toFixed(dp)));

function parseDate(value, name) {
  // new Date(null) is 1970-01-01, a valid date, so emptiness is rejected before parsing.
  const date = value === null || value === undefined || value === '' ? new Date(NaN) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${name} must be a date such as 2026-06-30, got "${value}".`);
  return date;
}

// True time-weighted return: each record is the portfolio value immediately before any external cash
// flow on that date, and `cashFlow` is that flow (contributions positive, withdrawals negative).
// Sub-period returns are linked geometrically, which strips out the effect of the flows themselves.
export function calculateTimeWeightedReturn(valuations) {
  if (!Array.isArray(valuations) || valuations.length < 2) {
    throw inputError('At least two valuations are needed.', [{
      field: 'valuations',
      question: 'What was the portfolio worth at the start, at each contribution or withdrawal, and at the end?',
      why: 'Time-weighted return needs a valuation at every external cash flow.'
    }]);
  }

  const records = valuations.map((v, i) => {
    const date = parseDate(v.date, `valuations[${i}].date`);
    if (!(Number.isFinite(v.value) && v.value >= 0)) throw new Error(`valuations[${i}].value must be a non-negative number.`);
    const cashFlow = v.cashFlow ?? 0;
    if (!Number.isFinite(cashFlow)) throw new Error(`valuations[${i}].cashFlow must be a number.`);
    return { date, value: v.value, cashFlow };
  });

  const periods = [];
  let growth = 1;
  for (let i = 1; i < records.length; i++) {
    const start = records[i - 1];
    const end = records[i];
    if (end.date <= start.date) throw new Error('Valuation dates must be strictly increasing.');
    const invested = start.value + start.cashFlow;
    if (invested <= 0) throw new Error(`Nothing was invested after ${start.date.toISOString().slice(0, 10)}; the sub-period return is undefined.`);
    const periodReturn = end.value / invested - 1;
    growth *= 1 + periodReturn;
    periods.push({
      from: start.date.toISOString().slice(0, 10),
      to: end.date.toISOString().slice(0, 10),
      returnPercent: round(periodReturn * 100, 4)
    });
  }

  const days = (records.at(-1).date - records[0].date) / DAY_MS;
  const cumulative = growth - 1;

  return {
    cumulativeReturnPercent: round(cumulative * 100, 4),
    // Performance standards discourage annualizing periods shorter than a year.
    annualizedReturnPercent: days >= 365 ? round((Math.pow(growth, 365 / days) - 1) * 100, 4) : null,
    days,
    periods,
    methodology: 'True time-weighted return: valuations at each external cash flow, sub-periods linked geometrically'
  };
}

// Money-weighted return (XIRR, actual/365). Flows are from the investor's side: contributions and
// capital calls negative, distributions positive, with the ending value as a final positive flow.
export function calculateMoneyWeightedReturn(cashFlows) {
  if (!Array.isArray(cashFlows) || cashFlows.length < 2) {
    throw inputError('At least two dated cash flows are needed.', [{
      field: 'cashFlows',
      question: 'What were the dated contributions and distributions, plus the current value as a final flow?',
      why: 'An internal rate of return needs money going in and value coming out.'
    }]);
  }

  const flows = cashFlows.map((f, i) => {
    if (!Number.isFinite(f.amount)) throw new Error(`cashFlows[${i}].amount must be a number.`);
    return { date: parseDate(f.date, `cashFlows[${i}].date`), amount: f.amount };
  }).sort((a, b) => a.date - b.date);

  if (!flows.some(f => f.amount < 0) || !flows.some(f => f.amount > 0)) {
    throw new Error('Cash flows need at least one negative (money in) and one positive (money out or ending value).');
  }

  const t0 = flows[0].date;
  const years = flows.map(f => (f.date - t0) / DAY_MS / 365);
  const npv = (rate) => flows.reduce((sum, f, i) => sum + f.amount / Math.pow(1 + rate, years[i]), 0);
  const derivative = (rate) => flows.reduce((sum, f, i) => sum - (years[i] * f.amount) / Math.pow(1 + rate, years[i] + 1), 0);

  let rate = 0.1;
  let iterations = 0;
  let method = 'newton';
  for (; iterations < 100; iterations++) {
    const value = npv(rate);
    if (Math.abs(value) < 1e-7) break;
    const slope = derivative(rate);
    const next = rate - value / slope;
    if (!Number.isFinite(next) || next <= -0.9999) { method = 'bisection'; break; }
    if (Math.abs(next - rate) < 1e-12) { rate = next; break; }
    rate = next;
  }

  // Newton can wander on awkward flow patterns; bisection over a wide bracket is the safe fallback.
  if (method === 'bisection' || Math.abs(npv(rate)) > 1e-4) {
    method = 'bisection';
    let low = -0.9999;
    let high = 10;
    if (npv(low) * npv(high) > 0) throw new Error('No internal rate of return between -99.99% and 1000%.');
    for (iterations = 0; iterations < 300; iterations++) {
      rate = (low + high) / 2;
      if (npv(low) * npv(rate) <= 0) high = rate; else low = rate;
      if (high - low < 1e-12) break;
    }
  }

  return {
    irrPercent: round(rate * 100, 4),
    method,
    iterations,
    firstFlow: flows[0].date.toISOString().slice(0, 10),
    lastFlow: flows.at(-1).date.toISOString().slice(0, 10),
    methodology: 'XIRR: the annual rate that sets the present value of dated flows to zero (actual/365)'
  };
}

const EULER_MASCHERONI = 0.5772156649015329;

// How far a Sharpe ratio can be trusted: Lo (2002) standard error, the probabilistic Sharpe ratio, and
// optionally the deflated Sharpe ratio that corrects for picking the best of many trials
// (Bailey and Lopez de Prado).
export function assessSharpeRatio(returns, options = {}) {
  const { periodsPerYear = 12, riskFreeRate = 0, benchmarkSharpe = 0, trials = null, sharpeVariance = null } = options;

  if (!Array.isArray(returns) || returns.length < 3 || !returns.every(Number.isFinite)) {
    throw new Error('returns must be an array of at least three periodic returns, as decimals.');
  }
  if (!(Number.isFinite(periodsPerYear) && periodsPerYear > 0)) throw new Error('periodsPerYear must be positive.');

  const n = returns.length;
  const excess = returns.map(r => r - riskFreeRate / periodsPerYear);
  const mean = excess.reduce((s, x) => s + x, 0) / n;
  const sampleSd = Math.sqrt(excess.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1));
  if (sampleSd === 0) throw new Error('Returns have no variation, so the Sharpe ratio is undefined.');

  const popSd = Math.sqrt(excess.reduce((s, x) => s + (x - mean) ** 2, 0) / n);
  const skewness = excess.reduce((s, x) => s + (x - mean) ** 3, 0) / n / popSd ** 3;
  const kurtosis = excess.reduce((s, x) => s + (x - mean) ** 4, 0) / n / popSd ** 4;

  const sharpe = mean / sampleSd;
  const scale = Math.sqrt(periodsPerYear);
  const standardError = Math.sqrt((1 + (sharpe * sharpe) / 2) / n);

  const probabilistic = (targetPerPeriod) => {
    const denominator = Math.sqrt(1 - skewness * sharpe + ((kurtosis - 1) / 4) * sharpe * sharpe);
    return normalCdf(((sharpe - targetPerPeriod) * Math.sqrt(n - 1)) / denominator);
  };

  let deflated = null;
  if (trials !== null) {
    if (!(Number.isInteger(trials) && trials > 1) || !(Number.isFinite(sharpeVariance) && sharpeVariance > 0)) {
      throw new Error('Deflating needs trials (an integer above 1) and sharpeVariance, the per-period variance of Sharpe ratios across those trials.');
    }
    const expectedMaxSharpe = Math.sqrt(sharpeVariance) *
      ((1 - EULER_MASCHERONI) * inverseNormalCdf(1 - 1 / trials) + EULER_MASCHERONI * inverseNormalCdf(1 - 1 / (trials * Math.E)));
    deflated = { trials, expectedMaxSharpeAnnualized: round(expectedMaxSharpe * scale, 4), deflatedSharpeRatio: round(probabilistic(expectedMaxSharpe), 4) };
  }

  return {
    observations: n,
    periodsPerYear,
    sharpeRatioAnnualized: round(sharpe * scale, 4),
    standardErrorAnnualized: round(standardError * scale, 4),
    skewness: round(skewness, 4),
    kurtosis: round(kurtosis, 4),
    probabilisticSharpeRatio: round(probabilistic(benchmarkSharpe / scale), 4),
    benchmarkSharpeAnnualized: benchmarkSharpe,
    deflated,
    methodology: 'Lo (2002) iid standard error; probabilistic Sharpe ratio adjusting for skewness and kurtosis; deflated Sharpe ratio when trials are supplied',
    note: 'The standard error assumes independent returns. Serial correlation, common in smoothed or illiquid returns, makes it too small.'
  };
}
