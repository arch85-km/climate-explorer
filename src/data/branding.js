/**
 * The project's name, in one place.
 *
 * Six variants of the title had drifted across the tree: colon and em-dash forms,
 * two survivals of the project's older name, and a shorter phrasing in the embed
 * docs. Everything that displays the name now reads it from here, including the
 * static shell, which `build.js` fills through injection markers.
 *
 * @version 1.0.0 — 2026-09-17
 */

/** The short name: the header lockup, and anywhere the name stands alone. */
const APP_NAME = 'Climate Explorer';

/** The descriptive half, lower-cased so it reads as a continuation of the name. */
const APP_TAGLINE = 'a browser-based weather data analysis and visualisation tool';

/** The full title. The colon form is canonical. */
const APP_TITLE = `${APP_NAME}: ${APP_TAGLINE}`;

/** Short strapline for the header, where the full tagline will not fit. */
const APP_STRAPLINE = 'Weather data analysis and visualisation';

export { APP_NAME, APP_TAGLINE, APP_TITLE, APP_STRAPLINE };
