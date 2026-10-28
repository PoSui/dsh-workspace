/**
 * Wealth FIX Engine - Institutional FIX 4.4 / 5.0 Trade Protocol Tag Generator
 */

const SOH = '\x01';

// A real FIX session owns MsgSeqNum (strictly increasing, reset on logon). This process-local
// counter is only a placeholder so generated samples do not go backwards; pass `msgSeqNum`
// explicitly when building a message for an actual session.
let sessionMsgSeqNum = 0;

export function buildFixOrderPayload(orderDetails = {}) {
  const {
    account = 'U9821045',
    symbol = 'VTI',
    side = 'BUY', // BUY=1, SELL=2
    quantity = 100,
    price = 275.50,
    orderType = 'LIMIT', // MARKET=1, LIMIT=2
    timeInForce = 'DAY', // DAY=0, GTC=1
    targetCustodian = 'Pershing_NetX360',
    senderCompId = 'WEALTH_SKILLS_AI',
    clOrdId = `ORD-${Date.now()}`,
    msgSeqNum = ++sessionMsgSeqNum,
    sendingTime = new Date()
  } = orderDetails;

  const sideKey = String(side).toUpperCase();
  const orderTypeKey = String(orderType).toUpperCase();
  const tifKey = String(timeInForce).toUpperCase();

  // Unrecognised values used to fall through silently: any side other than BUY became SELL, any
  // order type other than LIMIT (e.g. STOP) became MARKET, and any TIF other than GTC became DAY.
  if (sideKey !== 'BUY' && sideKey !== 'SELL') throw new Error(`Unsupported side "${side}"; expected BUY or SELL.`);
  if (orderTypeKey !== 'LIMIT' && orderTypeKey !== 'MARKET') throw new Error(`Unsupported orderType "${orderType}"; expected LIMIT or MARKET.`);
  if (tifKey !== 'DAY' && tifKey !== 'GTC') throw new Error(`Unsupported timeInForce "${timeInForce}"; expected DAY or GTC.`);
  if (!(Number.isFinite(quantity) && quantity > 0)) throw new Error('quantity must be a positive number.');
  if (orderTypeKey === 'LIMIT' && !(Number.isFinite(price) && price > 0)) throw new Error('A LIMIT order requires a positive price.');

  const sideCode = sideKey === 'BUY' ? '1' : '2';
  const ordTypeCode = orderTypeKey === 'LIMIT' ? '2' : '1';
  const tifCode = tifKey === 'GTC' ? '1' : '0';
  const transactTime = toFixUtcTimestamp(sendingTime);

  // FIX 4.4 header order is 8, 9, 35, 49, 56, 34, 52 -- MsgType (35) must be the third field
  // and is part of the body, so the body starts here rather than after it.
  const bodyTags = [
    '35=D', // New Order Single
    `49=${senderCompId}`,
    `56=${targetCustodian.toUpperCase()}`,
    `34=${msgSeqNum}`,
    `52=${transactTime}`,
    `11=${clOrdId}`,
    `1=${account}`,
    `55=${symbol.toUpperCase()}`,
    `54=${sideCode}`,
    `60=${transactTime}`,
    `38=${quantity}`,
    `40=${ordTypeCode}`,
    ordTypeCode === '2' ? `44=${price}` : null,
    `59=${tifCode}`
  ].filter(Boolean);

  // BodyLength (9) counts every character after the SOH terminating tag 9, up to and
  // including the SOH preceding tag 10.
  const rawMessageBody = bodyTags.join(SOH) + SOH;
  const bodyLength = rawMessageBody.length;
  const fullMessageNoChecksum = `8=FIX.4.4${SOH}9=${bodyLength}${SOH}` + rawMessageBody;

  const checksum = calculateFixChecksum(fullMessageNoChecksum);
  const fixMessageStr = `${fullMessageNoChecksum}10=${checksum}${SOH}`;

  return {
    protocol: 'FIX.4.4',
    targetCustodian,
    symbol: symbol.toUpperCase(),
    side,
    quantity,
    price,
    fixMessageRaw: fixMessageStr,
    fixMessageReadable: fixMessageStr.replace(/\x01/g, ' | '),
    tagsMap: {
      '8_BeginString': 'FIX.4.4',
      '9_BodyLength': bodyLength,
      '35_MsgType': 'D (New Order Single)',
      '34_MsgSeqNum': msgSeqNum,
      '52_SendingTime': transactTime,
      '1_Account': account,
      '11_ClOrdID': clOrdId,
      '55_Symbol': symbol.toUpperCase(),
      '54_Side': sideCode === '1' ? '1 (Buy)' : '2 (Sell)',
      '38_OrderQty': quantity,
      '40_OrdType': ordTypeCode === '2' ? '2 (Limit)' : '1 (Market)',
      '44_Price': price,
      '10_CheckSum': checksum
    },
    requiresHumanApproval: true
  };
}

export function parseFixMessage(fixString) {
  // Accepts both the SOH-delimited wire format and the ' | ' readable rendering above, so
  // tokens are trimmed before the tag number is read.
  const parts = String(fixString).split(/[\x01|]/).map(part => part.trim()).filter(Boolean);
  const tagMap = {};

  for (const p of parts) {
    const sep = p.indexOf('=');
    if (sep <= 0) continue;

    const k = p.slice(0, sep).trim();
    const v = p.slice(sep + 1).trim();
    if (k && v) tagMap[k] = v;
  }

  let parsedSide;
  if (tagMap['54'] === '1') parsedSide = 'BUY';
  else if (tagMap['54'] === '2') parsedSide = 'SELL';

  return {
    beginString: tagMap['8'],
    bodyLength: tagMap['9'] ? parseInt(tagMap['9'], 10) : undefined,
    msgType: tagMap['35'],
    msgSeqNum: tagMap['34'] ? parseInt(tagMap['34'], 10) : undefined,
    sendingTime: tagMap['52'],
    account: tagMap['1'],
    clOrdId: tagMap['11'],
    symbol: tagMap['55'],
    side: parsedSide,
    quantity: tagMap['38'] ? parseFloat(tagMap['38']) : undefined,
    price: tagMap['44'] ? parseFloat(tagMap['44']) : undefined,
    checksum: tagMap['10']
  };
}

// FIX UTCTimestamp is YYYYMMDD-HH:MM:SS.sss -- a dash between date and time, colons kept.
function toFixUtcTimestamp(date) {
  const [datePart, timePart] = new Date(date).toISOString().split('T');
  return `${datePart.replace(/-/g, '')}-${timePart.replace('Z', '')}`;
}

function calculateFixChecksum(str) {
  let sum = 0;
  for (let i = 0; i < str.length; i++) {
    sum += str.charCodeAt(i);
  }
  const check = sum % 256;
  return String(check).padStart(3, '0');
}
