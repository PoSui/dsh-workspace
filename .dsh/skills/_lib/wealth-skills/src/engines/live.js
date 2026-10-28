/**
 * Wealth Live Engine - Hybrid SEC EDGAR & FRED Live API Integration
 */

import http from 'http';
import https from 'https';
import { LIBRARY_VERSION } from './audit.js';

// FRED stalls requests that carry no User-Agent: the connection opens but no response arrives, so
// every live fetch from Node timed out until one was sent. FRED, unlike SEC, asks for no contact
// details, so a library identifier is enough.
const DEFAULT_FRED_USER_AGENT = `wealth-skills/${LIBRARY_VERSION} (+https://github.com/ai-theories/wealth-skills)`;

// When a live fetch fails these functions say so and return no values. The earlier fallbacks
// returned a fabricated 4.25 yield and an "Apple Inc." entity for any CIK, which a caller had no
// way to tell apart from real data.

export async function fetchLiveEdgarCompanyFacts(cik = '0000320193', { timeoutMs, userAgent } = {}) {
  const normalizedCik = String(cik).padStart(10, '0');
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${normalizedCik}.json`;

  // SEC's fair-access policy requires a User-Agent naming the requester with a contact address.
  // The library cannot declare one on the caller's behalf, so no request is made without it.
  const agent = userAgent ?? process.env.SEC_EDGAR_USER_AGENT;
  if (!agent || !String(agent).trim()) {
    return edgarUnavailable(
      normalizedCik,
      'SEC EDGAR requires a User-Agent identifying your organization and a contact email. Pass { userAgent } or set SEC_EDGAR_USER_AGENT (e.g. "Example Advisors ops@example.com"). No request was made.'
    );
  }

  try {
    const data = await httpGetJson(url, { 'User-Agent': agent }, { timeoutMs });
    return {
      source: 'SEC_EDGAR_LIVE_API',
      cik: normalizedCik,
      entityName: data.entityName,
      facts: data.facts
    };
  } catch (err) {
    return edgarUnavailable(normalizedCik, `Live fetch failed (${err.message}). No offline data is substituted.`);
  }
}

function edgarUnavailable(cik, message) {
  return {
    source: 'SEC_EDGAR_UNAVAILABLE',
    cik,
    entityName: null,
    facts: null,
    status: 'FALLBACK_MODE',
    message
  };
}

export async function fetchLiveFredSeries(seriesId = 'GS10', { timeoutMs, userAgent } = {}) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`;

  try {
    const csvText = await httpGetText(url, { headers: { 'User-Agent': userAgent ?? DEFAULT_FRED_USER_AGENT }, timeoutMs });
    const latest = latestNumericObservation(csvText);

    return {
      source: 'FRED_LIVE_API',
      seriesId,
      latestDate: latest.date,
      latestValue: latest.value
    };
  } catch (err) {
    return {
      source: 'FRED_UNAVAILABLE',
      seriesId,
      latestDate: null,
      latestValue: null,
      status: 'FALLBACK_MODE',
      message: `Live fetch failed (${err.message}). No offline value is substituted.`
    };
  }
}

// FRED CSV is an "observation_date,<SERIES>" header followed by date,value rows. Missing
// observations are written as ".", so the scan walks back to the most recent numeric value.
function latestNumericObservation(csvText) {
  const lines = String(csvText).trim().split(/\r?\n/);

  for (let i = lines.length - 1; i >= 1; i--) {
    const [date, raw] = lines[i].split(',');
    if (!date || raw === undefined || raw.trim() === '') continue;

    const value = Number(raw);
    if (Number.isFinite(value)) return { date: date.trim(), value };
  }

  throw new Error('response contained no numeric observations');
}

// Neither Node's HTTP client nor node:test imposes a default timeout, so a stalled
// connection hung every caller -- and `npm test` -- indefinitely. Every request now has a
// hard deadline and falls through to the caller's unavailable result when it expires.
const DEFAULT_TIMEOUT_MS = 8000;

function httpGetText(url, { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const signal = AbortSignal.timeout(timeoutMs);

    const req = client.get(url, { headers, signal }, (res) => {
      // A non-2xx body (an error page, or an unfollowed redirect) is not data. Rejecting
      // here routes it to the unavailable result instead of parsing HTML as a quote.
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`HTTP Status ${res.statusCode}`));
      }

      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body));
      res.on('error', reject);
    });

    req.on('error', (err) => {
      reject(signal.aborted ? new Error(`Request timed out after ${timeoutMs}ms`) : err);
    });
  });
}

async function httpGetJson(url, headers = {}, options = {}) {
  const body = await httpGetText(url, { headers, ...options });
  return JSON.parse(body);
}
