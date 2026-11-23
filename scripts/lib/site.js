// Build what the page shows from data/. No network: the build checks
// (npm run check) ask the APIs before every build.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { GROUPS, STAGES } from './checks.js';
import { studyUrl } from './ctgov.js';
import { loadEntries } from './entries.js';
import { recordKey, recordUrl } from './openfda.js';

const isText = (v) => typeof v === 'string' && v.trim() !== '';
const text = (v) => (isText(v) ? v.trim() : '');

/** "ACTIVE_NOT_RECRUITING" -> "Active, not recruiting". */
export function trialStatusLabel(status) {
  const map = {
    ACTIVE_NOT_RECRUITING: 'Active, not recruiting',
    ENROLLING_BY_INVITATION: 'Enrolling by invitation',
    NOT_YET_RECRUITING: 'Not yet recruiting',
    UNKNOWN: 'Unknown',
  };
  if (!status) return 'Not in the registry file yet';
  return map[status] ?? status.charAt(0) + status.slice(1).toLowerCase().replaceAll('_', ' ');
}

/** A short name for a source link. */
export function sourceLabel(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const nct = u.pathname.match(/NCT\d{8}/)?.[0];
  if (u.hostname.endsWith('clinicaltrials.gov') && nct) return `ClinicalTrials.gov ${nct}`;
  if (u.hostname === 'api.fda.gov' && u.pathname.startsWith('/device/pma')) {
    const q = u.searchParams.get('search') ?? '';
    const pma = q.match(/P\d{6}/)?.[0];
    const sup = q.match(/supplement_number:(S\d{3})/)?.[1];
    if (pma) return `FDA record ${recordKey(pma, sup)} (openFDA)`;
  }
  return u.hostname.replace(/^www\./, '');
}

function trialView(nct, registry) {
  const t = registry[nct] ?? {};
  const people = t.enrollment != null
    ? `${t.enrollment} people${t.enrollment_type === 'ESTIMATED' ? ' (planned)' : ''}`
    : '';
  return {
    nct,
    url: studyUrl(nct),
    title: t.title ?? '',
    status: trialStatusLabel(t.status),
    people,
    countries: (t.countries ?? []).join(', '),
    start: t.start_date ?? '',
    end: t.completion_date ?? t.primary_completion_date ?? '',
  };
}

function entryView(data, site, registry) {
  const ev = (tag) => site.evidence[tag] ?? tag;
  return {
    id: data.id,
    name: data.name,
    company: data.company,
    group: data.group,
    stage: data.stage,
    stageLabel: site.stages[data.stage].label,
    status: data.status,
    statusLabel: site.statuses[data.status].label,
    type: text(data.type),
    availability: text(data.availability) || 'Unknown',
    codeNames: data.code_names ?? [],
    howItWorks: text(data.how_it_works),
    summary: text(data.summary),
    tradeOffs: text(data.trade_offs),
    results: (data.results ?? []).map((r) => ({ text: r.text, evidence: ev(r.evidence), source: r.source })),
    latest: data.latest ? { date: data.latest.date, text: data.latest.text, evidence: ev(data.latest.evidence) } : null,
    trials: (data.trials ?? []).map((nct) => trialView(nct, registry)),
    fda: (data.fda ?? []).map((f) => ({
      key: recordKey(f.pma, f.supplement), date: f.date, url: recordUrl(f.pma, f.supplement),
    })),
    sources: (data.sources ?? []).map((s) => ({ url: s.url, label: sourceLabel(s.url), read: s.read })),
    reviewed: data.reviewed ?? '',
  };
}

/** The "Where you can get it" text of a lens that a US patient can get now. */
export const AVAILABLE_NOW = 'US now';

/**
 * True when the FDA approved the entry and it is on sale in the US now.
 * An approval is not a launch: an approved lens that is not on sale yet
 * stays in the pipeline.
 */
export const isAvailableNow = (v) => v.stage === 'approved-us' && v.availability === AVAILABLE_NOW;

/** The date of the first FDA approval in the entry's list, or ''. */
const firstFdaDate = (v) => v.fda.map((f) => f.date).filter(Boolean).sort()[0] ?? '';

const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });

/**
 * Everything the page needs. Two lists: the pipeline (the main list), and
 * the lenses that are approved and on sale now. In each list the order is
 * group, then stage, then name A to Z. The order says how far a lens has
 * got. It does not rank lenses.
 */
export function buildSite({ site, entries, registry }) {
  for (const key of ['title', 'not_advice', 'no_drug_approved']) {
    if (!isText(site?.[key])) throw new Error(`data/site.yaml: "${key}" is missing`);
  }
  for (const key of ['pipeline', 'available']) {
    if (!isText(site[key]?.title)) throw new Error(`data/site.yaml: ${key}.title is missing`);
  }
  for (const g of GROUPS) if (!site.groups?.[g]) throw new Error(`data/site.yaml: groups.${g} is missing`);
  for (const s of STAGES) if (!site.stages?.[s]) throw new Error(`data/site.yaml: stages.${s} is missing`);

  const views = entries.map((d) => entryView(d, site, registry));
  const available = views.filter(isAvailableNow).map((v) => ({ ...v, firstFda: firstFdaDate(v) }));
  const pipeline = views.filter((v) => !isAvailableNow(v));
  const byGroup = (list) => GROUPS.map((key) => ({
    key,
    label: site.groups[key].label,
    about: text(site.groups[key].about),
    entries: list
      .filter((v) => v.group === key)
      .sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage) || byName(a, b)),
  }));
  const groups = byGroup(pipeline).map((g) => ({
    ...g,
    note: g.key === 'no-surgery' ? site.no_drug_approved.trim() : '',
  }));
  // An approved stage shows in the pipeline counts only when an approved
  // entry is not on sale yet.
  const counts = STAGES.map((s) => ({
    stage: s,
    label: site.stages[s].label,
    about: text(site.stages[s].about),
    count: pipeline.filter((v) => v.stage === s).length,
  })).filter((c) => c.count > 0 || !c.stage.startsWith('approved'));
  const reviewed = views.map((v) => v.reviewed).filter(Boolean).sort();
  return {
    title: site.title.trim(),
    tagline: text(site.tagline),
    notAdvice: site.not_advice.trim(),
    pipeline: { title: site.pipeline.title.trim(), about: text(site.pipeline.about), total: pipeline.length },
    groups,
    counts,
    available: {
      title: site.available.title.trim(),
      about: text(site.available.about),
      total: available.length,
      groups: byGroup(available).filter((g) => g.entries.length > 0),
    },
    total: views.length,
    lastUpdated: reviewed.at(-1) ?? '',
    statuses: Object.entries(site.statuses ?? {})
      .map(([key, s]) => ({ key, label: s.label, about: text(s.about) }))
      .filter((s) => s.about),
    terms: (site.terms ?? []).filter((t) => isText(t.text)).map((t) => ({ term: t.term, text: t.text.trim() })),
    today: isText(site.today?.text) ? { title: site.today.title, text: site.today.text.trim() } : null,
    aboutData: text(site.about_data),
    repo: text(site.repo),
  };
}

/** Read data/ and build the page model. Throws if a lens file does not parse. */
export async function loadSite(dataDir) {
  const site = parse(await readFile(path.join(dataDir, 'site.yaml'), 'utf8'));
  const loaded = await loadEntries(dataDir);
  const broken = loaded.filter((e) => e.parseError);
  if (broken.length) throw new Error(`${broken[0].file} does not parse. Run npm run check.`);
  let registry = {};
  try {
    registry = JSON.parse(await readFile(path.join(dataDir, 'registry', 'trials.json'), 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return buildSite({ site, entries: loaded.map((e) => e.data), registry });
}
