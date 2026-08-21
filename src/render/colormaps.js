/**
 * Colour ramps for climate data.
 *
 * Ramps are interpolated in OKLab so that equal steps in the data read as equal
 * steps in colour. Each ramp is defined per theme rather than flipped automatically,
 * so the dark theme has its own chosen steps against the dark surface.
 *
 * Encoding rules, applied by `rampFor`:
 *   - temperature-like quantities use a DIVERGING blue-red pair about a meaningful
 *     midpoint (0 °C for temperature), with a neutral grey centre;
 *   - magnitudes (radiation, illuminance, wind speed, humidity) use SEQUENTIAL
 *     single-hue ramps;
 *   - angular quantities (wind direction, solar azimuth) use a CYCLIC ramp of
 *     near-constant lightness, because the data genuinely wraps at 360°.
 */

// ── OKLab conversion ─────────────────────────────────────────────────────────

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function linearToSrgb(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

function hexToOklab(hex) {
  const h = hex.replace('#', '');
  const r = srgbToLinear(parseInt(h.slice(0, 2), 16) / 255);
  const g = srgbToLinear(parseInt(h.slice(2, 4), 16) / 255);
  const b = srgbToLinear(parseInt(h.slice(4, 6), 16) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb(L, a, bb) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * bb) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [
    Math.max(0, Math.min(255, Math.round(linearToSrgb(r) * 255))),
    Math.max(0, Math.min(255, Math.round(linearToSrgb(g) * 255))),
    Math.max(0, Math.min(255, Math.round(linearToSrgb(b) * 255))),
  ];
}

// ── ramp construction ────────────────────────────────────────────────────────

const LUT_SIZE = 256;

/**
 * Build a ramp from hex stops, pre-sampled into a lookup table so that per-pixel
 * work in the heatmap and per-vertex work in the 3D surface stay cheap.
 */
function makeRamp(stops, opts = {}) {
  const labs = stops.map(hexToOklab);
  const lut = new Uint8ClampedArray(LUT_SIZE * 3);
  for (let i = 0; i < LUT_SIZE; i += 1) {
    const t = i / (LUT_SIZE - 1);
    const x = t * (labs.length - 1);
    const k = Math.min(labs.length - 2, Math.floor(x));
    const f = x - k;
    const A = labs[k];
    const B = labs[k + 1];
    const [r, g, b] = oklabToRgb(
      A[0] + (B[0] - A[0]) * f,
      A[1] + (B[1] - A[1]) * f,
      A[2] + (B[2] - A[2]) * f,
    );
    lut[i * 3] = r; lut[i * 3 + 1] = g; lut[i * 3 + 2] = b;
  }
  return {
    stops,
    lut,
    diverging: !!opts.diverging,
    cyclic: !!opts.cyclic,
    /** @returns {[number,number,number]} rgb for t in 0..1 */
    rgb(t) {
      const i = Math.max(0, Math.min(LUT_SIZE - 1, Math.round(t * (LUT_SIZE - 1)))) * 3;
      return [this.lut[i], this.lut[i + 1], this.lut[i + 2]];
    },
    css(t, alpha) {
      const [r, g, b] = this.rgb(t);
      return alpha == null ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
    },
  };
}

// Steps are drawn from the reference palette's ramps, chosen per surface. The
// palest stops sit clear of the light-grey panel surface (#f6f7f8) so a low value
// still registers instead of dissolving into the background.
const LIGHT = {
  // diverging: cool -> neutral grey -> warm
  temperature: makeRamp(['#0d366b', '#256abf', '#86b6ef', '#e9eaea', '#f0a58a', '#d03b3b', '#7d1d1d'], { diverging: true }),
  solar: makeRamp(['#fbe8cd', '#f6ce93', '#f2ab5e', '#eb6834', '#b73f1c', '#6d2410']),
  daylight: makeRamp(['#f6e5a4', '#f0d574', '#eda100', '#c07100', '#7a4300']),
  humidity: makeRamp(['#daf2e8', '#a9e6cf', '#4fc9a0', '#1baf7a', '#0d7050', '#08402f']),
  wind: makeRamp(['#dbe8fa', '#b7d3f6', '#5598e7', '#256abf', '#0d366b']),
  cloud: makeRamp(['#e6e7e8', '#c9cbcd', '#a2a5a9', '#75787c', '#464a4e']),
  sequential: makeRamp(['#cde2fb', '#86b6ef', '#3987e5', '#256abf', '#0d366b']),
  cyclic: makeRamp(['#2a78d6', '#1baf7a', '#eda100', '#e34948', '#a5539b', '#2a78d6'], { cyclic: true }),
};

const DARK = {
  temperature: makeRamp(['#123a72', '#2a78d6', '#86b6ef', '#383835', '#e2916f', '#d03b3b', '#7d1d1d'], { diverging: true }),
  solar: makeRamp(['#2a1a0c', '#7a3a12', '#c26127', '#e8853c', '#f6c179', '#fce8c4']),
  daylight: makeRamp(['#2b2107', '#7a5300', '#c98500', '#edb63c', '#f9e6a8']),
  humidity: makeRamp(['#08221a', '#0d5c42', '#199e70', '#54c8a1', '#b6ead6']),
  wind: makeRamp(['#0b1e3a', '#184f95', '#3987e5', '#86b6ef', '#d5e6fb']),
  cloud: makeRamp(['#1c1c1b', '#3c3c39', '#66665f', '#9a9a92', '#d6d6ce']),
  sequential: makeRamp(['#0b1e3a', '#184f95', '#3987e5', '#86b6ef', '#d5e6fb']),
  cyclic: makeRamp(['#3987e5', '#199e70', '#c98500', '#e66767', '#b070c0', '#3987e5'], { cyclic: true }),
};

// Print uses the light steps on pure white, with the palest stop darkened so that
// low values still register on paper.
const PRINT = {
  ...LIGHT,
  temperature: makeRamp(['#0d366b', '#256abf', '#9ec5f4', '#e8e7e3', '#f0a58a', '#d03b3b', '#7d1d1d'], { diverging: true }),
  solar: makeRamp(['#fae7c8', '#f2ab5e', '#eb6834', '#b73f1c', '#6d2410']),
  cloud: makeRamp(['#efefec', '#c9c9c4', '#96968f', '#5f5f5b', '#333331']),
};

const RAMPS = { light: LIGHT, dark: DARK, print: PRINT };

/** The ramp a field should use, for the active theme. */
function rampFor(field, theme = 'light') {
  const set = RAMPS[theme] || LIGHT;
  return set[field?.ramp] || set.sequential;
}

/**
 * Map a value onto 0..1 for a ramp.
 *
 * Diverging ramps place `mid` at exactly 0.5 and scale each arm by the larger
 * half-range, so the neutral colour always means the same value and the two arms
 * stay comparable.
 */
function makeScale(ramp, min, max, mid) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) {
    return () => 0.5;
  }
  if (ramp.diverging && Number.isFinite(mid)) {
    const half = Math.max(Math.abs(max - mid), Math.abs(mid - min)) || 1;
    return (v) => Math.max(0, Math.min(1, 0.5 + (v - mid) / (2 * half)));
  }
  if (ramp.cyclic) {
    return (v) => (((v % 360) + 360) % 360) / 360;
  }
  return (v) => Math.max(0, Math.min(1, (v - min) / (max - min)));
}

/**
 * The diverging midpoint for a field, or NaN when it has none.
 *
 * Temperatures centre on the *balance point* (the degree-day base) rather than on
 * freezing: blue then means "this hour needs heating" and red "this hour needs
 * cooling", which is the question a building asks. Centring on 0 °C instead makes
 * every temperate climate read as uniformly hot and wastes half the ramp.
 *
 * @param {object} field
 * @param {number} [balancePoint=18] usually state.stats.degreeDayBase, so the scale
 *   follows the control the student is already adjusting
 */
function midpointFor(field, balancePoint = 18) {
  if (!field) return NaN;
  if (field.unit === '°C') return Number.isFinite(balancePoint) ? balancePoint : 18;
  if (field.key === 'enthalpy') return 30;
  return NaN;
}

export { makeRamp, rampFor, makeScale, midpointFor, RAMPS, hexToOklab, oklabToRgb };
