# Climate Explorer

**A browser-based weather data analysis and visualisation tool.**

A single-file, responsive web app for exploring **EnergyPlus Weather (`.epw`)**
data in 2D and 3D, built for teaching climate-responsive design to architecture
students.

It opens on an empty state and waits for a weather file. Drop an `.epw` onto it
and it becomes an instrument: an annual heatmap, a psychrometric chart with
passive-strategy polygons, wind roses, sun path diagrams, and a massing block
casting the real sun shadow for any date and time.

- **One file, no dependencies.** `dist/climate-explorer.html` is about 320 KB of
  self-contained HTML. No CDN, no build step at the point of use, no server.
- **No weather data ships with it.** Publishing the app would mean redistributing
  whatever climate file were embedded in it, and those carry their own attribution
  terms. Students supply their own, which every other tool asks of them anyway.
- **Nothing is uploaded.** Weather files are read in the browser with the File API.
- **Works offline**, straight from `file://`, and inside a WordPress page.

The machinery for embedding an example is kept but dormant — see
[Bundling your own example](#bundling-your-own-example) for how to switch it on
for a file you hold the rights to redistribute.

## Views

| | 2D | 3D |
|---|---|---|
| **Thermal** | annual heatmap, daily range, diurnal profiles, monthly statistics, distribution | annual surface |
| **Solar** | sun path (stereographic / orthographic) | sun path dome, massing & shadows |
| **Wind** | wind rose | 3D wind rose |
| **Comfort** | psychrometric chart with ASHRAE 55 zones and Givoni strategy polygons | |

Five **analysis modes** — Thermal, Solar, Wind, Daylight, Comfort — reconfigure the
view shelf and preselect variables as a set, so a tutor can walk a class through a
structured climate study in one click per step.

Three **themes** — light grey (the default), dark for projection, and high-contrast
white for print — plus a **presentation mode** (fullscreen, larger type, collapsed
toolbar) and a **compare mode** that puts two periods, or two climates, side by
side. Two periods of one file share a colour scale, so the panels are directly
comparable. Two *files* are each scaled from their own data, so the same colour
means a different value on the left and on the right — read the numbers, not the
colours.

Every 3D view **orbits**: drag to rotate, scroll to zoom, shift-drag to pan, with
Plan / South / SE / Perspective preset angles and a reset — the angles a shadow
study gets checked from.

## Quick start

```bash
./tools/fetch-samples.sh   # real EPW files for the tests (not shipped with the app)
npm run build              # src/ -> dist/climate-explorer.html
npm test                   # 45 unit tests
node test/visual.mjs       # renders every view and screenshots it
```

Then open `dist/climate-explorer.html` in a browser. Nothing else is required.

For WordPress, see **[docs/wordpress-embed.md](docs/wordpress-embed.md)**.

## Bundling your own example

The app ships with no weather data, but the mechanism to embed one is kept. To have
a file load automatically on open:

1. Put the `.epw` in `assets/`.
2. Set `SAMPLE_SOURCE` and `SAMPLE_LABEL` in `src/data/sample.js` to match it.
3. `npm run build`.

`build.js` gzips the file and inlines it as base64 (about 1.5 MB of EPW becomes
~350 KB embedded), and the app inflates it at startup with the browser's own
`DecompressionStream`. Only do this for a file you hold the rights to redistribute
— publishing the built HTML distributes that file to every visitor.

## Where to get EPW files

- [climate.onebuilding.org](https://climate.onebuilding.org) — the most complete
  free collection, including recent TMYx files.
- [energyplus.net/weather](https://energyplus.net/weather) — the original
  EnergyPlus set.

## How it works

`src/` is authored as small ES modules; `build.js` (Node built-ins only)
concatenates them into the single output file. The zero-dependency constraint
applies to the *deliverable*, not to authoring.

```
assets/           not present — create it only to bundle an example (see above)
src/data/         sample.js — an example's base64 would be injected here at build time
src/epw/          parse.js (8 header lines + hourly records), fields.js (field registry)
src/core/         solar.js (NOAA position), psychro.js (ASHRAE), stats.js,
                  filter.js (analysis period), dataset.js, state.js
src/render/       canvas2d.js, colormaps.js (OKLab ramps), webgl.js, mat4.js,
                  camera.js, geometry.js
src/views2d/      eight Canvas 2D charts
src/views3d/      four hand-rolled WebGL scenes + the scene host
src/ui/           toolbar, stage, summary tiles, export, modes
build.js          the bundler
```

There is no Three.js. The four 3D scenes need only a Lambert shader, an unlit line
shader, an orbit camera and planar-projected shadows — a few hundred lines, and it
keeps a ~600 KB dependency out of the deliverable. Shaders are GLSL ES 1.00 so the
app runs on a WebGL 1 context, which matters on teaching-lab machines.

### Accuracy

The numbers are meant to be quotable in a crit, so they are tested against
references rather than eyeballed:

- **Solar position** — NOAA algorithm, verified against physical identities: the
  solar-noon altitude identity holds to 0.01°, equinox sunrise is due east to
  within 0.5°, declination spans ±23.44°, and the equation of time hits −14.2 min
  and +16.4 min on the right days.
- **Psychrometrics** — ASHRAE Fundamentals formulations; saturation pressure is
  within 0.05% of Table 1, and 25 °C/50% RH reproduces the published wet bulb
  (17.87 °C) and dew point (13.85 °C).
- **Parsing** — verified against real files. Chicago O'Hare TMY3 gives an annual
  mean dry bulb of 9.99 °C, 1407 kWh/m² global horizontal, and HDD18 of 3524;
  London St James's Park TMYx gives 11.4 °C, 1073 kWh/m² and HDD18 of 2573. Both
  are test fixtures, not shipped with the app.

### Colour

Ramps are interpolated in OKLab so equal data steps read as equal colour steps.
Temperature uses a diverging blue↔red pair centred on the **balance point** (the
degree-day base, which the toolbar controls) with a neutral grey midpoint — so blue
means "this hour needs heating" and red "this hour needs cooling". Centring on
freezing instead makes every temperate climate read as uniformly hot;
magnitudes use single-hue sequential ramps; wind direction and solar azimuth use a
constant-lightness cyclic ramp, because those quantities genuinely wrap at 360°.
Sequential ramps are monotonic in lightness in every theme, and each theme has its
own steps chosen against its own surface rather than being flipped automatically.

## Licence

Two licences, because the repository holds two kinds of thing:

- **The code** — MIT. See [`LICENSE`](LICENSE). Use it, change it, redistribute
  it, including commercially; keep the copyright and permission notice.
- **The accompanying material** — Creative Commons Attribution 4.0 International
  (CC BY 4.0). See [`LICENSE-DOCS`](LICENSE-DOCS). This covers `README.md`,
  `docs/`, screenshots and any teaching exercises distributed with the project:
  share and adapt freely, with credit.

Copyright © 2026 Karam Al-Obaidi.

No third-party code and no third-party weather data are redistributed by the
built file — see the dependency note above.

## Version

The version and release date live in one place, `package.json` (`version` and
`releaseDate`), and flow from there to:

- the built file's `<meta name="version">` and `<meta name="build-date">`, and the
  licence comment at the top of the HTML;
- a line at the foot of the app's control rail;
- an `@version` line in each source file's header comment, written by
  `npm run stamp`.

Run `npm run stamp` after changing the version, then `npm run build`.

## Keyboard

| Key | Action |
|---|---|
| `P` | Toggle presentation mode |
| `Space` | Play / pause the hour animation |
| `←` `→` | Step the selected hour |
| `Esc` | Leave presentation mode |

In any 3D view: drag to orbit, scroll to zoom, shift-drag to pan.

## Host API

The page exposes a small API so a host page or a test harness can drive it:

```js
EPWVisualiser.load(epwText, 'name.epw');
EPWVisualiser.setState({ view: 'sundome', theme: 'light', variable: 'directNormal' });
EPWVisualiser.getState();
```

`EPWVisualiser.sceneInfo()` returns the active 3D scene's frame count and camera,
which the test suite uses to assert that input actually causes a redraw.

When embedded in an iframe it posts `{ type: 'epwviz:height', height }` to the
parent on every layout change, so the embed can size itself.

---

© Karam Al-Obaidi
