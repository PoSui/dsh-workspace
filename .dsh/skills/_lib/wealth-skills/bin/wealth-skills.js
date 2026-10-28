#!/usr/bin/env node

/**
 * Universal CLI Entrypoint for `wealth-skills`
 * Executable by Claude Code, Devin, Cursor, OpenAI Codex, Antigravity, and terminal agents.
 *
 * Results print to stdout as JSON with an `auditMetadata` block; notes and errors print to stderr.
 * Bad input exits non-zero (2 = usage, 1 = engine error) instead of quietly running on sample data.
 */

import { calculateTaxBracketHeadroom, runMonteCarloCashFlow, calculateRMD } from '../src/engines/planning.js';
import { calculatePortfolioRebalance, scanTaxLossHarvesting, monitorPortfolioDrift, analyzePortfolioFactors, calculatePortfolioVar } from '../src/engines/portfolio.js';
import { backtestPortfolio, forwardTestSimulation } from '../src/engines/quant.js';
import { parseMeetingTranscript } from '../src/engines/crm.js';
import { generateCompanyTearSheet } from '../src/engines/research.js';
import { validatePreTradeCompliance, buildTradePayload } from '../src/engines/execution.js';
import { validateCipIdentity } from '../src/engines/onboarding.js';
import { scanFinraRule2210 } from '../src/engines/compliance.js';
import { lookupAdviserRegistration } from '../src/engines/registration.js';
import { renderAdaptiveUI } from '../src/engines/ui.js';
import { buildFixOrderPayload } from '../src/engines/fix.js';
import { calculateCollarStrategy, calculatePeMetrics } from '../src/engines/uhnw.js';
import { withAuditMetadata } from '../src/engines/audit.js';
import { withGuidance, listCapabilities } from '../src/engines/guidance.js';
import { seededRandom } from '../src/engines/stats.js';
import { netCapitalGainsAndLosses, calculateNetInvestmentIncomeTax, calculateCostBasis } from '../src/engines/tax.js';
import { calculateTimeWeightedReturn, calculateMoneyWeightedReturn, assessSharpeRatio } from '../src/engines/performance.js';
import { validateSecurityIdentifier, calculateSettlementDate } from '../src/engines/markets.js';
import { reconcileLedger, tieOutNav, checkLpCapitalStatement, trackCloseChecklist } from '../src/engines/fundops.js';
import { identifyOnboardingGaps } from '../src/engines/onboarding.js';
import { checkSuitability, checkPerformanceAdvertisement } from '../src/engines/compliance.js';
import { buildDcfValuation } from '../src/engines/research.js';

const args = process.argv.slice(2);
const command = args[0];
const subCommand = args[1];

class UsageError extends Error {}

const SAMPLE_LOTS = [{ id: 'LOT-1', symbol: 'IWM', quantity: 100, purchasePrice: 220, currentPrice: 150, purchaseDate: '2026-01-10' }];
const SAMPLE_ORDER = { symbol: 'VTI', action: 'BUY', quantity: 50, price: 275 };
const SAMPLE_FINANCIALS = { marketCap: 3.25e12, price: 215, eps: 7.3, revenue: 3.8e11, netIncome: 1e11, freeCashFlow: 1.08e11, dividends: 1.18, sector: 'Technology' };
const SAMPLE_APPLICANT = { name: 'Arthur Pendelton', ssn: '123-45-6789', dob: '1985-04-12', address: '123 Main St', ofacStatus: 'CLEAR' };

const SAMPLE_BASIS_LOTS = [{ id: 'A', quantity: 100, price: 50, date: '2024-01-10' }, { id: 'B', quantity: 100, price: 80, date: '2025-09-01' }];
const SAMPLE_SALE = { quantity: 150, date: '2026-03-01', price: 90 };
const SAMPLE_VALUATIONS = [{ date: '2026-01-01', value: 100000 }, { date: '2026-06-30', value: 110000, cashFlow: 50000 }, { date: '2026-12-31', value: 168000 }];
const SAMPLE_FUND_FLOWS = [
  { date: '2021-03-31', amount: -1000000 }, { date: '2022-03-31', amount: -1000000 }, { date: '2023-03-31', amount: -1000000 },
  { date: '2024-06-30', amount: 400000 }, { date: '2025-06-30', amount: 800000 }, { date: '2026-06-30', amount: 3200000 }
];
const SAMPLE_MONTHLY_RETURNS = [0.021, -0.012, 0.015, 0.008, -0.004, 0.019, 0.011, -0.017, 0.024, 0.006, -0.009, 0.013,
  0.017, -0.006, 0.009, 0.014, -0.011, 0.022, 0.004, -0.013, 0.018, 0.010, -0.002, 0.016];
const SAMPLE_APPLICATION = { accountType: 'individual', applicants: [{ name: 'Jane Doe', dob: '1958-04-02', residentialAddress: '456 Elm St' }], asOf: '2026-09-13' };
const SAMPLE_SUITABILITY_PROFILE = { age: 72, otherInvestments: 'CDs and a pension', financialSituation: 'retired', taxStatus: '12% bracket', investmentObjectives: 'income', investmentExperience: 'limited', timeHorizonYears: 3, liquidityNeeds: 'high', riskTolerance: 'conservative', investableAssets: 400000 };
const SAMPLE_RECOMMENDATION = { product: 'Non-traded REIT', riskLevel: 4, minimumHorizonYears: 7, liquidity: 'illiquid', amount: 150000 };
const SAMPLE_AD = { showsGrossPerformance: true, showsNetPerformance: false, isPrivateFund: false, portfolioInceptionDate: '2014-01-01', periodEndDate: '2025-12-31', periodsShown: ['1y', '5y'] };
const SAMPLE_BOOK = [{ account: 'A1', security: 'VTI', quantity: 100, marketValue: 27500 }, { account: 'A1', security: 'BND', quantity: 50, marketValue: 3600 }, { account: 'A1', security: 'AGG', quantity: 10, marketValue: 1000 }];
const SAMPLE_CUSTODIAN = [{ account: 'A1', security: 'VTI', quantity: 100, marketValue: 27500 }, { account: 'A1', security: 'BND', quantity: 40, marketValue: 2880 }, { account: 'A1', security: 'VXUS', quantity: 20, marketValue: 1300 }];
const SAMPLE_FUND = { assets: [{ name: 'Listed equities', value: 10500000 }, { name: 'Private company stake', value: 2000000, level: 3 }], liabilities: [{ name: 'Accrued fees', value: 500000 }], unitsOutstanding: 1000000, reportedNav: 12050000 };
const SAMPLE_LP_STATEMENT = { beginningBalance: 1000000, contributions: 250000, distributions: 100000, incomeAllocation: 20000, realizedGainLoss: 30000, unrealizedGainLoss: 50000, managementFees: 12500, performanceAllocation: 0, otherExpenses: 2500, endingBalance: 1240000 };
const SAMPLE_CLOSE_TASKS = [
  { id: 'bank', name: 'Bank reconciliations', owner: 'Ops', status: 'done', due: '2026-09-03' },
  { id: 'accruals', name: 'Accruals', owner: 'Finance', status: 'in_progress', due: '2026-09-04', dependsOn: ['bank'] },
  { id: 'fees', name: 'Fee calculation', owner: 'Finance', status: 'not_started', due: '2026-09-06', dependsOn: ['bank'] },
  { id: 'nav', name: 'NAV strike', owner: 'Fund accounting', status: 'not_started', due: '2026-09-08', dependsOn: ['accruals', 'fees'] }
];

const CALLER_INPUTS = 'caller-supplied inputs (built-in samples where flags were omitted)';

function hasFlag(flag) {
  return args.includes(flag);
}

function getArgVal(flag, defaultVal = null) {
  const index = args.indexOf(flag);
  if (index === -1) return defaultVal;

  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new UsageError(`${flag} requires a value.`);
  }
  return value;
}

function numArg(flag, defaultVal) {
  const raw = getArgVal(flag, null);
  if (raw === null) return defaultVal;

  const value = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(value)) {
    throw new UsageError(`${flag} must be a number, got "${raw}".`);
  }
  return value;
}

function intArg(flag, defaultVal) {
  if (!hasFlag(flag)) return defaultVal;

  const value = numArg(flag);
  if (!Number.isInteger(value)) throw new UsageError(`${flag} must be a whole number, got "${getArgVal(flag)}".`);
  return value;
}

function jsonArg(flag, defaultVal) {
  const raw = getArgVal(flag, null);
  if (raw === null) return defaultVal;

  try {
    return JSON.parse(raw);
  } catch (e) {
    // A malformed flag used to print a warning and then carry on with the sample default.
    throw new UsageError(`${flag} is not valid JSON: ${e.message}`);
  }
}

function dateArg(flag, defaultVal) {
  const raw = getArgVal(flag, null);
  if (raw === null) return defaultVal;
  if (Number.isNaN(Date.parse(raw))) throw new UsageError(`${flag} must be a date such as 2026-06-30, got "${raw}".`);
  return new Date(raw);
}

// With none of a command's input flags it runs on illustrative samples. Say so on stderr so the
// output is never mistaken for an analysis of the caller's own data.
function noteIfSample(flags) {
  if (!flags.some(hasFlag)) {
    console.error(`Note: no ${flags.join(' / ')} supplied; using built-in sample inputs.`);
  }
}

// Simulations are random by default. A seed makes a run reproducible, which is what documented
// examples and regression tests need.
function rngArg() {
  return hasFlag('--seed') ? seededRandom(intArg('--seed')) : Math.random;
}

function printResult(data, audit) {
  if (typeof data === 'string') {
    console.log(data);
    return;
  }
  // Questions and next steps ride along with the numbers, so an agent can carry the conversation
  // forward instead of stopping at a result.
  console.log(JSON.stringify(withAuditMetadata(withGuidance(data, audit?.tool), audit), null, 2));
}

function usage(line) {
  console.error(`Usage: wealth-skills ${line}`);
  process.exitCode = 2;
}

const HELP = `
===================================================
 Wealth Skills CLI - Universal Agent Executor
===================================================
JSON flags take a single-quoted JSON string. Omitted flags fall back to samples (noted on stderr).

  uhnw collar             --symbol --shares --price --basis [--put-pct --call-pct --put-premium --call-premium]
  uhnw pe-metrics         --commitment --called --distributions --nav
  ui render               --platform [claude|codex|cursor|antigravity] --data '<json>'
  quant backtest          --weights '<json>' [--initial --rf]
  quant forward-test      --weights '<json>' --regime [baseline|stagflation|bull_market|bear_market] [--years --trials --initial --seed]
  quant sharpe-stats      --returns '<json>' [--periods-per-year --rf --benchmark --trials --sharpe-variance]
  planning tax-headroom   --agi --status [MFJ|SINGLE]
  planning monte-carlo    --assets --spend [--return --vol --years --trials --inflation --seed]
  planning rmd            --age --balance [--birth-year]
  planning capital-losses --st-gains --st-losses --lt-gains --lt-losses [--st-carryover --lt-carryover --status --taxable-income]
  planning niit           --magi --nii [--status]
  portfolio rebalance     --current '<json>' --target '<json>' --value [--min-trade-pct]
  portfolio drift-monitor --current '<json>' --target '<json>' --value --band [--min-trade-pct]
  portfolio var           --value --vol [--confidence --horizon]
  portfolio factors       --holdings '<json>'
  portfolio tlh           --lots '<json>' [--min-loss --sale-date]
  portfolio cost-basis    --lots '<json>' --sale '<json>' [--method FIFO|SPECIFIC|AVERAGE --specific '<json>']
  portfolio twr           --valuations '<json>'
  portfolio irr           --cash-flows '<json>'
  execution validate      --order '<json>' --settled-cash [--positions '<json>']
  execution payload       --broker [Alpaca|IBKR] --account --order '<json>' [--conid]
  execution fix-payload   --custodian --account --symbol --side --qty --price [--seq]
  execution identifier    --id [--type ISIN|CUSIP|FIGI|LEI|MIC|CFI]
  execution settlement-date --trade-date [--holidays '<json>']
  crm parse-transcript    --text
  research tear-sheet     --ticker --financials '<json>'
  research dcf            --cash-flows '<json>' --discount --growth [--net-debt --shares]
  onboarding validate-cip --applicant '<json>'
  onboarding gaps         --application '<json>'
  compliance scan         --text
  compliance lookup       --feed <IAPD compilation file> --crd | --name [--limit --as-of --max-age-days]
  compliance suitability  --profile '<json>' --recommendation '<json>' [--activity '<json>' --limits '<json>']
  compliance performance-ad --ad '<json>' [--as-of]
  fundops reconcile       --book '<json>' --custodian '<json>' [--value-tolerance --quantity-tolerance]
  fundops nav-tieout      --fund '<json>'
  fundops lp-statement    --statement '<json>' [--tolerance]
  fundops close-status    --tasks '<json>' --as-of
  capabilities            what each command answers, what it needs, and typical phrasings
`;

async function run() {
  switch (command) {
    case 'uhnw':
      if (subCommand === 'collar') {
        noteIfSample(['--symbol', '--shares', '--price', '--basis']);
        const result = calculateCollarStrategy(
          getArgVal('--symbol', 'AAPL'),
          numArg('--shares', 100000),
          numArg('--price', 215),
          numArg('--basis', 25),
          {
            putStrikePct: numArg('--put-pct', 0.90),
            callStrikePct: numArg('--call-pct', 1.15),
            putPremium: numArg('--put-premium', null),
            callPremium: numArg('--call-premium', null)
          }
        );
        return printResult(result, {
          skillPack: 'wealth-uhnw',
          tool: 'uhnw collar',
          engineFunction: 'calculateCollarStrategy',
          methodology: 'Strikes as a percentage of spot; net cost only from supplied option premiums',
          dataSources: [CALLER_INPUTS]
        });
      }
      if (subCommand === 'pe-metrics') {
        noteIfSample(['--commitment', '--called', '--distributions', '--nav']);
        // --dist is the original flag name; --distributions is what the docs use. Both work.
        const distributions = hasFlag('--distributions') ? numArg('--distributions') : numArg('--dist', 1200000);
        const result = calculatePeMetrics(numArg('--commitment', 5000000), numArg('--called', 3000000), distributions, numArg('--nav', 3200000));
        return printResult(result, {
          skillPack: 'wealth-uhnw',
          tool: 'uhnw pe-metrics',
          engineFunction: 'calculatePeMetrics',
          methodology: 'Private equity multiples: TVPI/MOIC, DPI, RVPI',
          dataSources: [CALLER_INPUTS]
        });
      }
      return usage('uhnw [collar|pe-metrics]');

    case 'ui':
      if (subCommand === 'render') {
        const data = jsonArg('--data', {
          title: 'Portfolio Review',
          summary: 'Rebalance recommended due to equity drift.',
          metrics: { 'Portfolio Value': '$1,250,000', 'Equity Drift': '+8%' }
        });
        return printResult(renderAdaptiveUI(data, getArgVal('--platform', 'claude')));
      }
      return usage('ui render --platform [claude|codex|cursor|antigravity] --data \'<json>\'');

    case 'quant':
      if (subCommand === 'backtest') {
        noteIfSample(['--weights']);
        const result = backtestPortfolio(jsonArg('--weights', { VTI: 0.6, BND: 0.4 }), numArg('--initial', 100000), { riskFreeRate: numArg('--rf', 0.03) });
        return printResult(result, {
          skillPack: 'wealth-portfolio',
          tool: 'quant backtest',
          engineFunction: 'backtestPortfolio',
          methodology: 'Annual historical backtest with annual rebalancing',
          dataSources: [CALLER_INPUTS, 'embedded approximate annual total returns, 2015-2024']
        });
      }
      if (subCommand === 'forward-test') {
        noteIfSample(['--weights']);
        const result = forwardTestSimulation(
          jsonArg('--weights', { VTI: 0.6, BND: 0.4 }),
          getArgVal('--regime', 'baseline'),
          intArg('--years', 5),
          intArg('--trials', 500),
          { initialBalance: numArg('--initial', 100000), rng: rngArg() }
        );
        return printResult(result, {
          skillPack: 'wealth-portfolio',
          tool: 'quant forward-test',
          engineFunction: 'forwardTestSimulation',
          methodology: 'Monte Carlo on portfolio-level normal annual returns (weighted mean, full covariance)',
          dataSources: [CALLER_INPUTS, 'illustrative regime capital market assumptions (library defaults)', 'correlations from embedded 2015-2024 annual returns']
        });
      }
      if (subCommand === 'sharpe-stats') {
        noteIfSample(['--returns']);
        const result = assessSharpeRatio(jsonArg('--returns', SAMPLE_MONTHLY_RETURNS), {
          periodsPerYear: numArg('--periods-per-year', 12),
          riskFreeRate: numArg('--rf', 0),
          benchmarkSharpe: numArg('--benchmark', 0),
          trials: intArg('--trials', null),
          sharpeVariance: numArg('--sharpe-variance', null)
        });
        return printResult(result, {
          skillPack: 'wealth-portfolio',
          tool: 'quant sharpe-stats',
          engineFunction: 'assessSharpeRatio',
          methodology: 'Lo (2002) standard error; probabilistic and deflated Sharpe ratio (Bailey and Lopez de Prado)',
          dataSources: [CALLER_INPUTS]
        });
      }
      return usage('quant [backtest|forward-test|sharpe-stats]');

    case 'planning':
      if (subCommand === 'tax-headroom') {
        noteIfSample(['--agi']);
        const result = calculateTaxBracketHeadroom(numArg('--agi', 210000), getArgVal('--status', 'MFJ'));
        return printResult(result, {
          skillPack: 'wealth-planning',
          tool: 'planning tax-headroom',
          engineFunction: 'calculateTaxBracketHeadroom',
          methodology: 'Ordinary-income bracket headroom after the standard deduction',
          dataSources: [CALLER_INPUTS, 'IRS Rev. Proc. 2025-32 (tax year 2026 brackets and standard deduction)']
        });
      }
      if (subCommand === 'monte-carlo') {
        noteIfSample(['--assets', '--spend']);
        const result = runMonteCarloCashFlow(
          numArg('--assets', 1000000),
          numArg('--spend', 40000),
          numArg('--return', 0.06),
          numArg('--vol', 0.12),
          intArg('--years', 30),
          intArg('--trials', 1000),
          numArg('--inflation', 0.025),
          { rng: rngArg() }
        );
        return printResult(result, {
          skillPack: 'wealth-planning',
          tool: 'planning monte-carlo',
          engineFunction: 'runMonteCarloCashFlow',
          methodology: 'Monte Carlo of normal annual returns with inflation-adjusted start-of-year withdrawals',
          dataSources: [CALLER_INPUTS]
        });
      }
      if (subCommand === 'rmd') {
        noteIfSample(['--age', '--balance']);
        const result = calculateRMD(intArg('--age', 75), numArg('--balance', 500000), { birthYear: intArg('--birth-year', undefined) });
        return printResult(result, {
          skillPack: 'wealth-planning',
          tool: 'planning rmd',
          engineFunction: 'calculateRMD',
          methodology: 'Prior year-end balance divided by the Uniform Lifetime Table distribution period',
          dataSources: [CALLER_INPUTS, 'IRS Uniform Lifetime Table, Treas. Reg. §1.401(a)(9)-9(c)']
        });
      }
      if (subCommand === 'capital-losses') {
        const flags = ['--st-gains', '--st-losses', '--lt-gains', '--lt-losses'];
        noteIfSample(flags);
        const sample = !flags.some(hasFlag);
        const result = netCapitalGainsAndLosses({
          shortTermGains: numArg('--st-gains', 0),
          shortTermLosses: numArg('--st-losses', sample ? 10000 : 0),
          longTermGains: numArg('--lt-gains', sample ? 4000 : 0),
          longTermLosses: numArg('--lt-losses', 0),
          shortTermCarryover: numArg('--st-carryover', 0),
          longTermCarryover: numArg('--lt-carryover', 0),
          filingStatus: getArgVal('--status', 'MFJ'),
          taxableIncome: numArg('--taxable-income', null)
        });
        return printResult(result, {
          skillPack: 'wealth-planning',
          tool: 'planning capital-losses',
          engineFunction: 'netCapitalGainsAndLosses',
          methodology: 'IRC §1222 netting, §1211(b) limitation, §1212(b) carryover (Schedule D worksheet)',
          dataSources: [CALLER_INPUTS, 'IRC §§1211, 1212, 1222; IRS Schedule D instructions']
        });
      }
      if (subCommand === 'niit') {
        noteIfSample(['--magi', '--nii']);
        const result = calculateNetInvestmentIncomeTax({ magi: numArg('--magi', 300000), netInvestmentIncome: numArg('--nii', 80000), filingStatus: getArgVal('--status', 'MFJ') });
        return printResult(result, {
          skillPack: 'wealth-planning',
          tool: 'planning niit',
          engineFunction: 'calculateNetInvestmentIncomeTax',
          methodology: '3.8% of the lesser of net investment income or MAGI above the statutory threshold',
          dataSources: [CALLER_INPUTS, 'IRC §1411']
        });
      }
      return usage('planning [tax-headroom|monte-carlo|rmd|capital-losses|niit]');

    case 'portfolio':
      if (subCommand === 'rebalance' || subCommand === 'drift-monitor') {
        noteIfSample(['--current', '--target']);
        const current = jsonArg('--current', { equity: 68, bond: 22, cash: 10 });
        const target = jsonArg('--target', { equity: 60, bond: 30, cash: 10 });
        const value = numArg('--value', 1250000);
        const options = { minTradePct: numArg('--min-trade-pct', 0.05) };

        if (subCommand === 'rebalance') {
          return printResult(calculatePortfolioRebalance(current, target, value, options), {
            skillPack: 'wealth-portfolio',
            tool: 'portfolio rebalance',
            engineFunction: 'calculatePortfolioRebalance',
            methodology: 'Target-minus-current trade sizing with proportional minimum trade size',
            dataSources: [CALLER_INPUTS]
          });
        }
        return printResult(monitorPortfolioDrift(current, target, value, numArg('--band', 5), options), {
          skillPack: 'wealth-portfolio',
          tool: 'portfolio drift-monitor',
          engineFunction: 'monitorPortfolioDrift',
          methodology: 'Absolute percentage-point drift against target tolerance band',
          dataSources: [CALLER_INPUTS]
        });
      }
      if (subCommand === 'var') {
        noteIfSample(['--value', '--vol']);
        const result = calculatePortfolioVar(numArg('--value', 1000000), numArg('--vol', 0.14), numArg('--confidence', 0.95), numArg('--horizon', 1));
        return printResult(result, {
          skillPack: 'wealth-portfolio',
          tool: 'portfolio var',
          engineFunction: 'calculatePortfolioVar',
          methodology: 'Parametric normal VaR and expected shortfall',
          dataSources: [CALLER_INPUTS]
        });
      }
      if (subCommand === 'factors') {
        noteIfSample(['--holdings']);
        const holdings = jsonArg('--holdings', [{ symbol: 'VTI', weightPct: 60 }, { symbol: 'BND', weightPct: 40 }]);
        return printResult(analyzePortfolioFactors(holdings), {
          skillPack: 'wealth-portfolio',
          tool: 'portfolio factors',
          engineFunction: 'analyzePortfolioFactors',
          methodology: 'Asset-class weights; weighted averages of per-holding factor and duration inputs',
          dataSources: [CALLER_INPUTS, 'library symbol-to-asset-class table']
        });
      }
      if (subCommand === 'tlh') {
        noteIfSample(['--lots']);
        const result = scanTaxLossHarvesting(jsonArg('--lots', SAMPLE_LOTS), numArg('--min-loss', 1000), dateArg('--sale-date', new Date()));
        return printResult(result, {
          skillPack: 'wealth-portfolio',
          tool: 'portfolio tlh',
          engineFunction: 'scanTaxLossHarvesting',
          methodology: 'Unrealized loss screen; 30-day look-back wash-sale check across supplied lots; cross-index replacement candidates',
          dataSources: [CALLER_INPUTS, 'library ETF tracked-index table']
        });
      }
      if (subCommand === 'cost-basis') {
        noteIfSample(['--lots', '--sale']);
        const result = calculateCostBasis({ lots: jsonArg('--lots', SAMPLE_BASIS_LOTS), sale: jsonArg('--sale', SAMPLE_SALE), method: getArgVal('--method', 'FIFO'), specificLots: jsonArg('--specific', null) });
        return printResult(result, {
          skillPack: 'wealth-portfolio',
          tool: 'portfolio cost-basis',
          engineFunction: 'calculateCostBasis',
          methodology: 'Lot relief by FIFO, specific identification or average cost; holding over one year is long-term',
          dataSources: [CALLER_INPUTS, 'IRC §1012; IRS Publication 551']
        });
      }
      if (subCommand === 'twr') {
        noteIfSample(['--valuations']);
        return printResult(calculateTimeWeightedReturn(jsonArg('--valuations', SAMPLE_VALUATIONS)), {
          skillPack: 'wealth-portfolio',
          tool: 'portfolio twr',
          engineFunction: 'calculateTimeWeightedReturn',
          methodology: 'True time-weighted return, valuations at each external cash flow, linked geometrically',
          dataSources: [CALLER_INPUTS]
        });
      }
      if (subCommand === 'irr') {
        noteIfSample(['--cash-flows']);
        return printResult(calculateMoneyWeightedReturn(jsonArg('--cash-flows', SAMPLE_FUND_FLOWS)), {
          skillPack: 'wealth-portfolio',
          tool: 'portfolio irr',
          engineFunction: 'calculateMoneyWeightedReturn',
          methodology: 'XIRR on dated cash flows, actual/365',
          dataSources: [CALLER_INPUTS]
        });
      }
      return usage('portfolio [rebalance|drift-monitor|var|factors|tlh|cost-basis|twr|irr]');

    case 'execution':
      if (subCommand === 'fix-payload') {
        noteIfSample(['--symbol', '--qty', '--price']);
        const result = buildFixOrderPayload({
          targetCustodian: getArgVal('--custodian', 'Pershing_NetX360'),
          account: getArgVal('--account', 'U9821045'),
          symbol: getArgVal('--symbol', 'VTI'),
          side: getArgVal('--side', 'BUY'),
          quantity: numArg('--qty', 500),
          price: numArg('--price', 275.50),
          msgSeqNum: intArg('--seq', undefined)
        });
        return printResult(result, {
          skillPack: 'wealth-execution',
          tool: 'execution fix-payload',
          engineFunction: 'buildFixOrderPayload',
          methodology: 'FIX 4.4 New Order Single (35=D) construction with BodyLength and CheckSum',
          dataSources: [CALLER_INPUTS]
        });
      }
      if (subCommand === 'validate') {
        noteIfSample(['--order']);
        const balance = { settledCash: numArg('--settled-cash', 25000), positions: jsonArg('--positions', undefined) };
        const result = validatePreTradeCompliance(balance, jsonArg('--order', SAMPLE_ORDER));
        return printResult(result, {
          skillPack: 'wealth-execution',
          tool: 'execution validate',
          engineFunction: 'validatePreTradeCompliance',
          methodology: 'Buying power, oversell and holding-period checks',
          dataSources: [CALLER_INPUTS]
        });
      }
      if (subCommand === 'payload') {
        noteIfSample(['--order']);
        let order = jsonArg('--order', SAMPLE_ORDER);
        if (hasFlag('--conid')) order = { ...order, conid: intArg('--conid') };
        const result = buildTradePayload(getArgVal('--broker', 'Alpaca'), getArgVal('--account', 'ACC-123'), order);
        return printResult(result, {
          skillPack: 'wealth-execution',
          tool: 'execution payload',
          engineFunction: 'buildTradePayload',
          methodology: 'Broker REST order payload construction (not submitted)',
          dataSources: [CALLER_INPUTS]
        });
      }
      if (subCommand === 'identifier') {
        noteIfSample(['--id']);
        return printResult(validateSecurityIdentifier(getArgVal('--id', 'US0378331005'), getArgVal('--type', null)), {
          skillPack: 'wealth-execution',
          tool: 'execution identifier',
          engineFunction: 'validateSecurityIdentifier',
          methodology: 'Check digits for ISIN (ISO 6166), CUSIP, FIGI and LEI (ISO 17442); format checks for MIC and CFI',
          dataSources: [CALLER_INPUTS]
        });
      }
      if (subCommand === 'settlement-date') {
        noteIfSample(['--trade-date']);
        return printResult(calculateSettlementDate(getArgVal('--trade-date', '2026-09-11'), { holidays: jsonArg('--holidays', []) }), {
          skillPack: 'wealth-execution',
          tool: 'execution settlement-date',
          engineFunction: 'calculateSettlementDate',
          methodology: 'Business-day count skipping weekends and supplied holidays',
          dataSources: [CALLER_INPUTS, 'SEC Rule 15c6-1 (T+1)']
        });
      }
      return usage('execution [validate|payload|fix-payload|identifier|settlement-date]');

    case 'crm':
      if (subCommand === 'parse-transcript') {
        noteIfSample(['--text']);
        const text = getArgVal('--text', 'Client agreed to rebalance into bonds. Advisor will send proposal next week.');
        return printResult(parseMeetingTranscript(text), {
          skillPack: 'wealth-crm',
          tool: 'crm parse-transcript',
          engineFunction: 'parseMeetingTranscript',
          methodology: 'Line-level keyword extraction of decisions and action items',
          dataSources: [CALLER_INPUTS]
        });
      }
      return usage('crm [parse-transcript]');

    case 'research':
      if (subCommand === 'tear-sheet') {
        noteIfSample(['--financials']);
        const result = generateCompanyTearSheet(getArgVal('--ticker', 'AAPL'), jsonArg('--financials', SAMPLE_FINANCIALS));
        return printResult(result, {
          skillPack: 'wealth-research',
          tool: 'research tear-sheet',
          engineFunction: 'generateCompanyTearSheet',
          methodology: 'Valuation ratios from supplied fundamentals',
          dataSources: [CALLER_INPUTS]
        });
      }
      if (subCommand === 'dcf') {
        noteIfSample(['--cash-flows']);
        const result = buildDcfValuation({
          freeCashFlows: jsonArg('--cash-flows', [100, 110, 121]),
          discountRate: numArg('--discount', 0.09),
          terminalGrowthRate: numArg('--growth', 0.025),
          netDebt: numArg('--net-debt', 0),
          sharesOutstanding: numArg('--shares', null)
        });
        return printResult(result, {
          skillPack: 'wealth-research',
          tool: 'research dcf',
          engineFunction: 'buildDcfValuation',
          methodology: 'Discounted free cash flow with a Gordon-growth terminal value',
          dataSources: [CALLER_INPUTS]
        });
      }
      return usage('research [tear-sheet|dcf]');

    case 'onboarding':
      if (subCommand === 'validate-cip') {
        noteIfSample(['--applicant']);
        return printResult(validateCipIdentity(jsonArg('--applicant', SAMPLE_APPLICANT)), {
          skillPack: 'wealth-onboarding',
          tool: 'onboarding validate-cip',
          engineFunction: 'validateCipIdentity',
          methodology: 'Field presence and format checks; records a caller-performed OFAC screen result',
          dataSources: [CALLER_INPUTS]
        });
      }
      if (subCommand === 'gaps') {
        noteIfSample(['--application']);
        return printResult(identifyOnboardingGaps(jsonArg('--application', SAMPLE_APPLICATION)), {
          skillPack: 'wealth-onboarding',
          tool: 'onboarding gaps',
          engineFunction: 'identifyOnboardingGaps',
          methodology: 'Account-type requirement sets from CIP, FinCEN CDD and FINRA 2090, 2111, 2165 and 4512',
          dataSources: [CALLER_INPUTS, '31 CFR 1023.220; 31 CFR 1010.230; FINRA Rules 2090, 2111, 2165, 4512']
        });
      }
      return usage('onboarding [validate-cip|gaps]');

    case 'compliance':
      if (subCommand === 'scan') {
        noteIfSample(['--text']);
        const text = getArgVal('--text', 'We offer a guaranteed 15% return with past performance.');
        return printResult(scanFinraRule2210(text), {
          skillPack: 'wealth-compliance',
          tool: 'compliance scan',
          engineFunction: 'scanFinraRule2210',
          methodology: 'Pattern matching for promissory terms and required disclosure phrases',
          dataSources: [CALLER_INPUTS]
        });
      }
      if (subCommand === 'lookup') {
        // No sample default: a registration answer must come from a real SEC file the caller supplied.
        const result = await lookupAdviserRegistration({
          feedPath: getArgVal('--feed', process.env.WEALTH_SKILLS_IAPD_FEED ?? null),
          crd: getArgVal('--crd', null),
          name: getArgVal('--name', null),
          limit: intArg('--limit', 10),
          asOf: getArgVal('--as-of', undefined),
          maxAgeDays: numArg('--max-age-days', 7)
        });
        return printResult(result, {
          skillPack: 'wealth-compliance',
          tool: 'compliance lookup',
          engineFunction: 'lookupAdviserRegistration',
          methodology: 'Streaming exact-CRD or name match over an SEC IAPD compilation file',
          dataSources: [`SEC IAPD compilation file ${result.feed.file} generated ${result.feed.generatedOn}`]
        });
      }
      if (subCommand === 'suitability') {
        noteIfSample(['--profile', '--recommendation']);
        const result = checkSuitability(jsonArg('--profile', SAMPLE_SUITABILITY_PROFILE), jsonArg('--recommendation', SAMPLE_RECOMMENDATION), {
          activity: jsonArg('--activity', null),
          limits: jsonArg('--limits', {})
        });
        return printResult(result, {
          skillPack: 'wealth-compliance',
          tool: 'compliance suitability',
          engineFunction: 'checkSuitability',
          methodology: 'Customer-specific and quantitative suitability against the FINRA 2111 profile factors',
          dataSources: [CALLER_INPUTS, 'FINRA Rule 2111']
        });
      }
      if (subCommand === 'performance-ad') {
        noteIfSample(['--ad']);
        return printResult(checkPerformanceAdvertisement(jsonArg('--ad', SAMPLE_AD), { asOf: getArgVal('--as-of', null) }), {
          skillPack: 'wealth-compliance',
          tool: 'compliance performance-ad',
          engineFunction: 'checkPerformanceAdvertisement',
          methodology: 'Performance provisions of the SEC Marketing Rule, 17 CFR 275.206(4)-1(d)',
          dataSources: [CALLER_INPUTS, '17 CFR 275.206(4)-1']
        });
      }
      return usage('compliance [scan|lookup|suitability|performance-ad]');

    case 'fundops': {
      const audit = (tool, engineFunction, methodology) => ({ skillPack: 'wealth-fund-ops', tool, engineFunction, methodology, dataSources: [CALLER_INPUTS] });
      if (subCommand === 'reconcile') {
        noteIfSample(['--book', '--custodian']);
        const result = reconcileLedger(jsonArg('--book', SAMPLE_BOOK), jsonArg('--custodian', SAMPLE_CUSTODIAN), {
          valueTolerance: numArg('--value-tolerance', 0.01),
          quantityTolerance: numArg('--quantity-tolerance', 0)
        });
        return printResult(result, audit('fundops reconcile', 'reconcileLedger', 'Position match on account and security, with quantity and value tolerances'));
      }
      if (subCommand === 'nav-tieout') {
        noteIfSample(['--fund']);
        return printResult(tieOutNav(jsonArg('--fund', SAMPLE_FUND)), audit('fundops nav-tieout', 'tieOutNav', 'NAV recomputed from assets less liabilities, compared with the reported figure'));
      }
      if (subCommand === 'lp-statement') {
        noteIfSample(['--statement']);
        return printResult(checkLpCapitalStatement(jsonArg('--statement', SAMPLE_LP_STATEMENT), { tolerance: numArg('--tolerance', 1) }),
          audit('fundops lp-statement', 'checkLpCapitalStatement', 'Capital account roll-forward, commitment and fee checks'));
      }
      if (subCommand === 'close-status') {
        noteIfSample(['--tasks']);
        const asOf = getArgVal('--as-of', hasFlag('--tasks') ? null : '2026-09-07');
        return printResult(trackCloseChecklist(jsonArg('--tasks', SAMPLE_CLOSE_TASKS), { asOf }),
          audit('fundops close-status', 'trackCloseChecklist', 'Task status, due dates and dependency readiness'));
      }
      return usage('fundops [reconcile|nav-tieout|lp-statement|close-status]');
    }

    case 'capabilities':
      // One call that tells an agent which command answers which kind of request, and what each needs.
      console.log(JSON.stringify(listCapabilities(), null, 2));
      return;

    case undefined:
    case 'help':
    case '--help':
      console.log(HELP);
      return;

    default:
      console.error(`Unknown command "${command}".`);
      console.error(HELP);
      process.exitCode = 2;
  }
}

try {
  await run();
} catch (err) {
  console.error(`Error: ${err.message}`);
  // An error that names a missing input carries the question to put to the user.
  for (const item of err.needsInput ?? []) {
    console.error(`Ask: ${item.question}${item.why ? `  (${item.why})` : ''}`);
  }
  process.exitCode = err instanceof UsageError ? 2 : 1;
}
