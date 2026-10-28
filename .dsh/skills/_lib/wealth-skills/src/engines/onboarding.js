import { inputError } from './guidance.js';

/**
 * Wealth Onboarding Engine - Self-Contained CIP Identity & Onboarding Validator
 */

export function validateCipIdentity(applicantData) {
  // No default for ofacStatus: an absent field means the screen was never run, which is a
  // failure to verify, not a pass. Defaulting it to CLEAR asserted a sanctions check that
  // never happened. This function does not screen anything itself -- it records the result
  // of a screen the caller performed against an actual OFAC/SDN source.
  const { name, ssn, dob, address, ofacStatus } = applicantData || {};

  const flags = [];

  if (!name || !String(name).trim()) {
    flags.push('Applicant legal name missing.');
  }

  if (!ssn || ssn.replace(/[^0-9]/g, '').length !== 9) {
    flags.push('Invalid SSN length or format.');
  }

  if (!address || !String(address).trim()) {
    flags.push('Residential address missing; CIP requires a physical address of record.');
  }

  const ofacScreened = typeof ofacStatus === 'string' && ofacStatus.trim() !== '';
  if (!ofacScreened) {
    flags.push('OFAC/SDN screening result not supplied; applicant has NOT been screened.');
  } else if (ofacStatus.toUpperCase() !== 'CLEAR') {
    flags.push(`OFAC Watchlist Match Detected: ${ofacStatus}`);
  }

  const age = calculateAge(dob);
  if (age === null) {
    flags.push('Date of birth missing or unparseable; age could not be verified.');
  } else if (age < 18) {
    flags.push('Applicant is under 18; custodial account structure required.');
  }

  const isVerified = flags.length === 0;

  return {
    applicantName: name,
    age,
    cipPassed: isVerified,
    ofacScreened,
    ofacStatus: ofacScreened ? ofacStatus : 'NOT_SCREENED',
    verificationFlags: flags
  };
}

export function checkOnboardingStatus(record) {
  const { cipPassed, w9Signed, custodialAgreementSigned, accountFunded } = record;

  const totalSteps = 4;
  let completed = 0;
  if (cipPassed) completed++;
  if (w9Signed) completed++;
  if (custodialAgreementSigned) completed++;
  if (accountFunded) completed++;

  const progressPercent = (completed / totalSteps) * 100;
  const isReadyForTrading = completed === totalSteps;

  return {
    clientId: record.clientId,
    progressPercent,
    isReadyForTrading,
    pendingSteps: [
      !cipPassed ? 'CIP Identity Verification' : null,
      !w9Signed ? 'W-9 Tax Form Signature' : null,
      !custodialAgreementSigned ? 'Custodial Account Agreement' : null,
      !accountFunded ? 'Initial Deposit / ACAT Transfer' : null
    ].filter(Boolean)
  };
}

function calculateAge(dobString) {
  if (!dobString) return null;
  const birth = new Date(dobString);
  if (Number.isNaN(birth.getTime())) return null;

  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

// The nine FINRA 2111(a) investment profile factors, with the same field names checkSuitability reads.
const PROFILE_FACTORS = {
  age: 'Age',
  otherInvestments: 'Other investments',
  financialSituation: 'Financial situation and needs',
  taxStatus: 'Tax status',
  investmentObjectives: 'Investment objectives',
  investmentExperience: 'Investment experience',
  timeHorizonYears: 'Investment time horizon, in years',
  liquidityNeeds: 'Liquidity needs',
  riskTolerance: 'Risk tolerance'
};
const ACCOUNT_TYPES = ['individual', 'joint', 'ira', 'trust', 'entity'];

function ageOn(dob, asOf) {
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  let age = asOf.getUTCFullYear() - birth.getUTCFullYear();
  if (asOf.getUTCMonth() < birth.getUTCMonth() || (asOf.getUTCMonth() === birth.getUTCMonth() && asOf.getUTCDate() < birth.getUTCDate())) age--;
  return age;
}

// What stands between an application and an open, recommendable account, sorted by consequence:
// blocking (the account cannot open), beforeRecommendations (nothing can be recommended yet), and
// recommended (good practice or a reasonable-efforts duty).
export function identifyOnboardingGaps(application = {}) {
  const {
    accountType,
    institutional = false,
    applicants = [],
    entity = null,
    trust = null,
    trustedContact = null,
    investmentProfile = {},
    associatedPerson = null,
    acceptedBy = null,
    beneficiaries = [],
    asOf = null
  } = application;

  if (!ACCOUNT_TYPES.includes(accountType)) {
    throw inputError(`accountType must be one of ${ACCOUNT_TYPES.join(', ')}.`, [{
      field: 'accountType',
      question: `What kind of account is being opened (${ACCOUNT_TYPES.join(', ')})?`,
      why: 'The required records differ by account type.'
    }]);
  }

  const today = asOf ? new Date(asOf) : new Date();
  const blocking = [];
  const beforeRecommendations = [];
  const recommended = [];
  const add = (list, requirement, field, rule, detail = null) => list.push({ requirement, field, rule, detail });

  const checkPerson = (person, who, list) => {
    if (!person?.name) add(list, 'Legal name', `${who}.name`, 'CIP 31 CFR 1023.220; FINRA 4512(a)(1)');
    if (!person?.dob) add(list, 'Date of birth', `${who}.dob`, 'CIP 31 CFR 1023.220');
    if (!person?.residentialAddress) add(list, 'Residential address', `${who}.residentialAddress`, 'CIP 31 CFR 1023.220; FINRA 4512(a)(1)');
    if (!person?.taxId) add(list, 'Taxpayer identification number', `${who}.taxId`, 'CIP 31 CFR 1023.220');
  };

  if (accountType === 'entity') {
    if (!entity) {
      add(blocking, 'Entity details', 'entity', 'CIP 31 CFR 1023.220');
    } else {
      if (!entity.name) add(blocking, 'Entity legal name', 'entity.name', 'CIP 31 CFR 1023.220');
      if (!entity.principalAddress) add(blocking, 'Principal place of business address', 'entity.principalAddress', 'CIP 31 CFR 1023.220');
      if (!entity.taxId) add(blocking, 'Employer identification number', 'entity.taxId', 'CIP 31 CFR 1023.220');
      if (!entity.authorizedPersons?.length) add(blocking, 'Persons authorized to transact for the entity', 'entity.authorizedPersons', 'FINRA 4512(a)(1)');
      // FinCEN Customer Due Diligence rule: every individual owning 25% or more, plus one control person.
      if (!entity.controlPerson) add(blocking, 'Control person', 'entity.controlPerson', 'FinCEN CDD 31 CFR 1010.230');
      else checkPerson(entity.controlPerson, 'entity.controlPerson', blocking);
      if (!entity.beneficialOwnershipCertified) add(blocking, 'Beneficial ownership certification', 'entity.beneficialOwnershipCertified', 'FinCEN CDD 31 CFR 1010.230');
      (entity.beneficialOwners ?? []).forEach((owner, i) => {
        if (Number(owner.ownershipPct) >= 25) checkPerson(owner, `entity.beneficialOwners[${i}]`, blocking);
      });
    }
  } else {
    const expected = accountType === 'joint' ? 2 : 1;
    if (applicants.length < expected) {
      add(blocking, `${expected} applicant record${expected > 1 ? 's' : ''}`, 'applicants', 'CIP 31 CFR 1023.220', `${applicants.length} supplied.`);
    }
    applicants.forEach((person, i) => {
      const who = `applicants[${i}]`;
      checkPerson(person, who, blocking);
      const age = person?.dob ? ageOn(person.dob, today) : null;
      if (age !== null && age < 18 && accountType !== 'trust') {
        add(blocking, 'Legal age', `${who}.dob`, 'FINRA 4512(a)(1)', `Applicant is ${age}; a custodial account structure is required.`);
      }
      if (!institutional) {
        if (!person?.occupation || !person?.employer) add(beforeRecommendations, 'Occupation and employer', `${who}.occupation`, 'FINRA 4512(a)(2)');
        if (!Number.isFinite(person?.annualIncome)) add(beforeRecommendations, 'Annual income', `${who}.annualIncome`, 'FINRA 4512(a)(2)');
        if (!Number.isFinite(person?.netWorthExcludingResidence)) add(beforeRecommendations, 'Net worth excluding primary residence', `${who}.netWorthExcludingResidence`, 'FINRA 4512(a)(2)');
        // FINRA 2165: a customer 65 or older is a specified adult, for whom the trusted contact matters most.
        if (age !== null && age >= 65 && !trustedContact) {
          add(recommended, 'Trusted contact for a specified adult', 'trustedContact', 'FINRA 2165; FINRA 4512(a)(1)(F)', `Applicant is ${age}. A temporary hold for suspected exploitation relies on having a trusted contact to call.`);
        }
      }
    });
  }

  if (accountType === 'trust') {
    if (!trust?.trustees?.length) add(blocking, 'Trustee identification', 'trust.trustees', 'CIP 31 CFR 1023.220');
    else trust.trustees.forEach((trustee, i) => checkPerson(trustee, `trust.trustees[${i}]`, blocking));
    if (!trust?.certificationOfTrust) add(blocking, 'Certification of trust or trust agreement', 'trust.certificationOfTrust', 'Firm account-opening policy');
  }

  if (accountType === 'ira' && beneficiaries.length === 0) {
    add(recommended, 'Beneficiary designation', 'beneficiaries', 'IRA custodial agreement', 'Without one, the account passes under the custodial agreement or estate, which can accelerate distributions.');
  }

  if (!institutional) {
    if (!trustedContact) {
      if (!recommended.some(r => r.field === 'trustedContact')) {
        add(recommended, 'Trusted contact person', 'trustedContact', 'FINRA 4512(a)(1)(F)', 'Firms must make reasonable efforts to obtain one; the customer may decline.');
      }
    } else {
      if (!trustedContact.name || !(trustedContact.phone || trustedContact.email || trustedContact.address)) {
        add(recommended, 'Trusted contact name and contact details', 'trustedContact', 'FINRA 4512(a)(1)(F)');
      }
      if (Number.isFinite(trustedContact.age) && trustedContact.age < 18) {
        add(recommended, 'Trusted contact must be 18 or older', 'trustedContact.age', 'FINRA 4512(a)(1)(F)', `Named trusted contact is ${trustedContact.age}.`);
      }
    }

    // FINRA 2090 and 2111: the investment profile has to be known before anything is recommended.
    Object.entries(PROFILE_FACTORS).filter(([f]) => investmentProfile[f] === undefined || investmentProfile[f] === null || investmentProfile[f] === '')
      .forEach(([f, label]) => add(beforeRecommendations, `${label} (investment profile)`, `investmentProfile.${f}`, 'FINRA 2090; FINRA 2111(a)'));
  }

  if (!acceptedBy) add(blocking, 'Principal acceptance of the account', 'acceptedBy', 'FINRA 4512(a)(1)');
  if (!associatedPerson) add(recommended, 'Associated person responsible for the account', 'associatedPerson', 'FINRA 4512(a)(1)');

  return {
    accountType,
    institutional,
    readyToOpen: blocking.length === 0,
    readyForRecommendations: blocking.length === 0 && beforeRecommendations.length === 0,
    blocking,
    beforeRecommendations,
    recommended,
    counts: { blocking: blocking.length, beforeRecommendations: beforeRecommendations.length, recommended: recommended.length },
    note: 'Identifies missing records only. It does not verify identity documents, screen sanctions lists or assess whether information is true.'
  };
}
