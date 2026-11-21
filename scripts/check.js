#!/usr/bin/env node
// The build checks (rules 0 to 5). The build fails if one is broken.
// See docs/spec.md, "How the data is kept".
//
//   node scripts/check.js [--data data]
//
// Exit 0: all checks pass. Exit 1: a check failed. Exit 2: an API did not answer.

import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  checkEvidence, checkFda, checkNoApprovedDrug, checkShape, checkSources, checkTrials,
  collectFdaRefs, collectNcts,
} from './lib/checks.js';
import { getTrialsByIds } from './lib/ctgov.js';
import { findApprovedCataractDrugs, searchCataractLabels } from './lib/drugs.js';
import { loadEntries } from './lib/entries.js';
import { getPmaRecords } from './lib/openfda.js';

const RULES = {
  0: 'the file is valid',
  1: 'every entry has a source with a read date',
  2: 'every NCT number is in ClinicalTrials.gov',
  3: 'approved-us has an FDA record that openFDA confirms',
  4: 'every result number has an evidence tag',
  5: 'no drug is approved to treat a cataract (the page says so)',
};

const { values: args } = parseArgs({ options: { data: { type: 'string', default: 'data' } } });
const today = new Date().toISOString().slice(0, 10);

const entries = await loadEntries(args.data);
const problems = entries.flatMap((e) => [
  ...checkShape(e, today), ...checkSources(e, today), ...checkEvidence(e),
]);

const ncts = new Set(entries.flatMap((e) => [...collectNcts(e.data)]));
const fdaRefs = entries.flatMap((e) => collectFdaRefs(e.data));

async function ask(name, job) {
  try {
    return await job();
  } catch (err) {
    console.error(`Could not get data from ${name}: ${err.message}`);
    console.error('The checks did not finish. Try again later.');
    process.exit(2);
  }
}

const trials = await ask('ClinicalTrials.gov', () => getTrialsByIds([...ncts]));
const fda = await ask('openFDA', () => getPmaRecords(fdaRefs));
const labels = await ask('openFDA drug labels', () => searchCataractLabels());
problems.push(
  ...checkTrials(entries, trials),
  ...checkFda(entries, fda),
  ...checkNoApprovedDrug(path.join(args.data, 'site.yaml'), findApprovedCataractDrugs(labels)),
);

if (entries.length === 0) {
  console.log(`No entries in ${path.join(args.data, 'lenses')}. Nothing to check.`);
}

if (problems.length === 0) {
  console.log(`All checks pass: ${entries.length} entries, ${ncts.size} NCT numbers, ` +
    `${fdaRefs.length} FDA records, ${labels.length} drug labels that name cataract.`);
  process.exit(0);
}

const byFile = Map.groupBy(problems.sort((a, b) => a.rule - b.rule), (p) => p.file);
for (const [file, list] of [...byFile].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`\n${path.relative(process.cwd(), file)}`);
  for (const p of list) {
    console.log(`  rule ${p.rule} (${RULES[p.rule]}): ${p.message}`);
    if (process.env.GITHUB_ACTIONS) {
      console.log(`::error file=${path.relative(process.cwd(), file)}::rule ${p.rule}: ${p.message}`);
    }
  }
}
console.log(`\n${problems.length} problems in ${byFile.size} files. The checks fail.`);
process.exit(1);
