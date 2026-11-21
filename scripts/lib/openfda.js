// openFDA device PMA API. See docs/spec.md, "Where the data comes from".

import { getJson } from './http.js';

const BASE = 'https://api.fda.gov/device/pma.json';
const PAGE = 1000;
const CLAUSE_CHUNK = 20;

export const PMA_RE = /^P\d{6}$/;
export const SUPPLEMENT_RE = /^S\d{3}$/;

// Product codes seen for lenses. Codes are not used in a strict way, so the
// refresh also searches by name.
export const LENS_PRODUCT_CODES = ['HQL', 'MFK', 'POE', 'MJP', 'PZK', 'NAA'];

// The refresh reports lens approvals from this date on.
export const SEARCH = { decidedFrom: '2021-01-01' };

/** "P980040 S176" for a supplement, "P160055" for an original PMA. */
export const recordKey = (pma, supplement) => (supplement ? `${pma} ${supplement}` : pma);

/** A link to the openFDA record (JSON). A person can open it in a browser. */
export function recordUrl(pma, supplement) {
  const url = new URL(BASE);
  url.searchParams.set('search', `pma_number:${pma} AND supplement_number:${supplement || '""'}`);
  return url.toString();
}

/**
 * True for an approval that can be a new lens: an original PMA, or a
 * supplement for a design or labeling change. Most supplements are
 * paperwork (shelf life, factory moves).
 * @param {ReturnType<typeof toRecord>} r
 */
export function isLensApproval(r) {
  if (r.decision_code !== 'APPR' || r.advisory_committee !== 'OP') return false;
  if (!r.supplement) return true;
  const reason = r.supplement_reason ?? '';
  return reason.startsWith('Change Design') || reason.startsWith('Labeling Change');
}

/** Only the fields we use. */
export function toRecord(r) {
  return {
    pma: r.pma_number,
    supplement: r.supplement_number || null,
    trade_name: r.trade_name ?? null,
    applicant: r.applicant ?? null,
    decision_date: r.decision_date ?? null,
    decision_code: r.decision_code ?? null,
    advisory_committee: r.advisory_committee ?? null,
    product_code: r.product_code ?? null,
    supplement_reason: r.supplement_reason || null,
  };
}

async function search(query, opts) {
  const results = [];
  for (let skip = 0; ; skip += PAGE) {
    const url = new URL(BASE);
    url.searchParams.set('search', query);
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
    results.push(...(body.results ?? []).map(toRecord));
    if (skip + PAGE >= (body.meta?.results?.total ?? 0)) break;
  }
  return results;
}

async function searchInChunks(clauses, wrap, opts) {
  const out = [];
  for (let i = 0; i < clauses.length; i += CLAUSE_CHUNK) {
    out.push(...(await search(wrap(clauses.slice(i, i + CLAUSE_CHUNK).join(' OR ')), opts)));
  }
  return out;
}

/**
 * Get the records for a list of {pma, supplement}. Callers check the format
 * first. Returns a Map from recordKey() to record.
 */
export async function getPmaRecords(refs, opts = {}) {
  const keys = new Map();
  for (const { pma, supplement } of refs) {
    if (PMA_RE.test(pma) && (!supplement || SUPPLEMENT_RE.test(supplement))) {
      keys.set(recordKey(pma, supplement), { pma, supplement });
    }
  }
  const clauses = [...keys.values()].map(({ pma, supplement }) =>
    `(pma_number:${pma} AND supplement_number:${supplement ? supplement : '""'})`);
  const found = new Map();
  for (const r of await searchInChunks(clauses, (q) => q, opts)) {
    const key = recordKey(r.pma, r.supplement);
    if (keys.has(key)) found.set(key, r);
  }
  return found;
}

/** Make a name safe to put in a quoted openFDA phrase. */
export function phrase(name) {
  return String(name).replace(/[^A-Za-z0-9 .\-']/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Find approvals that can be new lenses: by lens product code since
 * SEARCH.decidedFrom, and by any of the given names at any date.
 * Returns a Map from recordKey() to record.
 */
export async function searchLensApprovals(names, opts = {}) {
  const base = 'advisory_committee:OP AND decision_code:APPR';
  const byCode = await search(
    `${base} AND product_code:(${LENS_PRODUCT_CODES.join(' OR ')})` +
      ` AND decision_date:[${SEARCH.decidedFrom} TO 2099-12-31]`,
    opts,
  );
  const phrases = [...new Set(names.map(phrase).filter((p) => p.length >= 3))].sort();
  const byName = await searchInChunks(
    phrases.map((p) => `"${p}"`),
    (q) => `${base} AND trade_name:(${q})`,
    opts,
  );
  const found = new Map();
  for (const r of [...byCode, ...byName]) {
    if (isLensApproval(r)) found.set(recordKey(r.pma, r.supplement), r);
  }
  return found;
}
