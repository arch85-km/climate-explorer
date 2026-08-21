/**
 * The bundled example climate.
 *
 * `SAMPLE_GZIP_B64` is deliberately empty here. `build.js` reads the EPW named by
 * `SAMPLE_SOURCE` out of `assets/`, gzips it, and substitutes the base64 into this
 * module at build time — so the ~350 KB blob never enters version control, while
 * the module still resolves when tests import `src/` directly.
 *
 * With the constant empty (i.e. running from source rather than from a build), the
 * app simply falls back to its empty state and waits for a file.
 */

const SAMPLE_SOURCE = 'GBR_ENG_London.Wea.CtrSt.James.Park.037700_TMYx.epw';
const SAMPLE_NAME = 'GBR_ENG_London.Wea.CtrSt.James.Park.037700_TMYx.epw';

// The LOCATION header reads "London.Wea.Ctr-St.James.Park", which is how TMYx names
// stations but is not how anyone says it. The bundled sample gets a readable label;
// files a student imports always keep whatever their own header says.
const SAMPLE_LABEL = 'London — St James’s Park';

const SAMPLE_GZIP_B64 = '';

export { SAMPLE_SOURCE, SAMPLE_NAME, SAMPLE_LABEL, SAMPLE_GZIP_B64 };
