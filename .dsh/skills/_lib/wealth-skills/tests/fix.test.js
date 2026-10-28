import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFixOrderPayload, parseFixMessage } from '../src/engines/fix.js';

test('FIX Engine: Tag 35=D New Order Single Payload Generation', () => {
  const result = buildFixOrderPayload({
    account: 'U9821045',
    symbol: 'VTI',
    side: 'BUY',
    quantity: 500,
    price: 275.50,
    targetCustodian: 'Pershing_NetX360'
  });

  assert.equal(result.protocol, 'FIX.4.4');
  assert.equal(result.symbol, 'VTI');
  assert.equal(result.quantity, 500);
  assert.ok(result.fixMessageRaw.includes('35=D'));
  assert.ok(result.fixMessageRaw.includes('55=VTI'));
  assert.ok(result.fixMessageRaw.includes('10='));
});

test('FIX Engine: Parse Raw FIX Message', () => {
  const fixStr = "8=FIX.4.4\x019=98\x0135=D\x011=U9821045\x0155=AAPL\x0154=1\x0138=100\x0144=215.00\x0110=184\x01";
  const parsed = parseFixMessage(fixStr);

  assert.equal(parsed.symbol, 'AAPL');
  assert.equal(parsed.side, 'BUY');
  assert.equal(parsed.quantity, 100);
  assert.equal(parsed.price, 215.00);
});

test('FIX Engine: MsgType Is The Third Field And BodyLength Matches The Spec', () => {
  const SOH = '\x01';
  const raw = buildFixOrderPayload({ symbol: 'VTI', quantity: 500, price: 275.50 }).fixMessageRaw;
  const fields = raw.split(SOH).filter(Boolean);

  assert.ok(fields[0].startsWith('8='), 'BeginString must be first');
  assert.ok(fields[1].startsWith('9='), 'BodyLength must be second');
  assert.equal(fields[2], '35=D', 'MsgType must be the third field');
  assert.ok(fields[fields.length - 1].startsWith('10='), 'CheckSum must be last');

  // BodyLength counts from the start of 35= up to and including the SOH before 10=.
  const bodyStart = raw.indexOf(`35=D`);
  const checksumStart = raw.lastIndexOf(`${SOH}10=`) + 1;
  const declaredBodyLength = parseInt(fields[1].slice(2), 10);

  assert.equal(declaredBodyLength, checksumStart - bodyStart);
});

test('FIX Engine: CheckSum Is The Modulo-256 Sum Of Everything Before Tag 10', () => {
  const SOH = '\x01';
  const raw = buildFixOrderPayload({ symbol: 'AAPL', quantity: 10, price: 215 }).fixMessageRaw;
  const upToChecksum = raw.slice(0, raw.lastIndexOf(`${SOH}10=`) + 1);

  let sum = 0;
  for (let i = 0; i < upToChecksum.length; i++) sum += upToChecksum.charCodeAt(i);

  const declared = raw.slice(raw.lastIndexOf(`${SOH}10=`) + 4, -1);
  assert.equal(declared, String(sum % 256).padStart(3, '0'));
  assert.equal(declared.length, 3);
});

test('FIX Engine: Timestamps Use FIX UTCTimestamp Format', () => {
  const result = buildFixOrderPayload({ sendingTime: new Date('2026-09-10T03:25:42.027Z') });
  const parsed = parseFixMessage(result.fixMessageRaw);

  assert.equal(parsed.sendingTime, '20260910-03:25:42.027');
  assert.match(parsed.sendingTime, /^\d{8}-\d{2}:\d{2}:\d{2}\.\d{3}$/);
});

test('FIX Engine: MsgSeqNum Increases Instead Of Being Random', () => {
  const first = parseFixMessage(buildFixOrderPayload({}).fixMessageRaw).msgSeqNum;
  const second = parseFixMessage(buildFixOrderPayload({}).fixMessageRaw).msgSeqNum;

  assert.ok(second > first, `expected increasing seq nums, got ${first} then ${second}`);
  assert.equal(parseFixMessage(buildFixOrderPayload({ msgSeqNum: 7 }).fixMessageRaw).msgSeqNum, 7);
});

test('FIX Engine: Round-Trips Its Own Readable Rendering', () => {
  const built = buildFixOrderPayload({ symbol: 'VTI', side: 'SELL', quantity: 250, price: 275.50 });
  const parsed = parseFixMessage(built.fixMessageReadable);

  assert.equal(parsed.msgType, 'D');
  assert.equal(parsed.symbol, 'VTI');
  assert.equal(parsed.side, 'SELL');
  assert.equal(parsed.quantity, 250);
  assert.equal(parsed.price, 275.50);
});

test('FIX Engine: Absent Side Tag Is Undefined Rather Than Defaulted To SELL', () => {
  const parsed = parseFixMessage('8=FIX.4.4\x0135=D\x0155=AAPL\x0138=100\x01');

  assert.equal(parsed.side, undefined);
  assert.equal(parsed.symbol, 'AAPL');
});

test('FIX Engine: Unrecognised Side, Order Type Or TIF Is Rejected', () => {
  assert.throws(() => buildFixOrderPayload({ side: 'HOLD' }), /Unsupported side/);
  assert.throws(() => buildFixOrderPayload({ orderType: 'STOP' }), /Unsupported orderType/);
  assert.throws(() => buildFixOrderPayload({ timeInForce: 'IOC' }), /Unsupported timeInForce/);
  assert.throws(() => buildFixOrderPayload({ orderType: 'LIMIT', price: 0 }), /positive price/);
});

test('FIX Engine: Market Orders Omit The Price Tag', () => {
  const parsed = parseFixMessage(buildFixOrderPayload({ orderType: 'MARKET' }).fixMessageRaw);
  assert.equal(parsed.price, undefined);
});
