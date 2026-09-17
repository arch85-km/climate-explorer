/**
 * Optional bundled example climate.
 *
 * The app ships with NO weather data: publishing it means redistributing whatever
 * is embedded here to every visitor, and third-party weather files carry their own
 * attribution terms. Students load their own EPW instead.
 *
 * The mechanism is kept so that bundling can be switched back on for a file you
 * hold the rights to: drop it in `assets/`, set `SAMPLE_SOURCE` and `SAMPLE_LABEL`
 * to match, and rebuild. `build.js` gzips it and substitutes the base64 below; with
 * the constant empty, `sampleAvailable()` is false and the app opens on its empty
 * state, which is the shipped behaviour.
 *
 * @version 1.0.0 — 2026-09-17
 */

// Name of the file to look for in assets/. Nothing is shipped unless it is there.
const SAMPLE_SOURCE = 'example.epw';
const SAMPLE_NAME = 'example.epw';

// A readable name for a bundled file, whose LOCATION header is often a terse
// station code. Files a student imports always keep whatever their own header says.
const SAMPLE_LABEL = 'Example climate';

const SAMPLE_GZIP_B64 = '';

export { SAMPLE_SOURCE, SAMPLE_NAME, SAMPLE_LABEL, SAMPLE_GZIP_B64 };
