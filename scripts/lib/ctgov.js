// ClinicalTrials.gov API v2. See docs/spec.md, "Where the data comes from".

import { getJson } from './http.js';

const BASE = 'https://clinicaltrials.gov/api/v2/studies';

export const NCT_RE = /^NCT\d{8}$/;

export const studyUrl = (nct) => `https://clinicaltrials.gov/study/${nct}`;

// The search from the spec. It found 112 industry lens trials on 2026-11-19.
export const SEARCH = {
  terms: ['intraocular lens', 'IOL', 'accommodating lens', 'EDOF', 'trifocal'],
  cond: 'cataract OR presbyopia OR aphakia',
  startFrom: '2021-01-01',
};

const FIELDS = [
  'NCTId', 'BriefTitle', 'OverallStatus', 'LeadSponsorName', 'LeadSponsorClass',
  'StartDate', 'PrimaryCompletionDate', 'CompletionDate', 'EnrollmentCount',
  'EnrollmentType', 'LocationCountry', 'Phase', 'StudyType', 'LastUpdatePostDate',
].join(',');

const ID_CHUNK = 100;

/** Flatten one API study into the fields we use. */
export function toTrial(study) {
  const p = study.protocolSection ?? {};
  const status = p.statusModule ?? {};
  const sponsor = p.sponsorCollaboratorsModule?.leadSponsor ?? {};
  const design = p.designModule ?? {};
  const countries = (p.contactsLocationsModule?.locations ?? [])
    .map((loc) => loc.country)
    .filter(Boolean);
  return {
    nct: p.identificationModule?.nctId ?? null,
    title: p.identificationModule?.briefTitle ?? null,
    status: status.overallStatus ?? null,
    sponsor: sponsor.name ?? null,
    sponsor_class: sponsor.class ?? null,
    study_type: design.studyType ?? null,
    phases: design.phases ?? [],
    start_date: status.startDateStruct?.date ?? null,
    primary_completion_date: status.primaryCompletionDateStruct?.date ?? null,
    completion_date: status.completionDateStruct?.date ?? null,
    enrollment: design.enrollmentInfo?.count ?? null,
    enrollment_type: design.enrollmentInfo?.type ?? null,
    countries: [...new Set(countries)].sort(),
    last_update: status.lastUpdatePostDateStruct?.date ?? null,
  };
}

async function fetchAll(params, opts) {
  const studies = [];
  let pageToken;
  do {
    const url = new URL(BASE);
    for (const [k, v] of Object.entries({ ...params, fields: FIELDS, pageSize: '1000' })) {
      url.searchParams.set(k, v);
    }
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const { body } = await getJson(url, opts);
    studies.push(...(body.studies ?? []));
    pageToken = body.nextPageToken;
  } while (pageToken);
  return studies.map(toTrial);
}

/**
 * Look up trials by NCT number.
 * Returns a Map with only the numbers the API really has.
 * Trap: the API pads a short number ("NCT123" gives NCT00000123), so we
 * keep exact matches only, and callers must check the format first.
 */
export async function getTrialsByIds(ids, opts = {}) {
  const wanted = [...new Set(ids)].filter((id) => NCT_RE.test(id)).sort();
  const found = new Map();
  for (let i = 0; i < wanted.length; i += ID_CHUNK) {
    const chunk = wanted.slice(i, i + ID_CHUNK);
    for (const trial of await fetchAll({ 'filter.ids': chunk.join(',') }, opts)) {
      if (chunk.includes(trial.nct)) found.set(trial.nct, trial);
    }
  }
  return found;
}

/** Run the spec search. Keep industry, interventional trials only. */
export async function searchLensTrials(opts = {}) {
  const found = new Map();
  for (const term of SEARCH.terms) {
    const trials = await fetchAll({
      'query.term': term,
      'query.cond': SEARCH.cond,
      'filter.advanced': `AREA[StartDate]RANGE[${SEARCH.startFrom},MAX]`,
    }, opts);
    for (const t of trials) {
      if (t.sponsor_class === 'INDUSTRY' && t.study_type === 'INTERVENTIONAL') found.set(t.nct, t);
    }
  }
  return found;
}
