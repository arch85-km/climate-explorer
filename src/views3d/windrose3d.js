/**
 * 3D wind rose.
 *
 * Direction around, speed band outward, frequency as height. The flat rose has
 * to encode two of those three in one radius; giving frequency its own axis lets
 * a student read "how often" and "how fast" independently, which is what matters
 * when deciding whether a facade opening is worth having.
 */
import { MeshBuilder, LineBuilder, rgb01, towards } from '../render/geometry.js';
import { hexRgb } from '../render/canvas2d.js';
import { windRose } from '../core/stats.js';
import { RAMPS } from '../render/colormaps.js';
import { FIELD_BY_KEY, convert, unitFor } from '../epw/fields.js';

const R_INNER = 0.22;
const R_OUTER = 1.5;
const H_MAX = 1.0;

function build(view, theme) {
  const { data, mask, state } = view;
  const sectors = state.stats.sectors || 16;
  const rose = windRose(data, mask, { sectors });

  const ink3 = rgb01(hexRgb(theme.ink3, [130, 130, 130]));
  const surfaceC = rgb01(hexRgb(theme.surface, [18, 18, 18]));
  const gridC = towards(ink3, surfaceC, 0.5);
  const mesh = new MeshBuilder();
  const lines = new LineBuilder();
  const labels = [];

  if (!rose.total) {
    return { objects: [], labels: [{ world: [0, 0, 0], text: 'No wind data in this period', color: theme.ink3, size: 13, always: true }], camera: {} };
  }

  const ramp = RAMPS[view.theme].wind;
  const bands = rose.bandCount;
  const bandWidth = (R_OUTER - R_INNER) / bands;
  const sectorAngle = (Math.PI * 2) / sectors;
  const gap = sectorAngle * 0.09;

  // Height scale: the tallest single (sector, band) cell fills H_MAX.
  let maxCell = 0;
  for (let i = 0; i < rose.counts.length; i += 1) maxCell = Math.max(maxCell, rose.counts[i]);
  const pctOf = (n) => (n / rose.total) * 100;
  const maxPct = pctOf(maxCell) || 1;
  const hOf = (n) => (pctOf(n) / maxPct) * H_MAX;

  for (let sec = 0; sec < sectors; sec += 1) {
    const a0 = sec * sectorAngle - sectorAngle / 2 + gap / 2;
    const a1 = sec * sectorAngle + sectorAngle / 2 - gap / 2;
    for (let b = 0; b < bands; b += 1) {
      const n = rose.counts[sec * bands + b];
      if (!n) continue;
      const inner = R_INNER + b * bandWidth;
      const outer = inner + bandWidth * 0.9; // 2px-equivalent gap between bands
      const t = 0.25 + 0.7 * (b / Math.max(1, bands - 1));
      mesh.wedge(inner, outer, a0, a1, 0, hOf(n), rgb01(ramp.rgb(t)), 5);
    }
  }

  // ── ground rings, one per speed band, labelled with the band ──────────────
  const speedField = FIELD_BY_KEY.windSpeed;
  for (let b = 0; b <= bands; b += 1) {
    const r = R_INNER + b * bandWidth;
    lines.circle(r, 0.001, gridC, 96);
    if (b < bands) {
      const lo = rose.speedBands[b];
      const hi = rose.speedBands[b + 1];
      const text = hi == null
        ? `≥${convert(speedField, lo, state.units).toFixed(0)}`
        : `${convert(speedField, lo, state.units).toFixed(0)}–${convert(speedField, hi, state.units).toFixed(0)}`;
      const a = sectorAngle * 0.5;
      labels.push({
        world: [Math.sin(a) * (r + bandWidth / 2), 0, -Math.cos(a) * (r + bandWidth / 2)],
        text, color: theme.ink3, size: 9, plateAlpha: 0.6,
      });
    }
  }
  labels.push({
    world: [0, 0, -(R_OUTER + 0.42)],
    text: `Speed band (${unitFor(speedField, state.units)}) — outward`,
    color: theme.ink2, size: 10, weight: 600,
  });

  // ── height scale ──────────────────────────────────────────────────────────
  const step = maxPct <= 2 ? 0.5 : maxPct <= 6 ? 1 : maxPct <= 15 ? 2 : 5;
  for (let p = 0; p <= maxPct; p += step) {
    const y = (p / maxPct) * H_MAX;
    lines.segment([R_OUTER + 0.08, y, 0], [R_OUTER + 0.16, y, 0], gridC);
    labels.push({
      world: [R_OUTER + 0.2, y, 0], text: `${p}%`, color: theme.ink3, size: 9, align: 'left', plateAlpha: 0.6,
    });
  }
  lines.segment([R_OUTER + 0.12, 0, 0], [R_OUTER + 0.12, H_MAX, 0], gridC);

  // ── calm disc ─────────────────────────────────────────────────────────────
  if (rose.calm) {
    const calmC = rgb01(hexRgb(theme.surfaceRaised, [40, 40, 40]));
    mesh.wedge(0, R_INNER * 0.92, 0, Math.PI * 2, 0, 0.006, calmC, 48);
    labels.push({
      world: [0, 0.02, 0],
      text: `calm ${(rose.calmFraction * 100).toFixed(1)}%`,
      color: theme.ink3, size: 10, always: true,
    });
  }

  // ── compass ───────────────────────────────────────────────────────────────
  for (const [text, deg] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]]) {
    const a = (deg * Math.PI) / 180;
    const r = R_OUTER + 0.26;
    labels.push({
      world: [Math.sin(a) * r, 0, -Math.cos(a) * r],
      text, color: theme.ink1, size: 14, weight: 700, always: true, plate: false,
    });
    lines.segment([Math.sin(a) * R_OUTER, 0.001, -Math.cos(a) * R_OUTER],
      [Math.sin(a) * (r - 0.08), 0.001, -Math.cos(a) * (r - 0.08)], ink3);
  }

  return {
    objects: [
      { kind: 'mesh', data: mesh.build(view.uint32), opts: { ambient: 0.44, cull: false } },
      { kind: 'lines', data: lines.build(), opts: { opacity: 0.85 } },
    ],
    labels,
    camera: { azimuth: Math.PI * 0.92, elevation: 0.66, distance: 4.3, target: [0, 0.2, 0], minDistance: 1.5, maxDistance: 11 },
    caption: `Prevailing ${rose.prevailingLabel} · ${rose.total.toLocaleString()} hours · height is frequency`,
  };
}

export { build };
