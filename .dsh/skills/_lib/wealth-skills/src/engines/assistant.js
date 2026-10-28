/**
 * Wealth Assistant - the conversational layer the browser demo runs on.
 *
 * Two ways to drive the same tools:
 *   - Scripted scenarios (SCENARIOS): a fixed conversation that runs the real engines, so anyone can
 *     see what a skill does without an API key.
 *   - Routing (routeRequest): matches a typed request to the capabilities in guidance.js by the
 *     phrasings each one says it answers. Keyword matching, not a language model, so it says how
 *     confident it is and offers alternatives.
 *
 * Browser-safe: engines and guidance only, no Node built-ins and no network calls. When a Claude API
 * key is supplied the page sends `systemPrompt()` and `anthropicToolSchemas()` to the Messages API,
 * and the model picks the tools instead.
 */

import { listCapabilities } from './guidance.js';
import { WEALTH_TOOLS, runTool, toolByCommand } from './tools.js';

/** Realistic arguments for every tool, used by the demo, the docs and the tests. */
export const EXAMPLE_ARGS = {
  calculate_tax_headroom: { agi: 210000, filingStatus: 'MFJ' },
  calculate_rmd: { age: 75, balance: 500000 },
  run_monte_carlo_cash_flow: { assets: 1250000, spend: 50000, years: 30, trials: 500 },
  net_capital_gains_losses: { shortTermLosses: 5000, longTermGains: 3000, longTermLosses: 12000, filingStatus: 'MFJ' },
  calculate_niit: { magi: 320000, netInvestmentIncome: 95000, filingStatus: 'MFJ' },
  monitor_portfolio_drift: { currentAlloc: { equity: 68, fixedIncome: 32 }, targetAlloc: { equity: 60, fixedIncome: 40 }, portfolioValue: 1000000 },
  calculate_portfolio_rebalance: { currentAlloc: { equity: 68, fixedIncome: 32 }, targetAlloc: { equity: 60, fixedIncome: 40 }, portfolioValue: 1000000 },
  calculate_portfolio_var: { portfolioValue: 5000000, annualizedVol: 0.16, confidenceLevel: 0.99 },
  analyze_portfolio_factors: { holdings: [{ symbol: 'VTI', weightPct: 45 }, { symbol: 'VXUS', weightPct: 20 }, { symbol: 'BND', weightPct: 25, durationYears: 6.1 }, { symbol: 'PRIVATE-RE', weightPct: 10 }] },
  scan_tax_loss_harvesting: { lots: [{ id: 'L1', symbol: 'VOO', quantity: 100, purchasePrice: 500, currentPrice: 420, purchaseDate: '2025-02-03' }], saleDate: '2026-06-30' },
  calculate_cost_basis: { lots: [{ id: 'A', quantity: 200, price: 40, date: '2021-05-03' }, { id: 'B', quantity: 200, price: 95, date: '2025-12-10' }], sale: { quantity: 300, price: 70, date: '2026-09-15' }, method: 'FIFO' },
  calculate_time_weighted_return: { valuations: [{ date: '2025-12-31', value: 1000000 }, { date: '2026-06-30', value: 850000, cashFlow: 500000 }, { date: '2026-12-31', value: 1500000 }] },
  calculate_money_weighted_return: { cashFlows: [{ date: '2025-12-31', amount: -1000000 }, { date: '2026-06-30', amount: -500000 }, { date: '2026-12-31', amount: 1500000 }] },
  assess_sharpe_ratio: { returns: [0.021, -0.012, 0.015, 0.008, -0.004, 0.019, 0.011, -0.017, 0.024, 0.006, -0.009, 0.013, 0.017, -0.006, 0.009, 0.014, -0.011, 0.022, 0.004, -0.013, 0.018, 0.010, -0.002, 0.016], trials: 20, sharpeVariance: 0.25 },
  backtest_portfolio: { weights: { VTI: 0.6, BND: 0.4 } },
  forward_test_simulation: { weights: { VTI: 0.6, BND: 0.4 }, regime: 'stagflation', years: 5, trials: 500 },
  validate_pre_trade: { order: { symbol: 'VOO', action: 'SELL', quantity: 100, price: 420 }, settledCash: 25000, positions: { VOO: 100 } },
  build_trade_payload: { broker: 'Alpaca', account: 'ACC-123', order: { symbol: 'VOO', action: 'SELL', quantity: 100, price: 420 } },
  build_fix_order_payload: { custodian: 'Pershing_NetX360', account: 'U9821045', symbol: 'IWM', side: 'SELL', quantity: 2000, price: 196 },
  validate_security_identifier: { id: 'US0378331006' },
  calculate_settlement_date: { tradeDate: '2026-11-25', holidays: ['2026-11-26'] },
  validate_cip_identity: { applicant: { name: 'Jane Doe', ssn: '123-45-6789', dob: '1990-05-15', address: '456 Elm St' } },
  identify_onboarding_gaps: { application: { accountType: 'ira', applicants: [{ name: 'Helen Park', dob: '1954-03-09', residentialAddress: '12 Oak Ln', taxId: '123-45-6789', ofacStatus: 'CLEAR' }], investmentProfile: { riskTolerance: 'conservative', investmentObjectives: 'income' }, asOf: '2026-09-13' } },
  scan_finra_compliance: { text: 'Our managed account delivers a guaranteed 8% return every year.' },
  check_suitability: {
    profile: { age: 72, otherInvestments: 'CDs and a pension', financialSituation: 'retired', taxStatus: '12% bracket', investmentObjectives: 'income', investmentExperience: 'limited', timeHorizonYears: 3, liquidityNeeds: 'high', riskTolerance: 'conservative', investableAssets: 400000 },
    recommendation: { product: 'Non-traded REIT', riskLevel: 4, minimumHorizonYears: 7, liquidity: 'illiquid', amount: 150000 },
    limits: { maxPositionPct: 10 }
  },
  check_performance_advertisement: { ad: { showsGrossPerformance: true, showsNetPerformance: false, isPrivateFund: false, portfolioInceptionDate: '2014-01-01', periodEndDate: '2025-12-31', periodsShown: ['1y', '5y'] }, asOf: '2026-09-13' },
  generate_tear_sheet: { ticker: 'AAPL', financials: { marketCap: 3.25e12, price: 215, eps: 7.3, revenue: 3.8e11, netIncome: 1e11, freeCashFlow: 1.08e11, dividends: 1.18 } },
  build_dcf_valuation: { freeCashFlows: [108, 116, 124, 131, 138], discountRate: 0.085, terminalGrowthRate: 0.025, netDebt: -50, sharesOutstanding: 15.2 },
  parse_meeting_transcript: { text: 'Client agreed to move to the 60/40 model.\nAdvisor will send the proposal next week.\nOperations will open the trust account.' },
  calculate_collar_strategy: { symbol: 'AAPL', shares: 100000, price: 215, basis: 25 },
  calculate_pe_metrics: { commitment: 5000000, called: 3000000, distributions: 1200000, nav: 3200000 },
  reconcile_ledger: {
    book: [{ account: 'FUND-A', security: 'VTI', quantity: 12000, marketValue: 3300000 }, { account: 'FUND-A', security: 'BND', quantity: 20000, marketValue: 1440000 }, { account: 'FUND-A', security: 'ACME-PFD', quantity: 5000, marketValue: 500000 }],
    custodian: [{ account: 'FUND-A', security: 'VTI', quantity: 12000, marketValue: 3300000 }, { account: 'FUND-A', security: 'BND', quantity: 19500, marketValue: 1404000 }]
  },
  tie_out_nav: { fund: { assets: [{ name: 'Listed ETFs', value: 4740000, priceDate: '2026-09-30' }, { name: 'ACME preferred', value: 500000, level: 3, priceDate: '2026-06-30' }, { name: 'Cash', value: 260000 }], liabilities: [{ name: 'Accrued fees', value: 40000 }], unitsOutstanding: 50000, reportedNav: 5460000, asOf: '2026-09-30', maxPriceAgeDays: 45 } },
  check_lp_capital_statement: { statement: { beginningBalance: 1000000, contributions: 250000, distributions: 100000, incomeAllocation: 20000, realizedGainLoss: 30000, unrealizedGainLoss: 50000, managementFees: 12500, performanceAllocation: 0, otherExpenses: 2500, endingBalance: 1240000, commitment: 2000000, contributionsToDate: 1250000, periodFractionOfYear: 0.25, expectedAnnualFeeRatePct: 2 } },
  track_close_checklist: {
    tasks: [
      { id: 'bank', name: 'Bank and custody reconciliations', owner: 'Ops', status: 'done', due: '2026-10-02' },
      { id: 'recon', name: 'Position reconciliation', owner: 'Ops', status: 'in_progress', due: '2026-10-05', dependsOn: ['bank'] },
      { id: 'marks', name: 'Level 3 valuations', owner: 'Valuation committee', status: 'not_started', due: '2026-10-06' },
      { id: 'nav', name: 'NAV strike', owner: 'Fund accounting', status: 'not_started', due: '2026-10-08', dependsOn: ['recon', 'marks'] }
    ],
    asOf: '2026-10-07'
  }
};

/**
 * Scripted conversations. Each step runs a real engine, so the numbers in the demo are the numbers
 * the CLI and MCP servers produce. `say` is what the assistant says before running the tool.
 */
export const SCENARIOS = [
  {
    id: 'roth',
    pack: 'wealth-planning',
    prompt: 'How much can my client convert to a Roth this year? They are 75, married, and earn $210,000.',
    steps: [
      { say: "I'll start with how much room is left in their tax bracket for 2026.", tool: 'calculate_tax_headroom' },
      { say: 'They are 75, so the required distribution has to come out first and it uses the same room. Running that on a $500,000 IRA balance.', tool: 'calculate_rmd' }
    ],
    closing: 'So the conversion room is roughly $13,275 once the $20,325 distribution is counted as income, not the full $33,600. Confirm state tax, the 3.8% investment income tax and Medicare premium effects with their tax preparer.'
  },
  {
    id: 'rebalance',
    pack: 'wealth-portfolio',
    prompt: 'The portfolio is 68% equities against a 60% target on $1M. Rebalance it.',
    steps: [
      { say: 'Checking the drift against the tolerance band first.', tool: 'monitor_portfolio_drift' },
      { say: 'Selling equities realizes gains, so let me look for losses to offset them before we trade.', tool: 'scan_tax_loss_harvesting' },
      { say: 'Checking the sell against the position the account actually holds.', tool: 'validate_pre_trade' }
    ],
    closing: 'Sell $80,000 of equities, buy $80,000 of fixed income, and harvest the $8,000 VOO loss into VV, which tracks a different index. Nothing is placed: an advisor approves the trades, confirms no substantially identical purchase within 30 days after the sale, and decides whether VV is a fair replacement.'
  },
  {
    id: 'suitability',
    pack: 'wealth-compliance',
    prompt: 'Is a $150,000 non-traded REIT suitable for a 72-year-old retiree with $400,000 invested?',
    steps: [
      { say: 'Before any recommendation, let me check the account file is complete.', tool: 'identify_onboarding_gaps' },
      { say: 'Now the recommendation itself, against the FINRA 2111 profile.', tool: 'check_suitability' }
    ],
    closing: 'Four conflicts: product risk against a conservative tolerance, a 7-year product for a 3-year horizon, an illiquid product against high liquidity needs, and 37.5% of investable assets against the firm’s 10% limit. The supervising principal decides; a documented reason would have to outweigh each one.'
  },
  {
    id: 'performance',
    pack: 'wealth-portfolio',
    prompt: 'Did the manager do well, or did the client just add money at the right time?',
    steps: [
      { say: 'Time-weighted return measures the manager, ignoring when money went in.', tool: 'calculate_time_weighted_return' },
      { say: 'Money-weighted return measures what the client actually experienced.', tool: 'calculate_money_weighted_return' }
    ],
    closing: 'The manager was down 5.56% while the client broke even, because the $500,000 went in at the low. Show both figures side by side and say which is which.'
  },
  {
    id: 'fundops',
    pack: 'wealth-fund-ops',
    prompt: 'Our month-end close is late. What is outstanding, and can we strike the NAV?',
    steps: [
      { say: 'Starting with what is overdue and what is waiting on it.', tool: 'track_close_checklist' },
      { say: 'Checking the book against the custodian.', tool: 'reconcile_ledger' },
      { say: 'Now recomputing NAV from the asset and liability figures.', tool: 'tie_out_nav' }
    ],
    closing: 'The NAV matches the administrator at $109.20 a unit, and it still cannot be signed off: a Level 3 holding at 9.16% of the fund was last priced 92 days ago, and two positions do not match the custodian. The valuation committee and operations clear those first.'
  },
  {
    id: 'compliance',
    pack: 'wealth-compliance',
    prompt: 'Can we send this to clients? "Our managed account delivers a guaranteed 8% return every year."',
    steps: [
      { say: 'Running the communication through the promissory-language and disclosure screen.', tool: 'scan_finra_compliance' }
    ],
    closing: 'It fails: "guaranteed 8%" is a promise no firm can make, and all three standard disclosures are missing. Even a clean rewrite still needs a registered principal to approve it, because this is a keyword screen, not a Rule 2210 review.'
  },
  {
    id: 'collar',
    pack: 'wealth-uhnw',
    prompt: 'A client holds 100,000 Apple shares at a $25 basis. Hedge it without selling.',
    steps: [
      { say: 'Building a collar: a put for the floor, a call sold to pay for it.', tool: 'calculate_collar_strategy' }
    ],
    closing: 'The floor is $193.50 and the cap $247.25. I cannot say what it costs without live option quotes, and tax counsel has to review constructive-sale treatment under IRC §1259 before anything is executed.'
  },
  {
    id: 'research',
    pack: 'wealth-research',
    prompt: 'What is this company worth on a discounted cash flow?',
    steps: [
      { say: 'Discounting five years of free cash flow with a Gordon-growth terminal value.', tool: 'build_dcf_valuation' }
    ],
    closing: 'About $138.11 a share, but 76.5% of that is the terminal value, so the answer mostly reflects the growth and discount assumptions. The sensitivity grid runs from roughly $112 to $181 a share; show the range, not one number.'
  }
];

/** Runs a scripted scenario, returning each step with its real engine result. */
export function runScenario(id) {
  const scenario = SCENARIOS.find(s => s.id === id);
  if (!scenario) throw new Error(`Unknown scenario: ${id}. Available: ${SCENARIOS.map(s => s.id).join(', ')}.`);

  return {
    ...scenario,
    steps: scenario.steps.map(step => {
      const args = step.args ?? EXAMPLE_ARGS[step.tool];
      return { ...step, args, command: toolByName(step.tool).command, result: runTool(step.tool, args) };
    })
  };
}

function toolByName(name) {
  const tool = WEALTH_TOOLS.find(t => t.name === name);
  if (!tool) throw new Error(`Scenario refers to unknown tool ${name}.`);
  return tool;
}

const STOP_WORDS = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'do', 'does', 'did', 'can', 'could', 'should', 'would', 'what', 'whats', 'how', 'much', 'many', 'i', 'we', 'they', 'my', 'our', 'their', 'this', 'that', 'these', 'those', 'for', 'to', 'of', 'in', 'on', 'at', 'with', 'and', 'or', 'it', 'be', 'have', 'has', 'need', 'want', 'please', 'client', 'clients', 'me', 'you', 'if', 'from', 'by', 'about', 'any']);

// "money-weighted return" and "money weighted return" are the same request.
const normalize = (text) => String(text ?? '').toLowerCase().replace(/[-\u2013\u2014]/g, ' ').replace(/\s+/g, ' ').trim();

function words(text) {
  return normalize(text).match(/[a-z0-9.%$]+/g)?.filter(w => w.length > 1 && !STOP_WORDS.has(w)) ?? [];
}

/**
 * Matches a typed request to the capabilities that say they answer it. Keyword overlap against each
 * capability's typical phrasings and summary; no language model is involved, so a low score means
 * "ask the user" rather than "guess".
 */
export function routeRequest(text, { limit = 3 } = {}) {
  const asked = words(text);
  const asJoined = normalize(text);
  const capabilities = listCapabilities();
  const scored = [];

  for (const capability of capabilities) {
    const phrases = [...capability.typicalRequests, capability.summary, capability.tool.replace(/-/g, ' ')];
    let score = 0;
    for (const phrase of phrases) {
      const phraseWords = new Set(words(phrase));
      const hits = asked.filter(word => phraseWords.has(word)).length;
      // A whole phrase the user echoed is worth more than scattered words.
      if (hits > 0) score += hits + (asJoined.includes(normalize(phrase)) ? 5 : 0);
    }
    if (score > 0) scored.push({ command: capability.tool, summary: capability.summary, score, requiredInputs: capability.inputs.filter(i => i.required).map(i => i.field) });
  }

  scored.sort((a, b) => b.score - a.score || a.command.localeCompare(b.command));
  const matches = scored.slice(0, limit).map(match => ({ ...match, tool: toolByCommand(match.command)?.name ?? null }));

  return {
    query: String(text ?? ''),
    matches,
    // Two close scores mean the words fit several skills; the caller should ask rather than assume.
    confident: matches.length > 0 && matches[0].score >= 3 && (matches.length === 1 || matches[0].score > matches[1].score),
    scenarios: SCENARIOS.filter(scenario => matches.some(match => scenario.steps.some(step => step.tool === match.tool))).map(s => s.id)
  };
}

const LABELS = { true: 'yes', false: 'no' };

/** The handful of figures worth showing from a result, before the full JSON. */
export function highlights(result, { limit = 6 } = {}) {
  const out = [];
  for (const [key, value] of Object.entries(result ?? {})) {
    if (['auditMetadata', 'needsInput', 'suggestedNextSteps', 'methodology', 'note', 'message'].includes(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === 'object') {
      if (Array.isArray(value) && value.length > 0) out.push({ key, value: `${value.length} item${value.length === 1 ? '' : 's'}` });
      continue;
    }
    out.push({ key, value: typeof value === 'boolean' ? LABELS[value] : value });
    if (out.length >= limit) break;
  }
  return out;
}

/** System prompt for the bring-your-own-key mode, where Claude chooses the tools itself. */
export function systemPrompt() {
  return [
    'You are a wealth management assistant for a US financial advisor, running inside the wealth-skills demo.',
    'Use the supplied tools for every calculation. Never do the arithmetic yourself and never invent figures: if no tool fits, say so.',
    'When a tool result contains needsInput, ask the user those questions instead of assuming values.',
    'When it contains suggestedNextSteps, offer them.',
    'State the limits the result gives you, including anything that requires human approval.',
    'You are speaking to a licensed professional who reviews everything before it reaches a client. Nothing here is investment, tax or legal advice, no order is ever placed, and you cannot connect to custodians, brokers or FINRA BrokerCheck.',
    'Keep answers short and concrete: the figures that matter, what is missing, and what to do next.'
  ].join(' ');
}
