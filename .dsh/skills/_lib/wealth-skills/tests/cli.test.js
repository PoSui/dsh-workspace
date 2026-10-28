import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const CLI = fileURLToPath(new URL('../bin/wealth-skills.js', import.meta.url));
const run = (...argv) => spawnSync(process.execPath, [CLI, ...argv], { encoding: 'utf8' });

test('CLI: Invalid JSON Exits Non-Zero Instead Of Running On Sample Data', () => {
  const result = run('portfolio', 'rebalance', '--current', '{equity:68}');

  assert.equal(result.status, 2);
  assert.match(result.stderr, /--current is not valid JSON/);
  assert.equal(result.stdout, '');
});

test('CLI: Non-Numeric Flags Are Rejected', () => {
  const result = run('planning', 'rmd', '--age', 'seventy');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--age must be a number/);
});

test('CLI: tlh Analyses The Supplied Lots', () => {
  const lots = [{ id: 'A', symbol: 'VOO', quantity: 10, purchasePrice: 500, currentPrice: 300, purchaseDate: '2020-01-01' }];
  const result = run('portfolio', 'tlh', '--lots', JSON.stringify(lots));
  const output = JSON.parse(result.stdout);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(output.opportunities[0].symbol, 'VOO');
  assert.equal(output.opportunities[0].recommendedReplacement, 'VV');
});

test('CLI: Omitted Inputs Are Announced On stderr', () => {
  const result = run('onboarding', 'validate-cip');

  assert.equal(result.status, 0);
  assert.match(result.stderr, /using built-in sample inputs/);
});

test('CLI: Results Carry Audit Metadata', () => {
  const result = run('portfolio', 'var', '--value', '2000000', '--vol', '0.2', '--confidence', '0.99');
  const output = JSON.parse(result.stdout);

  assert.equal(output.confidenceLevelPercent, 99);
  assert.equal(output.auditMetadata.engine_function, 'calculatePortfolioVar');
  assert.equal(output.auditMetadata.skill_pack, 'wealth-portfolio');
});

test('CLI: --distributions Is Honoured For PE Metrics', () => {
  const result = run('uhnw', 'pe-metrics', '--commitment', '5000000', '--called', '2000000', '--distributions', '1000000', '--nav', '1500000');
  assert.equal(JSON.parse(result.stdout).metrics.dpi, '0.5x');
});

test('CLI: IBKR Payload Without A conid Exits With An Engine Error', () => {
  const order = JSON.stringify({ symbol: 'MSFT', action: 'BUY', quantity: 1, price: 400 });
  const result = run('execution', 'payload', '--broker', 'IBKR', '--order', order);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /conid/);
});

test('CLI: Results Carry Suggested Next Steps', () => {
  const result = run('portfolio', 'drift-monitor', '--current', '{"equity":68,"fixedIncome":32}', '--target', '{"equity":60,"fixedIncome":40}', '--value', '1000000', '--band', '5');
  const output = JSON.parse(result.stdout);

  assert.ok(output.suggestedNextSteps.some(step => step.tool === 'portfolio tlh'));
  assert.ok(output.suggestedNextSteps.every(step => step.why));
});

test('CLI: Missing Information Comes Back As A Question', () => {
  const applicant = JSON.stringify({ name: 'Jane Doe', ssn: '123-45-6789', dob: '1990-05-15', address: '456 Elm St' });
  const output = JSON.parse(run('onboarding', 'validate-cip', '--applicant', applicant).stdout);

  assert.equal(output.cipPassed, false);
  assert.equal(output.needsInput[0].field, 'ofacStatus');
});

test('CLI: An Engine Error Prints The Question To Ask', () => {
  const order = JSON.stringify({ symbol: 'MSFT', action: 'BUY', quantity: 1, price: 400 });
  const result = run('execution', 'payload', '--broker', 'IBKR', '--order', order);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /^Ask: What is the Interactive Brokers contract id/m);
});

test('CLI: capabilities Lists Tools With Their Inputs', () => {
  const result = run('capabilities');
  const capabilities = JSON.parse(result.stdout);

  assert.equal(result.status, 0);
  assert.ok(capabilities.length >= 20);
  assert.ok(capabilities.every(c => c.tool && c.summary && c.typicalRequests.length && c.inputs.length));
});

test('CLI: A Seeded Simulation Is Reproducible', () => {
  const args = ['planning', 'monte-carlo', '--assets', '1250000', '--spend', '50000', '--seed', '42'];
  const first = JSON.parse(run(...args).stdout);
  const second = JSON.parse(run(...args).stdout);

  assert.deepEqual(first.successRatePercent, second.successRatePercent);
  assert.deepEqual(first.medianEndingBalance, second.medianEndingBalance);

  // The README quotes these figures. If the engine or RNG changes they must change there too.
  assert.equal(first.successRatePercent, 68.1);
  assert.equal(first.medianEndingBalance, 875459);
});

test('CLI: A Seeded Forward Test Is Reproducible', () => {
  const args = ['quant', 'forward-test', '--weights', '{"VTI":0.6,"BND":0.4}', '--regime', 'stagflation', '--seed', '7'];
  const first = JSON.parse(run(...args).stdout);

  assert.deepEqual(JSON.parse(run(...args).stdout).projections, first.projections);
  assert.equal(first.probabilityOfGrowthPercent, 46.2); // quoted in the README
});

test('CLI: Without A Seed, Simulations Still Vary', () => {
  const args = ['planning', 'monte-carlo', '--assets', '1250000', '--spend', '50000', '--trials', '2000'];
  const runs = new Set([0, 1, 2].map(() => JSON.parse(run(...args).stdout).medianEndingBalance));

  assert.ok(runs.size > 1, 'unseeded runs should not be identical');
});

test('CLI: New Commands Run On Supplied Inputs', () => {
  const losses = JSON.parse(run('planning', 'capital-losses', '--st-losses', '2000', '--lt-losses', '6000').stdout);
  assert.equal(losses.longTermCarryover, 5000);

  const id = JSON.parse(run('execution', 'identifier', '--id', 'HWUPKR0MPOU8FGXBT394').stdout);
  assert.equal(id.type, 'LEI');
  assert.equal(id.valid, true);

  const settle = JSON.parse(run('execution', 'settlement-date', '--trade-date', '2026-09-04', '--holidays', '["2026-09-07"]').stdout);
  assert.equal(settle.settlementDate, '2026-09-08');
});

test('CLI: Close Status With Supplied Tasks But No Date Asks For One', () => {
  const tasks = JSON.stringify([{ id: 'a', name: 'A', status: 'done' }]);
  const result = run('fundops', 'close-status', '--tasks', tasks);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /^Ask: What date should the close status be measured at\?/m);
});

test('CLI: capabilities Now Lists The Fund Operations Tools', () => {
  const tools = JSON.parse(run('capabilities').stdout).map(c => c.tool);
  for (const tool of ['fundops reconcile', 'fundops nav-tieout', 'fundops lp-statement', 'fundops close-status']) {
    assert.ok(tools.includes(tool), `${tool} missing`);
  }
});
