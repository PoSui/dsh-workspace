import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { lookupAdviserRegistration, parseIapdFirmRecord, parseIapdIndividualRecord } from '../src/engines/registration.js';

// Fixtures are fictitious records written to the published IAPD compilation schemas.
const FIXTURES = fileURLToPath(new URL('./fixtures/iapd/', import.meta.url));
const SEC = path.join(FIXTURES, 'sec-firms.xml');
const STATE = path.join(FIXTURES, 'state-firms.xml');
const REPS = path.join(FIXTURES, 'representatives.xml');
const AS_OF = '2026-09-13';

const recordOf = (file, tag, index = 0) => {
  const xml = fs.readFileSync(file, 'latin1');
  return xml.split(`</${tag}>`)[index] + `</${tag}>`;
};

// A minimal single-entry deflate zip, the way the SEC ships the representatives report.
function writeZip(source, target) {
  const data = fs.readFileSync(source);
  const deflated = zlib.deflateRawSync(data);
  const name = Buffer.from(path.basename(source));
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(deflated.length, 18); local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(deflated.length, 20); central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(30 + name.length + deflated.length, 16);

  fs.writeFileSync(target, Buffer.concat([local, name, deflated, central, name, end]));
}

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

test('Registration: An SEC-Registered Firm Parses With Notice Filings And No Disclosures', () => {
  const firm = parseIapdFirmRecord(recordOf(SEC, 'Firm', 0));

  assert.equal(firm.crd, '900001');
  assert.equal(firm.secFileNumber, '801-900001');
  assert.deepEqual(firm.secRegistration, { regulator: 'SEC', firmType: 'Registered', status: 'APPROVED', date: '2019-03-01' });
  assert.deepEqual(firm.currentlyRegisteredWith, ['SEC']);
  assert.deepEqual(firm.noticeFilings.map(n => n.state), ['NY', 'NJ']);
  assert.equal(firm.exemptReportingAdviser, false);
  assert.equal(firm.disclosures.anyReported, false);
  assert.equal(firm.website, 'HTTPS://WWW.EXAMPLE.COM');
  assert.equal(firm.iapdUrl, 'https://adviserinfo.sec.gov/firm/summary/900001');
});

test('Registration: An Exempt Reporting Adviser Is Not Counted As Registered, And Its Item 11 Answers Are Grouped', () => {
  const firm = parseIapdFirmRecord(recordOf(SEC, 'Firm', 1));

  assert.equal(firm.businessName, 'SAMPLE RIDGE CAPITAL & CO', 'XML entities are decoded');
  assert.equal(firm.exemptReportingAdviser, true);
  assert.deepEqual(firm.currentlyRegisteredWith, []);
  assert.equal(firm.disclosures.anyReported, true);
  assert.deepEqual(firm.disclosures.categories, [
    { category: 'Regulatory action by the SEC or CFTC', questions: ['Q11C3', 'Q11C5'] },
    { category: 'Action by a self-regulatory organization', questions: ['Q11E2'] }
  ]);
});

test('Registration: A State Firm Lists Only Approved State Registrations As Current', () => {
  const firm = parseIapdFirmRecord(recordOf(STATE, 'Firm', 0));

  assert.equal(firm.secRegistration, null);
  assert.deepEqual(firm.stateRegistrations.map(r => `${r.regulator}:${r.status}`), ['MI:APPROVED', 'OH:TERMINATED']);
  assert.deepEqual(firm.currentlyRegisteredWith, ['MI']);
});

test('Registration: A Representative Parses Employers, Exams, Designations And Disclosure Flags', () => {
  const active = parseIapdIndividualRecord(recordOf(REPS, 'Indvl', 0));
  assert.equal(active.name, 'ALEX Q EXAMPLE');
  assert.equal(active.activeAdviserRegistration, true);
  assert.deepEqual(active.currentlyRegisteredWith, ['NY', 'NJ']);
  assert.equal(active.currentEmployers[0].firmCrd, '900001');
  assert.deepEqual(active.exams.map(e => e.code), ['S65']);
  assert.deepEqual(active.designations, ['CERTIFIED FINANCIAL PLANNER']);
  assert.equal(active.disclosures.anyReported, false);

  const inactive = parseIapdIndividualRecord(recordOf(REPS, 'Indvl', 1));
  assert.equal(inactive.activeAdviserRegistration, false);
  assert.deepEqual(inactive.currentlyRegisteredWith, [], 'a CE-inactive registration is not current');
  assert.deepEqual(inactive.otherNames, ['JORDAN SAMPLE-TEST']);
  assert.deepEqual(inactive.disclosures.categories, ['Customer complaint, arbitration or civil litigation', 'Employment termination']);
  assert.equal(inactive.previousRegistrations[0].to, '2021-12-31');
});

test('Registration: The Parsers Reject Anything That Is Not A Record', () => {
  assert.throws(() => parseIapdFirmRecord('<Firm></Firm>'), /one <Firm> element/);
  assert.throws(() => parseIapdIndividualRecord(null), /one <Indvl> element/);
});

test('Registration: A CRD Lookup Finds The Firm And Reports The File It Came From', async () => {
  const result = await lookupAdviserRegistration({ feedPath: SEC, crd: '900003', asOf: AS_OF });

  assert.equal(result.found, true);
  assert.equal(result.matchCount, 1);
  assert.equal(result.matches[0].businessName, 'PLACEHOLDER CAPITAL PARTNERS');
  assert.deepEqual(result.matches[0].currentlyRegisteredWith, ['SEC'], 'APPROVED-120 is a registration');
  assert.equal(result.feed.kind, 'SEC_FIRM');
  assert.equal(result.feed.generatedOn, '2026-09-13');
  assert.equal(result.feed.stale, false);
  assert.equal(result.dataSource, 'SEC_IAPD_COMPILATION');
  assert.equal(result.requiresHumanReview, true);
  assert.match(result.coverage, /BrokerCheck by hand/);
});

test('Registration: A CRD Is Matched Exactly, Not As A Prefix', async () => {
  const result = await lookupAdviserRegistration({ feedPath: SEC, crd: '90000', asOf: AS_OF });
  assert.equal(result.found, false);
});

test('Registration: A Miss Never Claims The Person Or Firm Is Unregistered', async () => {
  const result = await lookupAdviserRegistration({ feedPath: SEC, crd: '123', asOf: AS_OF });

  assert.equal(result.found, false);
  assert.match(result.message, /does not show the person or firm is unregistered/);
});

test('Registration: A Name Search Is Case-Insensitive And Honours The Limit', async () => {
  const all = await lookupAdviserRegistration({ feedPath: SEC, name: 'capital', asOf: AS_OF });
  assert.deepEqual(all.matches.map(m => m.crd), ['900002', '900003']);
  assert.deepEqual(all.warnings, []);

  const limited = await lookupAdviserRegistration({ feedPath: SEC, name: 'CAPITAL', limit: 1, asOf: AS_OF });
  assert.equal(limited.matchCount, 1);
  assert.match(limited.warnings[0], /Stopped at 1 match/);

  const person = await lookupAdviserRegistration({ feedPath: REPS, name: 'alex example', asOf: AS_OF });
  assert.equal(person.matches[0].crd, '9000001');
  assert.equal(person.feed.kind, 'INDIVIDUAL');
});

test('Registration: An Old File Is Flagged Stale', async () => {
  const result = await lookupAdviserRegistration({ feedPath: STATE, crd: '900101', asOf: '2026-10-13' });

  assert.equal(result.feed.ageDays, 30);
  assert.equal(result.feed.stale, true);
  assert.match(result.warnings[0], /30 days/);
});

test('Registration: Gzip And Zip Files Read The Same As Plain XML', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iapd-'));
  try {
    const gz = path.join(dir, 'representatives.xml.gz');
    fs.writeFileSync(gz, zlib.gzipSync(fs.readFileSync(REPS)));
    const zip = path.join(dir, 'representatives.xml.zip');
    writeZip(REPS, zip);

    for (const feedPath of [gz, zip]) {
      const result = await lookupAdviserRegistration({ feedPath, crd: '9000002', asOf: AS_OF });
      assert.equal(result.found, true, feedPath);
      assert.deepEqual(result.matches[0], (await lookupAdviserRegistration({ feedPath: REPS, crd: '9000002', asOf: AS_OF })).matches[0]);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Registration: Missing Inputs Come Back As Questions', async () => {
  await assert.rejects(lookupAdviserRegistration({ crd: '900001' }), (err) => err.needsInput[0].field === 'feedPath' && /adviserinfo\.sec\.gov\/compilation/.test(err.needsInput[0].question));
  await assert.rejects(lookupAdviserRegistration({ feedPath: SEC }), (err) => err.needsInput[0].field === 'crd');
  await assert.rejects(lookupAdviserRegistration({ feedPath: path.join(FIXTURES, 'nope.xml'), crd: '1' }), (err) => /not found/.test(err.message) && err.needsInput.length === 1);
});

test('Registration: Bad Queries And Non-IAPD Files Fail Closed', async () => {
  await assert.rejects(lookupAdviserRegistration({ feedPath: SEC, crd: 'abc' }), /digits only/);
  await assert.rejects(lookupAdviserRegistration({ feedPath: SEC, crd: '1', limit: 0 }), /limit/);
  await assert.rejects(lookupAdviserRegistration({ feedPath: SEC, crd: '1', asOf: null }), /asOf must be a date/);
  await assert.rejects(lookupAdviserRegistration({ feedPath: fileURLToPath(new URL('../package.json', import.meta.url)), crd: '1' }), /Not an IAPD compilation file/);
});

test('Registration: The Engine Never Contacts FINRA BrokerCheck', () => {
  // BrokerCheck terms of use prohibit automated access and use with AI tools.
  const source = fs.readFileSync(new URL('../src/engines/registration.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /fetch\(|https?:\/\/[\w.]*brokercheck/i);
});
