// Read the YAML files in data/.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';

/**
 * Read data/lenses/*.yaml.
 * @returns {Promise<Array<{file: string, data: any, parseError?: string}>>}
 */
export async function loadEntries(dataDir) {
  const dir = path.join(dataDir, 'lenses');
  let names;
  try {
    names = await readdir(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const files = names.filter((n) => /\.ya?ml$/.test(n)).sort();
  return Promise.all(files.map(async (name) => {
    const file = path.join(dir, name);
    try {
      return { file, data: parse(await readFile(file, 'utf8')) };
    } catch (err) {
      return { file, data: null, parseError: err.message };
    }
  }));
}

/**
 * Read data/ignore.yaml: records the refresh found that are not lenses we
 * track. Each item needs an id and a reason ("why").
 * @returns {Promise<{trials: Set<string>, fda: Set<string>}>}
 */
export async function loadIgnore(dataDir) {
  const file = path.join(dataDir, 'ignore.yaml');
  let doc;
  try {
    doc = parse(await readFile(file, 'utf8')) ?? {};
  } catch (err) {
    if (err.code === 'ENOENT') return { trials: new Set(), fda: new Set() };
    throw new Error(`${file}: ${err.message}`);
  }
  const out = {};
  for (const kind of ['trials', 'fda']) {
    const items = doc[kind] ?? [];
    if (!Array.isArray(items)) throw new Error(`${file}: "${kind}" must be a list`);
    out[kind] = new Set(items.map((item, i) => {
      if (typeof item?.id !== 'string' || typeof item?.why !== 'string' || !item.why.trim()) {
        throw new Error(`${file}: ${kind} item ${i + 1} needs an "id" and a "why"`);
      }
      return item.id.trim();
    }));
  }
  return out;
}

/** Read a JSON file, or return the fallback if it is not there. */
export async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw new Error(`${file}: ${err.message}`);
  }
}
