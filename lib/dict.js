/**
 * dsh-gloss — offline dictionary loader.
 *
 * Bundles a filtered ECDICT subset (17,397 entries, ~406 KB gzip) and exposes
 * a single synchronous `lookup(word)` that never touches the network, the
 * settings service, or any profile file.
 *
 * Storage format is a compact array per entry:
 *   [word, phonetic, primaryDefinition, partOfSpeech]
 *
 * The gzip blob is decompressed lazily on the first lookup and indexed into a
 * Map so repeated lookups are O(1).
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(HERE, 'dict.core.json.gz');

/** @type {Map<string, [string,string,string,string]> | null} */
let index = null;
/** @type {string} */
let failure = '';

/**
 * Decode the bundled gzip blob. Uses the sync API so that lookups can stay
 * synchronous — the host only ever calls this inside a request handler.
 */
function loadIndex() {
  if (index !== null || failure) return;
  try {
    const raw = readFileSync(DATA_PATH);
    const decoded = JSON.parse(gunzipSync(raw).toString('utf8'));
    const map = new Map();
    for (const row of decoded) {
      const [word, phonetic, definition, pos] = row;
      if (typeof word === 'string' && word.length) {
        map.set(word, [word, phonetic ?? '', definition ?? '', pos ?? '']);
      }
    }
    index = map;
  } catch (error) {
    failure = error?.message ?? String(error);
    index = new Map();
  }
}

/**
 * Look up one lowercased word in the offline lexicon.
 *
 * @param {string} word
 * @returns {{ipa: string, definition: string, pos: string} | null}
 */
export function lookup(word) {
  loadIndex();
  const key = String(word ?? '').trim().toLowerCase();
  if (!key || key.length > 64) return null;
  const row = index?.get(key);
  if (!row) return null;
  return { ipa: row[1], definition: row[2], pos: row[3] };
}

/** Diagnostics for the host health endpoint. */
export function stats() {
  loadIndex();
  return { entries: index ? index.size : 0, failure: failure || null };
}
