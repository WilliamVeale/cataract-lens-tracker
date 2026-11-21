// The build checks. See docs/spec.md, "How the data is kept".
// Rule 0: the file is valid. Rules 1 to 4: the four rules in the spec.
// Each check returns a list of problems: {file, rule, message}.

import path from 'node:path';
import { NCT_RE } from './ctgov.js';
import { PMA_RE, SUPPLEMENT_RE, recordKey } from './openfda.js';

export const GROUPS = ['fixed', 'changes', 'no-surgery'];
export const STAGES = ['approved-us', 'approved-elsewhere', 'pivotal', 'early', 'lab'];
export const STATUSES = ['active', 'approved', 'stalled', 'discontinued'];
export const EVIDENCE = ['regulator', 'paper', 'company'];

// "sources" is required too. Rule 1 checks it.
const REQUIRED = ['id', 'name', 'company', 'group', 'stage', 'status'];
const OPTIONAL = [
  'sources', 'code_names', 'type', 'availability', 'how_it_works', 'summary', 'trade_offs',
  'latest', 'results', 'trials', 'fda', 'reviewed',
];
const KEYS = new Set([...REQUIRED, ...OPTIONAL]);

// Text a person writes. It has no evidence tag, so no result number may be in it.
export const PROSE_FIELDS = ['how_it_works', 'summary', 'trade_offs', 'availability'];

// Text that looks like a result number. This list is not complete, so a
// person still reads every change.
const RESULT_PATTERNS = [
  [/\d+(?:[.,]\d+)?\s*%/g, 'a percent'],
  [/\bper ?cent\b/gi, 'a percent'],
  [/\b20\/\d{2,3}\b/g, 'a vision score'],
  [/\b6\/(?:4\.8|5|6|7\.5|9|12|15|18|24|30|36|60)\b/g, 'a vision score'],
  [/\blog ?MAR\b/gi, 'a vision score'],
  [/\d\s*(?:diopters?|dioptres?)\b/gi, 'a diopter number'],
  [/[+-]?\d+\.\d+\s?D\b/g, 'a diopter number'],
  [/\b\d+(?:\.\d+)?\s+(?:of|out of)\s+(?:every\s+)?\d+\b/gi, 'a share, like "9 of 10"'],
  // "in" also joins a year to a count ("since 2019 in 60 countries", "phase 3
  // in 2025"), so a year (1900-2099) on either side is not a share.
  [
    /\b(?!(?:19|20)\d\d\b)\d+(?:\.\d+)?\s+in\s+(?:every\s+)?(?!(?:19|20)\d\d\b)\d+\b/gi,
    'a share, like "9 of 10"',
  ],
  [/\b\d+(?:\.\d+)?\s*(?:x|times)\b/gi, 'a "times" number'],
  [/\b\d+\s+(?:more\s+|fewer\s+)?lines?\b/gi, 'lines on a vision chart'],
  [/\bp\s*[<=>≤]\s*0?\.\d+/gi, 'a p-value'],
];

const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const isHttpUrl = (v) => typeof v === 'string' && /^https?:\/\/\S+$/.test(v);

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function reporter(file, rule) {
  const out = [];
  const add = (message) => out.push({ file, rule, message });
  return [out, add];
}

// "today" is the UTC date. Allow one day more: in Asia or Australia it can
// already be tomorrow.
function checkDate(add, label, value, today) {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  if (!isIsoDate(value)) add(`${label} must be a date like 2026-11-19.`);
  else if (value > d.toISOString().slice(0, 10)) add(`${label} ${value} is in the future.`);
}

/** Rule 0: the file parses, uses known keys and allowed values. */
export function checkShape({ file, data, parseError }, today) {
  const [out, add] = reporter(file, 0);
  if (parseError) {
    add(`The YAML does not parse: ${parseError.split('\n')[0]}`);
    return out;
  }
  if (!isMap(data)) {
    add('The file must hold one YAML mapping ("key: value" lines).');
    return out;
  }
  for (const key of Object.keys(data)) {
    if (!KEYS.has(key)) add(`Unknown key "${key}". Check the spelling.`);
  }
  for (const key of REQUIRED) {
    if (data[key] === undefined || data[key] === null || data[key] === '') add(`"${key}" is missing.`);
  }
  const base = path.basename(file).replace(/\.ya?ml$/, '');
  if (data.id !== undefined && data.id !== base) {
    add(`id is "${data.id}", but the file name is "${base}". They must be the same.`);
  }
  if (typeof data.id === 'string' && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.id)) {
    add(`id "${data.id}" must use small letters, digits and "-" only.`);
  }
  for (const [key, allowed] of [['group', GROUPS], ['stage', STAGES], ['status', STATUSES]]) {
    if (data[key] !== undefined && !allowed.includes(data[key])) {
      add(`${key} is "${data[key]}". It must be one of: ${allowed.join(', ')}.`);
    }
  }
  for (const key of ['name', 'company', 'type', ...PROSE_FIELDS]) {
    if (data[key] !== undefined && typeof data[key] !== 'string') add(`"${key}" must be text.`);
  }
  for (const key of ['code_names', 'trials']) {
    const v = data[key];
    if (v !== undefined && !(Array.isArray(v) && v.every((x) => typeof x === 'string'))) {
      add(`"${key}" must be a list of text items.`);
    }
  }
  for (const key of ['fda', 'results']) {
    const v = data[key];
    if (v !== undefined && !(Array.isArray(v) && v.every(isMap))) {
      add(`"${key}" must be a list of mappings.`);
    }
  }
  if (data.latest !== undefined) {
    if (!isMap(data.latest)) {
      add('"latest" must have "date", "text" and "evidence".');
    } else {
      checkDate(add, 'latest: "date"', data.latest.date, today);
      if (!isText(data.latest.text)) add('latest: "text" is missing.');
    }
  }
  if (data.reviewed !== undefined) checkDate(add, '"reviewed"', data.reviewed, today);
  return out;
}

/** Rule 1: every entry has at least one source with a read date. */
export function checkSources({ file, data }, today) {
  const [out, add] = reporter(file, 1);
  if (!isMap(data)) return out;
  const sources = data.sources;
  if (!Array.isArray(sources) || sources.length === 0) {
    add('Add at least one source, with a "url" and a "read" date.');
    return out;
  }
  sources.forEach((s, i) => {
    const label = `Source ${i + 1}`;
    if (!isMap(s)) {
      add(`${label} must have a "url" and a "read" date.`);
      return;
    }
    if (!isHttpUrl(s.url)) add(`${label}: "url" must start with https:// or http://.`);
    checkDate(add, `${label}: "read"`, s.read, today);
  });
  return out;
}

function walkStrings(value, visit) {
  if (typeof value === 'string') visit(value);
  else if (Array.isArray(value)) value.forEach((v) => walkStrings(v, visit));
  else if (isMap(value)) Object.values(value).forEach((v) => walkStrings(v, visit));
}

/** Every NCT number in an entry: the "trials" list, and any in text or links. */
export function collectNcts(data) {
  const ids = new Set();
  if (!isMap(data)) return ids;
  if (Array.isArray(data.trials)) {
    for (const t of data.trials) ids.add(String(t).trim());
  }
  walkStrings(data, (s) => {
    for (const m of s.matchAll(/NCT\d+/g)) ids.add(m[0]);
  });
  return ids;
}

/** Rule 2: every NCT number exists in ClinicalTrials.gov. */
export function checkTrials(entries, found) {
  const out = [];
  for (const { file, data } of entries) {
    for (const id of collectNcts(data)) {
      if (!NCT_RE.test(id)) {
        out.push({ file, rule: 2, message: `"${id}" is not an NCT number. It must be "NCT" and 8 digits.` });
      } else if (!found.has(id)) {
        out.push({ file, rule: 2, message: `${id} is not in ClinicalTrials.gov.` });
      }
    }
  }
  return out;
}

/** The "fda" list of an entry, cleaned up. */
export function collectFdaRefs(data) {
  if (!isMap(data) || !Array.isArray(data.fda)) return [];
  return data.fda.filter(isMap).map((f) => ({
    pma: typeof f.pma === 'string' ? f.pma.trim() : String(f.pma ?? ''),
    supplement: typeof f.supplement === 'string' && f.supplement.trim() ? f.supplement.trim() : null,
    date: f.date,
  }));
}

/** Rule 3: stage approved-us needs an FDA record that openFDA confirms. */
export function checkFda(entries, records) {
  const out = [];
  for (const { file, data } of entries) {
    if (!isMap(data)) continue;
    const add = (message) => out.push({ file, rule: 3, message });
    const refs = collectFdaRefs(data);
    if (data.stage === 'approved-us' && refs.length === 0) {
      add('stage is approved-us, so "fda" must list the FDA record: {pma, supplement, date}.');
    }
    refs.forEach(({ pma, supplement, date }, i) => {
      if (!PMA_RE.test(pma)) {
        add(`FDA record ${i + 1}: pma "${pma}" must be "P" and 6 digits.`);
        return;
      }
      if (supplement && !SUPPLEMENT_RE.test(supplement)) {
        add(`FDA record ${i + 1}: supplement "${supplement}" must be "S" and 3 digits.`);
        return;
      }
      const key = recordKey(pma, supplement);
      if (!isIsoDate(date)) add(`FDA ${key}: "date" must be a date like 2026-03-11.`);
      const r = records.get(key);
      if (!r) {
        add(`FDA ${key} is not in openFDA.`);
        return;
      }
      if (r.decision_code !== 'APPR') {
        add(`FDA ${key}: openFDA says decision "${r.decision_code}", not APPR (approved).`);
      }
      if (r.advisory_committee !== 'OP') {
        add(`FDA ${key}: openFDA files it under "${r.advisory_committee}", not OP (eye devices). Check the number.`);
      }
      if (isIsoDate(date) && r.decision_date !== date) {
        add(`FDA ${key}: the date here is ${date}, but openFDA says ${r.decision_date}.`);
      }
    });
  }
  return out;
}

/** Find text that looks like a result number. Returns [match, kind] pairs. */
export function findResultNumbers(text) {
  const hits = [];
  for (const [re, kind] of RESULT_PATTERNS) {
    for (const m of text.matchAll(re)) hits.push([m[0].trim(), kind]);
  }
  return hits;
}

/**
 * Rule 4: every result number has an evidence tag.
 * A result number goes in "results" (text, evidence, source) or in
 * "latest" (which has its own evidence tag). The text a person writes
 * (PROSE_FIELDS) must not hold one.
 */
export function checkEvidence({ file, data }) {
  const [out, add] = reporter(file, 4);
  if (!isMap(data)) return out;
  const tags = EVIDENCE.join(', ');
  const urls = new Set((Array.isArray(data.sources) ? data.sources : []).filter(isMap).map((s) => s.url));
  if (isMap(data.latest) && !EVIDENCE.includes(data.latest.evidence)) {
    add(`latest: "evidence" must be one of: ${tags}.`);
  }
  if (Array.isArray(data.results)) {
    data.results.forEach((r, i) => {
      const label = `results item ${i + 1}`;
      if (!isMap(r)) return; // rule 0 reports this
      if (!isText(r.text)) add(`${label}: "text" is missing.`);
      if (!EVIDENCE.includes(r.evidence)) add(`${label}: "evidence" must be one of: ${tags}.`);
      if (!urls.has(r.source)) {
        add(`${label}: "source" must be one of the urls in "sources", so it has a read date.`);
      }
    });
  }
  for (const field of PROSE_FIELDS) {
    if (typeof data[field] !== 'string') continue;
    for (const [match, kind] of findResultNumbers(data[field])) {
      add(`${field}: "${match}" looks like a result number (${kind}). ` +
        'Move it to "results", with an evidence tag and a source.');
    }
  }
  return out;
}
