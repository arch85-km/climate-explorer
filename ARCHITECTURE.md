# Architecture

How Climate Explorer is put together: what lives where, how a weather file
becomes a chart, and what the tooling around it does. For what each quantity
means, which published method it implements and what the tool does not model,
read the [method notes](docs/climate-explorer-method-notes.html). This file is
the map.

## Source and deliverable

| Path | What it is |
|---|---|
| `src/` | The source: 40 JavaScript modules (ES modules), `styles.css` and `shell.html` |
| `dist/climate-explorer.html` | The deliverable: one self-contained file, about 341 KB, built from `src/` by `build.js`. This is the file uploaded to the website. |

`build.js` has no dependencies. It concatenates the modules into one script
with a small module runtime (`__def` / `__req`). To keep that possible, the
source follows two rules the build enforces: imports are single-line named or
namespace imports, and exports are named (no default exports). The build
also:

- injects the CSS and the script into `shell.html`, with the title and
  tagline read from `src/data/branding.js`;
- writes the version and release date from `package.json` into
  `src/data/version.js`, the `<meta name="version">` and
  `<meta name="build-date">` tags, and the licence comment at the top of
  the file;
- embeds an example weather file if one is placed in `assets/`. None is, so
  the app ships with **no weather data** and opens on an empty state.

The built file contains no third-party library. It makes no network
requests and stores nothing in the browser: no `localStorage`, no cookies.
A weather file is read locally and never uploaded.

## Conventions

- Units are SI internally. The toolbar switches the display to IP, and the
  conversion happens at the point of display (`convert` and `unitFor` in
  `epw/fields.js`).
- Psychrometrics use °C, Pa, kg water per kg dry air and kJ/kg dry air.
- Solar azimuth is measured clockwise from true north (0 N, 90 E, 180 S,
  270 W). Times are local standard time with no daylight-saving shift,
  matching the EnergyPlus convention for EPW files.
- The version and release date are declared once, in `package.json`
  (`version`, `releaseDate`). `npm run stamp` (`tools/stamp-version.mjs`)
  writes them into every source file's `@version` header line, and
  `npm run build` carries them into the built file.

## The modules

| Folder | Modules | What they do |
|---|---|---|
| `epw/` | `fields.js`, `parse.js` | The EPW field registry (order, units and missing-value sentinels from the EnergyPlus data dictionary) and the parser. The record count is counted, not assumed, so leap-year and partial-year files parse. |
| `core/` | `dataset.js` | Derives what the file does not carry, once on load: solar position for every hour and the psychrometric quantities. |
| | `psychro.js` | Psychrometrics after the ASHRAE Handbook of Fundamentals, Ch. 1: saturation pressure over water and ice, humidity ratio, enthalpy, dew point, wet bulb by bisection, and the comfort and passive-strategy polygons. |
| | `solar.js` | Solar position after the NOAA General Solar Position Calculations, with refraction and sunrise and sunset at the 90.833° zenith. |
| | `stats.js` | Summaries, percentiles, circular means, monthly and diurnal aggregates, histograms, degree days and the wind rose. Every function takes a mask, so all views follow the analysis period. |
| | `filter.js` | The analysis period: the date and hour selection every view reads. |
| | `state.js` | The store, the single source of truth. Views hold no state of their own. |
| | `sample.js` | Inflates an embedded example file with the browser's `DecompressionStream`, when one is built in. |
| `data/` | `branding.js`, `version.js`, `sample.js` | The name, the build identity and the optional sample, all filled in by the build. |
| `ui/` | `modes.js` | The five analysis modes and the registry of twelve views. |
| | `toolbar.js`, `controls.js`, `dom.js` | The toolbar and its controls. |
| | `stage.js`, `viewctx.js` | The presentation space, and the context object each view draws from. |
| | `summary.js` | The readout strip: the few numbers worth quoting about a climate. |
| | `export.js` | PNG and CSV export. |
| `render/` | `canvas2d.js`, `colormaps.js` | Shared scaffolding for the 2D charts, and the colour ramps. |
| | `webgl.js`, `mat4.js`, `camera.js`, `geometry.js` | A small WebGL renderer written for the four 3D scenes, the matrix maths, the orbit camera and the geometry builders. Shaders are GLSL ES 1.00, so a WebGL 1 context on an older lab machine also works. |
| `views2d/` | 8 modules | Annual heatmap, time series, daily profiles, monthly statistics, distribution, psychrometric chart, wind rose and 2D sun path. |
| `views3d/` | 5 modules | The 3D host (`scene.js`), sun path dome, annual surface, 3D wind rose, and massing with shadows. |
| | `main.js` | Wires the store to the toolbar, the stages and the readout strip, and owns file loading, the animation loop, presentation mode and the layout. |

## From a weather file to a view

1. The user drops or opens an `.epw`. `main.js` reads it with `FileReader`.
2. `parseEpw` reads the location and the hourly records. Values at or above
   a field's missing-value sentinel become `NaN`. A file it cannot read
   raises `EpwParseError`, which is shown to the user.
3. `buildDataset` adds the derived series: sun position for each hour, and
   humidity ratio, enthalpy and wet bulb.
4. The store takes the dataset. The active **mode** decides which views are
   offered, which variable they open on, and which toolbar controls matter.
5. `buildViewContext` gathers the data, the period mask and the settings,
   and the active view draws from it: a 2D canvas chart, or a scene
   description that `views3d/scene.js` turns into WebGL buffers.
6. `summary.js` refreshes the readout strip from the same mask.

A change in the store notifies the views, so the toolbar, the 2D charts and
the 3D scenes never disagree about the period or the selected hour.

## Modes and views

| Mode | Views |
|---|---|
| Thermal | heatmap, time series, daily profiles, monthly, distribution, annual surface |
| Solar | sun path dome, 2D sun path, massing, heatmap, annual surface, monthly |
| Wind | wind rose, 3D wind rose, heatmap, time series, monthly, distribution |
| Daylight | heatmap, daily profiles, monthly, 2D sun path, annual surface, time series |
| Comfort | psychrometric chart, heatmap, distribution, monthly, daily profiles |

Choices worth knowing when reading the code:

- The **psychrometric chart** bins the hours into a density field instead
  of drawing 8,760 dots. The comfort zones are fixed rectangles. The
  ASHRAE 55 adaptive band (`adaptiveComfort`, `runningMean`) is
  implemented but not called, as the method notes record.
- The **wind rose** takes calm hours out into a centre disc, because EPW
  records them with direction 0 and they would otherwise stack on north.
- The **massing view** casts the block's shadow by projecting its geometry
  onto the ground along the sun vector. For one plane and a directional
  light this is exact, and needs no shadow map.
- **Compare** shows two stages side by side: two periods of one file, or
  two files.

## Presentation and export

- Three themes: dark (for projection), light (for screens) and
  high-contrast (for print and PDF). There is also a presentation mode.
- `exportPng` redraws the view at 1 to 4 times its size (3 by default)
  rather than upscaling, and adds a caption: the variable and the location,
  the period and the file name, and "© Karam Al-Obaidi".
- `exportCsv` writes the aggregated data behind the active view.
- The app is scoped under its own root, so it embeds in a WordPress page:
  see [`docs/wordpress-embed.md`](docs/wordpress-embed.md).

## The repository

```
build.js                     the dependency-free build
package.json                 version, release date and scripts
src/                         the source (above)
dist/climate-explorer.html   the built deliverable
docs/
  climate-explorer-method-notes.html          method notes (Elementor HTML widget)
  climate-explorer-method-notes-summary.html  the method in brief
  wordpress-embed.md                          how to embed the built file
test/
  parse.test.mjs · solar.test.mjs · stats.test.mjs · render.test.mjs   unit tests
  visual.mjs                                  smoke and visual test of the built file
  embed.mjs                                   the built file inside a hostile host page
  fixtures/                                   real EPW files, fetched, not committed
tools/
  check-release-metadata.mjs   the release guard
  stamp-version.mjs            writes the version into the source headers
  fetch-samples.sh             downloads the test fixtures
CITATION.cff · .zenodo.json · LICENSE · NOTICE · README.md
ARCHITECTURE.md · CHANGELOG.md · DESIGN.md
```

## Testing and release

`npm test` runs the release guard and then 54 unit tests (`node --test`):

| Suite | Tests | What it checks |
|---|---|---|
| `parse.test.mjs` | 18 | The EPW parser, on real files |
| `solar.test.mjs` | 12 | Solar position against published references |
| `stats.test.mjs` | 19 | The statistics and psychrometrics, including the running mean |
| `render.test.mjs` | 5 | Scales, ticks and the colour bar |

The real weather files the tests read are not committed:
`npm run samples` downloads the Chicago O'Hare TMY3 and London Gatwick IWEC
files. Three parser tests need a London TMYx file that cannot be
redistributed, and skip cleanly when it is absent.

`npm run test:visual` loads the built file in a browser, feeds it a real EPW
and exercises every view at several widths. `npm run test:embed` renders it
inside a page whose stylesheet is deliberately hostile.

`tools/check-release-metadata.mjs` is the release guard. It runs 21 checks
that the version, the date and the DOI agree everywhere they are written:
`package.json`, `CITATION.cff` and `.zenodo.json` (with its publication date);
every source file's `@version` header; the built file's meta tags; the
README's citation; and each method-notes page's byline, BibTeX version, date
and DOI. Until Zenodo mints a release's version DOI, the notes must cite the
concept DOI; the guard derives that rule from `CITATION.cff`.

Release order: change `package.json`, run `npm run stamp` and
`npm run build`, run `npm test`, push, cut the GitHub release (tag
`vX.Y.Z`), then record the version DOI Zenodo mints in a separate commit.
