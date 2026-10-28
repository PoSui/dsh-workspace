/**
 * Wealth Registration Engine - Investment adviser registration lookups on SEC IAPD compilation files.
 *
 * The SEC publishes the Investment Adviser Public Disclosure (IAPD) data as daily bulk XML files at
 * https://adviserinfo.sec.gov/compilation: SEC-registered and exempt reporting firms, state-registered
 * firms, and investment adviser representatives. This engine reads a file the caller has downloaded;
 * it does not fetch the 70-170 MB files itself, and it never queries FINRA BrokerCheck, whose terms of
 * use prohibit automated access and use with AI tools.
 *
 * Scope is investment adviser registration only. Broker-dealer registrations and FINRA-reported
 * disclosures are not in these files, so a lookup here never clears a registered representative.
 *
 * The record parsers are pure string functions and safe in a browser. `lookupAdviserRegistration`
 * streams a file from disk and loads Node's fs and zlib only when it is called.
 */

import { inputError } from './guidance.js';

export const IAPD_COMPILATION_URL = 'https://adviserinfo.sec.gov/compilation';
const FEED_ROOTS = {
  IAPDFirmSECReport: { kind: 'SEC_FIRM', record: 'Firm', label: 'SEC-registered and exempt reporting advisers' },
  IAPDFirmStateReport: { kind: 'STATE_FIRM', record: 'Firm', label: 'State-registered advisers' },
  IAPDIndividualReport: { kind: 'INDIVIDUAL', record: 'Indvl', label: 'Investment adviser representatives' }
};

// Form ADV Part 1A Item 11 disclosure questions, grouped as the form groups them.
const FIRM_DISCLOSURE_GROUPS = {
  Item11A: 'Criminal: felony charge or conviction',
  Item11B: 'Criminal: investment-related misdemeanor charge or conviction',
  Item11C: 'Regulatory action by the SEC or CFTC',
  Item11D: 'Regulatory action by another federal, state or foreign authority',
  Item11E: 'Action by a self-regulatory organization',
  Item11F: 'Registration or license revoked or suspended',
  Item11G: 'Proceeding currently pending',
  Item11H: 'Civil judicial action'
};

// Disclosure reporting page (DRP) flags on Form U4, as they appear on an individual's record.
const INDIVIDUAL_DISCLOSURE_FLAGS = {
  hasCriminal: 'Criminal',
  hasRegAction: 'Regulatory action',
  hasCivilJudc: 'Civil judicial action',
  hasCustComp: 'Customer complaint, arbitration or civil litigation',
  hasTermination: 'Employment termination',
  hasInvstgn: 'Investigation',
  hasBankrupt: 'Financial: bankruptcy',
  hasBond: 'Bond denial, payout or revocation',
  hasJudgment: 'Judgment or lien'
};

// Statuses under which an adviser may currently act. ACTIVE is an exempt reporting adviser, which
// reports to the SEC but is not registered.
const FIRM_REGISTERED_STATUSES = new Set(['APPROVED', 'APPROVED-120']);
const REP_ACTIVE_STATUSES = new Set(['APPROVED', 'APPROVED_RES', 'APP_PEND_IARCE', 'APPRNT', 'APRSLTS']);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code] ?? match;
  });
}

function attributes(tagText) {
  const out = {};
  if (!tagText) return out;
  for (const [, name, value] of tagText.matchAll(/([A-Za-z_][\w.-]*)="([^"]*)"/g)) out[name] = decodeEntities(value);
  return out;
}

// Attributes of the first <tag .../> or <tag ...> in xml, or null when absent.
function firstTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}(\\s[^>]*?)?/?>`));
  return match ? attributes(match[1]) : null;
}

function allTags(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}(\\s[^>]*?)?/?>`, 'g'))].map(match => attributes(match[1]));
}

// Content between <tag> and </tag>, for nested sections.
function section(xml, tag) {
  const start = xml.search(new RegExp(`<${tag}[\\s>]`));
  if (start === -1) return '';
  const end = xml.indexOf(`</${tag}>`, start);
  return end === -1 ? '' : xml.slice(start, end);
}

function sections(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, 'g'))].map(match => match[0]);
}

const clean = (value) => (value === undefined || value === '' ? null : value);

/** Parses one <Firm> element from an SEC or state firm compilation file. */
export function parseIapdFirmRecord(xml) {
  if (typeof xml !== 'string' || !xml.includes('<Info')) throw new Error('parseIapdFirmRecord expects the XML of one <Firm> element.');

  const info = firstTag(xml, 'Info') ?? {};
  const address = firstTag(xml, 'MainAddr') ?? {};
  const filing = firstTag(xml, 'Filing') ?? {};
  const secRegistration = firstTag(xml, 'Rgstn');
  const stateRegistrations = allTags(section(xml, 'StateRgstn'), 'Rgltr').map(r => ({ regulator: r.Cd, status: r.St, date: clean(r.Dt) }));

  const flagged = [];
  for (const [tag, category] of Object.entries(FIRM_DISCLOSURE_GROUPS)) {
    const answers = firstTag(xml, tag);
    const questions = Object.entries(answers ?? {}).filter(([, v]) => v === 'Y').map(([k]) => k);
    if (questions.length > 0) flagged.push({ category, questions });
  }
  const item11 = firstTag(xml, 'Item11');

  const registration = secRegistration
    ? { regulator: 'SEC', firmType: secRegistration.FirmType, status: secRegistration.St, date: clean(secRegistration.Dt) }
    : null;
  const registeredWith = [
    ...(registration && FIRM_REGISTERED_STATUSES.has(registration.status) && registration.firmType === 'Registered' ? ['SEC'] : []),
    ...stateRegistrations.filter(r => FIRM_REGISTERED_STATUSES.has(r.status)).map(r => r.regulator)
  ];

  return {
    type: 'firm',
    crd: info.FirmCrdNb ?? null,
    secFileNumber: clean(info.SECNb),
    businessName: clean(info.BusNm),
    legalName: clean(info.LegalNm),
    mainOffice: { city: clean(address.City), state: clean(address.State), country: clean(address.Cntry) },
    secRegistration: registration,
    exemptReportingAdviser: registration?.firmType === 'ERA',
    stateRegistrations,
    noticeFilings: allTags(section(xml, 'NoticeFiled'), 'States').map(s => ({ state: s.RgltrCd, status: s.St, date: clean(s.Dt) })),
    currentlyRegisteredWith: registeredWith,
    lastFilingDate: clean(filing.Dt),
    website: xml.match(/<WebAddr>([^<]*)<\/WebAddr>/)?.[1] ? decodeEntities(xml.match(/<WebAddr>([^<]*)<\/WebAddr>/)[1]) : null,
    disclosures: {
      anyReported: item11?.Q11 === 'Y' || flagged.length > 0,
      categories: flagged,
      source: 'Form ADV Part 1A Item 11'
    },
    iapdUrl: info.FirmCrdNb ? `https://adviserinfo.sec.gov/firm/summary/${info.FirmCrdNb}` : null
  };
}

/** Parses one <Indvl> element from the investment adviser representative compilation file. */
export function parseIapdIndividualRecord(xml) {
  if (typeof xml !== 'string' || !xml.includes('<Info')) throw new Error('parseIapdIndividualRecord expects the XML of one <Indvl> element.');

  const info = firstTag(xml, 'Info') ?? {};
  const fullName = (i) => [i.firstNm, i.midNm, i.lastNm, i.sufNm].filter(Boolean).join(' ') || null;

  const currentEmployers = sections(section(xml, 'CrntEmps'), 'CrntEmp').map(emp => {
    const org = firstTag(emp, 'CrntEmp') ?? {};
    return {
      firm: clean(org.orgNm),
      firmCrd: clean(org.orgPK),
      city: clean(org.city),
      state: clean(org.state),
      registrations: allTags(emp, 'CrntRgstn').map(r => ({ authority: r.regAuth, category: r.regCat, status: r.st, statusDate: clean(r.stDt) }))
    };
  });

  const drp = allTags(section(xml, 'DRPs'), 'DRP');
  const categories = Object.entries(INDIVIDUAL_DISCLOSURE_FLAGS)
    .filter(([flag]) => drp.some(d => d[flag] === 'Y'))
    .map(([, label]) => label);

  const activeRegistrations = currentEmployers.flatMap(e => e.registrations.filter(r => REP_ACTIVE_STATUSES.has(r.status)).map(r => r.authority));

  return {
    type: 'individual',
    crd: info.indvlPK ?? null,
    name: fullName(info),
    otherNames: allTags(section(xml, 'OthrNms'), 'OthrNm').map(fullName).filter(Boolean),
    activeAdviserRegistration: info.actvAGReg === 'Y',
    currentlyRegisteredWith: [...new Set(activeRegistrations)],
    currentEmployers,
    exams: allTags(section(xml, 'Exms'), 'Exm').map(e => ({ code: e.exmCd, name: clean(e.exmNm), date: clean(e.exmDt) })),
    designations: allTags(section(xml, 'Dsgntns'), 'Dsgntn').map(d => d.dsgntnNm).filter(Boolean),
    previousRegistrations: allTags(section(xml, 'PrevRgstns'), 'PrevRgstn').map(p => ({ firm: clean(p.orgNm), firmCrd: clean(p.orgPK), from: clean(p.regBeginDt), to: clean(p.regEndDt) })),
    disclosures: {
      anyReported: categories.length > 0,
      categories,
      source: 'Disclosure reporting page flags (Form U4 and U5)'
    },
    iapdUrl: info.indvlPK ? `https://adviserinfo.sec.gov/individual/summary/${info.indvlPK}` : null
  };
}

const LOOKUP_INPUTS = {
  feed: { field: 'feedPath', question: `Which IAPD compilation file should I search? Download today's from ${IAPD_COMPILATION_URL}: the SEC firm report, the state firm report, or the investment adviser representatives report.`, why: 'Lookups run on the official SEC bulk file on disk; nothing is scraped.' },
  query: { field: 'crd', question: 'What is the CRD number of the firm or individual, or the name to search for?', why: 'Records are matched by CRD, or by name when the CRD is unknown.' }
};

function parseDay(value) {
  if (value === null || value === undefined || value === '') return new Date(NaN);
  return new Date(value);
}

/**
 * Finds a firm or representative in an IAPD compilation file.
 *
 * @param {object} options
 * @param {string} options.feedPath  .xml, .xml.gz or .xml.zip from adviserinfo.sec.gov/compilation
 * @param {string} [options.crd]     exact CRD number (stops at the first match)
 * @param {string} [options.name]    case-insensitive name search across business, legal and personal names
 * @param {number} [options.limit]   maximum name matches (default 10)
 * @param {string} [options.asOf]    date used to judge how old the file is (default today)
 * @param {number} [options.maxAgeDays] a file older than this is flagged stale (default 7)
 */
export async function lookupAdviserRegistration({ feedPath, crd, name, limit = 10, asOf, maxAgeDays = 7 } = {}) {
  if (typeof feedPath !== 'string' || feedPath.trim() === '') throw inputError('An IAPD compilation file path is required.', [LOOKUP_INPUTS.feed]);
  const crdQuery = crd === undefined || crd === null ? '' : String(crd).trim();
  const nameQuery = typeof name === 'string' ? name.trim() : '';
  if (!crdQuery && !nameQuery) throw inputError('Provide a CRD number or a name to search for.', [LOOKUP_INPUTS.query]);
  if (crdQuery && !/^\d{1,10}$/.test(crdQuery)) throw new Error(`CRD numbers are digits only, got "${crdQuery}".`);
  if (!Number.isInteger(limit) || limit < 1) throw new Error('limit must be a positive whole number.');
  const asOfDate = asOf === undefined ? new Date() : parseDay(asOf);
  if (Number.isNaN(asOfDate.getTime())) throw new Error(`asOf must be a date such as 2026-09-13, got "${asOf}".`);

  const { feed, matches } = await scanCompilation(feedPath, { crd: crdQuery, name: nameQuery.toLowerCase(), limit });

  const generated = parseDay(feed.generatedOn);
  const ageDays = Number.isNaN(generated.getTime()) ? null : Math.floor((asOfDate - generated) / 86400000);
  const stale = ageDays === null || ageDays > maxAgeDays;
  const query = crdQuery ? `CRD ${crdQuery}` : `name "${nameQuery}"`;
  const warnings = [];
  if (stale) warnings.push(ageDays === null ? 'The file has no generation date.' : `The file was generated ${ageDays} days before ${asOfDate.toISOString().slice(0, 10)}; download a current one before relying on the result.`);
  if (matches.length === limit && nameQuery) warnings.push(`Stopped at ${limit} match${limit === 1 ? '' : 'es'}; there may be more. Narrow the name or raise the limit.`);

  return {
    query: { crd: crdQuery || null, name: nameQuery || null },
    feed: { ...feed, ageDays, stale },
    found: matches.length > 0,
    matchCount: matches.length,
    matches,
    dataSource: 'SEC_IAPD_COMPILATION',
    coverage: `${feed.label} only. Broker-dealer registrations and FINRA-reported disclosures are not in this file; check BrokerCheck by hand for registered representatives and dual registrants.`,
    message: matches.length > 0
      ? `Found ${matches.length} record${matches.length === 1 ? '' : 's'} for ${query} in the IAPD file of ${feed.label} dated ${feed.generatedOn}. Confirm on the IAPD page before relying on it.`
      : `No record for ${query} in the IAPD file of ${feed.label} dated ${feed.generatedOn}. That does not show the person or firm is unregistered: they may be in another IAPD file or registered only as a broker-dealer.`,
    warnings,
    requiresHumanReview: true
  };
}

async function scanCompilation(feedPath, { crd, name, limit }) {
  const { createReadStream } = await import('node:fs');
  const { access } = await import('node:fs/promises');
  const zlib = await import('node:zlib');

  try {
    await access(feedPath);
  } catch {
    throw inputError(`IAPD compilation file not found: ${feedPath}`, [LOOKUP_INPUTS.feed]);
  }

  const source = createReadStream(feedPath, { highWaterMark: 1 << 20 });
  const lower = feedPath.toLowerCase();
  const streams = [source];
  let stream = source;
  if (lower.endsWith('.gz')) {
    stream = source.pipe(zlib.createGunzip());
    streams.push(stream);
  } else if (lower.endsWith('.zip')) {
    const inflate = zlib.createInflateRaw();
    stream = zipFirstEntry(source, inflate);
    streams.push(stream);
  }

  let buffer = '';
  let decoder = null;
  let feed = null;
  let recordTag = null;
  const matches = [];

  const crdAttr = (tag) => (tag === 'Firm' ? `FirmCrdNb="${crd}"` : `indvlPK="${crd}"`);

  try {
    for await (const chunk of stream) {
      if (!decoder) {
        const prolog = chunk.subarray(0, 200).toString('latin1');
        decoder = new TextDecoder(/encoding="utf-8"/i.test(prolog) ? 'utf-8' : 'latin1');
      }
      buffer += decoder.decode(chunk, { stream: true });

      if (!feed) {
        const root = buffer.match(/<(IAPD\w+Report)(\s[^>]*)?>/);
        if (!root) {
          if (buffer.length > 4096) throw new Error('Not an IAPD compilation file: no IAPD report root element found.');
          continue;
        }
        const spec = FEED_ROOTS[root[1]];
        if (!spec) throw new Error(`Unrecognized IAPD report type ${root[1]}.`);
        feed = { kind: spec.kind, label: spec.label, generatedOn: attributes(root[2]).GenOn ?? null, file: feedPath.split(/[\\/]/).pop() };
        recordTag = spec.record;
      }

      const close = `</${recordTag}>`;
      let end;
      while ((end = buffer.indexOf(close)) !== -1) {
        const start = buffer.lastIndexOf(`<${recordTag}>`, end);
        const record = buffer.slice(start === -1 ? 0 : start, end + close.length);
        buffer = buffer.slice(end + close.length);

        if (crd ? record.includes(crdAttr(recordTag)) : infoMatchesName(record, name)) {
          matches.push(recordTag === 'Firm' ? parseIapdFirmRecord(record) : parseIapdIndividualRecord(record));
          if (crd || matches.length >= limit) return { feed, matches };
        }
      }
    }
  } finally {
    for (const s of streams) s.destroy();
  }

  if (!feed) throw new Error('Not an IAPD compilation file: no IAPD report root element found.');
  return { feed, matches };
}

function infoMatchesName(record, name) {
  const info = firstTag(record, 'Info') ?? {};
  const names = [info.BusNm, info.LegalNm, [info.firstNm, info.midNm, info.lastNm].filter(Boolean).join(' '), [info.firstNm, info.lastNm].filter(Boolean).join(' ')];
  return names.some(n => n && n.toLowerCase().includes(name));
}

// The representatives report ships as a single-entry .zip. Skip the local file header and inflate
// the entry's deflate stream; nothing after it (the central directory) is read.
function zipFirstEntry(source, inflate) {
  let header = Buffer.alloc(0);
  let started = false;

  source.on('data', (chunk) => {
    if (started) {
      if (!inflate.write(chunk)) source.pause();
      return;
    }
    header = Buffer.concat([header, chunk]);
    if (header.length < 30) return;
    if (header.readUInt32LE(0) !== 0x04034b50) {
      inflate.destroy(new Error('Not a zip file.'));
      return;
    }
    const method = header.readUInt16LE(8);
    if (method !== 8) {
      inflate.destroy(new Error(`Unsupported zip compression method ${method}; unzip the file and pass the .xml.`));
      return;
    }
    const dataStart = 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    if (header.length < dataStart) return;
    started = true;
    if (!inflate.write(header.subarray(dataStart))) source.pause();
  });
  inflate.on('drain', () => source.resume());
  source.on('end', () => inflate.end());
  source.on('error', (err) => inflate.destroy(err));
  return inflate;
}
