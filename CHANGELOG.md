# Changelog

Each release is archived on Zenodo with its own version DOI. The concept DOI,
[10.5281/zenodo.22814692](https://doi.org/10.5281/zenodo.22814692), always
resolves to the newest version. The full notes for each release are on the
[releases page](https://github.com/arch85-km/climate-explorer/releases).

## Unreleased

- **Added** — the About panel opens with what the app is for: teaching and
  exploring early design, with results that are indicative and not for
  compliance or certification.
- **Changed** — the cube device, the icon and logo, is reserved: neither the
  MIT licence nor CC BY 4.0 grants any right to use it. Stated in `NOTICE`,
  in the app's licence panel and in `.zenodo.json`.
- **Fixed** — the release guard read only unquoted DOI values in
  `CITATION.cff`, so it could not see 1.1.0's declared version DOI.
- **Fixed** — both method notes' BibTeX entries for 1.1.0 carried 1.0.0's
  date (17 September 2026). They now give 4 October 2026.
- **Changed** — the release guard also checks the dates, the source
  headers, the built file, the README's citation, `.zenodo.json`'s
  publication date and the BibTeX date: 21 checks.
- **Fixed** — the 3D camera buttons looked from the wrong side: Plan showed
  south at the top, and South and SE looked from the north and the
  north-east. Each now looks from the side it names, in every 3D view.
- **Fixed** — a period with only calm hours was reported as "prevailing N":
  every direction tied at zero and the first, north, was taken. The wind
  roses now say "no prevailing direction: all calm" and the summary tile
  "Calm".
- **Changed** — the 3D wind rose opens from the south, with north at the
  back as on a map and as in the 2D rose, and from a little higher so the
  nearest bars do not hide the middle. Its caption names the tallest bar and
  says it is the most common direction and speed together, not the
  prevailing direction.
- **Docs** — `ARCHITECTURE.md`, `CHANGELOG.md` and `DESIGN.md` added, and a
  statement of how the app is developed added to the README, the method
  notes and `.zenodo.json`.

## [1.1.0](https://github.com/arch85-km/climate-explorer/releases/tag/v1.1.0) — 4 October 2026

Version DOI [10.5281/zenodo.23144280](https://doi.org/10.5281/zenodo.23144280).
What the tool computes is unchanged.

- **Added** — a short companion to the method notes, the method in brief.
- **Added** — the licence, the credits and the release, inside the app:
  click "© Karam Al-Obaidi" in the footer. No library is bundled, and the
  published methods are credited to ASHRAE, NOAA and Givoni–Milne.
- **Changed** — the tab icon is carried inside the HTML, so a copy opened
  from disk or another domain shows the same mark.
- **Fixed** — two claims in the method notes, found by checking them against
  the source. The notes now also say that the app does not read the design
  conditions header of an EPW file.
- **Fixed** — the exercises were corrected against the source, the list of
  unattributed constants now names the source of each, and an overlapping
  figure caption was fixed.
- **Added** — `tools/check-release-metadata.mjs` checks that the version, the
  date and the DOI agree across `package.json`, `CITATION.cff`,
  `.zenodo.json` and both method notes.

## [1.0.0](https://github.com/arch85-km/climate-explorer/releases/tag/v1.0.0) — 17 September 2026

Version DOI [10.5281/zenodo.22814693](https://doi.org/10.5281/zenodo.22814693).
First release.

- Twelve views in five analysis modes (Thermal, Solar, Wind, Daylight and
  Comfort): annual heatmap, daily-range time series, diurnal profiles,
  monthly statistics, distribution, psychrometric chart with ASHRAE 55
  comfort zones and Givoni–Milne passive-strategy polygons, wind rose and
  2D sun path; and in 3D, sun path dome, annual surface, wind rose, and a
  massing block casting the real sun shadow.
- Three themes, including one for projection and one for print, a
  presentation mode, a compare mode for two periods or two climates, and PNG
  export re-rendered at up to 4×.
- Psychrometrics after the ASHRAE Handbook of Fundamentals, solar position
  after NOAA, comfort zones after ASHRAE 55.
- No weather data, no third-party library and no network requests. Runs
  offline and embeds in a WordPress page.
- 54 unit tests, checked against published references.
