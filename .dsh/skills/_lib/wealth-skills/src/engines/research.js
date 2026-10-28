import { inputError } from './guidance.js';

/**
 * Wealth Research Engine - Self-Contained Valuation & SEC EDGAR Parser
 */

export function generateCompanyTearSheet(ticker, financials) {
  const t = ticker.toUpperCase();
  const {
    marketCap = 0,
    price = 0,
    eps = 0,
    revenue = 0,
    netIncome = 0,
    freeCashFlow = 0,
    dividends = 0,
    sector = 'General'
  } = financials;

  const peRatio = eps > 0 ? parseFloat((price / eps).toFixed(2)) : 'N/A';
  const psRatio = revenue > 0 && marketCap > 0 ? parseFloat((marketCap / revenue).toFixed(2)) : 'N/A';
  const dividendYield = price > 0 && dividends > 0 ? parseFloat(((dividends / price) * 100).toFixed(2)) : 0;
  const fcfConversion = netIncome > 0 ? parseFloat(((freeCashFlow / netIncome) * 100).toFixed(1)) : 'N/A';

  return {
    ticker: t,
    sector,
    price,
    marketCapFormatted: formatCurrency(marketCap),
    valuationMetrics: {
      peRatio,
      psRatio,
      dividendYieldPercent: dividendYield,
      freeCashFlowConversionPercent: fcfConversion
    },
    investmentSummary: `${t} trades at a P/E of ${peRatio} with a dividend yield of ${dividendYield}%. FCF Conversion is ${fcfConversion}%.`
  };
}

export function parseEdgarFilingSummary(cik, filingType = '10-K', filingText = '') {
  const lower = filingText.toLowerCase();
  
  const riskPhrases = ['supply chain', 'cybersecurity', 'regulatory', 'interest rate', 'competition'];
  const identifiedRisks = riskPhrases.filter(p => lower.includes(p));

  return {
    cik,
    filingType,
    parsedAt: new Date().toISOString(),
    item1ARiskSummary: identifiedRisks.length > 0 ? `Identified risks relating to: ${identifiedRisks.join(', ')}.` : "Standard Item 1A disclosure.",
    hasMaterialChange: lower.includes('material adverse') || lower.includes('restatement')
  };
}

function formatCurrency(val) {
  if (val >= 1e12) return `$${(val / 1e12).toFixed(2)}T`;
  if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
  return `$${val.toLocaleString()}`;
}

// Discounted cash flow with a Gordon-growth terminal value, plus a small sensitivity grid.
export function buildDcfValuation({ freeCashFlows, discountRate, terminalGrowthRate, netDebt = 0, sharesOutstanding = null } = {}) {
  if (!Array.isArray(freeCashFlows) || freeCashFlows.length === 0 || !freeCashFlows.every(Number.isFinite)) {
    throw inputError('freeCashFlows must be a non-empty array of yearly amounts.', [{
      field: 'freeCashFlows', question: 'What are the forecast free cash flows for each year?', why: 'The valuation discounts each year of the forecast.'
    }]);
  }
  if (!(Number.isFinite(discountRate) && discountRate > -1)) throw new Error('discountRate must be a decimal above -1, e.g. 0.09.');
  if (!Number.isFinite(terminalGrowthRate)) throw new Error('terminalGrowthRate must be a decimal, e.g. 0.025.');
  if (discountRate <= terminalGrowthRate) {
    throw inputError(`discountRate ${discountRate} must exceed terminalGrowthRate ${terminalGrowthRate}.`, [{
      field: 'terminalGrowthRate', question: 'What long-run growth rate, below the discount rate, should the terminal value assume?', why: 'A growth rate at or above the discount rate makes the terminal value infinite.'
    }]);
  }

  const value = (r, g) => {
    const pvForecast = freeCashFlows.reduce((sum, cf, i) => sum + cf / Math.pow(1 + r, i + 1), 0);
    const terminal = (freeCashFlows.at(-1) * (1 + g)) / (r - g);
    const pvTerminal = terminal / Math.pow(1 + r, freeCashFlows.length);
    return { pvForecast, terminal, pvTerminal, enterprise: pvForecast + pvTerminal };
  };

  const base = value(discountRate, terminalGrowthRate);
  const equity = base.enterprise - netDebt;
  const r2 = (x) => Math.round(x * 100) / 100;

  const sensitivity = [];
  for (const dr of [-0.01, 0, 0.01]) {
    for (const dg of [-0.005, 0, 0.005]) {
      const r = discountRate + dr;
      const g = terminalGrowthRate + dg;
      if (r > g && r > -1) sensitivity.push({ discountRate: parseFloat(r.toFixed(4)), terminalGrowthRate: parseFloat(g.toFixed(4)), enterpriseValue: r2(value(r, g).enterprise) });
    }
  }

  return {
    presentValueOfForecast: r2(base.pvForecast),
    terminalValue: r2(base.terminal),
    presentValueOfTerminal: r2(base.pvTerminal),
    enterpriseValue: r2(base.enterprise),
    equityValue: r2(equity),
    valuePerShare: Number.isFinite(sharesOutstanding) && sharesOutstanding > 0 ? r2(equity / sharesOutstanding) : null,
    terminalValueShareOfEnterprisePct: r2((base.pvTerminal / base.enterprise) * 100),
    sensitivity,
    note: 'A model of the inputs, not a price target. When the terminal value dominates enterprise value, the answer mostly reflects the growth and discount assumptions.'
  };
}

// Latest annual (or chosen period) value of one XBRL concept from SEC companyfacts JSON, the shape
// returned by fetchLiveEdgarCompanyFacts or https://data.sec.gov/api/xbrl/companyfacts/.
export function extractCompanyFact(companyFacts, { concept, taxonomy = 'us-gaap', unit = 'USD', form = '10-K', fiscalPeriod = 'FY' } = {}) {
  const facts = companyFacts?.facts?.[taxonomy];
  if (!facts) throw new Error(`No ${taxonomy} facts in the supplied document.`);

  const entry = facts[concept];
  if (!entry) {
    const needle = String(concept ?? '').toLowerCase();
    const similar = Object.keys(facts).filter(k => needle && k.toLowerCase().includes(needle.slice(0, 6))).slice(0, 5);
    throw inputError(`Concept "${concept}" is not reported under ${taxonomy}.`, [{
      field: 'concept',
      question: similar.length ? `Did you mean one of: ${similar.join(', ')}?` : 'Which XBRL concept should be read (for example Revenues or NetIncomeLoss)?',
      why: 'Companies report the same idea under different concept names.'
    }]);
  }

  const series = entry.units?.[unit];
  if (!series) {
    throw inputError(`Concept "${concept}" has no ${unit} values.`, [{
      field: 'unit', question: `Which unit should be used: ${Object.keys(entry.units ?? {}).join(', ')}?`, why: 'Values are stored per unit.'
    }]);
  }

  const candidates = series.filter(f => (f.form === form || f.form === `${form}/A`) && f.fp === fiscalPeriod);
  if (candidates.length === 0) throw new Error(`No ${form} ${fiscalPeriod} values for ${concept} in ${unit}.`);

  // Latest period first; for restated periods the most recent filing wins.
  const latest = candidates.reduce((best, f) => {
    if (!best) return f;
    if (f.end > best.end) return f;
    if (f.end === best.end && f.filed > best.filed) return f;
    return best;
  }, null);

  return {
    entityName: companyFacts.entityName ?? null,
    cik: companyFacts.cik ?? null,
    taxonomy,
    concept,
    label: entry.label ?? null,
    unit,
    value: latest.val,
    periodStart: latest.start ?? null,
    periodEnd: latest.end,
    fiscalYear: latest.fy ?? null,
    fiscalPeriod: latest.fp,
    form: latest.form,
    filed: latest.filed,
    accessionNumber: latest.accn ?? null,
    source: 'SEC companyfacts (XBRL)'
  };
}
