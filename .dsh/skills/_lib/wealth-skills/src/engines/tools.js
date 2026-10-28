/**
 * Wealth Tool Registry - one definition per capability, shared by the MCP servers, the browser
 * assistant and anything else that needs a tool surface.
 *
 * Each definition carries the MCP tool name, the CLI command it mirrors (also its key in guidance.js,
 * so questions and next steps are shared), a JSON Schema for its arguments, and the engine call. The
 * module is browser-safe: it imports engines only, never Node built-ins.
 */

import { calculateTaxBracketHeadroom, calculateRMD, runMonteCarloCashFlow } from './planning.js';
import { monitorPortfolioDrift, calculatePortfolioVar, calculatePortfolioRebalance, analyzePortfolioFactors, scanTaxLossHarvesting } from './portfolio.js';
import { backtestPortfolio, forwardTestSimulation } from './quant.js';
import { scanFinraRule2210, checkSuitability, checkPerformanceAdvertisement } from './compliance.js';
import { netCapitalGainsAndLosses, calculateNetInvestmentIncomeTax, calculateCostBasis } from './tax.js';
import { calculateTimeWeightedReturn, calculateMoneyWeightedReturn, assessSharpeRatio } from './performance.js';
import { validateSecurityIdentifier, calculateSettlementDate } from './markets.js';
import { validatePreTradeCompliance, buildTradePayload } from './execution.js';
import { buildFixOrderPayload } from './fix.js';
import { validateCipIdentity, identifyOnboardingGaps } from './onboarding.js';
import { generateCompanyTearSheet, buildDcfValuation } from './research.js';
import { parseMeetingTranscript } from './crm.js';
import { calculateCollarStrategy, calculatePeMetrics } from './uhnw.js';
import { reconcileLedger, tieOutNav, checkLpCapitalStatement, trackCloseChecklist } from './fundops.js';
import { withAuditMetadata } from './audit.js';
import { withGuidance } from './guidance.js';

const CALLER_INPUTS = 'caller-supplied tool arguments';

const num = (description) => ({ type: 'number', description });
const int = (description) => ({ type: 'integer', description });
const str = (description) => ({ type: 'string', description });
const obj = (description) => ({ type: 'object', description });
const arr = (description) => ({ type: 'array', description });
const FILING_STATUS = { type: 'string', enum: ['MFJ', 'SINGLE'], description: 'Filing status (default MFJ)' };
const TAX_FILING_STATUS = { type: 'string', enum: ['MFJ', 'QSS', 'MFS', 'SINGLE', 'HOH'], description: 'Filing status (default MFJ)' };

export const WEALTH_TOOLS = [
  // --- Planning -----------------------------------------------------------------------------------
  {
    name: 'calculate_tax_headroom', command: 'planning tax-headroom', skillPack: 'wealth-planning',
    description: 'Remaining room in the current federal ordinary-income bracket for tax year 2026 after the standard deduction. A starting point for sizing Roth conversions, not a tax return: ignores itemizing, credits, capital gains stacking, NIIT and state tax.',
    properties: { agi: num('Adjusted Gross Income'), filingStatus: FILING_STATUS },
    required: ['agi'],
    run: (a) => calculateTaxBracketHeadroom(a.agi, a.filingStatus ?? 'MFJ'),
    engineFunction: 'calculateTaxBracketHeadroom', methodology: 'Ordinary-income bracket headroom after the standard deduction',
    dataSources: ['IRS Rev. Proc. 2025-32 (tax year 2026 brackets and standard deduction)']
  },
  {
    name: 'calculate_rmd', command: 'planning rmd', skillPack: 'wealth-planning',
    description: 'Required minimum distribution from the IRS Uniform Lifetime Table, with the SECURE 2.0 starting age (73, or 75 if born in 1960 or later). Not for a sole spouse beneficiary more than 10 years younger.',
    properties: { age: int('Account owner age this year'), balance: num('Account balance on December 31 of last year'), birthYear: int('Birth year, to apply the age-75 start') },
    required: ['age', 'balance'],
    run: (a) => calculateRMD(a.age, a.balance, { birthYear: a.birthYear }),
    engineFunction: 'calculateRMD', methodology: 'Prior year-end balance divided by the Uniform Lifetime Table distribution period',
    dataSources: ['IRS Uniform Lifetime Table, Treas. Reg. §1.401(a)(9)-9(c)']
  },
  {
    name: 'run_monte_carlo_cash_flow', command: 'planning monte-carlo', skillPack: 'wealth-planning',
    description: 'Retirement cash-flow Monte Carlo with inflation-adjusted start-of-year withdrawals. Assumptions are illustrative; results ignore taxes and fees.',
    properties: {
      assets: num('Starting portfolio value'), spend: num('First-year withdrawal'), expectedReturn: num('Expected annual return as a decimal (default 0.06)'),
      volatility: num('Annual volatility as a decimal (default 0.12)'), years: int('Horizon in years (default 30)'), trials: int('Simulated paths (default 1000)'),
      inflation: num('Annual inflation as a decimal (default 0.025)')
    },
    required: ['assets', 'spend'],
    run: (a) => runMonteCarloCashFlow(a.assets, a.spend, a.expectedReturn ?? 0.06, a.volatility ?? 0.12, a.years ?? 30, a.trials ?? 1000, a.inflation ?? 0.025),
    engineFunction: 'runMonteCarloCashFlow', methodology: 'Monte Carlo of normal annual returns with inflation-adjusted start-of-year withdrawals'
  },
  {
    name: 'net_capital_gains_losses', command: 'planning capital-losses', skillPack: 'wealth-planning',
    description: 'Nets short- and long-term capital gains and losses, applies the $3,000 ($1,500 MFS) ordinary-income deduction limit, and carries the rest forward, following the Schedule D capital loss carryover worksheet. Enter losses as positive amounts.',
    properties: {
      shortTermGains: num('Short-term gains'), shortTermLosses: num('Short-term losses, as a positive amount'),
      longTermGains: num('Long-term gains'), longTermLosses: num('Long-term losses, as a positive amount'),
      shortTermCarryover: num('Short-term loss carried in from last year'), longTermCarryover: num('Long-term loss carried in from last year'),
      filingStatus: TAX_FILING_STATUS, taxableIncome: num('Taxable income before the capital loss deduction, when it could be small')
    },
    required: [],
    run: (a) => netCapitalGainsAndLosses(a),
    engineFunction: 'netCapitalGainsAndLosses', methodology: 'IRC §1222 netting, §1211(b) limitation, §1212(b) carryover (Schedule D worksheet)',
    dataSources: ['IRC §§1211, 1212, 1222; IRS Schedule D instructions']
  },
  {
    name: 'calculate_niit', command: 'planning niit', skillPack: 'wealth-planning',
    description: 'Net investment income tax under IRC §1411: 3.8% of the lesser of net investment income or MAGI above $250,000 (MFJ/QSS), $125,000 (MFS) or $200,000 (single/HOH). Thresholds are not indexed.',
    properties: { magi: num('Modified adjusted gross income'), netInvestmentIncome: num('Net investment income'), filingStatus: TAX_FILING_STATUS },
    required: ['magi', 'netInvestmentIncome'],
    run: (a) => calculateNetInvestmentIncomeTax(a),
    engineFunction: 'calculateNetInvestmentIncomeTax', methodology: '3.8% of the lesser of net investment income or MAGI above the statutory threshold',
    dataSources: ['IRC §1411']
  },

  // --- Portfolio and performance ---------------------------------------------------------------------
  {
    name: 'monitor_portfolio_drift', command: 'portfolio drift-monitor', skillPack: 'wealth-portfolio',
    description: 'Compares current allocation percentages with targets, flags categories outside the tolerance band, and proposes rebalance trades for human approval.',
    properties: {
      currentAlloc: obj('Current allocation percentages, e.g. {"equity":68,"fixedIncome":32}'), targetAlloc: obj('Target allocation percentages'),
      portfolioValue: num('Total portfolio value'), toleranceBandPct: num('Drift threshold in percentage points (default 5)')
    },
    required: ['currentAlloc', 'targetAlloc', 'portfolioValue'],
    run: (a) => monitorPortfolioDrift(a.currentAlloc, a.targetAlloc, a.portfolioValue, a.toleranceBandPct ?? 5.0),
    engineFunction: 'monitorPortfolioDrift', methodology: 'Absolute percentage-point drift against target with proportional minimum trade size'
  },
  {
    name: 'calculate_portfolio_rebalance', command: 'portfolio rebalance', skillPack: 'wealth-portfolio',
    description: 'Trades that move a portfolio from its current allocation to target, skipping trades below a minimum size. Proposals for human approval; nothing is placed.',
    properties: {
      currentAlloc: obj('Current allocation percentages'), targetAlloc: obj('Target allocation percentages'), portfolioValue: num('Total portfolio value'),
      minTradePct: num('Trades smaller than this percentage of portfolio value are held (default 0.05, i.e. 0.05%)')
    },
    required: ['currentAlloc', 'targetAlloc', 'portfolioValue'],
    run: (a) => calculatePortfolioRebalance(a.currentAlloc, a.targetAlloc, a.portfolioValue, a.minTradePct === undefined ? {} : { minTradePct: a.minTradePct }),
    engineFunction: 'calculatePortfolioRebalance', methodology: 'Target-minus-current trade sizing with proportional minimum trade size'
  },
  {
    name: 'calculate_portfolio_var', command: 'portfolio var', skillPack: 'wealth-portfolio',
    description: 'Parametric (normal) Value at Risk and expected shortfall at any confidence level and horizon, from a supplied annualized volatility.',
    properties: {
      portfolioValue: num('Total portfolio value'), annualizedVol: num('Annualized volatility as a decimal (default 0.14)'),
      confidenceLevel: num('Confidence level as a decimal between 0.5 and 1 (default 0.95)'), horizonDays: num('Horizon in trading days (default 1)')
    },
    required: ['portfolioValue'],
    run: (a) => calculatePortfolioVar(a.portfolioValue, a.annualizedVol ?? 0.14, a.confidenceLevel ?? 0.95, a.horizonDays ?? 1),
    engineFunction: 'calculatePortfolioVar', methodology: 'Parametric normal VaR and expected shortfall'
  },
  {
    name: 'analyze_portfolio_factors', command: 'portfolio factors', skillPack: 'wealth-portfolio',
    description: 'Asset-class weights, plus weighted factor scores and duration from per-holding inputs you supply. It does not estimate factor exposures.',
    properties: { holdings: arr('Holdings, e.g. [{"symbol":"VTI","weightPct":60,"factorScores":{"value":0.4}},{"symbol":"BND","weightPct":40,"durationYears":6}]') },
    required: ['holdings'],
    run: (a) => analyzePortfolioFactors(a.holdings),
    engineFunction: 'analyzePortfolioFactors', methodology: 'Asset-class weights; weighted averages of per-holding factor and duration inputs',
    dataSources: ['library symbol-to-asset-class table']
  },
  {
    name: 'scan_tax_loss_harvesting', command: 'portfolio tlh', skillPack: 'wealth-portfolio',
    description: 'Finds lots with harvestable losses, checks the 30-day look-back for wash sales across the supplied lots, and suggests replacements tracking a different index.',
    properties: {
      lots: arr('Tax lots: [{"id","symbol","quantity","purchasePrice","currentPrice","purchaseDate"}]'),
      minLoss: num('Minimum loss to report (default 1000)'), saleDate: str('Proposed sale date, YYYY-MM-DD (default today)')
    },
    required: ['lots'],
    run: (a) => scanTaxLossHarvesting(a.lots, a.minLoss ?? 1000, a.saleDate ? new Date(a.saleDate) : new Date()),
    engineFunction: 'scanTaxLossHarvesting', methodology: 'Unrealized loss screen; 30-day look-back wash-sale check across supplied lots; cross-index replacement candidates',
    dataSources: ['library ETF tracked-index table']
  },
  {
    name: 'calculate_cost_basis', command: 'portfolio cost-basis', skillPack: 'wealth-portfolio',
    description: 'Relieves lots for a sale by FIFO, specific identification or average cost, and splits the gain into short- and long-term (held more than one year).',
    properties: {
      lots: arr('Lots: [{"id","quantity","price","date"}]'), sale: obj('Sale: {"quantity","date","price"}'),
      method: { type: 'string', enum: ['FIFO', 'SPECIFIC', 'AVERAGE'], description: 'Basis method (default FIFO)' },
      specificLots: arr('For SPECIFIC: [{"id","quantity"}]')
    },
    required: ['lots', 'sale'],
    run: (a) => calculateCostBasis(a),
    engineFunction: 'calculateCostBasis', methodology: 'Lot relief by FIFO, specific identification or average cost; holding over one year is long-term',
    dataSources: ['IRC §1012; IRS Publication 551']
  },
  {
    name: 'calculate_time_weighted_return', command: 'portfolio twr', skillPack: 'wealth-portfolio',
    description: 'True time-weighted return from valuations taken at every external cash flow, linked geometrically. Periods under a year are not annualized.',
    properties: { valuations: arr('Valuations: [{"date","value","cashFlow"}], where cashFlow is the external flow on that date, included in value') },
    required: ['valuations'],
    run: (a) => calculateTimeWeightedReturn(a.valuations),
    engineFunction: 'calculateTimeWeightedReturn', methodology: 'True time-weighted return, valuations at each external cash flow, linked geometrically'
  },
  {
    name: 'calculate_money_weighted_return', command: 'portfolio irr', skillPack: 'wealth-portfolio',
    description: 'Money-weighted return (XIRR) on dated cash flows: contributions negative, distributions and ending value positive.',
    properties: { cashFlows: arr('Dated flows: [{"date","amount"}]') },
    required: ['cashFlows'],
    run: (a) => calculateMoneyWeightedReturn(a.cashFlows),
    engineFunction: 'calculateMoneyWeightedReturn', methodology: 'XIRR on dated cash flows, actual/365'
  },
  {
    name: 'assess_sharpe_ratio', command: 'quant sharpe-stats', skillPack: 'wealth-portfolio',
    description: 'How far a Sharpe ratio can be trusted: Lo (2002) standard error, the probabilistic Sharpe ratio, and the deflated Sharpe ratio when you say how many strategies were tried.',
    properties: {
      returns: arr('Periodic returns as decimals'), periodsPerYear: int('Periods per year (default 12)'), riskFreeRate: num('Annual risk-free rate (default 0)'),
      benchmarkSharpe: num('Annualized Sharpe to beat (default 0)'), trials: int('Number of strategies tried, for the deflated Sharpe ratio'),
      sharpeVariance: num('Variance of the Sharpe ratios across those trials')
    },
    required: ['returns'],
    run: (a) => assessSharpeRatio(a.returns, a),
    engineFunction: 'assessSharpeRatio', methodology: 'Lo (2002) standard error; probabilistic and deflated Sharpe ratio (Bailey and Lopez de Prado)'
  },
  {
    name: 'backtest_portfolio', command: 'quant backtest', skillPack: 'wealth-portfolio',
    description: 'Historical backtest on embedded approximate annual total returns (2015-2024) for VTI, BND, VXUS and VNQ only; any other ticker is rejected. Returns CAGR, volatility, Sharpe, Sortino and max drawdown (year-end resolution).',
    properties: { weights: obj('Ticker weights, e.g. {"VTI":0.6,"BND":0.4}. Supported: VTI, BND, VXUS, VNQ.'), initialBalance: num('Starting capital (default 100000)') },
    required: ['weights'],
    run: (a) => backtestPortfolio(a.weights, a.initialBalance ?? 100000),
    engineFunction: 'backtestPortfolio', methodology: 'Annual historical backtest with annual rebalancing',
    dataSources: ['embedded approximate annual total returns, 2015-2024']
  },
  {
    name: 'forward_test_simulation', command: 'quant forward-test', skillPack: 'wealth-portfolio',
    description: 'Monte Carlo projection of a weighted portfolio under a macro regime, using illustrative per-asset return/volatility assumptions (not forecasts) and correlations estimated from 2015-2024 annual returns. Supported tickers: VTI, BND, VXUS, VNQ.',
    properties: {
      weights: obj('Ticker weights, e.g. {"VTI":0.6,"BND":0.4}'),
      regime: { type: 'string', enum: ['baseline', 'stagflation', 'bull_market', 'bear_market'], description: 'Macro regime (default baseline)' },
      years: int('Projection horizon in years (default 5)'), trials: int('Number of simulated paths (default 500)'), initialBalance: num('Starting capital (default 100000)')
    },
    required: ['weights'],
    run: (a) => forwardTestSimulation(a.weights, a.regime ?? 'baseline', a.years ?? 5, a.trials ?? 500, { initialBalance: a.initialBalance ?? 100000 }),
    engineFunction: 'forwardTestSimulation', methodology: 'Monte Carlo on portfolio-level normal annual returns (weighted mean, full covariance)',
    dataSources: ['illustrative regime capital market assumptions (library defaults)', 'correlations from embedded 2015-2024 annual returns']
  },

  // --- Execution --------------------------------------------------------------------------------------
  {
    name: 'validate_pre_trade', command: 'execution validate', skillPack: 'wealth-execution',
    description: 'Pre-trade checks: buying power against settled cash, oversell against supplied positions (fails closed when the position is unknown), and short-term holding-period warnings.',
    properties: { order: obj('Order: {"symbol","action":"BUY|SELL","quantity","price"}'), settledCash: num('Settled cash available'), positions: obj('Shares held by symbol, e.g. {"VTI":120}') },
    required: ['order', 'settledCash'],
    run: (a) => validatePreTradeCompliance({ settledCash: a.settledCash, positions: a.positions }, a.order),
    engineFunction: 'validatePreTradeCompliance', methodology: 'Buying power, oversell and holding-period checks'
  },
  {
    name: 'build_trade_payload', command: 'execution payload', skillPack: 'wealth-execution',
    description: 'Builds an Alpaca or Interactive Brokers REST order payload for a person to review and submit. Nothing is sent. IBKR orders need a numeric conid.',
    properties: { broker: { type: 'string', enum: ['Alpaca', 'IBKR'], description: 'Broker' }, account: str('Brokerage account ID'), order: obj('Order: {"symbol","action","quantity","price","conid"}') },
    required: ['broker', 'account', 'order'],
    run: (a) => buildTradePayload(a.broker, a.account, a.order),
    engineFunction: 'buildTradePayload', methodology: 'Broker REST order payload construction (not submitted)'
  },
  {
    name: 'build_fix_order_payload', command: 'execution fix-payload', skillPack: 'wealth-execution',
    description: 'Builds a FIX 4.4 New Order Single (35=D) with correct BodyLength and CheckSum, for a session you operate. Nothing is sent.',
    properties: {
      custodian: str('Target custodian label'), account: str('Account'), symbol: str('Symbol'),
      side: { type: 'string', enum: ['BUY', 'SELL'], description: 'Side' }, quantity: num('Quantity'), price: num('Limit price'), msgSeqNum: int('MsgSeqNum from your FIX session')
    },
    required: ['account', 'symbol', 'side', 'quantity', 'price'],
    run: (a) => buildFixOrderPayload({ targetCustodian: a.custodian, account: a.account, symbol: a.symbol, side: a.side, quantity: a.quantity, price: a.price, msgSeqNum: a.msgSeqNum }),
    engineFunction: 'buildFixOrderPayload', methodology: 'FIX 4.4 New Order Single (35=D) construction with BodyLength and CheckSum'
  },
  {
    name: 'validate_security_identifier', command: 'execution identifier', skillPack: 'wealth-execution',
    description: 'Validates an ISIN, CUSIP, FIGI or LEI check digit, or the format of a MIC or CFI code. The type is detected when omitted. It does not confirm the security exists.',
    properties: { id: str('Identifier, e.g. US0378331005'), type: { type: 'string', enum: ['ISIN', 'CUSIP', 'FIGI', 'LEI', 'MIC', 'CFI'], description: 'Identifier type (detected when omitted)' } },
    required: ['id'],
    run: (a) => validateSecurityIdentifier(a.id, a.type ?? null),
    engineFunction: 'validateSecurityIdentifier', methodology: 'Check digits for ISIN (ISO 6166), CUSIP, FIGI and LEI (ISO 17442); format checks for MIC and CFI'
  },
  {
    name: 'calculate_settlement_date', command: 'execution settlement-date', skillPack: 'wealth-execution',
    description: 'Settlement date for a US equity trade under the T+1 cycle of SEC Rule 15c6-1, skipping weekends and the market holidays you supply.',
    properties: { tradeDate: str('Trade date, YYYY-MM-DD'), holidays: arr('Market holidays as YYYY-MM-DD strings'), settlementDays: int('Business days to settle (default 1)') },
    required: ['tradeDate'],
    run: (a) => calculateSettlementDate(a.tradeDate, { holidays: a.holidays ?? [], settlementDays: a.settlementDays ?? 1 }),
    engineFunction: 'calculateSettlementDate', methodology: 'Business-day count skipping weekends and supplied holidays',
    dataSources: ['SEC Rule 15c6-1 (T+1)']
  },

  // --- Onboarding, compliance, research, CRM, UHNW -----------------------------------------------------
  {
    name: 'validate_cip_identity', command: 'onboarding validate-cip', skillPack: 'wealth-onboarding',
    description: 'Checks the four CIP identity fields for presence and format and records an OFAC screen result you performed. It does not screen OFAC or verify identity itself.',
    properties: { applicant: obj('Applicant: {"name","ssn","dob","address","ofacStatus"}') },
    required: ['applicant'],
    run: (a) => validateCipIdentity(a.applicant),
    engineFunction: 'validateCipIdentity', methodology: 'Field presence and format checks; records a caller-performed OFAC screen result'
  },
  {
    name: 'identify_onboarding_gaps', command: 'onboarding gaps', skillPack: 'wealth-onboarding',
    description: 'Lists what stands between an application and an open, recommendable account, by account type (individual, joint, ira, trust, entity): blocking gaps, gaps before recommendations, and recommended items, citing CIP, FinCEN CDD and FINRA 2090, 2111, 2165 and 4512.',
    properties: { application: obj('Application: {"accountType","applicants":[...],"entity","trust","trustedContact","investmentProfile","asOf"}') },
    required: ['application'],
    run: (a) => identifyOnboardingGaps(a.application),
    engineFunction: 'identifyOnboardingGaps', methodology: 'Account-type requirement sets from CIP, FinCEN CDD and FINRA 2090, 2111, 2165 and 4512',
    dataSources: ['31 CFR 1023.220; 31 CFR 1010.230; FINRA Rules 2090, 2111, 2165, 4512']
  },
  {
    name: 'scan_finra_compliance', command: 'compliance scan', skillPack: 'wealth-compliance',
    description: 'Automated keyword and pattern screen of advisory text for promissory language and missing standard disclosures. Not a substitute for registered-principal review under FINRA Rule 2210.',
    properties: { text: str('Communication text to screen') },
    required: ['text'],
    run: (a) => scanFinraRule2210(a.text),
    engineFunction: 'scanFinraRule2210', methodology: 'Pattern matching for promissory terms and required disclosure phrases'
  },
  {
    name: 'check_suitability', command: 'compliance suitability', skillPack: 'wealth-compliance',
    description: 'Checks a recommendation against the FINRA Rule 2111 customer profile (risk, horizon, liquidity) and reports concentration, turnover and cost-to-equity. FINRA sets no numeric thresholds for those, so they flag only against firm limits you supply.',
    properties: { profile: obj('Customer investment profile, the nine FINRA 2111 factors'), recommendation: obj('Recommendation: {"product","riskLevel","minimumHorizonYears","liquidity","amount"}'), activity: obj('Account activity for quantitative suitability, including averageEquity'), limits: obj('Firm limits, e.g. {"maxTurnover":6,"maxCostEquityPct":20,"maxPositionPct":10}') },
    required: ['profile', 'recommendation'],
    run: (a) => checkSuitability(a.profile, a.recommendation, { activity: a.activity ?? null, limits: a.limits ?? {} }),
    engineFunction: 'checkSuitability', methodology: 'Customer-specific and quantitative suitability against the FINRA 2111 profile factors',
    dataSources: ['FINRA Rule 2111']
  },
  {
    name: 'check_performance_advertisement', command: 'compliance performance-ad', skillPack: 'wealth-compliance',
    description: 'Checks an advertisement against the performance provisions of the SEC Marketing Rule, 17 CFR 275.206(4)-1(d): net alongside gross, 1-, 5- and 10-year periods, and related conditions. Unanswered facts come back as questions.',
    properties: { ad: obj('Facts about the advertisement'), asOf: str('Date of use, YYYY-MM-DD') },
    required: ['ad'],
    run: (a) => checkPerformanceAdvertisement(a.ad, { asOf: a.asOf ?? null }),
    engineFunction: 'checkPerformanceAdvertisement', methodology: 'Performance provisions of the SEC Marketing Rule, 17 CFR 275.206(4)-1(d)',
    dataSources: ['17 CFR 275.206(4)-1']
  },
  {
    name: 'generate_tear_sheet', command: 'research tear-sheet', skillPack: 'wealth-research',
    description: 'Valuation ratios (P/E, margins, yields) from fundamentals you supply. No market data is fetched.',
    properties: { ticker: str('Ticker'), financials: obj('Fundamentals: {"marketCap","price","eps","revenue","netIncome","freeCashFlow","dividends","sector"}') },
    required: ['ticker', 'financials'],
    run: (a) => generateCompanyTearSheet(a.ticker, a.financials),
    engineFunction: 'generateCompanyTearSheet', methodology: 'Valuation ratios from supplied fundamentals'
  },
  {
    name: 'build_dcf_valuation', command: 'research dcf', skillPack: 'wealth-research',
    description: 'Discounted free cash flow valuation with a Gordon-growth terminal value, plus equity value per share when net debt and shares are given.',
    properties: { freeCashFlows: arr('Projected free cash flows, one per year'), discountRate: num('Discount rate as a decimal'), terminalGrowthRate: num('Terminal growth rate as a decimal, below the discount rate'), netDebt: num('Net debt (default 0)'), sharesOutstanding: num('Shares outstanding') },
    required: ['freeCashFlows', 'discountRate', 'terminalGrowthRate'],
    run: (a) => buildDcfValuation(a),
    engineFunction: 'buildDcfValuation', methodology: 'Discounted free cash flow with a Gordon-growth terminal value'
  },
  {
    name: 'parse_meeting_transcript', command: 'crm parse-transcript', skillPack: 'wealth-crm',
    description: 'Pulls decisions and action items out of a meeting transcript by line-level keyword matching, for an advisor to confirm before logging.',
    properties: { text: str('Transcript text') },
    required: ['text'],
    run: (a) => parseMeetingTranscript(a.text),
    engineFunction: 'parseMeetingTranscript', methodology: 'Line-level keyword extraction of decisions and action items'
  },
  {
    name: 'calculate_collar_strategy', command: 'uhnw collar', skillPack: 'wealth-uhnw',
    description: 'Collar strikes on a concentrated position with a §1259 constructive-sale review. Net cost is computed only from option premiums you supply; the engine does not price options.',
    properties: {
      symbol: str('Symbol'), shares: num('Shares held'), price: num('Current share price'), basis: num('Cost basis per share'),
      putStrikePct: num('Put strike as a fraction of price (default 0.90)'), callStrikePct: num('Call strike as a fraction of price (default 1.15)'),
      putPremium: num('Put premium per share'), callPremium: num('Call premium per share')
    },
    required: ['symbol', 'shares', 'price', 'basis'],
    run: (a) => calculateCollarStrategy(a.symbol, a.shares, a.price, a.basis, { putStrikePct: a.putStrikePct ?? 0.90, callStrikePct: a.callStrikePct ?? 1.15, putPremium: a.putPremium ?? null, callPremium: a.callPremium ?? null }),
    engineFunction: 'calculateCollarStrategy', methodology: 'Strikes as a percentage of spot; net cost only from supplied option premiums'
  },
  {
    name: 'calculate_pe_metrics', command: 'uhnw pe-metrics', skillPack: 'wealth-uhnw',
    description: 'Private equity multiples from commitment, called capital, distributions and NAV: TVPI (MOIC), DPI and RVPI.',
    properties: { commitment: num('Total commitment'), called: num('Capital called to date'), distributions: num('Distributions to date'), nav: num('Current net asset value') },
    required: ['commitment', 'called', 'distributions', 'nav'],
    run: (a) => calculatePeMetrics(a.commitment, a.called, a.distributions, a.nav),
    engineFunction: 'calculatePeMetrics', methodology: 'Private equity multiples: TVPI/MOIC, DPI, RVPI'
  },

  // --- Fund operations --------------------------------------------------------------------------------
  {
    name: 'reconcile_ledger', command: 'fundops reconcile', skillPack: 'wealth-fund-ops',
    description: 'Matches book positions to custodian positions on account and security, and lists breaks: missing on either side, quantity differences and value differences beyond tolerance.',
    properties: { book: arr('Book records: [{"account","security","quantity","marketValue"}]'), custodian: arr('Custodian records, same shape'), quantityTolerance: num('Allowed quantity difference (default 0)'), valueTolerance: num('Allowed value difference (default 0.01)') },
    required: ['book', 'custodian'],
    run: (a) => reconcileLedger(a.book, a.custodian, { quantityTolerance: a.quantityTolerance ?? 0, valueTolerance: a.valueTolerance ?? 0.01 }),
    engineFunction: 'reconcileLedger', methodology: 'Position match on account and security, with quantity and value tolerances'
  },
  {
    name: 'tie_out_nav', command: 'fundops nav-tieout', skillPack: 'wealth-fund-ops',
    description: 'Recomputes NAV from assets less liabilities and compares it with the reported NAV, flagging Level 3 marks and stale prices. Requires human approval before the NAV is struck.',
    properties: { fund: obj('Fund: {"assets":[{"name","value","level","priceDate"}],"liabilities":[...],"unitsOutstanding","reportedNav","reportedNavPerUnit","asOf","maxPriceAgeDays","tolerancePct"}') },
    required: ['fund'],
    run: (a) => tieOutNav(a.fund),
    engineFunction: 'tieOutNav', methodology: 'NAV recomputed from assets less liabilities, compared with the reported figure'
  },
  {
    name: 'check_lp_capital_statement', command: 'fundops lp-statement', skillPack: 'wealth-fund-ops',
    description: 'Checks that an LP capital account statement rolls forward (beginning + contributions - distributions + income and gains - fees and expenses = ending), and checks unfunded commitment and the implied management fee rate when those fields are given.',
    properties: { statement: obj('Capital account statement fields'), tolerance: num('Allowed rounding difference (default 1)') },
    required: ['statement'],
    run: (a) => checkLpCapitalStatement(a.statement, { tolerance: a.tolerance ?? 1 }),
    engineFunction: 'checkLpCapitalStatement', methodology: 'Capital account roll-forward, commitment and fee checks'
  },
  {
    name: 'track_close_checklist', command: 'fundops close-status', skillPack: 'wealth-fund-ops',
    description: 'Month-end close status: overdue tasks, tasks blocked by unfinished dependencies and what is ready to start. A dependency cycle is an error.',
    properties: { tasks: arr('Tasks: [{"id","name","owner","due","status":"not_started|in_progress|blocked|done","dependsOn":[ids]}]'), asOf: str('Status date, YYYY-MM-DD') },
    required: ['tasks', 'asOf'],
    run: (a) => trackCloseChecklist(a.tasks, { asOf: a.asOf }),
    engineFunction: 'trackCloseChecklist', methodology: 'Task status, due dates and dependency readiness'
  }
];


const BY_NAME = new Map(WEALTH_TOOLS.map(tool => [tool.name, tool]));
const BY_COMMAND = new Map(WEALTH_TOOLS.map(tool => [tool.command, tool]));

export function toolByName(name) {
  return BY_NAME.get(name) ?? null;
}

export function toolByCommand(command) {
  return BY_COMMAND.get(command) ?? null;
}

/** Tool definitions in the shape the Anthropic Messages API expects. */
export function anthropicToolSchemas() {
  return WEALTH_TOOLS.map(({ name, description, properties, required = [] }) => ({
    name,
    description,
    input_schema: { type: 'object', properties, required }
  }));
}

/** JSON Schema for one tool, as MCP publishes it. */
export function inputSchemaFor(tool) {
  return { type: 'object', properties: tool.properties, required: tool.required ?? [] };
}

/**
 * Runs a tool by name and returns its result with audit metadata and conversational guidance
 * attached, exactly as the CLI and the MCP servers return it.
 */
export function runTool(name, args = {}) {
  const tool = BY_NAME.get(name);
  if (!tool) throw new Error(`Unknown tool: ${name}. Call listTools() for the ${WEALTH_TOOLS.length} available.`);

  return withAuditMetadata(withGuidance(tool.run(args), tool.command), {
    skillPack: tool.skillPack,
    tool: tool.name,
    engineFunction: tool.engineFunction,
    methodology: tool.methodology,
    dataSources: [CALLER_INPUTS, ...(tool.dataSources ?? [])]
  });
}

/** Name, command, pack and description for every tool, without the schemas. */
export function listTools() {
  return WEALTH_TOOLS.map(({ name, command, skillPack, description }) => ({ name, command, skillPack, description }));
}
