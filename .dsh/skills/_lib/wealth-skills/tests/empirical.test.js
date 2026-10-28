import test from 'node:test';
import assert from 'node:assert/strict';
import { USE_CASES, evaluateUseCase, runProofs } from '../bin/run-empirical-proofs.js';

test('Empirical Proofs: All 21 Use Cases Pass Every Check', () => {
  const results = runProofs();
  const failures = results.filter(r => r.status !== 'PASSED').map(r => `${r.id}: ${r.failures.join('; ')}`);

  assert.equal(results.length, 21);
  assert.deepEqual(failures, []);
});

test('Empirical Proofs: Every Use Case Actually Checks Something', () => {
  for (const useCase of USE_CASES) {
    assert.ok(useCase.checks.length > 0, `${useCase.id} has no checks`);
  }
});

test('Empirical Proofs: A Failed Check Is Reported As FAILED', () => {
  const result = evaluateUseCase({
    id: 'UC-X',
    tier: 'test',
    name: 'deliberately wrong expectation',
    run: () => ({ value: 1 }),
    checks: [['value is 2', o => o.value === 2]]
  });

  assert.equal(result.status, 'FAILED');
  assert.deepEqual(result.failures, ['value is 2']);
});

test('Empirical Proofs: A Throwing Use Case Is Reported As FAILED', () => {
  const result = evaluateUseCase({
    id: 'UC-Y',
    tier: 'test',
    name: 'throws',
    run: () => { throw new Error('boom'); },
    checks: [['never reached', () => true]]
  });

  assert.equal(result.status, 'FAILED');
  assert.match(result.failures[0], /boom/);
});
