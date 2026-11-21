import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkNoApprovedDrug } from '../scripts/lib/checks.js';
import {
  findApprovedCataractDrugs, isApprovedLabel, searchCataractLabels, treatsCataract,
} from '../scripts/lib/drugs.js';

const label = (indication, app = ['NDA012345'], name = 'Test Drops') => ({
  id: 'label-1',
  indications_and_usage: [indication],
  openfda: app ? { application_number: app, brand_name: [name] } : undefined,
});

test('treatsCataract ignores text about cataract surgery', () => {
  for (const t of [
    'For inflammation after cataract surgery.',
    'Used during cataract extraction to dilate the pupil.',
    'Pain following cataract-surgery and other ocular surgeries.',
    'Indicated for postoperative inflammation after cataract removal procedures.',
  ]) {
    assert.equal(treatsCataract(t), false, t);
  }
});

test('treatsCataract finds a claim to treat a cataract', () => {
  for (const t of [
    'These eye drops are indicated for the treatment of Cataract.',
    'To slow the progression of age-related cataract.',
    'For cataract surgery pain, and to treat cataract.',
  ]) {
    assert.equal(treatsCataract(t), true, t);
  }
});

test('isApprovedLabel needs an NDA, ANDA or BLA number', () => {
  assert.equal(isApprovedLabel(label('x', ['NDA021000'])), true);
  assert.equal(isApprovedLabel(label('x', ['ANDA200000'])), true);
  assert.equal(isApprovedLabel(label('x', ['BLA125000'])), true);
  // Homeopathic and other unapproved labels have no number.
  assert.equal(isApprovedLabel(label('x', null)), false);
  assert.equal(isApprovedLabel(label('x', [])), false);
  assert.equal(isApprovedLabel(label('x', ['part341'])), false);
});

test('findApprovedCataractDrugs keeps only approved labels that may treat a cataract', () => {
  const hits = findApprovedCataractDrugs([
    label('For the treatment of Cataract.', null, 'Homeopathic Drops'),
    label('For inflammation after cataract surgery.', ['NDA020000'], 'Steroid Drops'),
    label('To treat age-related cataract.', ['NDA099999'], 'New Drops'),
  ]);
  assert.deepEqual(hits, [{ id: 'label-1', name: 'New Drops', application: 'NDA099999' }]);
});

test('checkNoApprovedDrug makes one rule 5 problem for each hit', () => {
  assert.deepEqual(checkNoApprovedDrug('data/site.yaml', []), []);
  const [p] = checkNoApprovedDrug('data/site.yaml', [{ id: 'abc', name: 'New Drops', application: 'NDA099999' }]);
  assert.equal(p.rule, 5);
  assert.equal(p.file, 'data/site.yaml');
  assert.match(p.message, /New Drops \(NDA099999, label id abc\)/);
});

test('searchCataractLabels pages through results and treats 404 as none', async () => {
  const calls = [];
  const fetch = async (url) => {
    const u = new URL(url);
    calls.push(u);
    const skip = Number(u.searchParams.get('skip'));
    const body = skip === 0
      ? { meta: { results: { total: 1500 } }, results: [label('a')] }
      : { meta: { results: { total: 1500 } }, results: [label('b')] };
    return { ok: true, status: 200, json: async () => body };
  };
  const got = await searchCataractLabels({ fetch, apiKey: '' });
  assert.equal(got.length, 2);
  assert.deepEqual(calls.map((u) => u.searchParams.get('skip')), ['0', '1000']);
  assert.equal(calls[0].searchParams.get('search'), 'indications_and_usage:cataract');

  const none = async () => ({ ok: false, status: 404, json: async () => ({ error: { code: 'NOT_FOUND' } }) });
  assert.deepEqual(await searchCataractLabels({ fetch: none, apiKey: '' }), []);
});
