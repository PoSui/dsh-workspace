import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { createMessageHandler } from '../mcp-servers/lib/stdio-server.js';
import { server as universal } from '../mcp-servers/universal-wealth-server/index.js';
import { server as iapd } from '../mcp-servers/sec-iapd-lookup/index.js';
import { listCapabilities } from '../src/engines/guidance.js';

const handle = createMessageHandler(universal);
const IAPD_FIXTURE = fileURLToPath(new URL('./fixtures/iapd/sec-firms.xml', import.meta.url));
const call = (id, name, args) => handle({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

test('MCP: Notifications Get No Response', () => {
  assert.equal(handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
});

test('MCP: Initialize And tools/list', () => {
  const init = handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(init.result.serverInfo.name, 'universal-wealth-server');

  const list = handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  assert.equal(list.result.tools.length, universal.tools.length);
  assert.ok(list.result.tools.every(tool => !('handler' in tool)));
});

test('MCP: Unknown Tools And Invalid Arguments Are JSON-RPC Errors', () => {
  assert.equal(call(3, 'nope', {}).error.code, -32602);

  const missing = call(4, 'monitor_portfolio_drift', {});
  assert.equal(missing.error.code, -32602);
  assert.match(missing.error.message, /"currentAlloc" is required/);

  const wrongType = call(5, 'calculate_portfolio_var', { portfolioValue: '1000000' });
  assert.match(wrongType.error.message, /must be of type number/);
});

test('MCP: A Throwing Tool Still Answers, With isError', () => {
  const response = call(6, 'backtest_portfolio', { weights: { TSLA: 1 } });

  assert.equal(response.id, 6);
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /No return data/);
});

test('MCP: Tool Results Carry Audit Metadata And Honour New Parameters', () => {
  const response = call(7, 'calculate_portfolio_var', { portfolioValue: 1000000, confidenceLevel: 0.99 });
  const payload = JSON.parse(response.result.content[0].text);

  assert.equal(payload.confidenceLevelPercent, 99);
  assert.equal(payload.auditMetadata.engine_function, 'calculatePortfolioVar');
});

test('MCP: Registration Lookup Reads An IAPD File Asynchronously And Carries Its Date', async () => {
  const response = await createMessageHandler(iapd)({
    jsonrpc: '2.0', id: 8, method: 'tools/call',
    params: { name: 'lookup_adviser_registration', arguments: { feedPath: IAPD_FIXTURE, crd: '900001', asOf: '2026-09-13' } }
  });
  const payload = JSON.parse(response.result.content[0].text);

  assert.equal(response.id, 8);
  assert.equal(payload.dataSource, 'SEC_IAPD_COMPILATION');
  assert.equal(payload.matches[0].businessName, 'EXAMPLE HARBOR ADVISORS LLC');
  assert.match(payload.auditMetadata.data_sources[0], /generated 2026-09-13/);
  assert.ok(payload.suggestedNextSteps.some(step => /BrokerCheck by hand/.test(step.action)));
  assert.doesNotMatch(iapd.tools[0].description, /sample|fictitious/i);
});

test('MCP: Registration Lookup Without A File Asks Where To Find One', async () => {
  const saved = process.env.WEALTH_SKILLS_IAPD_FEED;
  delete process.env.WEALTH_SKILLS_IAPD_FEED;
  try {
    const response = await createMessageHandler(iapd)({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'lookup_adviser_registration', arguments: { crd: '1' } } });
    const payload = JSON.parse(response.result.content[0].text);
    assert.equal(response.result.isError, true);
    assert.equal(payload.needsInput[0].field, 'feedPath');
  } finally {
    if (saved !== undefined) process.env.WEALTH_SKILLS_IAPD_FEED = saved;
  }
});

test('MCP: Over stdio, Notifications Are Silent And Every Request Is Answered', async () => {
  const serverPath = fileURLToPath(new URL('../mcp-servers/universal-wealth-server/index.js', import.meta.url));
  const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });

  let stdout = '';
  child.stdout.on('data', chunk => stdout += chunk);

  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'monitor_portfolio_drift', arguments: { currentAlloc: {}, targetAlloc: {}, portfolioValue: -1 } } },
    { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }
  ];
  for (const message of messages) child.stdin.write(JSON.stringify(message) + '\n');
  child.stdin.write('not json\n');
  child.stdin.end();

  await new Promise(resolve => child.on('close', resolve));

  const responses = stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(responses.map(r => r.id), [1, 2, 3, null]);
  assert.equal(responses[1].result.isError, true);
  assert.equal(responses[3].error.code, -32700);
});

test('MCP: Tool Results Carry Suggested Next Steps', () => {
  const response = call(10, 'monitor_portfolio_drift', { currentAlloc: { equity: 68, fixedIncome: 32 }, targetAlloc: { equity: 60, fixedIncome: 40 }, portfolioValue: 1000000 });
  const payload = JSON.parse(response.result.content[0].text);

  assert.ok(payload.suggestedNextSteps.some(step => step.tool === 'portfolio tlh'));
});

test('MCP: An Error Naming A Missing Input Returns The Question', () => {
  const response = call(11, 'backtest_portfolio', { weights: { TSLA: 1 } });
  const payload = JSON.parse(response.result.content[0].text);

  assert.equal(response.result.isError, true);
  assert.equal(payload.needsInput[0].field, 'weights');
  assert.match(payload.needsInput[0].question, /VTI/);
});

test('MCP: A Value Outside An Enum Is Rejected Before The Engine Runs', () => {
  // Schema validation catches this at the protocol level, so it never reaches the tool.
  const response = call(12, 'forward_test_simulation', { weights: { VTI: 1 }, regime: 'recession' });

  assert.equal(response.error.code, -32602);
  assert.match(response.error.message, /"regime" must be one of baseline/);
});

// --- Every capability over MCP -----------------------------------------------------------------------

test('MCP: Every CLI Capability Is Exposed By Exactly One MCP Tool', () => {
  const tools = [...universal.tools, ...iapd.tools];
  const names = tools.map(tool => tool.name);
  assert.equal(new Set(names).size, names.length, 'tool names are unique');

  const commands = tools.map(tool => tool.command).sort();
  assert.deepEqual(commands, listCapabilities().map(capability => capability.tool).sort());
});

test('MCP: Every Tool Schema Lists Its Required Arguments As Properties', () => {
  for (const tool of [...universal.tools, ...iapd.tools]) {
    assert.ok(tool.description.length > 40, `${tool.name} needs a real description`);
    for (const field of tool.inputSchema.required) {
      assert.ok(tool.inputSchema.properties[field], `${tool.name} requires "${field}" but does not describe it`);
    }
  }
});

test('MCP: The New Tools Fail Closed With A Question When Inputs Are Wrong', () => {
  const response = call(101, 'identify_onboarding_gaps', { application: { accountType: 'crypto' } });
  const payload = JSON.parse(response.result.content[0].text);
  assert.equal(response.result.isError, true);
  assert.equal(payload.needsInput[0].field, 'accountType');

  const niit = call(102, 'calculate_niit', { magi: 300000, netInvestmentIncome: 1, filingStatus: 'JOINT' });
  assert.equal(niit.error.code, -32602, 'enum validation rejects an unknown filing status');
});

test('MCP: Over stdio, An Async Registration Lookup Is Answered', async () => {
  const serverPath = fileURLToPath(new URL('../mcp-servers/sec-iapd-lookup/index.js', import.meta.url));
  const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });

  let stdout = '';
  child.stdout.on('data', chunk => stdout += chunk);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lookup_adviser_registration', arguments: { feedPath: IAPD_FIXTURE, name: 'capital', asOf: '2026-09-13' } } }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }) + '\n');
  child.stdin.end();

  await new Promise(resolve => child.on('close', resolve));
  const responses = stdout.trim().split('\n').map(line => JSON.parse(line));
  const lookup = responses.find(r => r.id === 1);

  assert.deepEqual(responses.map(r => r.id).sort(), [1, 2]);
  assert.equal(JSON.parse(lookup.result.content[0].text).matchCount, 2);
});
