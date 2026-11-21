import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getTrialsByIds, searchLensTrials } from '../scripts/lib/ctgov.js';
import { getJson } from '../scripts/lib/http.js';
import {
  getPmaRecords, isLensApproval, phrase, recordKey, searchLensApprovals, toRecord,
} from '../scripts/lib/openfda.js';

// A fake fetch. `answer(url)` returns [status, body]. All calls are kept.
function fakeFetch(answer) {
  const calls = [];
  const fn = async (url) => {
    calls.push(new URL(url));
    const [status, body] = await answer(new URL(url), calls.length);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}
const noSleep = async () => {};

const study = (nct, extra = {}) => ({
  protocolSection: {
    identificationModule: { nctId: nct, briefTitle: `Study ${nct}` },
    statusModule: { overallStatus: 'RECRUITING', startDateStruct: { date: '2025-01' } },
    sponsorCollaboratorsModule: { leadSponsor: { name: 'Test Co', class: extra.class ?? 'INDUSTRY' } },
    designModule: { studyType: extra.type ?? 'INTERVENTIONAL', enrollmentInfo: { count: 10, type: 'ESTIMATED' } },
    contactsLocationsModule: { locations: [{ country: 'Spain' }, { country: 'France' }, { country: 'Spain' }] },
  },
});

test('getJson retries a 503, then returns the answer', async () => {
  const fetch = fakeFetch((_, n) => (n < 3 ? [503, {}] : [200, { ok: true }]));
  const got = await getJson(new URL('https://api.example/x'), { fetch, sleep: noSleep });
  assert.deepEqual(got, { status: 200, body: { ok: true } });
  assert.equal(fetch.calls.length, 3);
});

test('getJson does not retry a 400, and keeps the query (api_key) out of the error', async () => {
  const fetch = fakeFetch(() => [400, {}]);
  await assert.rejects(
    getJson(new URL('https://api.example/x?api_key=SECRET'), { fetch, sleep: noSleep }),
    (err) => err.message === 'api.example/x: HTTP 400',
  );
  assert.equal(fetch.calls.length, 1);
});

test('getTrialsByIds keeps exact matches only, and follows pages', async () => {
  const fetch = fakeFetch((url) => {
    assert.equal(url.searchParams.get('filter.ids'), 'NCT00000001,NCT00000002');
    if (!url.searchParams.get('pageToken')) {
      return [200, { studies: [study('NCT00000001')], nextPageToken: 'next' }];
    }
    // A study we did not ask for must not count.
    return [200, { studies: [study('NCT00000999')] }];
  });
  const got = await getTrialsByIds(['NCT00000002', 'NCT00000001', 'NCT123', 'NCT00000001'], { fetch });
  assert.deepEqual([...got.keys()], ['NCT00000001']);
  assert.deepEqual(got.get('NCT00000001').countries, ['France', 'Spain']);
  assert.equal(got.get('NCT00000001').enrollment_type, 'ESTIMATED');
  assert.equal(fetch.calls.length, 2);
});

test('getTrialsByIds makes no call for an empty list', async () => {
  const fetch = fakeFetch(() => assert.fail('no call expected'));
  assert.equal((await getTrialsByIds([], { fetch })).size, 0);
});

test('searchLensTrials runs each term and keeps industry, interventional trials', async () => {
  const fetch = fakeFetch((url) => {
    assert.equal(url.searchParams.get('query.cond'), 'cataract OR presbyopia OR aphakia');
    assert.equal(url.searchParams.get('filter.advanced'), 'AREA[StartDate]RANGE[2021-01-01,MAX]');
    return [200, { studies: [
      study('NCT00000001'),
      study('NCT00000002', { class: 'OTHER' }),
      study('NCT00000003', { type: 'OBSERVATIONAL' }),
    ] }];
  });
  const got = await searchLensTrials({ fetch });
  assert.deepEqual([...got.keys()], ['NCT00000001']);
  assert.equal(fetch.calls.length, 5);
});

const pma = (pma_number, supplement_number, extra = {}) => ({
  pma_number,
  supplement_number,
  decision_code: 'APPR',
  advisory_committee: 'OP',
  decision_date: '2026-03-11',
  supplement_reason: supplement_number ? 'Change Design/Components/Specifications/Material' : '',
  trade_name: 'Test Lens',
  ...extra,
});

test('isLensApproval keeps originals and design or labeling changes only', () => {
  assert.ok(isLensApproval(toRecord(pma('P000001', ''))));
  assert.ok(isLensApproval(toRecord(pma('P000001', 'S001'))));
  assert.ok(isLensApproval(toRecord(pma('P000001', 'S002', {
    supplement_reason: 'Labeling Change - Indications/instructions/shelf life/tradename',
  }))));
  assert.ok(!isLensApproval(toRecord(pma('P000001', 'S003', {
    supplement_reason: 'Process Change - Manufacturer/Sterilizer/Packager/Supplier',
  }))));
  assert.ok(!isLensApproval(toRecord(pma('P000001', '', { decision_code: 'DENY' }))));
  assert.ok(!isLensApproval(toRecord(pma('P000001', '', { advisory_committee: 'CV' }))));
});

test('getPmaRecords asks for originals with an empty supplement, and treats 404 as none', async () => {
  const fetch = fakeFetch((url) => {
    const q = url.searchParams.get('search');
    assert.equal(q, '(pma_number:P000001 AND supplement_number:S001) OR (pma_number:P000002 AND supplement_number:"")');
    return [200, { meta: { results: { total: 2 } }, results: [pma('P000001', 'S001'), pma('P000002', '')] }];
  });
  const got = await getPmaRecords([
    { pma: 'P000001', supplement: 'S001' },
    { pma: 'P000002', supplement: null },
    { pma: 'bad', supplement: null },
  ], { fetch });
  assert.deepEqual([...got.keys()].sort(), ['P000001 S001', 'P000002']);

  const none = fakeFetch(() => [404, { error: { code: 'NOT_FOUND', message: 'No matches found!' } }]);
  assert.equal((await getPmaRecords([{ pma: 'P000009' }], { fetch: none })).size, 0);
});

test('openFDA: a 404 that is not "no matches" is an error', async () => {
  const fetch = fakeFetch(() => [404, { error: { code: 'OTHER' } }]);
  await assert.rejects(getPmaRecords([{ pma: 'P000001' }], { fetch }), /HTTP 404/);
});

test('openFDA: the api key goes in the query when it is set', async () => {
  const fetch = fakeFetch((url) => {
    assert.equal(url.searchParams.get('api_key'), 'k');
    return [404, { error: { code: 'NOT_FOUND' } }];
  });
  await getPmaRecords([{ pma: 'P000001' }], { fetch, apiKey: 'k' });
});

test('searchLensApprovals searches by code and by name, and drops paperwork', async () => {
  const fetch = fakeFetch((url) => {
    const q = url.searchParams.get('search');
    if (q.includes('product_code:')) {
      return [200, { meta: { results: { total: 2 } }, results: [
        pma('P000001', 'S001'),
        pma('P000001', 'S002', { supplement_reason: 'Location Change - Manufacturer' }),
      ] }];
    }
    assert.match(q, /trade_name:\("Bausch Lomb Lens" OR "IC-8 Lens"\)$/);
    return [200, { meta: { results: { total: 1 } }, results: [pma('P000003', '')] }];
  });
  const got = await searchLensApprovals(['IC-8 Lens', 'Bausch + Lomb Lens', 'IC-8 Lens', 'x'], { fetch });
  assert.deepEqual([...got.keys()].sort(), ['P000001 S001', 'P000003']);
});

test('phrase and recordKey', () => {
  assert.equal(phrase('enVista "Beyond" (EDOF)'), 'enVista Beyond EDOF');
  assert.equal(recordKey('P980040', 'S176'), 'P980040 S176');
  assert.equal(recordKey('P160055', null), 'P160055');
});
