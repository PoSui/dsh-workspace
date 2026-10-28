/**
 * Wealth Portfolio Engine - Self-Contained Rebalancing, Drift Monitoring & VaR Engine
 */

import { inverseNormalCdf, normalPdf } from './stats.js';

const round2 = (x) => parseFloat(x.toFixed(2));

export function calculatePortfolioRebalance(currentAlloc, targetAlloc, portfolioValue, options = {}) {
  assertAllocation(currentAlloc, 'currentAlloc');
  assertAllocation(targetAlloc, 'targetAlloc');
  if (!(Number.isFinite(portfolioValue) && portfolioValue > 0)) {
    throw new Error('portfolioValue must be a positive number.');
  }

  // Trades below this size are reported as HOLD. It scales with the portfolio, so a $600 trade is
  // not a "rebalance" in a $50M account; the 0.05% default reproduces the former flat $500 cutoff
  // at $1M.
  const { minTradePct = 0.05, minTradeAmount = 0 } = options;
  const tradeThreshold = Math.max(minTradeAmount, (portfolioValue * minTradePct) / 100);

  const categories = Array.from(new Set([...Object.keys(currentAlloc), ...Object.keys(targetAlloc)]));
  const rebalancePlan = [];

  for (const cat of categories) {
    const currentPct = currentAlloc[cat] || 0;
    const targetPct = targetAlloc[cat] || 0;
    const driftPct = parseFloat((currentPct - targetPct).toFixed(2));

    const currentValue = (currentPct / 100) * portfolioValue;
    const targetValue = (targetPct / 100) * portfolioValue;
    const actionAmount = Math.round(targetValue - currentValue);

    let action = 'HOLD';
    if (actionAmount > tradeThreshold) action = 'BUY';
    if (actionAmount < -tradeThreshold) action = 'SELL';

    rebalancePlan.push({
      category: cat,
      currentPct,
      targetPct,
      driftPct,
      currentValue: Math.round(currentValue),
      targetValue: Math.round(targetValue),
      action,
      tradeAmount: Math.abs(actionAmount)
    });
  }

  const allocationWarnings = [];
  for (const [label, alloc] of [['currentAlloc', currentAlloc], ['targetAlloc', targetAlloc]]) {
    const total = Object.values(alloc).reduce((sum, v) => sum + v, 0);
    if (Math.abs(total - 100) > 0.5) {
      allocationWarnings.push(`${label} sums to ${round2(total)}%, not 100%; trade amounts treat each percentage as a share of total portfolio value.`);
    }
  }

  return {
    portfolioValue,
    tradeThreshold: Math.round(tradeThreshold),
    allocationWarnings,
    rebalancePlan,
    requiresHumanApproval: true
  };
}

export function monitorPortfolioDrift(currentAlloc, targetAlloc, portfolioValue, toleranceBandPct = 5.0, options = {}) {
  if (!(Number.isFinite(toleranceBandPct) && toleranceBandPct > 0)) {
    throw new Error('toleranceBandPct must be a positive number.');
  }

  const rebalanceResult = calculatePortfolioRebalance(currentAlloc, targetAlloc, portfolioValue, options);
  const breachedCategories = [];

  let maxDrift = 0;
  for (const item of rebalanceResult.rebalancePlan) {
    const absDrift = Math.abs(item.driftPct);
    if (absDrift > maxDrift) maxDrift = absDrift;

    if (absDrift >= toleranceBandPct) {
      breachedCategories.push({
        category: item.category,
        currentPct: item.currentPct,
        targetPct: item.targetPct,
        driftPct: item.driftPct,
        status: item.driftPct > 0 ? 'OVERWEIGHT_BREACH' : 'UNDERWEIGHT_BREACH'
      });
    }
  }

  const isRebalanceTriggered = breachedCategories.length > 0;
  const urgencyScore = Math.min(100, Math.round((maxDrift / toleranceBandPct) * 50));

  return {
    portfolioValue,
    toleranceBandPct,
    maxDriftPct: maxDrift,
    isRebalanceTriggered,
    urgencyScore,
    breachedCategories,
    allocationWarnings: rebalanceResult.allocationWarnings,
    recommendedRebalancePlan: isRebalanceTriggered ? rebalanceResult.rebalancePlan : []
  };
}

function assertAllocation(alloc, label) {
  if (!alloc || typeof alloc !== 'object' || Array.isArray(alloc)) {
    throw new TypeError(`${label} must be an object of percentages, e.g. {"equity":60,"fixedIncome":40}.`);
  }
  for (const [key, value] of Object.entries(alloc)) {
    if (!Number.isFinite(value)) throw new Error(`${label}.${key} must be a number.`);
  }
}

const ASSET_CLASSES = ['equity', 'fixedIncome', 'cash', 'realAssets'];

const ASSET_CLASS_BY_SYMBOL = {
  VTI: 'equity', ITOT: 'equity', SCHB: 'equity', VOO: 'equity', IVV: 'equity', SPY: 'equity', SPLG: 'equity',
  VV: 'equity', QQQ: 'equity', QQQM: 'equity', VUG: 'equity', IWM: 'equity', VB: 'equity', IJR: 'equity',
  VXUS: 'equity', VEA: 'equity', IEFA: 'equity', VWO: 'equity', IEMG: 'equity',
  BND: 'fixedIncome', AGG: 'fixedIncome', BNDX: 'fixedIncome', TLT: 'fixedIncome', IEF: 'fixedIncome',
  SHV: 'cash', BIL: 'cash', SGOV: 'cash', CASH: 'cash',
  VNQ: 'realAssets', GLD: 'realAssets'
};

export function analyzePortfolioFactors(holdings) {
  // holdings: [{ symbol, weightPct, assetClass?, factorScores?: { value, growth, quality, smallCap },
  //              durationYears?, creditQuality? }]
  if (!Array.isArray(holdings) || holdings.length === 0) {
    throw new TypeError('holdings must be a non-empty array of { symbol, weightPct }.');
  }

  const weights = { equity: 0, fixedIncome: 0, cash: 0, realAssets: 0, unclassified: 0 };
  const unclassifiedSymbols = [];
  const equityHoldings = [];
  const fixedIncomeHoldings = [];

  for (const h of holdings) {
    const sym = String(h.symbol).toUpperCase();
    if (!Number.isFinite(h.weightPct) || h.weightPct < 0) {
      throw new Error(`weightPct for ${sym} must be a non-negative number.`);
    }
    if (h.assetClass !== undefined && !ASSET_CLASSES.includes(h.assetClass)) {
      throw new Error(`Unknown assetClass "${h.assetClass}" for ${sym}. Use one of: ${ASSET_CLASSES.join(', ')}.`);
    }

    // An explicit assetClass wins; otherwise the symbol table. Unknown symbols stay unclassified
    // instead of being counted as equity.
    const assetClass = h.assetClass ?? ASSET_CLASS_BY_SYMBOL[sym];
    if (!assetClass) {
      weights.unclassified += h.weightPct;
      unclassifiedSymbols.push(sym);
      continue;
    }

    weights[assetClass] += h.weightPct;
    if (assetClass === 'equity') equityHoldings.push(h);
    if (assetClass === 'fixedIncome') fixedIncomeHoldings.push(h);
  }

  // The library has no factor model or fund-level data. Exposures are weighted averages of values
  // supplied on each holding, and null means nothing was supplied -- not a neutral exposure. These
  // were previously constants (0.65, 0.72, 0.81, 0.25; 6.2 years) returned for any portfolio.
  const factor = (key) => weightedAverage(equityHoldings, h => h.factorScores?.[key]);
  const duration = weightedAverage(fixedIncomeHoldings, h => h.durationYears);
  const creditQualities = [...new Set(fixedIncomeHoldings.map(h => h.creditQuality).filter(Boolean))];

  return {
    assetClassBreakdown: {
      equityPct: weights.equity,
      fixedIncomePct: weights.fixedIncome,
      cashPct: weights.cash,
      realAssetsPct: weights.realAssets,
      unclassifiedPct: weights.unclassified
    },
    unclassifiedSymbols,
    equityFactorExposures: {
      valueFactorScore: factor('value').value,
      growthFactorScore: factor('growth').value,
      qualityFactorScore: factor('quality').value,
      smallCapTiltScore: factor('smallCap').value,
      coveragePct: weightedAverage(equityHoldings, h => (h.factorScores ? 0 : undefined)).coveragePct
    },
    fixedIncomeFactors: {
      durationYears: fixedIncomeHoldings.length === 0 ? 0 : duration.value,
      durationCoveragePct: duration.coveragePct,
      creditQuality: creditQualities.length === 0 ? null : (creditQualities.length === 1 ? creditQualities[0] : 'MIXED')
    },
    dataNote: 'Factor scores, duration and credit quality are averaged only from values supplied per holding. null means no input was provided.'
  };
}

function weightedAverage(items, pick) {
  let totalWeight = 0;
  let coveredWeight = 0;
  let weightedSum = 0;

  for (const item of items) {
    totalWeight += item.weightPct;
    const v = pick(item);
    if (Number.isFinite(v)) {
      coveredWeight += item.weightPct;
      weightedSum += v * item.weightPct;
    }
  }

  return {
    value: coveredWeight > 0 ? round2(weightedSum / coveredWeight) : null,
    coveragePct: totalWeight > 0 ? round2((coveredWeight / totalWeight) * 100) : null
  };
}

export function calculatePortfolioVar(portfolioValue = 1000000, annualizedVol = 0.14, confidenceLevel = 0.95, horizonDays = 1) {
  if (!(Number.isFinite(portfolioValue) && portfolioValue > 0)) throw new Error('portfolioValue must be a positive number.');
  if (!(Number.isFinite(annualizedVol) && annualizedVol >= 0)) throw new Error('annualizedVol must be a non-negative decimal, e.g. 0.14.');
  // Any level is computed exactly. Unrecognised levels used to fall back to 95% without saying so.
  if (!(confidenceLevel > 0.5 && confidenceLevel < 1)) {
    throw new Error('confidenceLevel must be a decimal between 0.5 and 1, e.g. 0.95 or 0.99.');
  }
  if (!(Number.isFinite(horizonDays) && horizonDays > 0)) throw new Error('horizonDays must be a positive number.');

  const z = inverseNormalCdf(confidenceLevel);
  const dailyVol = annualizedVol / Math.sqrt(252);
  const horizonVol = dailyVol * Math.sqrt(horizonDays);

  const dollarVar = Math.round(portfolioValue * z * horizonVol);
  const percentVar = round2((dollarVar / portfolioValue) * 100);

  // Expected shortfall under the same normal model: sigma * phi(z) / (1 - alpha). The ES/VaR ratio
  // is about 1.25 at 95% but 1.15 at 99%, so the former fixed 1.25x multiplier was wrong at most
  // confidence levels.
  const cVarDollar = Math.round((portfolioValue * horizonVol * normalPdf(z)) / (1 - confidenceLevel));

  return {
    portfolioValue,
    annualizedVolPercent: parseFloat((annualizedVol * 100).toFixed(1)),
    confidenceLevelPercent: parseFloat((confidenceLevel * 100).toFixed(4)),
    horizonDays,
    zScore: parseFloat(z.toFixed(4)),
    valueAtRiskDollar: dollarVar,
    valueAtRiskPercent: percentVar,
    conditionalVaR_ExpectedShortfallDollar: cVarDollar,
    riskStatus: percentVar > 3.0 ? 'ELEVATED_RISK' : 'NORMAL_RISK',
    methodology: 'Parametric normal VaR and expected shortfall; zero mean return; square-root-of-time scaling over 252 trading days'
  };
}

export function scanTaxLossHarvesting(taxLots, minLossThreshold = 1000, saleDate = new Date()) {
  const harvestOpportunities = [];
  const sale = new Date(saleDate);
  const lots = Array.isArray(taxLots) ? taxLots : [];

  for (const lot of lots) {
    const currentVal = lot.quantity * lot.currentPrice;
    const costBasis = lot.quantity * lot.purchasePrice;
    const unrealizedGainLoss = currentVal - costBasis;

    if (unrealizedGainLoss <= -minLossThreshold) {
      const replacement = getReplacementEtf(lot.symbol);
      const conflictingLots = findReplacementPurchases(lots, lot, sale);

      harvestOpportunities.push({
        lotId: lot.id || lot.symbol,
        symbol: lot.symbol,
        quantity: lot.quantity,
        purchaseDate: lot.purchaseDate,
        costBasis: Math.round(costBasis),
        currentValue: Math.round(currentVal),
        unrealizedLoss: Math.round(unrealizedGainLoss),
        washSaleRisk: conflictingLots.length > 0,
        washSaleDetail: {
          // IRC 1091 disallows the loss if substantially identical stock was acquired within
          // 30 days BEFORE or AFTER the sale. Only the "before" leg is observable from a lot
          // list; the forward window depends on trades that have not happened yet.
          conflictingPurchaseLotIds: conflictingLots.map(l => l.id || l.symbol),
          lookbackWindowChecked: '30 days before assumed sale date',
          forwardWindowChecked: false,
          note: 'Re-check for substantially identical purchases in the 30 days following the sale, including purchases in IRA and spouse accounts, before claiming the loss.'
        },
        recommendedReplacement: replacement ? replacement.symbol : null,
        replacementDetail: replacement
          ? {
              soldIndex: replacement.soldIndex,
              replacementIndex: replacement.replacementIndex,
              basis: 'Candidate tracks a different index than the position being sold.'
            }
          : {
              basis: `No non-identical replacement is defined for ${String(lot.symbol).toUpperCase()} in this table. Select one manually rather than buying a fund tracking the same index.`
            },
        // The IRS has never defined "substantially identical" for ETFs. These candidates
        // differ by index, which is the common screen, but the call is not automatable.
        substantiallyIdenticalReviewRequired: true
      });
    }
  }

  return {
    totalHarvestableLosses: harvestOpportunities.reduce((sum, item) => sum + Math.abs(item.unrealizedLoss), 0),
    opportunities: harvestOpportunities,
    requiresHumanApproval: true
  };
}

// Same-symbol lots acquired in the 30 days before the sale are replacement shares under
// IRC 1091. The lot being sold cannot be its own replacement, so it is excluded.
function findReplacementPurchases(allLots, soldLot, saleDate) {
  const soldSymbol = String(soldLot.symbol).toUpperCase();
  const soldId = soldLot.id || soldLot.symbol;

  return allLots.filter(other => {
    if ((other.id || other.symbol) === soldId) return false;
    if (String(other.symbol).toUpperCase() !== soldSymbol) return false;

    const purchased = new Date(other.purchaseDate);
    if (Number.isNaN(purchased.getTime())) return false;

    const daysBefore = (saleDate - purchased) / (1000 * 60 * 60 * 24);
    return daysBefore >= 0 && daysBefore <= 30;
  });
}

// Index tracked by each symbol, used to reject swaps into a fund following the same index.
const TRACKED_INDEX = {
  VOO: 'S&P 500', IVV: 'S&P 500', SPY: 'S&P 500', SPLG: 'S&P 500',
  VV: 'CRSP US Large Cap',
  QQQ: 'Nasdaq-100', QQQM: 'Nasdaq-100',
  VUG: 'CRSP US Large Cap Growth',
  VTI: 'CRSP US Total Market', ITOT: 'S&P Total Market', SCHB: 'DJ US Broad Stock Market',
  IWM: 'Russell 2000', VB: 'CRSP US Small Cap', IJR: 'S&P SmallCap 600',
  VEA: 'FTSE Developed All Cap ex US', IEFA: 'MSCI EAFE IMI',
  VWO: 'FTSE Emerging Markets', IEMG: 'MSCI Emerging Markets IMI'
};

// Every pair here crosses index families. Symbols with no defensible non-identical swap
// (total-bond funds, where the liquid alternatives all track a Bloomberg Aggregate variant)
// are deliberately absent so the scanner returns null instead of guessing.
const REPLACEMENT_MAP = {
  VOO: 'VV', IVV: 'VV', SPY: 'VV', SPLG: 'VV',
  VV: 'SPLG',
  QQQ: 'VUG', QQQM: 'VUG',
  VTI: 'SCHB', ITOT: 'SCHB', SCHB: 'ITOT',
  IWM: 'VB', VB: 'IWM', IJR: 'IWM',
  VEA: 'IEFA', IEFA: 'VEA',
  VWO: 'IEMG', IEMG: 'VWO'
};

function getReplacementEtf(symbol) {
  const sold = String(symbol).toUpperCase();
  const candidate = REPLACEMENT_MAP[sold];
  if (!candidate) return null;

  return {
    symbol: candidate,
    soldIndex: TRACKED_INDEX[sold] || 'Unknown',
    replacementIndex: TRACKED_INDEX[candidate] || 'Unknown'
  };
}
