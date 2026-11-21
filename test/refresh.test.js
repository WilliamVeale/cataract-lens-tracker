import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildUnmatched, diffSnapshots, entriesForTradeName, normalizeCompany, renderReport,
  snapshotOf, sponsorMatcher, staleReason,
} from '../scripts/lib/refresh.js';

// Test data only. These are not real lens facts.
const TODAY = '2026-11-21';

const trial = (nct, extra = {}) => ({
  nct,
  title: `Study ${nct}`,
  status: 'RECRUITING',
  sponsor: 'Test Co, Inc.',
  phases: ['NA'],
  start_date: '2025-01',
  primary_completion_date: '2026-06',
  completion_date: null,
  enrollment: 100,
  enrollment_type: 'ESTIMATED',
  countries: ['Spain'],
  last_update: '2026-10-01',
  sponsor_class: 'INDUSTRY',
  ...extra,
});

test('snapshotOf keeps the fact fields only, sorted by NCT', () => {
  const snap = snapshotOf(new Map([['NCT00000002', trial('NCT00000002')], ['NCT00000001', trial('NCT00000001')]]));
  assert.deepEqual(Object.keys(snap), ['NCT00000001', 'NCT00000002']);
  assert.equal(snap.NCT00000001.last_update, undefined);
  assert.equal(snap.NCT00000001.sponsor_class, undefined);
  assert.equal(snap.NCT00000001.enrollment, 100);
});

test('diffSnapshots finds added, removed and changed facts', () => {
  const before = snapshotOf(new Map([
    ['NCT00000001', trial('NCT00000001')],
    ['NCT00000002', trial('NCT00000002')],
  ]));
  const after = snapshotOf(new Map([
    ['NCT00000001', trial('NCT00000001', { status: 'COMPLETED', enrollment: 95, enrollment_type: 'ACTUAL' })],
    ['NCT00000003', trial('NCT00000003')],
  ]));
  assert.deepEqual(diffSnapshots(before, after), {
    added: ['NCT00000003'],
    removed: ['NCT00000002'],
    changes: [
      { nct: 'NCT00000001', field: 'status', from: 'RECRUITING', to: 'COMPLETED' },
      { nct: 'NCT00000001', field: 'enrollment', from: 100, to: 95 },
      { nct: 'NCT00000001', field: 'enrollment_type', from: 'ESTIMATED', to: 'ACTUAL' },
    ],
  });
  assert.deepEqual(diffSnapshots(after, after), { added: [], removed: [], changes: [] });
});

test('staleReason flags old records that still say they are open', () => {
  assert.match(staleReason(trial('NCT1', { status: 'UNKNOWN' }), TODAY), /unknown status/);
  assert.match(staleReason(trial('NCT1', { status: 'NOT_YET_RECRUITING', start_date: '2023-05' }), TODAY),
    /not yet recruiting.*2023-05/);
  assert.match(staleReason(trial('NCT1', { last_update: '2025-11-01' }), TODAY), /last update was 2025-11-01/);
  assert.equal(staleReason(trial('NCT1'), TODAY), null);
  assert.equal(staleReason(trial('NCT1', { status: 'NOT_YET_RECRUITING', start_date: '2026-09' }), TODAY), null);
  assert.equal(staleReason(trial('NCT1', { status: 'COMPLETED', last_update: '2020-01-01' }), TODAY), null);
});

test('sponsorMatcher matches company names with different endings', () => {
  assert.equal(normalizeCompany('Bausch & Lomb Incorporated'), 'bausch lomb');
  const isKnown = sponsorMatcher(['Alcon', 'Bausch + Lomb', 'Johnson & Johnson Surgical Vision, Inc.']);
  assert.ok(isKnown('Alcon Research, LLC'));
  assert.ok(isKnown('Bausch & Lomb Incorporated'));
  assert.ok(isKnown('Johnson & Johnson Surgical Vision'));
  assert.ok(!isKnown('Johnson & Johnson Vision Care, Inc.'));
  assert.ok(!isKnown('Alconox Labs'));
  assert.ok(!isKnown(null));
});

const entries = [
  { data: { id: 'lens-a', name: 'Test Vision', code_names: ['TV100'] } },
  { data: { id: 'lens-b', name: 'Other Lens' } },
];

test('entriesForTradeName matches whole names and code names', () => {
  assert.deepEqual(entriesForTradeName('TEST VISION Toric IOL, Model TV100', entries), ['lens-a']);
  assert.deepEqual(entriesForTradeName('Model TV1000', entries), []);
  assert.deepEqual(entriesForTradeName(null, entries), []);
});

test('buildUnmatched skips listed and ignored records, and keeps the first "found" date', () => {
  const searched = new Map([
    ['NCT00000001', trial('NCT00000001')],
    ['NCT00000002', trial('NCT00000002')],
    ['NCT00000003', trial('NCT00000003', { sponsor: 'Stent Maker' })],
    ['NCT00000004', trial('NCT00000004')],
  ]);
  const approvals = new Map([
    ['P000001 S001', { pma: 'P000001', supplement: 'S001', trade_name: 'Test Vision IOL', decision_date: '2026-01-01' }],
    ['P000002', { pma: 'P000002', supplement: null, trade_name: 'X', decision_date: '2026-01-02' }],
    ['P000003', { pma: 'P000003', supplement: null, trade_name: 'Y', decision_date: '2026-01-03' }],
  ]);
  const got = buildUnmatched({
    searched,
    approvals,
    listedNcts: new Set(['NCT00000001']),
    listedFda: new Set(['P000002']),
    ignore: { trials: new Set(['NCT00000004']), fda: new Set(['P000003']) },
    isKnown: sponsorMatcher(['Test Co']),
    entries,
    before: { trials: [{ nct: 'NCT00000002', found: '2026-11-14' }], fda: [] },
    today: TODAY,
  });
  assert.deepEqual(got.trials.map((t) => [t.nct, t.known_company, t.found]), [
    ['NCT00000002', true, '2026-11-14'],
    ['NCT00000003', false, TODAY],
  ]);
  assert.deepEqual(got.fda.map((r) => [r.id, r.maybe_for, r.found]), [['P000001 S001', ['lens-a'], TODAY]]);
});

test('renderReport lists changes, stale trials and new records', () => {
  const report = renderReport({
    today: TODAY,
    diff: { added: [], removed: [], changes: [{ nct: 'NCT00000001', field: 'start_date', from: '2025-01', to: null }] },
    entriesByNct: new Map([['NCT00000001', ['lens-a']]]),
    stale: [{ nct: 'NCT00000001', reason: 'it is old.' }],
    unmatched: {
      trials: [
        { nct: 'NCT00000002', title: 'A study.', sponsor: 'Test Co, Inc.', known_company: true, found: TODAY },
        { nct: 'NCT00000003', title: 'Old', sponsor: 'X', known_company: false, found: '2026-11-14' },
      ],
      fda: [{ id: 'P000001', pma: 'P000001', supplement: null, decision_date: '2026-01-01',
        trade_name: 'Lens', applicant: 'Test Co', supplement_reason: null, maybe_for: ['lens-a'], found: TODAY }],
    },
    searched: new Map([['NCT00000002', trial('NCT00000002')]]),
    problems: ['Something is wrong.'],
  });
  assert.match(report, /^# Weekly data refresh: 2026-11-21\n/);
  assert.match(report, /## Problems \(1\)\n\nFix these first\.\n\n- Something is wrong\./);
  assert.match(report, /\(`lens-a`\): start date changed from 2025-01 to none\./);
  assert.match(report, /## Trials that look stale \(1\)/);
  assert.match(report, /## New trials from known companies \(1\)/);
  assert.match(report, /NCT00000002\): A study\. Test Co, Inc\. RECRUITING, start 2025-01\./);
  assert.match(report, /## Other new trials that match no entry \(0\)\n\nNone\.\n\nStill waiting from earlier runs: 1\./);
  assert.match(report, /## Possible new FDA approvals \(1\)/);
  assert.match(report, /Lens\. Test Co\. Original PMA\. Maybe for `lens-a`\./);
  assert.doesNotMatch(report, /\.\./);
});
