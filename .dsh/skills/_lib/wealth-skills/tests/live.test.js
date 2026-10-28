import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchLiveEdgarCompanyFacts, fetchLiveFredSeries } from '../src/engines/live.js';

// Network tests are opt-in (`npm run test:live`) so `npm test` stays deterministic and offline-safe.
// EDGAR additionally needs SEC_EDGAR_USER_AGENT, because SEC requires a declared contact.
const liveOptIn = process.env.WEALTH_SKILLS_LIVE_TESTS === '1';
const skipFred = liveOptIn ? false : 'set WEALTH_SKILLS_LIVE_TESTS=1 to run network tests';
const skipEdgar = !liveOptIn
  ? 'set WEALTH_SKILLS_LIVE_TESTS=1 to run network tests'
  : (process.env.SEC_EDGAR_USER_AGENT ? false : 'set SEC_EDGAR_USER_AGENT to run the live EDGAR test');

test('Live Engine: SEC EDGAR Live Company Facts', { skip: skipEdgar }, async () => {
  const result = await fetchLiveEdgarCompanyFacts('0000320193');
  assert.equal(result.source, 'SEC_EDGAR_LIVE_API');
  assert.ok(result.entityName);
});

test('Live Engine: FRED Live Series Returns A Real Observation', { skip: skipFred }, async () => {
  const result = await fetchLiveFredSeries('GS10');
  assert.equal(result.source, 'FRED_LIVE_API');
  assert.ok(Number.isFinite(result.latestValue));
  assert.match(result.latestDate, /^\d{4}-\d{2}-\d{2}$/);
});

// Runs everywhere: with a 1ms deadline no handshake can complete, so this is deterministic with
// or without network access.
test('Live Engine: A Stalled FRED Request Times Out And Substitutes No Value', async () => {
  const started = Date.now();
  const result = await fetchLiveFredSeries('GS10', { timeoutMs: 1 });

  assert.equal(result.source, 'FRED_UNAVAILABLE');
  assert.equal(result.status, 'FALLBACK_MODE');
  assert.equal(result.latestValue, null);
  assert.equal(result.latestDate, null);
  assert.ok(Date.now() - started < 5000, 'fetch should abort promptly, not hang');
});

test('Live Engine: EDGAR Honours Its Deadline And Does Not Invent An Entity', async () => {
  const result = await fetchLiveEdgarCompanyFacts('0000789019', { timeoutMs: 1, userAgent: 'wealth-skills-tests test@example.com' });

  assert.equal(result.source, 'SEC_EDGAR_UNAVAILABLE');
  assert.equal(result.entityName, null);
  assert.ok(/timed out|abort/i.test(result.message), `unexpected message: ${result.message}`);
});

test('Live Engine: EDGAR Makes No Request Without A Declared User-Agent', async () => {
  const saved = process.env.SEC_EDGAR_USER_AGENT;
  delete process.env.SEC_EDGAR_USER_AGENT;
  try {
    const result = await fetchLiveEdgarCompanyFacts('0000320193');
    assert.equal(result.source, 'SEC_EDGAR_UNAVAILABLE');
    assert.match(result.message, /User-Agent/);
    assert.match(result.message, /No request was made/);
  } finally {
    if (saved !== undefined) process.env.SEC_EDGAR_USER_AGENT = saved;
  }
});
