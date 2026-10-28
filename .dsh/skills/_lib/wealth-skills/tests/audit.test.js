import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { buildAuditMetadata, withAuditMetadata, LIBRARY_VERSION } from '../src/engines/audit.js';

test('Audit Engine: Library Version Matches package.json', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(LIBRARY_VERSION, pkg.version);
});

test('Audit Engine: Metadata Carries Only Fields The System Can Populate', () => {
  const meta = buildAuditMetadata({ skillPack: 'wealth-portfolio', engineFunction: 'calculatePortfolioVar', dataSources: ['caller-supplied'] });

  assert.equal(meta.skill_pack, 'wealth-portfolio');
  assert.equal(meta.engine_function, 'calculatePortfolioVar');
  assert.ok(!('confidence_score' in meta));
  assert.ok(!Number.isNaN(Date.parse(meta.generated_at)));
});

test('Audit Engine: An Engine Approval Flag Cannot Be Cleared By Metadata', () => {
  const result = withAuditMetadata({ requiresHumanApproval: true }, {
    skillPack: 'wealth-execution',
    engineFunction: 'buildTradePayload',
    requiresHumanApproval: false
  });

  assert.equal(result.auditMetadata.requires_human_approval, true);
});
