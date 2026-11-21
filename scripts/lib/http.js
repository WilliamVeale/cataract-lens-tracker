// GET JSON with a timeout and a few retries.

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {URL} url
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetch] Swap in a fake for tests.
 * @param {number[]} [opts.okStatus] Statuses to return, not throw (openFDA sends 404 for "no matches").
 * @param {number} [opts.retries]
 * @param {(ms: number) => Promise<void>} [opts.sleep]
 * @returns {Promise<{status: number, body: any}>}
 */
export async function getJson(url, opts = {}) {
  const {
    fetch: fetchImpl = globalThis.fetch,
    okStatus = [],
    retries = 3,
    sleep = wait,
    timeoutMs = 30_000,
  } = opts;
  // Never put the query string in an error: it can hold an API key.
  const where = `${url.host}${url.pathname}`;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
    let res;
    try {
      res = await fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      lastError = new Error(`${where}: ${err.message}`);
      continue;
    }
    if (res.ok || okStatus.includes(res.status)) {
      return { status: res.status, body: await res.json() };
    }
    lastError = new Error(`${where}: HTTP ${res.status}`);
    if (!RETRY_STATUS.has(res.status)) break;
  }
  throw lastError;
}
