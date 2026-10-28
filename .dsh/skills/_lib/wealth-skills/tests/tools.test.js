import test from 'node:test';
import assert from 'node:assert/strict';
import { WEALTH_TOOLS, runTool, listTools, toolByName, toolByCommand, anthropicToolSchemas, inputSchemaFor } from '../src/engines/tools.js';
import { EXAMPLE_ARGS, SCENARIOS, runScenario, routeRequest, highlights, systemPrompt } from '../src/engines/assistant.js';
import { listCapabilities } from '../src/engines/guidance.js';

// One realistic call per tool. A wiring mistake - wrong argument name, wrong order, an option that
// never reaches the engine - fails here rather than in front of a user.
const EXPECTED = {
  analyze_portfolio_factors: o => o.assetClassBreakdown.unclassifiedPct === 10,
  assess_sharpe_ratio: o => o.deflated.trials === 20 && o.probabilisticSharpeRatio > 0.9,
  backtest_portfolio: o => o.endingBalance === 219579,
  build_dcf_valuation: o => o.valuePerShare === 138.11,
  build_fix_order_payload: o => o.fixMessageReadable.includes('35=D') && o.tagsMap['54_Side'].startsWith('2'),
  build_trade_payload: o => o.payload.symbol === 'VOO' && o.payload.side === 'sell',
  calculate_collar_strategy: o => o.collarParameters.putStrikeFloor === 193.5 && o.zeroCostStructure === null,
  calculate_cost_basis: o => o.shortTermGainOrLoss === -2500 && o.longTermGainOrLoss === 6000,
  calculate_money_weighted_return: o => o.irrPercent === 0,
  calculate_niit: o => o.netInvestmentIncomeTax === 2660,
  calculate_pe_metrics: o => o.metrics.tvpiMoic === '1.47x',
  calculate_portfolio_rebalance: o => Array.isArray(o.rebalancePlan),
  calculate_portfolio_var: o => o.confidenceLevelPercent === 99 && o.valueAtRiskDollar === 117237,
  calculate_rmd: o => o.rmdRequired === 20325,
  calculate_settlement_date: o => o.settlementDate === '2026-11-27',
  calculate_tax_headroom: o => o.headroomForRothConversion === 33600,
  calculate_time_weighted_return: o => o.cumulativeReturnPercent === -5.5556,
  check_lp_capital_statement: o => o.rollsForward === false && o.unfundedCommitment === 750000,
  check_performance_advertisement: o => o.violations.length === 2,
  check_suitability: o => o.flags.length === 4 && o.metrics.positionPctOfInvestableAssets === 37.5,
  forward_test_simulation: o => o.regime === 'stagflation' && Number.isFinite(o.expectedReturnPercent),
  generate_tear_sheet: o => o.valuationMetrics.peRatio === 29.45,
  identify_onboarding_gaps: o => o.blocking.length === 1 && o.counts.beforeRecommendations === 10,
  monitor_portfolio_drift: o => o.isRebalanceTriggered === true && o.maxDriftPct === 8,
  net_capital_gains_losses: o => o.netCapitalGainOrLoss === -14000 && o.deductionAgainstOrdinaryIncome === 3000,
  parse_meeting_transcript: o => o.extractedDecisionsCount === 1 && o.actionItems.length === 2,
  reconcile_ledger: o => o.breaks.length === 2 && o.netValueDifference === 536000,
  run_monte_carlo_cash_flow: o => o.successRatePercent > 0 && o.initialAssets === 1250000,
  scan_finra_compliance: o => o.screenStatus === 'VIOLATION' && o.complianceScore === 35,
  scan_tax_loss_harvesting: o => o.totalHarvestableLosses === 8000 && o.opportunities[0].recommendedReplacement === 'VV',
  tie_out_nav: o => o.computedNavPerUnit === 109.2 && o.requiresHumanApproval === true,
  track_close_checklist: o => o.overdue.length === 2 && o.closeComplete === false,
  validate_cip_identity: o => o.cipPassed === false && o.ofacStatus === 'NOT_SCREENED',
  validate_pre_trade: o => o.passed === true && o.estimatedCost === 42000,
  validate_security_identifier: o => o.valid === false && o.type === 'ISIN',
};

test('Tools: Every Capability Is A Tool, And Every Tool Mirrors A CLI Command', () => {
  const commands = WEALTH_TOOLS.map(tool => tool.command);
  assert.equal(new Set(commands).size, commands.length, 'commands are unique');
  assert.equal(new Set(WEALTH_TOOLS.map(t => t.name)).size, WEALTH_TOOLS.length, 'names are unique');

  const known = new Set(listCapabilities().map(capability => capability.tool));
  // The registry covers every capability except the registration lookup, which reads a file and so
  // lives in its own server.
  for (const command of commands) assert.ok(known.has(command), `${command} has no guidance entry`);
  assert.deepEqual([...known].filter(command => !commands.includes(command)), ['compliance lookup']);

  assert.equal(toolByName('calculate_rmd').command, 'planning rmd');
  assert.equal(toolByCommand('planning rmd').name, 'calculate_rmd');
  assert.equal(toolByName('nope'), null);
  assert.equal(listTools().length, WEALTH_TOOLS.length);
});

test('Tools: Every Tool Runs On Its Example Arguments And Produces What The Engine Should', () => {
  assert.deepEqual(Object.keys(EXAMPLE_ARGS).sort(), WEALTH_TOOLS.map(tool => tool.name).sort());
  assert.deepEqual(Object.keys(EXPECTED).sort(), WEALTH_TOOLS.map(tool => tool.name).sort());

  for (const tool of WEALTH_TOOLS) {
    const result = runTool(tool.name, EXAMPLE_ARGS[tool.name]);

    assert.equal(result.auditMetadata.tool, tool.name);
    assert.equal(result.auditMetadata.engine_function, tool.engineFunction);
    assert.ok(result.suggestedNextSteps?.length > 0, `${tool.name} suggests nothing`);
    assert.ok(EXPECTED[tool.name](result), `${tool.name} returned an unexpected result: ${JSON.stringify(result).slice(0, 300)}`);
  }
});

test('Tools: An Unknown Tool Is Refused', () => {
  assert.throws(() => runTool('sell_everything', {}), /Unknown tool/);
});

test('Tools: Schemas Are Well Formed For MCP And For The Messages API', () => {
  for (const tool of WEALTH_TOOLS) {
    const schema = inputSchemaFor(tool);
    assert.equal(schema.type, 'object');
    for (const field of schema.required) assert.ok(schema.properties[field], `${tool.name} requires undescribed ${field}`);
    for (const [field, spec] of Object.entries(schema.properties)) {
      assert.ok(spec.description?.length > 3, `${tool.name}.${field} has no description`);
      assert.ok(['string', 'number', 'integer', 'boolean', 'object', 'array'].includes(spec.type), `${tool.name}.${field} has type ${spec.type}`);
    }
  }

  const api = anthropicToolSchemas();
  assert.equal(api.length, WEALTH_TOOLS.length);
  assert.deepEqual(Object.keys(api[0]).sort(), ['description', 'input_schema', 'name']);
  // Anthropic tool names must be [a-zA-Z0-9_-]{1,64}.
  for (const tool of api) assert.match(tool.name, /^[a-zA-Z0-9_-]{1,64}$/);
});

test('Assistant: Every Scripted Scenario Runs Real Engines End To End', () => {
  assert.ok(SCENARIOS.length >= 6);
  const packs = new Set(SCENARIOS.map(scenario => scenario.pack));
  assert.ok(packs.size >= 5, 'scenarios should show several packs');

  for (const scenario of SCENARIOS) {
    assert.ok(scenario.prompt.length > 20 && scenario.closing.length > 40, `${scenario.id} needs a prompt and a closing`);
    const run = runScenario(scenario.id);
    assert.equal(run.steps.length, scenario.steps.length);

    for (const step of run.steps) {
      assert.ok(step.say.length > 10, `${scenario.id} step has no narration`);
      assert.equal(step.command, toolByName(step.tool).command);
      assert.equal(step.result.auditMetadata.tool, step.tool);
      assert.ok(step.args, `${scenario.id} step ${step.tool} has no arguments`);
    }
  }
  assert.throws(() => runScenario('nope'), /Unknown scenario/);
});

test('Assistant: Requests Route To The Skill That Says It Answers Them', () => {
  const cases = [
    ['how much can they convert to a roth this year', 'planning tax-headroom'],
    ['what is their RMD this year', 'planning rmd'],
    ['how much could this portfolio lose', 'portfolio var'],
    ['is the portfolio off target', 'portfolio drift-monitor'],
    ['can we send this to clients', 'compliance scan'],
    ['what is their money weighted return', 'portfolio irr']
  ];
  for (const [request, expected] of cases) {
    const routed = routeRequest(request);
    assert.equal(routed.matches[0].command, expected, `"${request}" routed to ${routed.matches[0]?.command}`);
    assert.equal(routed.confident, true, `"${request}" should be a confident match`);
    assert.equal(routed.matches[0].tool, toolByCommand(expected).name);
  }
});

test('Assistant: A Request It Cannot Place Returns No Match Rather Than A Guess', () => {
  const routed = routeRequest('what is the weather tomorrow');
  assert.deepEqual(routed.matches, []);
  assert.equal(routed.confident, false);

  // A vague request matches, but not confidently, so the caller asks instead of running something.
  const vague = routeRequest('is this suitable');
  assert.equal(vague.confident, false);
  assert.ok(vague.matches.length > 0);
});

test('Assistant: Highlights Skip The Plumbing And Summarize Arrays', () => {
  const result = runTool('calculate_rmd', EXAMPLE_ARGS.calculate_rmd);
  const shown = highlights(result);

  assert.ok(shown.some(item => item.key === 'rmdRequired' && item.value === 20325));
  for (const item of shown) assert.ok(!['auditMetadata', 'suggestedNextSteps', 'needsInput', 'note'].includes(item.key));

  const drift = highlights(runTool('monitor_portfolio_drift', EXAMPLE_ARGS.monitor_portfolio_drift));
  assert.ok(drift.some(item => /item/.test(String(item.value))), 'arrays are summarized by length');
  assert.deepEqual(highlights(null), []);
});

test('Assistant: The System Prompt Tells Claude Not To Invent Figures Or Give Advice', () => {
  const prompt = systemPrompt();
  assert.match(prompt, /never invent figures/i);
  assert.match(prompt, /needsInput/);
  assert.match(prompt, /investment, tax or legal advice/i);
});
