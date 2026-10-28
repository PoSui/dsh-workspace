import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePreTradeCompliance, buildTradePayload } from '../src/engines/execution.js';

test('Execution Engine: Pre-Trade Compliance Validation', () => {
  const balance = { settledCash: 10000 };
  const order = { symbol: 'VTI', action: 'BUY', quantity: 100, price: 200 }; // 20,000 > 10,000
  const result = validatePreTradeCompliance(balance, order);

  assert.equal(result.passed, false);
  assert.equal(result.errors.length, 1);
  assert.ok(result.errors[0].includes('Insufficient buying power'));
});

test('Execution Engine: Alpaca Payload Generation', () => {
  const order = { symbol: 'VTI', action: 'BUY', quantity: 10, price: 270, orderType: 'LIMIT', tif: 'DAY' };
  const result = buildTradePayload('Alpaca', 'ACC-1', order);

  assert.equal(result.broker, 'Alpaca_API');
  assert.equal(result.payload.symbol, 'VTI');
  assert.equal(result.payload.side, 'buy');
  assert.equal(result.requiresHumanApproval, true);
});

test('Execution Engine: IBKR Payload Requires An Explicit conid', () => {
  const order = { symbol: 'MSFT', action: 'BUY', quantity: 10, price: 400 };

  assert.throws(() => buildTradePayload('IBKR', 'U123', order), /requires a numeric 'conid'/);
});

test('Execution Engine: IBKR Payload Uses The Supplied conid', () => {
  const order = { symbol: 'MSFT', action: 'BUY', quantity: 10, price: 400, conid: 272093 };
  const result = buildTradePayload('IBKR', 'U123', order);
  const ibOrder = result.payload.orders[0];

  assert.equal(result.broker, 'Interactive_Brokers_API');
  assert.equal(ibOrder.conid, 272093);
  assert.equal(ibOrder.ticker, 'MSFT');
});

test('Execution Engine: A Sell Larger Than The Position Is Rejected', () => {
  const result = validatePreTradeCompliance({ positions: { VTI: 60 } }, { symbol: 'VTI', action: 'SELL', quantity: 100, price: 275, holdingPeriodDays: 120 });

  assert.equal(result.passed, false);
  assert.match(result.errors[0], /exceeds the 60 shares held/);
  assert.match(result.warnings[0], /Short-term capital gains/);
});

test('Execution Engine: A Sell Against An Unknown Position Fails Closed', () => {
  const result = validatePreTradeCompliance({ settledCash: 1000000 }, { symbol: 'VTI', action: 'SELL', quantity: 10, price: 275 });

  assert.equal(result.passed, false);
  assert.match(result.errors[0], /not supplied/);
});

test('Execution Engine: A Buy Without A Reference Price Fails Closed', () => {
  const result = validatePreTradeCompliance({ settledCash: 1000000 }, { symbol: 'VTI', action: 'BUY', quantity: 10 });

  assert.equal(result.passed, false);
  assert.equal(result.estimatedCost, null);
});
