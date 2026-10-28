/**
 * Wealth Compliance Engine - FINRA Rule 2210 communications screen, FINRA 2111 suitability and SEC Marketing Rule performance checks
 */

// Promissory language. Patterns rather than fixed strings, so "guaranteed 12%" is caught as well
// as "guaranteed 15%". Flagged text always needs human review: the screen does not understand
// negation, so "we never promise risk-free returns" is flagged too, which is the safe direction.
const PROHIBITED_PATTERNS = [
  /\bguarantee(?:d|s)?\s+(?:a\s+|an\s+)?\d+(?:\.\d+)?\s*%/g,
  /\bguarantee(?:d|s)?\s+(?:a\s+|an\s+)?(?:return|returns|income|profit|profits|yield|gain|gains)\b/g,
  /\brisk-?\s?free\b/g,
  /\bno\s+risk\b/g,
  /\b100\s*%\s*safe\b/g,
  /\b(?:can't|cannot|can\s+not|won't|will\s+not)\s+lose\b/g
];

const REQUIRED_DISCLOSURES = [
  {
    disclosure: 'past performance is no guarantee',
    pattern: /\bpast performance (?:is no guarantee|is not (?:a |an )?(?:guarantee|indication)|does not guarantee)/
  },
  {
    disclosure: 'subject to market risk',
    pattern: /\bsubject to (?:market )?risks?\b/
  },
  {
    disclosure: 'may lose value',
    pattern: /\b(?:may|could|can) lose value\b|\bloss of principal\b/
  }
];

// Curly quotes and typographic dashes (as pasted from Word or Outlook) otherwise slip past the
// patterns, so text is normalised before matching.
function normalizeText(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ');
}

export function scanFinraRule2210(communicationText) {
  const text = normalizeText(communicationText);

  const foundProhibitedTerms = [];
  for (const pattern of PROHIBITED_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const phrase = match[0].trim();
      if (!foundProhibitedTerms.includes(phrase)) foundProhibitedTerms.push(phrase);
    }
  }

  const missingRequiredDisclaimers = REQUIRED_DISCLOSURES
    .filter(({ pattern }) => !pattern.test(text))
    .map(({ disclosure }) => disclosure);

  // Missing disclosures now affect the verdict. Before, a communication with none of them was
  // reported as compliant with a score of 100.
  let screenStatus = 'PASSED_AUTOMATED_SCREEN';
  if (foundProhibitedTerms.length > 0) screenStatus = 'VIOLATION';
  else if (missingRequiredDisclaimers.length > 0) screenStatus = 'NEEDS_REVIEW';

  const isCompliant = screenStatus === 'PASSED_AUTOMATED_SCREEN';

  let regulatoryNotice;
  if (screenStatus === 'VIOLATION') {
    regulatoryNotice = `Prohibited promissory language detected (${foundProhibitedTerms.join(', ')}). Revise before use.`;
  } else if (screenStatus === 'NEEDS_REVIEW') {
    regulatoryNotice = `No prohibited terms detected, but standard disclosures are missing (${missingRequiredDisclaimers.join('; ')}). Add them or document why they do not apply.`;
  } else {
    regulatoryNotice = 'Passed the automated keyword screen. This is not a Rule 2210 principal approval; retail communications still require review by a registered principal.';
  }

  return {
    isCompliant,
    screenStatus,
    prohibitedTermsFound: foundProhibitedTerms,
    missingDisclaimers: missingRequiredDisclaimers,
    // Heuristic triage score for sorting a review queue; not a regulatory measure.
    complianceScore: Math.max(0, 100 - foundProhibitedTerms.length * 35 - missingRequiredDisclaimers.length * 10),
    requiresPrincipalReview: true,
    screenLimitations: 'Keyword and pattern matching only: no negation handling, no fair-and-balanced assessment, no performance-presentation review.',
    regulatoryNotice
  };
}

const SUITABILITY_FACTORS = ['age', 'otherInvestments', 'financialSituation', 'taxStatus', 'investmentObjectives', 'investmentExperience', 'timeHorizonYears', 'liquidityNeeds', 'riskTolerance'];
const RISK_SCALE = { conservative: 1, moderately_conservative: 2, moderate: 3, moderately_aggressive: 4, aggressive: 5 };
const LIQUIDITY_RANK = { daily: 1, monthly: 2, quarterly: 3, annual: 4, illiquid: 5 };
// The least liquid product each stated liquidity need can tolerate.
const MAX_LIQUIDITY_FOR_NEED = { high: 1, medium: 3, low: 5 };

function riskRank(value, label) {
  if (Number.isInteger(value) && value >= 1 && value <= 5) return value;
  const rank = RISK_SCALE[String(value ?? '').toLowerCase()];
  if (!rank) throw new Error(`${label} must be 1-5 or one of ${Object.keys(RISK_SCALE).join(', ')}.`);
  return rank;
}

// FINRA 2111 customer-specific and quantitative suitability, which Regulation Best Interest's care
// obligation builds on. The rule sets no numeric turnover or cost-equity threshold, so those are only
// flagged against limits the firm supplies.
export function checkSuitability(profile = {}, recommendation = {}, { activity = null, limits = {} } = {}) {
  const missingProfileFactors = SUITABILITY_FACTORS.filter(f => profile[f] === undefined || profile[f] === null || profile[f] === '');
  const flags = [];
  const metrics = {};

  if (profile.riskTolerance != null && recommendation.riskLevel != null) {
    const customer = riskRank(profile.riskTolerance, 'profile.riskTolerance');
    const product = riskRank(recommendation.riskLevel, 'recommendation.riskLevel');
    metrics.riskGap = product - customer;
    if (product > customer) flags.push({ obligation: 'customer-specific', check: 'risk', detail: `Product risk ${product} exceeds the customer's stated tolerance ${customer} (on a 1-5 scale).` });
  }

  if (Number.isFinite(profile.timeHorizonYears) && Number.isFinite(recommendation.minimumHorizonYears)) {
    if (recommendation.minimumHorizonYears > profile.timeHorizonYears) {
      flags.push({ obligation: 'customer-specific', check: 'time horizon', detail: `Product needs ${recommendation.minimumHorizonYears} years; the customer's horizon is ${profile.timeHorizonYears}.` });
    }
  }

  if (profile.liquidityNeeds && recommendation.liquidity) {
    const need = MAX_LIQUIDITY_FOR_NEED[String(profile.liquidityNeeds).toLowerCase()];
    const product = LIQUIDITY_RANK[String(recommendation.liquidity).toLowerCase()];
    if (!need) throw new Error(`profile.liquidityNeeds must be one of ${Object.keys(MAX_LIQUIDITY_FOR_NEED).join(', ')}.`);
    if (!product) throw new Error(`recommendation.liquidity must be one of ${Object.keys(LIQUIDITY_RANK).join(', ')}.`);
    if (product > need) flags.push({ obligation: 'customer-specific', check: 'liquidity', detail: `A product with ${recommendation.liquidity} liquidity does not fit ${profile.liquidityNeeds} liquidity needs.` });
  }

  if (Number.isFinite(recommendation.amount) && Number.isFinite(profile.investableAssets) && profile.investableAssets > 0) {
    metrics.positionPctOfInvestableAssets = parseFloat(((recommendation.amount / profile.investableAssets) * 100).toFixed(2));
    if (Number.isFinite(limits.maxPositionPct) && metrics.positionPctOfInvestableAssets > limits.maxPositionPct) {
      flags.push({ obligation: 'customer-specific', check: 'concentration', detail: `${metrics.positionPctOfInvestableAssets}% of investable assets exceeds the firm limit of ${limits.maxPositionPct}%.` });
    }
  }

  if (activity) {
    const { averageEquity, purchases, costs, periodYears = 1 } = activity;
    if (!(Number.isFinite(averageEquity) && averageEquity > 0)) throw new Error('activity.averageEquity must be positive.');
    if (Number.isFinite(purchases)) metrics.annualTurnover = parseFloat((purchases / averageEquity / periodYears).toFixed(2));
    if (Number.isFinite(costs)) metrics.annualCostEquityPct = parseFloat(((costs / averageEquity / periodYears) * 100).toFixed(2));
    if (Number.isFinite(limits.maxTurnover) && metrics.annualTurnover > limits.maxTurnover) {
      flags.push({ obligation: 'quantitative', check: 'turnover', detail: `Annual turnover ${metrics.annualTurnover} exceeds the firm limit of ${limits.maxTurnover}.` });
    }
    if (Number.isFinite(limits.maxCostEquityPct) && metrics.annualCostEquityPct > limits.maxCostEquityPct) {
      flags.push({ obligation: 'quantitative', check: 'cost-equity', detail: `Annual cost-equity ratio ${metrics.annualCostEquityPct}% exceeds the firm limit of ${limits.maxCostEquityPct}%.` });
    }
  }

  let status = 'NO_FLAGS';
  if (flags.length > 0) status = 'FLAGGED';
  if (missingProfileFactors.length > 0) status = flags.length > 0 ? 'FLAGGED_WITH_MISSING_INFORMATION' : 'NEEDS_INFORMATION';

  return {
    status,
    flags,
    missingProfileFactors,
    metrics,
    requiresHumanApproval: true,
    note: 'Covers customer-specific and quantitative suitability from supplied facts. Reasonable-basis suitability, understanding the product itself, cannot be assessed from these inputs, and no flags is not a finding of suitability.'
  };
}

// SEC Marketing Rule 17 CFR 275.206(4)-1(d): the performance provisions only.
export function checkPerformanceAdvertisement(ad = {}, { asOf = null } = {}) {
  const violations = [];
  const unanswered = [];
  const today = asOf ? new Date(asOf) : new Date();
  if (Number.isNaN(today.getTime())) throw new Error('asOf must be a date.');

  const need = (field, question) => {
    if (ad[field] === undefined || ad[field] === null) { unanswered.push({ field, question }); return false; }
    return true;
  };

  // (d)(1) Gross performance needs net, with equal prominence, same period and method.
  if (ad.showsGrossPerformance) {
    if (need('showsNetPerformance', 'Does the advertisement also show net performance?') && !ad.showsNetPerformance) {
      violations.push({ paragraph: '(d)(1)', requirement: 'Gross performance must be accompanied by net performance.' });
    } else if (ad.showsNetPerformance) {
      if (need('netWithEqualProminence', 'Is net performance shown with at least equal prominence to gross?') && !ad.netWithEqualProminence) {
        violations.push({ paragraph: '(d)(1)(i)', requirement: 'Net performance must have at least equal prominence to gross, in a format that eases comparison.' });
      }
      if (need('netSamePeriodAndMethod', 'Is net calculated over the same period, return type and methodology as gross?') && !ad.netSamePeriodAndMethod) {
        violations.push({ paragraph: '(d)(1)(ii)', requirement: 'Net performance must use the same period, type of return and methodology as gross.' });
      }
    }
  }

  // (d)(2) One-, five- and ten-year periods, or life of the portfolio where shorter; private funds exempt.
  let requiredPeriods = [];
  if (need('isPrivateFund', 'Is the performance that of a private fund?') && !ad.isPrivateFund) {
    const shown = new Set(ad.periodsShown ?? []);
    if (need('portfolioInceptionDate', 'When did the portfolio or composite begin?') && need('periodEndDate', 'What date do the performance periods end on?')) {
      const inception = new Date(ad.portfolioInceptionDate);
      const end = new Date(ad.periodEndDate);
      if (Number.isNaN(inception.getTime()) || Number.isNaN(end.getTime())) {
        throw new Error('portfolioInceptionDate and periodEndDate must be dates such as 2014-01-01.');
      }
      const ageYears = (end - inception) / (365.25 * 86400000);
      requiredPeriods = [1, 5, 10].map(y => (ageYears >= y ? `${y}y` : 'life'));
      requiredPeriods = [...new Set(requiredPeriods)];
      const missing = requiredPeriods.filter(p => !shown.has(p));
      if (missing.length > 0) {
        violations.push({ paragraph: '(d)(2)', requirement: 'Portfolio performance must show 1-, 5- and 10-year periods, substituting the life of the portfolio for any it has not existed through.', detail: `Missing: ${missing.join(', ')}.` });
      }
      const lastYearEnd = new Date(Date.UTC(today.getUTCMonth() === 11 && today.getUTCDate() === 31 ? today.getUTCFullYear() : today.getUTCFullYear() - 1, 11, 31));
      if (end < lastYearEnd) {
        violations.push({ paragraph: '(d)(2)', requirement: 'Periods must end no earlier than the most recent calendar year-end.', detail: `Periods end ${ad.periodEndDate}; the most recent year-end is ${lastYearEnd.toISOString().slice(0, 10)}.` });
      }
    }
  }

  // (d)(4) Related performance must include all related portfolios unless excluding them changes nothing material.
  if (ad.includesRelatedPerformance && need('includesAllRelatedPortfolios', 'Does the related performance include all related portfolios?') && !ad.includesAllRelatedPortfolios) {
    if (need('exclusionsNotMateriallyHigher', 'Are results no materially higher than if all related portfolios were included?') && !ad.exclusionsNotMateriallyHigher) {
      violations.push({ paragraph: '(d)(4)', requirement: 'Related performance that excludes portfolios must not be materially higher than including them all.' });
    }
  }

  // (d)(5) Extracted performance must offer the total portfolio's results.
  if (ad.extractedPerformance && need('offersTotalPortfolioPerformance', 'Does the advertisement provide, or offer promptly, the total portfolio results?') && !ad.offersTotalPortfolioPerformance) {
    violations.push({ paragraph: '(d)(5)', requirement: 'Extracted performance must provide or offer the performance of the total portfolio it came from.' });
  }

  // (d)(6) Hypothetical performance needs policies, and explanations of assumptions and risks.
  if (ad.hypotheticalPerformance) {
    [
      ['hypotheticalPoliciesAdopted', 'Policies and procedures ensuring hypothetical performance is relevant to the audience must be adopted.', '(d)(6)(i)'],
      ['hypotheticalAssumptionsExplained', 'The criteria and assumptions behind hypothetical performance must be explained.', '(d)(6)(ii)'],
      ['hypotheticalRisksExplained', 'The risks and limitations of relying on hypothetical performance must be explained.', '(d)(6)(iii)']
    ].forEach(([field, requirement, paragraph]) => {
      if (need(field, `${requirement.replace(/must be .*$/, '')}- is that in place?`) && !ad[field]) violations.push({ paragraph, requirement });
    });
  }

  return {
    compliantWithPerformanceProvisions: violations.length === 0 && unanswered.length === 0,
    violations,
    unanswered,
    requiredPeriods,
    requiresComplianceReview: true,
    note: 'Checks only the performance provisions of 206(4)-1(d). Testimonials, endorsements, third-party ratings and the general prohibitions in paragraph (a) are out of scope.'
  };
}
