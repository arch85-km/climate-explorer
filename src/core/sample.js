/**
 * Inflate and parse the bundled example climate.
 *
 * The EPW is embedded gzipped and base64-encoded, and inflated with the browser's
 * own DecompressionStream — no library, no network request. It then goes through
 * exactly the same parseEpw/buildDataset path as an imported file, so the sample is
 * never a special case downstream.
 *
 * @version 1.0.0 — 2026-09-17
 */
import { SAMPLE_GZIP_B64, SAMPLE_NAME, SAMPLE_LABEL } from '../data/sample.js';
import { parseEpw } from '../epw/parse.js';
import { buildDataset } from './dataset.js';

/** True when a sample is embedded and this browser can inflate it. */
function sampleAvailable() {
  return !!SAMPLE_GZIP_B64 && typeof DecompressionStream === 'function';
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * @returns {Promise<{data: object, name: string, label: string}|null>}
 *          null when no sample is embedded or the browser cannot inflate it —
 *          callers fall back to the empty state rather than failing.
 */
async function loadSample() {
  if (!sampleAvailable()) return null;
  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  writer.write(base64ToBytes(SAMPLE_GZIP_B64));
  writer.close();
  const text = await new Response(stream.readable).text();
  const data = buildDataset(parseEpw(text));
  // Only the bundled file carries a curated display name.
  data.displayLabel = SAMPLE_LABEL;
  data.isSample = true;
  return { data, name: SAMPLE_NAME, label: SAMPLE_LABEL };
}

export { loadSample, sampleAvailable, SAMPLE_LABEL, SAMPLE_NAME };
