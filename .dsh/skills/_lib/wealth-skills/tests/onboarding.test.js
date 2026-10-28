import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCipIdentity, checkOnboardingStatus } from '../src/engines/onboarding.js';

test('Onboarding Engine: CIP Identity Check Pass', () => {
  const applicant = { name: 'Jane Doe', ssn: '123-45-6789', dob: '1990-05-15', address: '456 Elm St', ofacStatus: 'CLEAR' };
  const result = validateCipIdentity(applicant);

  assert.equal(result.cipPassed, true);
  assert.equal(result.verificationFlags.length, 0);
});

test('Onboarding Engine: Status Progress Tracker', () => {
  const record = { clientId: 'C1', cipPassed: true, w9Signed: true, custodialAgreementSigned: false, accountFunded: false };
  const result = checkOnboardingStatus(record);

  assert.equal(result.progressPercent, 50);
  assert.equal(result.isReadyForTrading, false);
  assert.equal(result.pendingSteps.length, 2);
});

test('Onboarding Engine: CIP Fails When OFAC Screening Was Never Run', () => {
  const applicant = { name: 'Jane Doe', ssn: '123-45-6789', dob: '1990-05-15', address: '456 Elm St' };
  const result = validateCipIdentity(applicant);

  assert.equal(result.cipPassed, false);
  assert.equal(result.ofacScreened, false);
  assert.equal(result.ofacStatus, 'NOT_SCREENED');
  assert.ok(result.verificationFlags.some(f => f.includes('NOT been screened')));
});

test('Onboarding Engine: CIP Fails On An Unverifiable Date Of Birth', () => {
  const applicant = { name: 'Jane Doe', ssn: '123-45-6789', dob: 'not-a-date', address: '456 Elm St', ofacStatus: 'CLEAR' };
  const result = validateCipIdentity(applicant);

  assert.equal(result.cipPassed, false);
  assert.equal(result.age, null);
});

test('Onboarding Engine: CIP Fails On An OFAC Hit And On A Missing Address', () => {
  const hit = validateCipIdentity({ name: 'Jane Doe', ssn: '123-45-6789', dob: '1990-05-15', address: '456 Elm St', ofacStatus: 'SDN_MATCH' });
  assert.equal(hit.cipPassed, false);
  assert.ok(hit.verificationFlags.some(f => f.includes('OFAC Watchlist Match')));

  const noAddress = validateCipIdentity({ name: 'Jane Doe', ssn: '123-45-6789', dob: '1990-05-15', ofacStatus: 'CLEAR' });
  assert.equal(noAddress.cipPassed, false);
});

import { identifyOnboardingGaps } from '../src/engines/onboarding.js';

const PERSON = { name: 'Jane Doe', dob: '1990-05-15', residentialAddress: '456 Elm St', taxId: '123-45-6789', occupation: 'Engineer', employer: 'Acme', annualIncome: 180000, netWorthExcludingResidence: 900000 };
const PROFILE = { age: 36, otherInvestments: '401k', financialSituation: 'stable', taxStatus: '24%', investmentObjectives: 'growth', investmentExperience: 'moderate', timeHorizonYears: 20, liquidityNeeds: 'low', riskTolerance: 'moderate' };

test('Onboarding Engine: A Complete Individual Application Has No Gaps', () => {
  const result = identifyOnboardingGaps({ accountType: 'individual', applicants: [PERSON], investmentProfile: PROFILE, trustedContact: { name: 'Sam', phone: '555-0100' }, acceptedBy: 'Principal', associatedPerson: 'Advisor', asOf: '2026-09-13' });

  assert.equal(result.readyToOpen, true);
  assert.equal(result.readyForRecommendations, true);
  assert.deepEqual(result.counts, { blocking: 0, beforeRecommendations: 0, recommended: 0 });
});

test('Onboarding Engine: Gaps Are Sorted By Consequence', () => {
  const result = identifyOnboardingGaps({ accountType: 'individual', applicants: [{ name: 'Jane Doe' }], asOf: '2026-09-13' });

  assert.equal(result.readyToOpen, false);
  assert.ok(['dob', 'residentialAddress', 'taxId'].every(f => result.blocking.some(g => g.field === `applicants[0].${f}`)));
  assert.equal(result.beforeRecommendations.filter(g => g.field.startsWith('investmentProfile.')).length, 9);
  // A trusted contact is a reasonable-efforts duty, not a condition for opening.
  assert.ok(result.recommended.some(g => g.field === 'trustedContact'));
  assert.ok(!result.blocking.some(g => g.field === 'trustedContact'));
});

test('Onboarding Engine: Specified Adults, IRAs, Minors, Entities And Trusts Get Their Own Requirements', () => {
  const senior = identifyOnboardingGaps({ accountType: 'ira', applicants: [{ ...PERSON, dob: '1955-01-01' }], investmentProfile: PROFILE, acceptedBy: 'P', associatedPerson: 'A', asOf: '2026-09-13' });
  assert.ok(senior.recommended.some(g => /specified adult/.test(g.requirement)));
  assert.ok(senior.recommended.some(g => g.field === 'beneficiaries'));

  const minor = identifyOnboardingGaps({ accountType: 'individual', applicants: [{ ...PERSON, dob: '2012-01-01' }], acceptedBy: 'P', asOf: '2026-09-13' });
  assert.ok(minor.blocking.some(g => g.requirement === 'Legal age'));

  const entity = identifyOnboardingGaps({ accountType: 'entity', institutional: true, acceptedBy: 'P', asOf: '2026-09-13',
    entity: { name: 'Webb Holdings LLC', principalAddress: '1 Main', taxId: '12-3456789', authorizedPersons: ['Marcus Webb'], beneficialOwners: [{ name: 'Marcus Webb', ownershipPct: 60 }] } });
  for (const field of ['entity.controlPerson', 'entity.beneficialOwnershipCertified', 'entity.beneficialOwners[0].dob']) {
    assert.ok(entity.blocking.some(g => g.field === field), `entity should require ${field}`);
  }

  const trust = identifyOnboardingGaps({ accountType: 'trust', applicants: [PERSON], trust: { trustees: [] }, acceptedBy: 'P', asOf: '2026-09-13' });
  assert.ok(trust.blocking.some(g => g.field === 'trust.trustees'));
  assert.ok(trust.blocking.some(g => g.field === 'trust.certificationOfTrust'));
});

test('Onboarding Engine: An Unknown Account Type Asks Which One', () => {
  assert.throws(() => identifyOnboardingGaps({ accountType: 'crypto' }), (err) => err.needsInput[0].field === 'accountType');
});
