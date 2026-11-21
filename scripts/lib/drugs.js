// openFDA drug label API. Used by rule 5: the page says that no drug is
// approved to treat a cataract, and the build checks that this is still true.

import { getJson } from './http.js';

const BASE = 'https://api.fda.gov/drug/label.json';
const PAGE = 1000;

// "Cataract" in this phrase is about surgery, not a drug that treats a
// cataract. Example: "for inflammation after cataract surgery". Keep this
// narrow: a miss here fails the build, and a person then reads the label.
// That is safer than a wide pattern that could hide a real approval.
const SURGERY_CONTEXT =
  /cataract[\s-]*(?:surgery|surgeries|surgical|extraction|removal|operation|procedure)s?/gi;

/** True if the text still names "cataract" once the surgery phrases are gone. */
export function treatsCataract(text) {
  return /cataract/i.test(String(text ?? '').replace(SURGERY_CONTEXT, ' '));
}

/**
 * True for a label of an FDA-approved drug: it has an NDA, ANDA or BLA number.
 * Trap: the label API also holds unapproved products (for example
 * homeopathic drops whose label says "for cataract"). They have no number.
 */
export function isApprovedLabel(label) {
  const numbers = label?.openfda?.application_number ?? [];
  return numbers.some((n) => /^(?:NDA|ANDA|BLA)\d+$/.test(n));
}

/** Approved labels whose indications may say "treats a cataract". */
export function findApprovedCataractDrugs(labels) {
  return labels
    .filter((l) => isApprovedLabel(l) && treatsCataract((l.indications_and_usage ?? []).join(' ')))
    .map((l) => ({
      id: l.id ?? null,
      name: l.openfda?.brand_name?.[0] ?? l.openfda?.generic_name?.[0] ?? null,
      application: l.openfda.application_number.join(', '),
    }));
}

/** All drug labels whose indications name "cataract". */
export async function searchCataractLabels(opts = {}) {
  const labels = [];
  for (let skip = 0; ; skip += PAGE) {
    const url = new URL(BASE);
    url.searchParams.set('search', 'indications_and_usage:cataract');
    url.searchParams.set('limit', String(PAGE));
    url.searchParams.set('skip', String(skip));
    const key = opts.apiKey ?? process.env.OPENFDA_API_KEY;
    if (key) url.searchParams.set('api_key', key);
    // openFDA answers 404 when nothing matches.
    const { status, body } = await getJson(url, { ...opts, okStatus: [404] });
    if (status === 404) {
      if (body?.error?.code === 'NOT_FOUND') break;
      throw new Error(`${url.host}${url.pathname}: HTTP 404`);
    }
    labels.push(...(body.results ?? []));
    if (skip + PAGE >= (body.meta?.results?.total ?? 0)) break;
  }
  return labels;
}
