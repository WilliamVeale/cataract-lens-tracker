#!/usr/bin/env node
// The weekly refresh. See docs/spec.md, "How it stays up to date".
//
//   node scripts/refresh.js [--data data] [--report report.md]
//
// It reads both APIs again and writes:
//   data/registry/trials.json     facts for each trial that an entry lists
//   data/registry/unmatched.json  records the searches found that no entry lists
// and a Markdown report for the pull request (to --report, or to stdout).
// It never changes data/lenses/. It writes nothing if an API fails.
//
// Exit 0: done. Exit 1: a file in data/ is wrong. Exit 2: an API did not answer.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { collectFdaRefs, collectNcts } from './lib/checks.js';
import { NCT_RE, getTrialsByIds, searchLensTrials } from './lib/ctgov.js';
import { loadEntries, loadIgnore, readJson } from './lib/entries.js';
import { PMA_RE, recordKey, searchLensApprovals } from './lib/openfda.js';
import {
  buildUnmatched, diffSnapshots, renderReport, snapshotOf, sponsorMatcher, staleReason,
} from './lib/refresh.js';

const { values: args } = parseArgs({
  options: {
    data: { type: 'string', default: 'data' },
    report: { type: 'string' },
  },
});
const today = new Date().toISOString().slice(0, 10);
const registry = path.join(args.data, 'registry');
const trialsFile = path.join(registry, 'trials.json');
const unmatchedFile = path.join(registry, 'unmatched.json');

const problems = [];
const all = await loadEntries(args.data);
const entries = [];
for (const e of all) {
  if (e.data && typeof e.data === 'object' && !Array.isArray(e.data)) {
    entries.push({ ...e, data: { ...e.data, id: e.data.id ?? path.basename(e.file).replace(/\.ya?ml$/, '') } });
  } else {
    problems.push(`\`${e.file}\` does not parse, so the script skipped it.`);
  }
}
let ignore, before, beforeUnmatched;
try {
  ignore = await loadIgnore(args.data);
  before = await readJson(trialsFile, {});
  beforeUnmatched = await readJson(unmatchedFile, { trials: [], fda: [] });
} catch (err) {
  console.error(err.message);
  console.error('Fix that file. The script wrote nothing.');
  process.exit(1);
}

// What the entries list now.
const entriesByNct = new Map();
for (const { data } of entries) {
  for (const nct of collectNcts(data)) {
    if (!NCT_RE.test(nct)) {
      problems.push(`\`${data.id}\` has "${nct}", which is not an NCT number.`);
      continue;
    }
    entriesByNct.set(nct, [...(entriesByNct.get(nct) ?? []), data.id].sort());
  }
}
const listedFda = new Set(entries.flatMap(({ data }) => collectFdaRefs(data))
  .filter((r) => PMA_RE.test(r.pma))
  .map((r) => recordKey(r.pma, r.supplement)));
const names = entries
  .filter(({ data }) => data.group !== 'no-surgery')
  .flatMap(({ data }) => [data.name, ...(Array.isArray(data.code_names) ? data.code_names : [])])
  .filter((n) => typeof n === 'string');

// Read both APIs before we write anything.
let live, searched, approvals;
try {
  live = await getTrialsByIds([...entriesByNct.keys()]);
  searched = await searchLensTrials();
  approvals = await searchLensApprovals(names);
} catch (err) {
  console.error(`An API did not answer: ${err.message}`);
  console.error('The script wrote nothing. Try again later.');
  process.exit(2);
}

for (const nct of entriesByNct.keys()) {
  if (!live.has(nct)) {
    problems.push(`${nct} (${entriesByNct.get(nct).map((id) => `\`${id}\``).join(', ')}) ` +
      'is not in ClinicalTrials.gov. The build check will fail until an entry is fixed.');
  }
}

const after = snapshotOf(live);
const diff = diffSnapshots(before, after);

const statusOf = new Map(entries.map(({ data }) => [data.id, data.status]));
const stale = [];
for (const [nct, ids] of entriesByNct) {
  const t = live.get(nct);
  if (!t || ids.every((id) => ['stalled', 'discontinued'].includes(statusOf.get(id)))) continue;
  const reason = staleReason(t, today);
  if (reason) stale.push({ nct, reason });
}

const isKnown = sponsorMatcher([
  ...entries.map(({ data }) => data.company),
  ...[...live.values()].map((t) => t.sponsor),
]);
const unmatched = buildUnmatched({
  searched,
  approvals,
  listedNcts: new Set(entriesByNct.keys()),
  listedFda,
  ignore,
  isKnown,
  entries,
  before: beforeUnmatched,
  today,
});

await mkdir(registry, { recursive: true });
await writeFile(trialsFile, `${JSON.stringify(after, null, 2)}\n`);
await writeFile(unmatchedFile, `${JSON.stringify(unmatched, null, 2)}\n`);

const report = renderReport({ today, diff, entriesByNct, stale, unmatched, searched, problems });
if (args.report) await writeFile(args.report, report);
else process.stdout.write(report);

console.error(
  `Refresh done: ${live.size} listed trials, ${diff.changes.length} changes, ` +
  `${stale.length} look stale, ${unmatched.trials.length} unmatched trials, ` +
  `${unmatched.fda.length} unmatched FDA records, ${problems.length} problems.`,
);
