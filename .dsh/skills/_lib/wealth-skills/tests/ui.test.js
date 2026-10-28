import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAdaptiveUI } from '../src/engines/ui.js';

const sampleData = {
  title: 'Portfolio Review',
  summary: 'Equities drifted above target.',
  metrics: { 'Portfolio Value': '$1,000,000' },
  latexFormula: '\\text{Sharpe} = \\frac{R_p - R_f}{\\sigma}',
  diffContent: '- Equity: 68%\n+ Equity: 60%'
};

test('UI Engine: Render Claude Artifact Format', () => {
  const result = renderAdaptiveUI(sampleData, 'claude');
  assert.ok(result.includes('[!IMPORTANT]'));
  assert.ok(result.includes('Claude Artifacts'));
  assert.ok(result.includes('| **Portfolio Value** | $1,000,000 |'));
});

test('UI Engine: Render Codex Canvas LaTeX Format', () => {
  const result = renderAdaptiveUI(sampleData, 'codex');
  assert.ok(result.includes('# Portfolio Review'));
  assert.ok(result.includes('\\text{Sharpe}'));
});

test('UI Engine: Render Cursor Diff Format', () => {
  const result = renderAdaptiveUI(sampleData, 'cursor');
  assert.ok(result.includes('```diff'));
  assert.ok(result.includes('- Equity: 68%'));
});
