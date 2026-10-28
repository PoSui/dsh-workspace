/**
 * Wealth UHNW Engine - Self-Contained Family Office & Concentrated Stock Strategy
 */

const round2 = (x) => parseFloat(x.toFixed(2));
const isNonNegativeNumber = (x) => Number.isFinite(x) && x >= 0;

export function calculateCollarStrategy(symbol = 'AAPL', shares = 100000, currentPrice = 215, costBasis = 25, options = {}) {
  const {
    putStrikePct = 0.90,
    callStrikePct = 1.15,
    putPremium = null, // per share, paid for the long put
    callPremium = null, // per share, received for the short call
    zeroCostTolerancePerShare = 0.05
  } = options;

  if (!(Number.isFinite(shares) && shares > 0)) throw new Error('shares must be a positive number.');
  if (!(Number.isFinite(currentPrice) && currentPrice > 0)) throw new Error('currentPrice must be a positive number.');
  if (!isNonNegativeNumber(costBasis)) throw new Error('costBasis must be a non-negative number.');
  if (!(putStrikePct > 0 && putStrikePct < 1)) {
    throw new Error('putStrikePct must be between 0 and 1, e.g. 0.90 for a 10% out-of-the-money put.');
  }
  if (!(callStrikePct > 1)) {
    throw new Error('callStrikePct must be greater than 1, e.g. 1.15 for a 15% out-of-the-money call.');
  }

  const positionValue = shares * currentPrice;
  const unrealizedGain = (currentPrice - costBasis) * shares;

  const putStrike = round2(currentPrice * putStrikePct);
  const callStrike = round2(currentPrice * callStrikePct);
  const collarBandPct = round2(((callStrike - putStrike) / currentPrice) * 100);

  // Whether a collar costs nothing depends on the option premiums (implied volatility and skew),
  // which this engine does not model. Without quotes the answer is unknown, so it is null rather
  // than an unconditional `true`.
  const premiumsSupplied = isNonNegativeNumber(putPremium) && isNonNegativeNumber(callPremium);
  const netPremiumPerShare = premiumsSupplied ? round2(callPremium - putPremium) : null;

  return {
    symbol: symbol.toUpperCase(),
    shares,
    costBasis,
    currentPrice,
    positionValue: Math.round(positionValue),
    unrealizedGain: Math.round(unrealizedGain),
    collarParameters: {
      putStrikeFloor: putStrike,
      putFloorValue: Math.round(shares * putStrike),
      protectedMaxLossPercent: round2((1 - putStrikePct) * 100),
      callStrikeCap: callStrike,
      callCapValue: Math.round(shares * callStrike),
      upsideCapPercent: round2((callStrikePct - 1) * 100),
      collarBandPct
    },
    premiums: premiumsSupplied
      ? {
          putPremiumPerShare: putPremium,
          callPremiumPerShare: callPremium,
          netPremiumPerShare, // positive = net credit, negative = net debit
          netPremiumTotal: Math.round(netPremiumPerShare * shares),
          effectiveFloorPrice: round2(putStrike + netPremiumPerShare),
          effectiveCapPrice: round2(callStrike + netPremiumPerShare)
        }
      : null,
    zeroCostStructure: premiumsSupplied ? Math.abs(netPremiumPerShare) <= zeroCostTolerancePerShare : null,
    pricingNote: premiumsSupplied
      ? `Zero-cost test: absolute net premium within $${zeroCostTolerancePerShare} per share.`
      : 'Option premiums not supplied, so net cost is unknown. Pass putPremium and callPremium from live quotes to evaluate a zero-cost structure.',
    constructiveSaleReview: {
      required: true,
      collarBandPct,
      narrowBand: collarBandPct < 20,
      note: 'IRC §1259 can treat a collar on an appreciated position as a constructive sale when it removes substantially all risk of loss and opportunity for gain. No statute or final regulation defines a safe band; a put-to-call spread under roughly 15-20% of the share price is a commonly used practitioner warning sign. Obtain tax counsel sign-off before execution.'
    },
    requiresHumanApproval: true
  };
}

export function calculatePeMetrics(commitment = 5000000, calledCapital = 3000000, distributions = 1200000, nav = 3200000) {
  const unfundedCommitment = Math.max(0, commitment - calledCapital);
  const totalValue = distributions + nav;

  // MOIC / TVPI = Total Value / Paid-in Capital
  const tvpiMoic = calledCapital > 0 ? parseFloat((totalValue / calledCapital).toFixed(2)) : 0;

  // DPI = Distributions / Paid-in Capital
  const dpi = calledCapital > 0 ? parseFloat((distributions / calledCapital).toFixed(2)) : 0;

  // RVPI = Residual Value / Paid-in Capital
  const rvpi = calledCapital > 0 ? parseFloat((nav / calledCapital).toFixed(2)) : 0;

  return {
    commitment,
    calledCapital,
    unfundedCommitment,
    distributions,
    nav,
    totalValue,
    metrics: {
      tvpiMoic: `${tvpiMoic}x`,
      dpi: `${dpi}x`,
      rvpi: `${rvpi}x`,
      jCurvePhase: dpi > 0.5 ? 'Harvesting Phase' : 'Investment & Value Creation Phase'
    }
  };
}
