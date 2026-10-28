/**
 * Wealth Quantitative Engine - Self-Contained Backtesting & Forward Monte Carlo Simulator
 */

import { randomNormal, percentileSorted } from './stats.js';
import { inputError } from './guidance.js';

// Approximate calendar-year total returns for 2015-2024 (ten years). Embedded so the engine runs
// offline; refresh from a licensed data source before relying on the figures.
const HISTORICAL_RETURNS = {
  VTI: [0.003, 0.127, 0.211, -0.052, 0.308, 0.210, 0.257, -0.195, 0.260, 0.238],  // US Total Market
  BND: [0.005, 0.026, 0.036, 0.001, 0.087, 0.075, -0.017, -0.130, 0.057, 0.015],  // Total Bond
  VXUS: [-0.043, 0.047, 0.274, -0.143, 0.216, 0.107, 0.086, -0.158, 0.155, 0.058], // Intl Equities
  VNQ: [0.024, 0.086, 0.049, -0.056, 0.287, -0.047, 0.404, -0.249, 0.118, 0.045]  // Real Estate
};
const DATA_PERIOD = '2015-2024';

// Illustrative library defaults, not forecasts: annual arithmetic mean return and volatility per
// asset in each regime. Pass `options.assumptions` to substitute your firm's capital market
// assumptions.
const REGIME_ASSUMPTIONS = {
  baseline: {
    VTI: { expectedReturn: 0.07, volatility: 0.16 },
    BND: { expectedReturn: 0.04, volatility: 0.05 },
    VXUS: { expectedReturn: 0.075, volatility: 0.17 },
    VNQ: { expectedReturn: 0.065, volatility: 0.19 }
  },
  stagflation: {
    VTI: { expectedReturn: 0.02, volatility: 0.20 },
    BND: { expectedReturn: -0.01, volatility: 0.08 },
    VXUS: { expectedReturn: 0.015, volatility: 0.21 },
    VNQ: { expectedReturn: 0.01, volatility: 0.22 }
  },
  bull_market: {
    VTI: { expectedReturn: 0.12, volatility: 0.13 },
    BND: { expectedReturn: 0.035, volatility: 0.04 },
    VXUS: { expectedReturn: 0.10, volatility: 0.15 },
    VNQ: { expectedReturn: 0.10, volatility: 0.16 }
  },
  bear_market: {
    VTI: { expectedReturn: -0.06, volatility: 0.25 },
    BND: { expectedReturn: 0.03, volatility: 0.07 },
    VXUS: { expectedReturn: -0.07, volatility: 0.26 },
    VNQ: { expectedReturn: -0.08, volatility: 0.28 }
  }
};

// Correlations estimated from the embedded series. Ten annual observations is a small sample, so
// treat these as rough.
const HISTORICAL_CORRELATIONS = buildCorrelationMatrix(HISTORICAL_RETURNS);

const round = (x, dp) => parseFloat(x.toFixed(dp));

export function backtestPortfolio(weights = { VTI: 0.6, BND: 0.4 }, initialBalance = 100000, options = {}) {
  const { riskFreeRate = 0.03 } = options;
  const normWeights = normalizeWeights(weights, Object.keys(HISTORICAL_RETURNS));

  if (!(Number.isFinite(initialBalance) && initialBalance > 0)) {
    throw new Error('initialBalance must be a positive number.');
  }

  const sampleYears = HISTORICAL_RETURNS.VTI.length;
  let currentBalance = initialBalance;
  const balances = [initialBalance];
  const annualReturns = [];

  for (let i = 0; i < sampleYears; i++) {
    let yearReturn = 0;
    for (const ticker in normWeights) {
      yearReturn += normWeights[ticker] * HISTORICAL_RETURNS[ticker][i];
    }
    annualReturns.push(yearReturn);
    currentBalance = currentBalance * (1 + yearReturn);
    balances.push(currentBalance);
  }

  const cagr = Math.pow(currentBalance / initialBalance, 1 / sampleYears) - 1;

  const meanReturn = annualReturns.reduce((a, b) => a + b, 0) / sampleYears;
  const variance = annualReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / (sampleYears - 1);
  const volatility = Math.sqrt(variance);

  // Sharpe uses the arithmetic mean excess return over the same annual series the volatility is
  // measured on.
  const sharpeRatio = volatility > 0 ? round((meanReturn - riskFreeRate) / volatility, 2) : null;

  // Downside deviation below the risk-free target, averaged over ALL periods. When no year falls
  // below target it is zero and Sortino is undefined, so null is returned rather than dividing by
  // a placeholder and reporting a meaningless ratio.
  const downsideDeviation = Math.sqrt(
    annualReturns.reduce((sum, r) => sum + Math.pow(Math.min(0, r - riskFreeRate), 2), 0) / sampleYears
  );
  const sortinoRatio = downsideDeviation > 0 ? round((meanReturn - riskFreeRate) / downsideDeviation, 2) : null;

  let peak = balances[0];
  let maxDrawdown = 0;
  for (const bal of balances) {
    if (bal > peak) peak = bal;
    maxDrawdown = Math.max(maxDrawdown, (peak - bal) / peak);
  }

  return {
    initialBalance,
    endingBalance: Math.round(currentBalance),
    sampleYears,
    dataPeriod: DATA_PERIOD,
    weights: roundWeights(normWeights),
    metrics: {
      cagrPercent: round(cagr * 100, 2),
      volatilityPercent: round(volatility * 100, 2),
      sharpeRatio,
      sortinoRatio,
      maxDrawdownPercent: round(maxDrawdown * 100, 2),
      riskFreeRatePercent: round(riskFreeRate * 100, 2)
    },
    methodology: {
      returnFrequency: 'annual',
      rebalancing: 'annual, back to target weights',
      drawdownResolution: 'year-end balances only; intra-year drawdowns are not captured'
    },
    yearlyBalances: balances.map(b => Math.round(b))
  };
}

export function forwardTestSimulation(weights = { VTI: 0.6, BND: 0.4 }, regime = 'baseline', years = 5, trials = 500, options = {}) {
  const { initialBalance = 100000, assumptions = null, rng = Math.random } = options;

  const regimeKey = String(regime).toLowerCase();
  const regimeDefaults = REGIME_ASSUMPTIONS[regimeKey];
  if (!regimeDefaults) {
    throw inputError(`Unknown regime "${regime}". Supported: ${Object.keys(REGIME_ASSUMPTIONS).join(', ')}.`, [{
      field: 'regime',
      question: `Which regime should the projection use: ${Object.keys(REGIME_ASSUMPTIONS).join(', ')}?`,
      why: 'Each regime carries different return and volatility assumptions.'
    }]);
  }
  if (!Number.isInteger(years) || years <= 0) throw new Error('years must be a positive integer.');
  if (!Number.isInteger(trials) || trials <= 0) throw new Error('trials must be a positive integer.');
  if (!(Number.isFinite(initialBalance) && initialBalance > 0)) throw new Error('initialBalance must be a positive number.');

  const normWeights = normalizeWeights(weights, Object.keys(regimeDefaults));
  const tickers = Object.keys(normWeights);

  const assumptionsUsed = {};
  for (const ticker of tickers) {
    const override = assumptions ? assumptions[ticker] : undefined;
    const expectedReturn = override?.expectedReturn ?? regimeDefaults[ticker].expectedReturn;
    const volatility = override?.volatility ?? regimeDefaults[ticker].volatility;
    if (!Number.isFinite(expectedReturn) || !Number.isFinite(volatility) || volatility < 0) {
      throw new Error(`Assumptions for ${ticker} need a finite expectedReturn and a non-negative volatility.`);
    }
    assumptionsUsed[ticker] = { expectedReturn, volatility };
  }

  // The portfolio's own return distribution: weighted mean, and variance from the full covariance
  // (w' Sigma w). Previously the regime's single return and volatility were applied to every
  // portfolio, so the weights had no effect.
  let portfolioReturn = 0;
  let portfolioVariance = 0;
  for (const a of tickers) {
    portfolioReturn += normWeights[a] * assumptionsUsed[a].expectedReturn;
    for (const b of tickers) {
      portfolioVariance += normWeights[a] * normWeights[b] *
        assumptionsUsed[a].volatility * assumptionsUsed[b].volatility *
        HISTORICAL_CORRELATIONS[a][b];
    }
  }
  const portfolioVolatility = Math.sqrt(Math.max(0, portfolioVariance));

  let successes = 0;
  const finalValues = [];

  for (let t = 0; t < trials; t++) {
    let bal = initialBalance;
    for (let y = 0; y < years; y++) {
      const r = portfolioReturn + randomNormal(rng) * portfolioVolatility;
      bal *= Math.max(0, 1 + r);
    }
    if (bal >= initialBalance) successes++;
    finalValues.push(bal);
  }

  finalValues.sort((a, b) => a - b);

  return {
    regime: regimeKey,
    years,
    trials,
    initialBalance,
    weights: roundWeights(normWeights),
    expectedReturnPercent: round(portfolioReturn * 100, 2),
    volatilityPercent: round(portfolioVolatility * 100, 2),
    probabilityOfGrowthPercent: round((successes / trials) * 100, 1),
    projections: {
      downsidePercentile10: Math.round(percentileSorted(finalValues, 0.1)),
      medianPercentile50: Math.round(percentileSorted(finalValues, 0.5)),
      upsidePercentile90: Math.round(percentileSorted(finalValues, 0.9))
    },
    assumptionsUsed,
    assumptionsSource: assumptions
      ? 'caller-supplied, with library defaults for any asset not overridden'
      : 'illustrative library defaults (not a forecast)',
    correlationSource: `sample correlations of embedded annual returns, ${DATA_PERIOD}`
  };
}

function normalizeWeights(weights, supportedTickers) {
  if (!weights || typeof weights !== 'object' || Array.isArray(weights)) {
    throw new TypeError('weights must be an object mapping ticker to weight, e.g. {"VTI":0.6,"BND":0.4}.');
  }

  const entries = Object.entries(weights);
  if (entries.length === 0) throw new Error('weights must contain at least one ticker.');

  const normalized = {};
  let total = 0;

  for (const [rawTicker, weight] of entries) {
    const ticker = rawTicker.toUpperCase();
    // Unknown tickers used to be silently backtested on the VTI series.
    if (!supportedTickers.includes(ticker)) {
      throw inputError(`No return data for "${rawTicker}". Supported tickers: ${supportedTickers.join(', ')}.`, [{
        field: 'weights',
        question: `Which of ${supportedTickers.join(', ')} should stand in for ${rawTicker}, or should the backtest be skipped?`,
        why: 'Only those tickers have embedded return data, and substituting one silently would misreport the result.'
      }]);
    }
    if (!Number.isFinite(weight) || weight < 0) {
      throw new Error(`Weight for ${rawTicker} must be a non-negative number.`);
    }
    normalized[ticker] = (normalized[ticker] || 0) + weight;
    total += weight;
  }

  if (total <= 0) throw new Error('Weights must sum to a positive number.');

  for (const ticker in normalized) normalized[ticker] /= total;
  return normalized;
}

function roundWeights(normWeights) {
  const out = {};
  for (const ticker in normWeights) out[ticker] = round(normWeights[ticker], 4);
  return out;
}

function buildCorrelationMatrix(series) {
  const tickers = Object.keys(series);
  const matrix = {};
  for (const a of tickers) {
    matrix[a] = {};
    for (const b of tickers) {
      matrix[a][b] = a === b ? 1 : pearson(series[a], series[b]);
    }
  }
  return matrix;
}

function pearson(xs, ys) {
  const n = xs.length;
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    cov += (xs[i] - meanX) * (ys[i] - meanY);
    varX += Math.pow(xs[i] - meanX, 2);
    varY += Math.pow(ys[i] - meanY, 2);
  }
  return cov / Math.sqrt(varX * varY);
}
