# EPW Climate Explorer

A single-file, responsive web app for exploring **EnergyPlus Weather (`.epw`)**
data in 2D and 3D, built for teaching climate-responsive design to architecture
students.

Drop an `.epw` file onto the page and it opens into an instrument: an annual
heatmap, a psychrometric chart with passive-strategy polygons, wind roses, sun
path diagrams, and a massing block casting the real sun shadow for any date and
time.

- **One file, no dependencies.** `dist/epw-visualiser.html` is ~290 KB of
  self-contained HTML. No CDN, no build step at the point of use, no server.
- **Nothing is uploaded.** Weather files are read in the browser with the File API.
- **Works offline**, straight from `file://`, and inside a WordPress page.

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

Three **themes** — dark for projection, light for screens, high-contrast white for
print — plus a **presentation mode** (fullscreen, larger type, collapsed toolbar)
and a **compare mode** that puts two periods, or two climates, side by side on
locked identical scales.

## Quick start

```bash
./tools/fetch-samples.sh   # real EPW files for the tests (not shipped with the app)
npm run build              # src/ -> dist/epw-visualiser.html
npm test                   # 45 unit tests
node test/visual.mjs       # renders every view and screenshots it
```

Then open `dist/epw-visualiser.html` in a browser. Nothing else is required.

For WordPress, see **[docs/wordpress-embed.md](docs/wordpress-embed.md)**.

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
  mean dry bulb of 9.99 °C, 1407 kWh/m² global horizontal, and HDD18 of 3524.

### Colour

Ramps are interpolated in OKLab so equal data steps read as equal colour steps.
Temperature uses a diverging blue↔red pair about 0 °C with a neutral grey centre;
magnitudes use single-hue sequential ramps; wind direction and solar azimuth use a
constant-lightness cyclic ramp, because those quantities genuinely wrap at 360°.
Sequential ramps are monotonic in lightness in every theme, and each theme has its
own steps chosen against its own surface rather than being flipped automatically.

## Keyboard

| Key | Action |
|---|---|
| `P` | Toggle presentation mode |
| `Space` | Play / pause the hour animation |
| `←` `→` | Step the selected hour |
| `Esc` | Leave presentation mode |

## Host API

The page exposes a small API so a host page or a test harness can drive it:

```js
EPWVisualiser.load(epwText, 'name.epw');
EPWVisualiser.setState({ view: 'sundome', theme: 'light', variable: 'directNormal' });
EPWVisualiser.getState();
```

When embedded in an iframe it posts `{ type: 'epwviz:height', height }` to the
parent on every layout change, so the embed can size itself.
