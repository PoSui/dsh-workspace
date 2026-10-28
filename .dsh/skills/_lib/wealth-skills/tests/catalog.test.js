import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { loadCatalog, validateCatalog, PACKS } from '../bin/build-catalog.js';

const CODE_TIERS = ['engine', 'partial-engine', 'payload-builder'];

test('Catalog: All 400 Items Are Assigned And Every Claim Validates', async () => {
  const catalog = loadCatalog();
  assert.equal(catalog.items.length, 400);
  assert.deepEqual(await validateCatalog(catalog), []);
});

test('Catalog: Every Pack Carries Items, And Code-Backed Coverage Is Substantial', () => {
  const { items } = loadCatalog();
  for (const pack of PACKS) assert.ok(items.some(i => i.pack === pack), `${pack} has no catalog items`);
  assert.ok(items.filter(i => CODE_TIERS.includes(i.tier)).length >= 100);
});

test('Catalog: The Validator Rejects A Fabricated Engine', async () => {
  const catalog = loadCatalog();
  catalog.items[0] = { ...catalog.items[0], tier: 'engine', engines: ['calculateEverythingPerfectly'] };
  const problems = await validateCatalog(catalog);
  assert.ok(problems.some(p => /calculateEverythingPerfectly is not exported/.test(p)));
});

test('Catalog: The Validator Rejects Code Claims On Guidance And References In The Wrong Section', async () => {
  const catalog = loadCatalog();
  const t = catalog.items.findIndex(i => i.section === 'T');
  const g = catalog.items.findIndex(i => i.section === 'G');
  catalog.items[t] = { ...catalog.items[t], tier: 'research-reference', engines: [] };
  catalog.items[g] = { ...catalog.items[g], tier: 'guidance', engines: ['calculateRMD'] };
  const problems = await validateCatalog(catalog);

  assert.ok(problems.some(p => /research-reference is only for section R/.test(p)));
  assert.ok(problems.some(p => /guidance cannot claim engines/.test(p)));
});

test('Catalog: The Validator Notices A Missing Item', async () => {
  const catalog = loadCatalog();
  catalog.items = catalog.items.filter(i => i.id !== 'S059');
  const problems = await validateCatalog(catalog);
  assert.ok(problems.some(p => /S059: missing from catalog/.test(p)));
});

test('Catalog: Generated Crosswalk And Skill Blocks Are Up To Date', () => {
  const script = fileURLToPath(new URL('../bin/build-catalog.js', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
