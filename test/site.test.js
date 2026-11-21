import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildSite, loadSite, sourceLabel, trialStatusLabel } from '../scripts/lib/site.js';

const stage = (label) => ({ label, about: `${label} means this.` });
const site = {
  title: 'Test tracker',
  tagline: 'A tagline.',
  not_advice: 'Not medical advice.',
  no_drug_approved: 'No drug is approved.',
  groups: {
    fixed: { label: 'Fixed focus', about: 'Does not move.' },
    changes: { label: 'Changes focus', about: '' },
    'no-surgery': { label: 'No surgery', about: 'Drugs.' },
  },
  stages: {
    'approved-us': stage('Approved (US)'),
    'approved-elsewhere': stage('Approved elsewhere'),
    pivotal: stage('Pivotal trial'),
    early: stage('Early trial'),
    lab: stage('Lab'),
  },
  statuses: {
    active: { label: 'Active', about: '' },
    approved: { label: 'Approved', about: '' },
    stalled: { label: 'Stalled', about: 'Out of date.' },
    discontinued: { label: 'Discontinued', about: '' },
  },
  evidence: { regulator: 'Regulator', paper: 'Peer-reviewed paper', company: 'Company claim' },
  terms: [{ term: 'IOL', text: 'A lens.' }, { term: 'Halo', text: '' }],
  today: { title: 'What surgeons use today', text: '' },
};

const entry = (id, extra = {}) => ({
  id, name: id, company: 'Co', group: 'fixed', stage: 'early', status: 'active', reviewed: '2026-11-01', ...extra,
});

test('buildSite orders by group, then stage, then name, and counts each stage', () => {
  const s = buildSite({
    site,
    registry: {},
    entries: [
      entry('zeta', { stage: 'approved-us', status: 'approved' }),
      entry('beta'),
      entry('Alpha'),
      entry('drop', { group: 'no-surgery', reviewed: '2026-11-20' }),
    ],
  });
  assert.deepEqual(s.groups.map((g) => g.key), ['fixed', 'changes', 'no-surgery']);
  assert.deepEqual(s.groups[0].entries.map((e) => e.id), ['zeta', 'Alpha', 'beta']);
  assert.equal(s.groups[2].note, 'No drug is approved.');
  assert.equal(s.groups[0].note, '');
  assert.deepEqual(s.counts.map((c) => c.count), [1, 0, 0, 3, 0]);
  assert.equal(s.total, 4);
  assert.equal(s.lastUpdated, '2026-11-20');
});

test('buildSite hides empty texts, and tags evidence with its label', () => {
  const s = buildSite({
    site,
    registry: {},
    entries: [entry('a', {
      summary: '  ',
      latest: { date: '2026-03-11', text: 'Approved.', evidence: 'regulator' },
      results: [{ text: 'A result.', evidence: 'company', source: 'https://example.org/x' }],
    })],
  });
  const e = s.groups[0].entries[0];
  assert.equal(e.summary, '');
  assert.equal(e.availability, 'Unknown');
  assert.equal(e.latest.evidence, 'Regulator');
  assert.equal(e.results[0].evidence, 'Company claim');
  assert.deepEqual(s.terms, [{ term: 'IOL', text: 'A lens.' }]);
  assert.equal(s.today, null);
  assert.deepEqual(s.statuses.map((x) => x.key), ['stalled']);
});

test('buildSite reads trial facts from the registry, and FDA links from the record', () => {
  const s = buildSite({
    site,
    registry: {
      NCT01234567: {
        status: 'ACTIVE_NOT_RECRUITING', enrollment: 40, enrollment_type: 'ESTIMATED',
        countries: ['France', 'Spain'], start_date: '2025-01', completion_date: '2027-06',
      },
    },
    entries: [entry('a', {
      trials: ['NCT01234567', 'NCT07654321'],
      fda: [{ pma: 'P980040', supplement: 'S176', date: '2026-03-11' }],
    })],
  });
  const [t1, t2] = s.groups[0].entries[0].trials;
  assert.equal(t1.status, 'Active, not recruiting');
  assert.equal(t1.people, '40 people (planned)');
  assert.equal(t1.countries, 'France, Spain');
  assert.equal(t1.url, 'https://clinicaltrials.gov/study/NCT01234567');
  assert.equal(t2.status, 'Not in the registry file yet');
  const [f] = s.groups[0].entries[0].fda;
  assert.equal(f.key, 'P980040 S176');
  assert.match(f.url, /^https:\/\/api\.fda\.gov\/device\/pma\.json\?search=/);
});

test('buildSite stops on a site.yaml without the no-drug text', () => {
  assert.throws(() => buildSite({ site: { ...site, no_drug_approved: '' }, entries: [], registry: {} }), /no_drug_approved/);
});

test('sourceLabel names the registry and FDA links', () => {
  assert.equal(sourceLabel('https://clinicaltrials.gov/study/NCT05364983'), 'ClinicalTrials.gov NCT05364983');
  assert.equal(
    sourceLabel('https://api.fda.gov/device/pma.json?search=pma_number%3AP200020+AND+supplement_number%3AS003'),
    'FDA record P200020 S003 (openFDA)',
  );
  assert.equal(
    sourceLabel('https://api.fda.gov/device/pma.json?search=pma_number%3AP160055+AND+supplement_number%3A%22%22'),
    'FDA record P160055 (openFDA)',
  );
  assert.equal(sourceLabel('https://www.example.org/paper'), 'example.org');
});

test('trialStatusLabel writes the registry status in plain words', () => {
  assert.equal(trialStatusLabel('RECRUITING'), 'Recruiting');
  assert.equal(trialStatusLabel('NOT_YET_RECRUITING'), 'Not yet recruiting');
  assert.equal(trialStatusLabel('COMPLETED'), 'Completed');
  assert.equal(trialStatusLabel(undefined), 'Not in the registry file yet');
});

test('loadSite reads data/ and works without a registry file', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'site-'));
  try {
    await mkdir(path.join(dir, 'lenses'));
    const { stringify } = await import('yaml');
    await writeFile(path.join(dir, 'site.yaml'), stringify(site));
    await writeFile(path.join(dir, 'lenses', 'a.yaml'), stringify(entry('a')));
    const s = await loadSite(dir);
    assert.equal(s.total, 1);
    await writeFile(path.join(dir, 'lenses', 'b.yaml'), 'id: [broken');
    await assert.rejects(loadSite(dir), /does not parse/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
