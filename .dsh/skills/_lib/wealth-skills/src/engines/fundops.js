/**
 * Wealth Fund Operations Engine - Ledger reconciliation, NAV tie-out, LP capital statement checks and
 * month-end close tracking.
 */

import { inputError } from './guidance.js';

const round2 = (x) => Math.round(x * 100) / 100;

function positions(records, label) {
  if (!Array.isArray(records)) throw new TypeError(`${label} must be an array of { account, security, quantity, marketValue }.`);
  const map = new Map();
  const duplicates = [];
  records.forEach((r, i) => {
    if (!r.account || !r.security) throw new Error(`${label}[${i}] needs account and security.`);
    if (!Number.isFinite(r.quantity) || !Number.isFinite(r.marketValue)) throw new Error(`${label}[${i}] needs numeric quantity and marketValue.`);
    const key = `${r.account}|${r.security}`;
    // Position files often split a holding across rows; they are summed but reported, since a
    // duplicate can also be a booking error.
    if (map.has(key)) {
      duplicates.push(key);
      const prior = map.get(key);
      map.set(key, { ...prior, quantity: prior.quantity + r.quantity, marketValue: prior.marketValue + r.marketValue });
    } else {
      map.set(key, { account: r.account, security: r.security, quantity: r.quantity, marketValue: r.marketValue });
    }
  });
  return { map, duplicates };
}

export function reconcileLedger(bookRecords, custodianRecords, { quantityTolerance = 0, valueTolerance = 0.01 } = {}) {
  const book = positions(bookRecords, 'bookRecords');
  const custodian = positions(custodianRecords, 'custodianRecords');
  const keys = [...new Set([...book.map.keys(), ...custodian.map.keys()])].sort();

  const breaks = [];
  let matched = 0;
  for (const key of keys) {
    const b = book.map.get(key);
    const c = custodian.map.get(key);
    const [account, security] = key.split('|');
    if (!c) { breaks.push({ account, security, type: 'MISSING_AT_CUSTODIAN', book: b, custodian: null, quantityDifference: b.quantity, valueDifference: round2(b.marketValue) }); continue; }
    if (!b) { breaks.push({ account, security, type: 'MISSING_IN_BOOK', book: null, custodian: c, quantityDifference: -c.quantity, valueDifference: round2(-c.marketValue) }); continue; }
    const quantityDifference = b.quantity - c.quantity;
    const valueDifference = round2(b.marketValue - c.marketValue);
    if (Math.abs(quantityDifference) > quantityTolerance) breaks.push({ account, security, type: 'QUANTITY_BREAK', book: b, custodian: c, quantityDifference, valueDifference });
    else if (Math.abs(valueDifference) > valueTolerance) breaks.push({ account, security, type: 'VALUE_BREAK', book: b, custodian: c, quantityDifference, valueDifference });
    else matched++;
  }

  const byType = breaks.reduce((acc, b) => ({ ...acc, [b.type]: (acc[b.type] ?? 0) + 1 }), {});
  return {
    positionsCompared: keys.length,
    matched,
    breaks,
    breakCounts: byType,
    netValueDifference: round2(breaks.reduce((sum, b) => sum + b.valueDifference, 0)),
    grossValueDifference: round2(breaks.reduce((sum, b) => sum + Math.abs(b.valueDifference), 0)),
    duplicateKeys: { book: book.duplicates, custodian: custodian.duplicates },
    reconciled: breaks.length === 0,
    note: 'Quantity breaks take precedence over value breaks for the same position; a value break with matching quantity usually means a pricing difference.'
  };
}

export function tieOutNav({ assets, liabilities = [], unitsOutstanding, reportedNav = null, reportedNavPerUnit = null, asOf = null, maxPriceAgeDays = null, tolerancePct = 0.01 } = {}) {
  if (!Array.isArray(assets) || assets.length === 0) throw new TypeError('assets must be a non-empty array of { name, value }.');
  if (!(Number.isFinite(unitsOutstanding) && unitsOutstanding > 0)) {
    throw inputError('unitsOutstanding must be a positive number.', [{
      field: 'unitsOutstanding', question: 'How many units or shares are outstanding at the valuation date?', why: 'NAV per unit divides by it.'
    }]);
  }
  for (const item of [...assets, ...liabilities]) {
    if (!item.name || !Number.isFinite(item.value)) throw new Error('Every asset and liability needs a name and a numeric value.');
  }

  const totalAssets = assets.reduce((sum, a) => sum + a.value, 0);
  const totalLiabilities = liabilities.reduce((sum, l) => sum + l.value, 0);
  const nav = totalAssets - totalLiabilities;
  const navPerUnit = nav / unitsOutstanding;

  const exceptions = [];
  let navVariancePct = null;
  if (reportedNav !== null) {
    navVariancePct = nav === 0 ? null : ((reportedNav - nav) / nav) * 100;
    if (navVariancePct === null || Math.abs(navVariancePct) > tolerancePct) {
      exceptions.push(`Reported NAV ${reportedNav} differs from computed ${round2(nav)} by ${round2(reportedNav - nav)} (${navVariancePct === null ? 'n/a' : navVariancePct.toFixed(4)}%), beyond the ${tolerancePct}% tolerance.`);
    }
  }
  if (reportedNavPerUnit !== null && Math.abs(reportedNavPerUnit - navPerUnit) > Math.abs(navPerUnit) * (tolerancePct / 100)) {
    exceptions.push(`Reported NAV per unit ${reportedNavPerUnit} differs from computed ${navPerUnit.toFixed(4)}.`);
  }

  // Valuation review focuses on hard-to-value and stale-priced holdings.
  const levelThree = assets.filter(a => a.level === 3);
  const levelThreeValue = levelThree.reduce((sum, a) => sum + a.value, 0);
  let stalePrices = [];
  if (maxPriceAgeDays !== null) {
    const asOfDate = asOf === null || asOf === undefined || asOf === '' ? null : new Date(asOf);
    if (!asOfDate || Number.isNaN(asOfDate.getTime())) throw new Error('asOf is required when maxPriceAgeDays is set.');
    stalePrices = assets.filter(a => a.priceDate).map(a => ({ name: a.name, priceDate: a.priceDate, ageDays: Math.round((asOfDate - new Date(a.priceDate)) / 86400000) }))
      .filter(a => a.ageDays > maxPriceAgeDays);
    stalePrices.forEach(a => exceptions.push(`${a.name} was last priced ${a.ageDays} days before ${asOf}.`));
  }

  return {
    totalAssets: round2(totalAssets),
    totalLiabilities: round2(totalLiabilities),
    computedNav: round2(nav),
    computedNavPerUnit: parseFloat(navPerUnit.toFixed(6)),
    reportedNav,
    navVariance: reportedNav === null ? null : round2(reportedNav - nav),
    navVariancePct: navVariancePct === null ? null : parseFloat(navVariancePct.toFixed(4)),
    levelThree: { count: levelThree.length, value: round2(levelThreeValue), shareOfNavPct: nav === 0 ? null : round2((levelThreeValue / nav) * 100) },
    stalePrices,
    exceptions,
    tiesOut: exceptions.length === 0,
    requiresHumanApproval: true
  };
}

const STATEMENT_FIELDS = ['beginningBalance', 'contributions', 'distributions', 'incomeAllocation', 'realizedGainLoss', 'unrealizedGainLoss', 'managementFees', 'performanceAllocation', 'otherExpenses', 'endingBalance'];

export function checkLpCapitalStatement(statement = {}, { tolerance = 1 } = {}) {
  const missing = STATEMENT_FIELDS.filter(f => !Number.isFinite(statement[f]));
  if (missing.length > 0) {
    throw inputError(`Statement is missing ${missing.join(', ')}.`, missing.map(field => ({
      field, question: `What is the ${field.replace(/([A-Z])/g, ' $1').toLowerCase()} on the statement (0 if none)?`, why: 'The capital account roll-forward needs every line.'
    })));
  }

  const s = statement;
  const computedEnding = s.beginningBalance + s.contributions - s.distributions + s.incomeAllocation + s.realizedGainLoss
    + s.unrealizedGainLoss - s.managementFees - s.performanceAllocation - s.otherExpenses;
  const difference = s.endingBalance - computedEnding;

  const exceptions = [];
  if (Math.abs(difference) > tolerance) exceptions.push(`Ending balance ${s.endingBalance} does not roll forward: computed ${round2(computedEnding)}, difference ${round2(difference)}.`);
  for (const field of ['contributions', 'distributions', 'managementFees', 'performanceAllocation', 'otherExpenses']) {
    if (s[field] < 0) exceptions.push(`${field} is negative; enter it as a positive amount so the roll-forward sign is unambiguous.`);
  }

  let unfundedCommitment = null;
  if (Number.isFinite(s.commitment) && Number.isFinite(s.contributionsToDate)) {
    unfundedCommitment = round2(s.commitment - s.contributionsToDate);
    if (unfundedCommitment < 0) exceptions.push(`Contributions to date exceed the ${s.commitment} commitment by ${-unfundedCommitment}.`);
  }

  let impliedAnnualFeeRatePct = null;
  if (Number.isFinite(s.commitment) && s.commitment > 0 && Number.isFinite(s.periodFractionOfYear) && s.periodFractionOfYear > 0) {
    impliedAnnualFeeRatePct = round2((s.managementFees / s.periodFractionOfYear / s.commitment) * 100);
    if (Number.isFinite(s.expectedAnnualFeeRatePct) && Math.abs(impliedAnnualFeeRatePct - s.expectedAnnualFeeRatePct) > 0.05) {
      exceptions.push(`Management fees imply ${impliedAnnualFeeRatePct}% a year on commitment, against the ${s.expectedAnnualFeeRatePct}% in the fund terms.`);
    }
  }

  return {
    computedEndingBalance: round2(computedEnding),
    reportedEndingBalance: s.endingBalance,
    difference: round2(difference),
    rollsForward: Math.abs(difference) <= tolerance,
    unfundedCommitment,
    impliedAnnualFeeRatePct,
    exceptions,
    passed: exceptions.length === 0,
    methodology: 'Beginning + contributions - distributions + income + realized + unrealized - management fees - performance allocation - other expenses = ending'
  };
}

const TASK_STATUSES = ['not_started', 'in_progress', 'blocked', 'done'];

export function trackCloseChecklist(tasks, { asOf } = {}) {
  if (!Array.isArray(tasks) || tasks.length === 0) throw new TypeError('tasks must be a non-empty array of { id, name, owner, due, status, dependsOn }.');
  // new Date(null) is 1970-01-01, a valid date, so a missing value has to be caught before parsing.
  const asOfDate = asOf === null || asOf === undefined || asOf === '' ? null : new Date(asOf);
  if (!asOfDate || Number.isNaN(asOfDate.getTime())) {
    throw inputError('asOf is required.', [{ field: 'asOf', question: 'What date should the close status be measured at?', why: 'Overdue depends on it.' }]);
  }

  const byId = new Map();
  for (const t of tasks) {
    if (!t.id || !t.name) throw new Error('Every task needs an id and a name.');
    if (byId.has(t.id)) throw new Error(`Duplicate task id ${t.id}.`);
    if (!TASK_STATUSES.includes(t.status)) throw new Error(`Task ${t.id} status must be one of ${TASK_STATUSES.join(', ')}.`);
    byId.set(t.id, { ...t, dependsOn: t.dependsOn ?? [] });
  }
  for (const t of byId.values()) {
    for (const dep of t.dependsOn) if (!byId.has(dep)) throw new Error(`Task ${t.id} depends on unknown task ${dep}.`);
  }

  // A dependency cycle means the close can never finish, so it is an error rather than a warning.
  const visiting = new Set();
  const visited = new Set();
  const visit = (id, path) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Dependency cycle: ${[...path, id].join(' -> ')}.`);
    visiting.add(id);
    byId.get(id).dependsOn.forEach(dep => visit(dep, [...path, id]));
    visiting.delete(id);
    visited.add(id);
  };
  byId.forEach((_, id) => visit(id, []));

  const done = (id) => byId.get(id).status === 'done';
  const summary = TASK_STATUSES.reduce((acc, s) => ({ ...acc, [s]: 0 }), {});
  const overdue = [];
  const waitingOnDependencies = [];
  const readyToStart = [];

  for (const t of byId.values()) {
    summary[t.status]++;
    const openDeps = t.dependsOn.filter(dep => !done(dep));
    if (t.status !== 'done' && t.due && new Date(t.due) < asOfDate) overdue.push({ id: t.id, name: t.name, owner: t.owner ?? null, due: t.due, status: t.status });
    if (t.status !== 'done' && openDeps.length > 0) waitingOnDependencies.push({ id: t.id, name: t.name, waitingOn: openDeps });
    if (t.status === 'not_started' && openDeps.length === 0) readyToStart.push({ id: t.id, name: t.name, owner: t.owner ?? null });
  }

  return {
    asOf: asOfDate.toISOString().slice(0, 10),
    totalTasks: byId.size,
    percentComplete: round2((summary.done / byId.size) * 100),
    statusCounts: summary,
    overdue,
    blocked: [...byId.values()].filter(t => t.status === 'blocked').map(t => ({ id: t.id, name: t.name, owner: t.owner ?? null })),
    waitingOnDependencies,
    readyToStart,
    closeComplete: summary.done === byId.size
  };
}
