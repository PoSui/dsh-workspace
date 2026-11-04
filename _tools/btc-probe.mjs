const urls = [
  ['OKX', 'https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT'],
  ['Binance', 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT'],
  ['HTX(火币)', 'https://api.huobi.pro/market/detail/merged?symbol=btcusdt'],
  ['Bybit', 'https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT'],
  ['Gate', 'https://api.gateio.ws/api/v4/spot/tickers?currency_pair=BTC_USDT'],
  ['CoinGecko', 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd'],
  ['Coinbase', 'https://api.coinbase.com/v2/prices/BTC-USD/spot'],
  ['Kraken', 'https://api.kraken.com/0/public/Ticker?pair=XBTUSD'],
  ['Blockchain.info', 'https://api.blockchain.info/ticker'],
  ['aicoin', 'https://www.aicoin.com/'],
  ['非小号', 'https://www.feixiaohao.com/'],
  ['mytoken', 'https://www.mytoken.io/'],
  ['控制组 github(直连应失败)', 'https://github.com/'],
];

for (const [name, url] of urls) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(7000), headers: { 'User-Agent': 'Mozilla/5.0' } });
    const txt = (await r.text()).slice(0, 120).replace(/\s+/g, ' ');
    console.log(`${name.padEnd(22)} HTTP ${r.status} ${Date.now() - t0}ms | ${txt}`);
  } catch (e) {
    console.log(`${name.padEnd(22)} FAIL ${Date.now() - t0}ms | ${e.name}: ${e.message}`);
  }
}
