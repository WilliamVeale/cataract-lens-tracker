import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkEvidence, checkFda, checkShape, checkSources, checkTrials,
  collectNcts, findResultNumbers, isIsoDate,
} from '../scripts/lib/checks.js';

// Test data only. These are not real lens facts.
const TODAY = '2026-11-21';
const SRC = 'https://example.org/record';

function entry(overrides = {}, file = 'data/lenses/test-lens.yaml') {
  return {
    file,
    data: {
      id: 'test-lens',
      name: 'Test Lens',
      company: 'Test Co',
      group: 'fixed',
      stage: 'pivotal',
      status: 'active',
      sources: [{ url: SRC, read: '2026-11-19' }],
      ...overrides,
    },
  };
}

const messages = (problems) => problems.map((p) => `${p.rule}: ${p.message}`);

test('a valid entry passes every offline check', () => {
  const e = entry({
    summary: 'A lens with a ring pattern. Approved in 2026. Model IC-8 and DEN00V.',
    latest: { date: '2026-03-11', text: 'Something happened.', evidence: 'regulator' },
    results: [{ text: '92% saw well.', evidence: 'paper', source: SRC }],
    reviewed: '2026-11-19',
  });
  assert.deepEqual([...checkShape(e, TODAY), ...checkSources(e, TODAY), ...checkEvidence(e)], []);
});

test('isIsoDate needs a real date in YYYY-MM-DD form', () => {
  assert.ok(isIsoDate('2024-02-29'));
  assert.ok(!isIsoDate('2023-02-29'));
  assert.ok(!isIsoDate('2026-13-01'));
  assert.ok(!isIsoDate('2026-1-1'));
  assert.ok(!isIsoDate(20261121));
  assert.ok(!isIsoDate(undefined));
});

test('rule 0 catches parse errors, unknown keys, a wrong id and bad values', () => {
  assert.match(messages(checkShape({ file: 'x.yaml', data: null, parseError: 'bad\nmore' }, TODAY))[0], /does not parse: bad$/);
  const got = messages(checkShape(entry({ sumary: 'x', id: 'other', stage: 'aproved-us', trials: 'NCT00000001' }), TODAY));
  assert.ok(got.some((m) => m.includes('Unknown key "sumary"')));
  assert.ok(got.some((m) => m.includes('file name is "test-lens"')));
  assert.ok(got.some((m) => m.includes('stage is "aproved-us"')));
  assert.ok(got.some((m) => m.includes('"trials" must be a list')));
  const missing = messages(checkShape({ file: 'data/lenses/a.yaml', data: { id: 'a' } }, TODAY));
  for (const key of ['name', 'company', 'group', 'stage', 'status']) {
    assert.ok(missing.some((m) => m.includes(`"${key}" is missing`)), key);
  }
});

test('rule 1 needs a source with a url and a read date that is not in the future', () => {
  assert.match(messages(checkSources(entry({ sources: [] }), TODAY))[0], /^1: Add at least one source/);
  assert.match(messages(checkSources(entry({ sources: undefined }), TODAY))[0], /^1: Add at least one source/);
  const got = messages(checkSources(entry({
    sources: [
      { url: 'ftp://x', read: '2026-11-19' }, { url: SRC }, { url: SRC, read: '2026-11-23' }, 'text',
      { url: SRC, read: '2026-11-22' }, // tomorrow in UTC is OK: it can be tomorrow in Asia
    ],
  }), TODAY));
  assert.deepEqual(got, [
    '1: Source 1: "url" must start with https:// or http://.',
    '1: Source 2: "read" must be a date like 2026-11-19.',
    '1: Source 3: "read" 2026-11-23 is in the future.',
    '1: Source 4 must have a "url" and a "read" date.',
  ]);
});

test('collectNcts finds numbers in the trials list, in text and in links', () => {
  const ids = collectNcts(entry({
    trials: ['NCT00000001', ' NCT00000002 '],
    summary: 'See NCT00000003.',
    sources: [{ url: 'https://clinicaltrials.gov/study/NCT00000004?tab=results', read: '2026-11-19' }],
  }).data);
  assert.deepEqual([...ids].sort(), ['NCT00000001', 'NCT00000002', 'NCT00000003', 'NCT00000004']);
});

test('rule 2 checks the format and that the trial exists', () => {
  const e = entry({ trials: ['NCT00000001', 'NCT00000002', 'NCT123', 'nct00000003'] });
  // The API pads "NCT123" to NCT00000123. That must not count as found.
  const found = new Map([['NCT00000001', {}], ['NCT00000123', {}]]);
  assert.deepEqual(messages(checkTrials([e], found)), [
    '2: NCT00000002 is not in ClinicalTrials.gov.',
    '2: "NCT123" is not an NCT number. It must be "NCT" and 8 digits.',
    '2: "nct00000003" is not an NCT number. It must be "NCT" and 8 digits.',
  ]);
});

test('rule 3: approved-us needs an FDA record', () => {
  assert.deepEqual(messages(checkFda([entry({ stage: 'approved-us' })], new Map())), [
    '3: stage is approved-us, so "fda" must list the FDA record: {pma, supplement, date}.',
  ]);
});

test('rule 3: openFDA must confirm number, decision, panel and date', () => {
  const ok = { decision_code: 'APPR', advisory_committee: 'OP', decision_date: '2026-03-11' };
  const records = new Map([
    ['P000001 S001', ok],
    ['P000002', ok],
    ['P000003 S002', { ...ok, decision_code: 'DENY' }],
    ['P000004', { ...ok, advisory_committee: 'CV' }],
  ]);
  const e = entry({
    stage: 'approved-us',
    fda: [
      { pma: 'P000001', supplement: 'S001', date: '2026-03-11' },
      { pma: 'P000002', date: '2026-03-12' },
      { pma: 'P000003', supplement: 'S002', date: '2026-03-11' },
      { pma: 'P000004', date: '2026-03-11' },
      { pma: 'P000005', date: '2026-03-11' },
      { pma: 'P12', date: '2026-03-11' },
      { pma: 'P000006', supplement: '29', date: '2026-03-11' },
    ],
  });
  assert.deepEqual(messages(checkFda([e], records)), [
    '3: FDA P000002: the date here is 2026-03-12, but openFDA says 2026-03-11.',
    '3: FDA P000003 S002: openFDA says decision "DENY", not APPR (approved).',
    '3: FDA P000004: openFDA files it under "CV", not OP (eye devices). Check the number.',
    '3: FDA P000005 is not in openFDA.',
    '3: FDA record 6: pma "P12" must be "P" and 6 digits.',
    '3: FDA record 7: supplement "29" must be "S" and 3 digits.',
  ]);
});

test('rule 4: latest and results need an evidence tag, results need a listed source', () => {
  const got = messages(checkEvidence(entry({
    latest: { date: '2026-03-11', text: 'x' },
    results: [
      { text: '1 in 5', evidence: 'blog', source: SRC },
      { text: '1 in 5', evidence: 'company', source: 'https://elsewhere.example' },
    ],
  })));
  assert.deepEqual(got, [
    '4: latest: "evidence" must be one of: regulator, paper, company.',
    '4: results item 1: "evidence" must be one of: regulator, paper, company.',
    '4: results item 2: "source" must be one of the urls in "sources", so it has a read date.',
  ]);
});

test('rule 4: a result number in text a person writes fails', () => {
  const got = messages(checkEvidence(entry({
    trade_offs: 'In the trial 14% saw halos, and 1 in 10 needed glasses.',
  })));
  assert.equal(got.length, 2);
  assert.match(got[0], /trade_offs: "14%" looks like a result number \(a percent\)/);
  assert.match(got[1], /"1 in 10"/);
});

test('findResultNumbers finds common result numbers', () => {
  const kinds = (t) => findResultNumbers(t).map(([, kind]) => kind);
  assert.deepEqual(kinds('92 % of eyes'), ['a percent']);
  assert.deepEqual(kinds('ninety percent'), ['a percent']);
  assert.deepEqual(kinds('saw 20/25 or better'), ['a vision score']);
  assert.deepEqual(kinds('saw 6/6'), ['a vision score']);
  assert.deepEqual(kinds('0.1 logMAR'), ['a vision score']);
  assert.deepEqual(kinds('a range of 1.5 D'), ['a diopter number']);
  assert.deepEqual(kinds('up to 2 diopters'), ['a diopter number']);
  assert.deepEqual(kinds('9 out of 10 people'), ['a share, like "9 of 10"']);
  assert.deepEqual(kinds('2x more halos'), ['a "times" number']);
  assert.deepEqual(kinds('2 more lines'), ['lines on a vision chart']);
  assert.deepEqual(kinds('p < 0.05'), ['a p-value']);
});

test('findResultNumbers lets years, model codes and plain words pass', () => {
  for (const text of [
    'Approved in the US in 2026.',
    'Model DEN00V, IC-8 Apthera, KI-362-US1, FG-80030.1, LS-313 MF80.',
    'A trifocal lens. The doctor tunes it after surgery.',
    'US now',
    '2027 to 2028',
  ]) {
    assert.deepEqual(findResultNumbers(text), [], text);
  }
});
