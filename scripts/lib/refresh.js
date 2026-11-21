// The weekly refresh: compare, decide, write the report.
// See docs/spec.md, "How it stays up to date".
// No network and no files here. scripts/refresh.js does that.

import { studyUrl } from './ctgov.js';
import { recordUrl } from './openfda.js';

// The facts we keep for each trial that an entry lists. The script changes
// these facts only. A person writes all the text in data/lenses/.
export const SNAPSHOT_FIELDS = [
  'title', 'status', 'sponsor', 'phases', 'start_date', 'primary_completion_date',
  'completion_date', 'enrollment', 'enrollment_type', 'countries',
];

const LIST_CAP = 60;
const OPEN = new Set(['NOT_YET_RECRUITING', 'RECRUITING', 'ENROLLING_BY_INVITATION', 'ACTIVE_NOT_RECRUITING']);
const COMPANY_SUFFIXES = /\b(?:inc|incorporated|llc|ltd|limited|gmbh|ag|sa|sas|bv|nv|corp|corporation|co|company|plc|srl|spa|kk|pty|and)\b/g;

/** Map of live trials -> the object we save in data/registry/trials.json. */
export function snapshotOf(trials) {
  const out = {};
  for (const nct of [...trials.keys()].sort()) {
    const t = trials.get(nct);
    out[nct] = Object.fromEntries(SNAPSHOT_FIELDS.map((f) => [f, t[f] ?? null]));
  }
  return out;
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function diffSnapshots(before, after) {
  const added = Object.keys(after).filter((k) => !(k in before)).sort();
  const removed = Object.keys(before).filter((k) => !(k in after)).sort();
  const changes = [];
  for (const nct of Object.keys(after).sort()) {
    if (!(nct in before)) continue;
    for (const field of SNAPSHOT_FIELDS) {
      if (!same(before[nct][field], after[nct][field])) {
        changes.push({ nct, field, from: before[nct][field] ?? null, to: after[nct][field] ?? null });
      }
    }
  }
  return { added, removed, changes };
}

export function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Why a trial record looks out of date, or null. The spec says to mark
 * these entries "stalled". A person decides.
 */
export function staleReason(t, today) {
  if (t.status === 'UNKNOWN') {
    return 'ClinicalTrials.gov says "unknown status": nobody confirmed the status for more than 2 years.';
  }
  if (t.status === 'NOT_YET_RECRUITING' && t.start_date && t.start_date < addDays(today, -183)) {
    return `it still says "not yet recruiting", but the start date was ${t.start_date}.`;
  }
  if (OPEN.has(t.status) && t.last_update && t.last_update < addDays(today, -365)) {
    return `it still says ${t.status}, but the last update was ${t.last_update}.`;
  }
  return null;
}

export function normalizeCompany(name) {
  return String(name ?? '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(COMPANY_SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Make a test for "is this sponsor a company we already track?".
 * Known names: the entry companies, and the sponsors of trials that
 * entries list. "Alcon" matches "Alcon Research, LLC".
 */
export function sponsorMatcher(knownNames) {
  const known = [...new Set(knownNames.map(normalizeCompany))].filter((k) => k.length >= 3);
  return (sponsor) => {
    const n = normalizeCompany(sponsor);
    if (!n) return false;
    return known.some((k) => n === k || n.startsWith(`${k} `) || k.startsWith(`${n} `));
  };
}

const normalizeName = (s) => ` ${String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

/** The ids of entries whose name or code name is in this FDA trade name. */
export function entriesForTradeName(tradeName, entries) {
  const trade = normalizeName(tradeName ?? '');
  return entries.filter(({ data }) => [data.name, ...(data.code_names ?? [])]
    .filter((n) => typeof n === 'string' && n.trim().length >= 3)
    .some((n) => trade.includes(normalizeName(n))))
    .map(({ data }) => data.id)
    .sort();
}

/**
 * Records the searches found that no entry lists and data/ignore.yaml
 * does not list. "found" is the first run that saw each one.
 */
export function buildUnmatched({ searched, approvals, listedNcts, listedFda, ignore, isKnown, entries, before, today }) {
  const seenTrial = new Map((before.trials ?? []).map((t) => [t.nct, t.found]));
  const seenFda = new Map((before.fda ?? []).map((r) => [r.id, r.found]));
  const trials = [...searched.values()]
    .filter((t) => !listedNcts.has(t.nct) && !ignore.trials.has(t.nct))
    .sort((a, b) => a.nct.localeCompare(b.nct))
    .map((t) => ({
      nct: t.nct,
      title: t.title,
      sponsor: t.sponsor,
      known_company: isKnown(t.sponsor),
      found: seenTrial.get(t.nct) ?? today,
    }));
  const fda = [...approvals.entries()]
    .filter(([id]) => !listedFda.has(id) && !ignore.fda.has(id))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, r]) => ({
      id,
      pma: r.pma,
      supplement: r.supplement,
      decision_date: r.decision_date,
      trade_name: r.trade_name,
      applicant: r.applicant,
      product_code: r.product_code,
      supplement_reason: r.supplement_reason,
      maybe_for: entriesForTradeName(r.trade_name, entries),
      found: seenFda.get(id) ?? today,
    }));
  return { trials, fda };
}

// ---- The report: the body of the pull request ----

const show = (v) => {
  if (v === null || v === undefined || v === '') return 'none';
  return Array.isArray(v) ? (v.length ? v.join(', ') : 'none') : String(v);
};
const code = (ids) => ids.map((id) => `\`${id}\``).join(', ');
// "Alcon Inc." -> "Alcon Inc.", "Alcon" -> "Alcon.": no ".." in the report.
const sentence = (v) => {
  const s = show(v).trim();
  return /[.!?]$/.test(s) ? s : `${s}.`;
};

function section(lines, title, items, { intro, waiting } = {}) {
  lines.push('', `## ${title} (${items.length})`, '');
  if (items.length === 0) {
    lines.push('None.');
  } else {
    if (intro) lines.push(intro, '');
    for (const item of items.slice(0, LIST_CAP)) lines.push(`- ${item}`);
    if (items.length > LIST_CAP) {
      lines.push(`- And ${items.length - LIST_CAP} more. See \`data/registry/unmatched.json\`.`);
    }
  }
  if (waiting) lines.push('', waiting);
}

/** A line about records from earlier runs that a person has not cleared yet. */
function waitingNote(all, today) {
  const old = all.filter((x) => x.found !== today).length;
  return old ? `Still waiting from earlier runs: ${old}. See \`data/registry/unmatched.json\`.` : null;
}

/**
 * @param {object} r
 * @param {string} r.today
 * @param {{added: string[], removed: string[], changes: object[]}} r.diff
 * @param {Map<string, string[]>} r.entriesByNct NCT -> entry ids
 * @param {{nct: string, reason: string}[]} r.stale
 * @param {{trials: object[], fda: object[]}} r.unmatched
 * @param {Map<string, object>} r.searched live search results, for status and dates
 * @param {string[]} r.problems
 */
export function renderReport({ today, diff, entriesByNct, stale, unmatched, searched, problems }) {
  const label = (nct) => {
    const ids = entriesByNct.get(nct) ?? [];
    return `[${nct}](${studyUrl(nct)})${ids.length ? ` (${code(ids)})` : ''}`;
  };
  const lines = [
    `# Weekly data refresh: ${today}`,
    '',
    'A script made this pull request. A person must check it before it is merged.',
    '',
    'The script changes facts only: trial status, dates and counts, in',
    '`data/registry/trials.json`. It does not change the files in `data/lenses/`.',
  ];

  if (problems.length) {
    lines.push('', `## Problems (${problems.length})`, '', 'Fix these first.', '');
    for (const p of problems) lines.push(`- ${p}`);
  }

  const changes = diff.changes.map((c) => `${label(c.nct)}: ${c.field.replaceAll('_', ' ')} ` +
    `changed from ${show(c.from)} to ${show(c.to)}.`);
  if (diff.added.length) changes.push(`Added to \`trials.json\`: ${diff.added.map(label).join(', ')}.`);
  if (diff.removed.length) {
    changes.push(`Removed from \`trials.json\` (no entry lists them now, or the API did not return them): ` +
      `${diff.removed.join(', ')}.`);
  }
  section(lines, 'Trial changes', changes);

  section(lines, 'Trials that look stale', stale.map((s) => `${label(s.nct)}: ${s.reason}`), {
    intro: 'The spec says to mark these entries `status: stalled`. A person decides.',
  });

  const trialLine = (t) => {
    const live = searched.get(t.nct) ?? {};
    return `[${t.nct}](${studyUrl(t.nct)}): ${sentence(t.title)} ${sentence(t.sponsor)} ` +
      `${show(live.status)}, start ${show(live.start_date)}.`;
  };
  const newKnown = unmatched.trials.filter((t) => t.known_company && t.found === today);
  const newOther = unmatched.trials.filter((t) => !t.known_company && t.found === today);
  const knownAll = unmatched.trials.filter((t) => t.known_company);
  const otherAll = unmatched.trials.filter((t) => !t.known_company);
  const clear = 'Add each number to an entry, or add it to `data/ignore.yaml` with a reason.';

  section(lines, 'New trials from known companies', newKnown.map(trialLine), {
    intro: clear,
    waiting: waitingNote(knownAll, today),
  });
  section(lines, 'Other new trials that match no entry', newOther.map(trialLine), {
    intro: `Most of these are not lenses (glaucoma stents, eye drops, contact lenses). ${clear}`,
    waiting: waitingNote(otherAll, today),
  });

  const fdaLine = (r) => `[${r.id}](${recordUrl(r.pma, r.supplement)}), ${r.decision_date}: ` +
    `${sentence(r.trade_name)} ${sentence(r.applicant)} ${sentence(r.supplement_reason ?? 'Original PMA')}` +
    `${r.maybe_for.length ? ` Maybe for ${code(r.maybe_for)}.` : ''}`;
  section(lines, 'Possible new FDA approvals', unmatched.fda.filter((r) => r.found === today).map(fdaLine), {
    intro: 'These are original PMAs, or supplements for a design or labeling change. ' +
      'Read the FDA record: most supplements are not a new lens. ' +
      'Add each one to an entry\'s `fda` list, or add it to `data/ignore.yaml` with a reason.',
    waiting: waitingNote(unmatched.fda, today),
  });

  return `${lines.join('\n')}\n`;
}
