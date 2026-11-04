const urls = [
  ['Gate 现价+24h', 'https://api.gateio.ws/api/v4/spot/tickers?currency_pair=BTC_USDT'],
  ['blockchain.info', 'https://api.blockchain.info/ticker'],
  ['api.okx.com', 'https://api.okx.com/api/v5/market/ticker?instId=BTC-USDT'],
  ['Bitget', 'https://api.bitget.com/api/v2/spot/market/tickers?symbol=BTCUSDT'],
  ['MEXC', 'https://api.mexc.com/api/v3/ticker/price?symbol=BTCUSDT'],
  ['KuCoin', 'https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=BTC-USDT'],
  ['HTX新域名', 'https://api.htx.com/market/detail/merged?symbol=btcusdt'],
  ['CryptoCompare', 'https://min-api.cryptocompare.com/data/price?fsym=BTC&tsyms=USD'],
  ['CoinLore', 'https://api.coinlore.net/api/ticker/?id=90'],
  ['CoinPaprika', 'https://api.coinpaprika.com/v1/tickers/btc-bitcoin'],
];

for (const [name, url] of urls) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0' } });
    const txt = (await r.text()).slice(0, 160).replace(/\s+/g, ' ');
    console.log(`${name.padEnd(18)} HTTP ${r.status} ${Date.now() - t0}ms | ${txt}`);
  } catch (e) {
    console.log(`${name.padEnd(18)} FAIL ${Date.now() - t0}ms | ${e.name}`);
  }
}
