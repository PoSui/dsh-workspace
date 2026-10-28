import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

// Every CLI example in the docs is run as written. A journey that quotes a command which no longer
// works, or no longer exists, fails here rather than in front of a reader.
const root = fileURLToPath(new URL('..', import.meta.url));
const DOCS = ['README.md', 'AGENTS.md', ...fs.readdirSync(path.join(root, 'skills')).map(pack => path.join('skills', pack, 'SKILL.md')).filter(file => fs.existsSync(path.join(root, file)))];
const NOT_CLI = /^\s*(git|npm|cd|cp|curl|export)\b/m;

function cliBlocks(file) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  return [...text.matchAll(/```bash\n([\s\S]*?)```/g)]
    .map(match => match[1])
    .filter(block => block.includes('node bin/wealth-skills.js') && !NOT_CLI.test(block));
}

test('Docs: Every Quoted CLI Command Runs Successfully', () => {
  let commands = 0;
  for (const file of DOCS) {
    for (const block of cliBlocks(file)) {
      commands += (block.match(/^node bin\/wealth-skills\.js/gm) ?? []).length;
      const run = spawnSync('bash', ['-e', '-c', block.replace(/\s+#[^'"\n]*$/gm, '') + '\n'], { cwd: root, encoding: 'utf8', env: { ...process.env, WEALTH_SKILLS_IAPD_FEED: '', IBKR_ACCOUNT: 'U1234567', VTI_CONID: '12345' } });
      assert.equal(run.status, 0, `${file}: a quoted command failed\n${block}\n${run.stderr}`);
    }
  }
  assert.ok(commands >= 60, `expected the docs to quote at least 60 commands, found ${commands}`);
});

test('Docs: README Journey Figures Match The Engines', () => {
  const cli = (...args) => JSON.parse(spawnSync(process.execPath, ['bin/wealth-skills.js', ...args], { cwd: root, encoding: 'utf8' }).stdout);
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

  const quoted = [
    ['$2,660', cli('planning', 'niit', '--magi', '320000', '--nii', '95000').netInvestmentIncomeTax === 2660],
    ['-5.56%', cli('portfolio', 'twr', '--valuations', '[{"date":"2025-12-31","value":1000000},{"date":"2026-06-30","value":850000,"cashFlow":500000},{"date":"2026-12-31","value":1500000}]').cumulativeReturnPercent === -5.5556],
    ['$138.11 a share', cli('research', 'dcf', '--cash-flows', '[108,116,124,131,138]', '--discount', '0.085', '--growth', '0.025', '--net-debt', '-50', '--shares', '15.2').valuePerShare === 138.11],
    ['$109.20 a unit', cli('fundops', 'nav-tieout', '--fund', '{"assets":[{"name":"Listed ETFs","value":4740000,"priceDate":"2026-09-30"},{"name":"ACME preferred","value":500000,"level":3,"priceDate":"2026-06-30"},{"name":"Cash","value":260000}],"liabilities":[{"name":"Accrued management fee","value":27500},{"name":"Audit accrual","value":12500}],"unitsOutstanding":50000,"reportedNav":5460000,"asOf":"2026-09-30","maxPriceAgeDays":45}').computedNavPerUnit === 109.2]
  ];
  for (const [phrase, holds] of quoted) {
    assert.ok(readme.includes(phrase), `README no longer quotes ${phrase}`);
    assert.ok(holds, `the engine no longer produces the README figure ${phrase}`);
  }
});
