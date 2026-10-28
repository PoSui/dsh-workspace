import { inputError } from './guidance.js';

/**
 * Wealth Execution Engine - Self-Contained Pre-Trade Validation & Broker Payload Logic
 */

export function validatePreTradeCompliance(accountBalance = {}, orderDetails = {}) {
  const { symbol, action, quantity, price } = orderDetails;
  const side = String(action ?? '').toUpperCase();
  const ticker = String(symbol ?? '').toUpperCase();

  const errors = [];
  const warnings = [];

  if (!ticker) errors.push('Order symbol is required.');
  if (side !== 'BUY' && side !== 'SELL') errors.push(`Unsupported action "${action}"; expected BUY or SELL.`);

  const quantityValid = Number.isFinite(quantity) && quantity > 0;
  if (!quantityValid) errors.push('Quantity must be a positive number.');

  const priceKnown = Number.isFinite(price) && price > 0;
  const estimatedCost = quantityValid && priceKnown ? quantity * price : null;

  if (side === 'BUY') {
    // Buying power cannot be verified without both a reference price and settled cash, so either
    // gap fails the check instead of passing it.
    if (!priceKnown) {
      errors.push('No positive reference price supplied (e.g. a market order); buying power could not be verified.');
    } else if (!Number.isFinite(accountBalance.settledCash)) {
      errors.push('Settled cash not supplied; buying power could not be verified.');
    } else if (estimatedCost !== null && estimatedCost > accountBalance.settledCash) {
      errors.push(`Insufficient buying power. Order cost ($${estimatedCost}) exceeds settled cash ($${accountBalance.settledCash}).`);
    }
  }

  if (side === 'SELL') {
    // Selling more than is held creates a short sale. An unknown position fails closed.
    const held = accountBalance.positions?.[ticker] ?? orderDetails.sharesHeld;
    if (!Number.isFinite(held)) {
      errors.push(`Position in ${ticker} not supplied (accountBalance.positions or orderDetails.sharesHeld); cannot verify the sell does not exceed holdings.`);
    } else if (quantityValid && quantity > held) {
      errors.push(`Sell quantity ${quantity} exceeds the ${held} shares held in ${ticker}; this would create a short sale.`);
    }

    if (orderDetails.holdingPeriodDays && orderDetails.holdingPeriodDays < 365) {
      warnings.push(`Short-term capital gains tax triggered. Holding period is ${orderDetails.holdingPeriodDays} days.`);
    }
  }

  const passed = errors.length === 0;

  return {
    symbol,
    action,
    quantity,
    price,
    estimatedCost,
    passed,
    errors,
    warnings,
    requiresHumanApproval: true
  };
}

export function buildTradePayload(broker = 'Alpaca', accountId, orderDetails) {
  const { symbol, action, quantity, price, orderType = 'LIMIT', tif = 'DAY' } = orderDetails;

  if (broker.toLowerCase() === 'alpaca') {
    return {
      broker: 'Alpaca_API',
      endpoint: '/v2/orders',
      payload: {
        symbol: symbol.toUpperCase(),
        qty: quantity,
        side: action.toLowerCase(),
        type: orderType.toLowerCase(),
        time_in_force: tif.toLowerCase(),
        limit_price: orderType.toUpperCase() === 'LIMIT' ? String(price) : undefined
      },
      requiresHumanApproval: true
    };
  }

  // Interactive Brokers routes on the numeric contract identifier (conid), NOT the ticker
  // string. A wrong or defaulted conid places a real order in the wrong security, so the
  // caller must resolve it first (GET /iserver/secdef/search?symbol=<ticker>) and pass it in.
  const { conid, secType = 'STK', currency = 'USD' } = orderDetails;

  if (!Number.isInteger(conid) || conid <= 0) {
    throw inputError(
      `Interactive Brokers order for ${String(symbol).toUpperCase()} requires a numeric 'conid' in orderDetails. ` +
      `Resolve it via GET /iserver/secdef/search?symbol=${String(symbol).toUpperCase()} and pass it explicitly; ` +
      `IBKR routes on conid, so a placeholder would submit an order for the wrong security.`,
      [{
        field: 'conid',
        question: `What is the Interactive Brokers contract id (conid) for ${String(symbol).toUpperCase()}?`,
        why: 'IBKR routes on conid, so the wrong value would place the order in a different security.'
      }]
    );
  }

  return {
    broker: 'Interactive_Brokers_API',
    endpoint: '/v1/api/iserver/account/' + accountId + '/orders',
    payload: {
      orders: [
        {
          acctId: accountId,
          conid,
          secType,
          cFC: currency,
          ticker: symbol.toUpperCase(),
          orderType: orderType.toUpperCase(),
          price: price,
          side: action.toUpperCase(),
          quantity: quantity,
          tif: tif.toUpperCase()
        }
      ]
    },
    requiresHumanApproval: true
  };
}
