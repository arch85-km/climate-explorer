/**
 * Build identity.
 *
 * Both constants are empty here and substituted by `build.js` from `package.json`
 * (`version` and `releaseDate`) — the single source of truth. Running from source
 * rather than from a build simply leaves them blank, and the app omits the line.
 *
 * @version 1.0.0 — 2026-09-17
 */

const VERSION = '';
const RELEASE_DATE = '';

/** The release date in long form, e.g. "5 April 2026" — or '' when running unbuilt. */
function releaseDateLong() {
  if (!RELEASE_DATE) return '';
  const [y, m, d] = RELEASE_DATE.split('-').map(Number);
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  if (!y || !m || !d) return RELEASE_DATE;
  return `${d} ${months[m - 1]} ${y}`;
}

export { VERSION, RELEASE_DATE, releaseDateLong };
