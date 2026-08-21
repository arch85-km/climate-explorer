/**
 * The annual heatmap extruded into relief.
 *
 * 24 hours across, 365 days deep, the value as both height and colour. Reading
 * the same data as a surface rather than a flat carpet makes the diurnal ridge
 * and the seasonal swell obvious, which is exactly the intuition the flat view
 * asks students to infer.
 */
import { MeshBuilder, LineBuilder, rgb01, towards } from '../render/geometry.js';
import { hexRgb } from '../render/canvas2d.js';
import { MONTH_ABBR } from '../epw/parse.js';
import { dayOfYear } from '../core/solar.js';
import { formatValue, unitFor, convert } from '../epw/fields.js';
import { niceTicks } from '../render/canvas2d.js';

const W = 2.0;   // width, hours axis
const D = 3.4;   // depth, days axis
const H = 0.85;  // maximum height

function build(view, theme) {
  const { data, values, mask, field, state, ramp, scale, min, max } = view;
  const ink3 = rgb01(hexRgb(theme.ink3, [130, 130, 130]));
  const surfaceC = rgb01(hexRgb(theme.surface, [18, 18, 18]));
  const gridC = towards(ink3, surfaceC, 0.45);
  const accent = rgb01(hexRgb(theme.accent2, [235, 104, 52]));

  const mesh = new MeshBuilder();
  const lines = new LineBuilder();
  const labels = [];

  const cols = 24;
  const rows = data.nDays;
  const xOf = (c) => -W / 2 + (c / (cols - 1)) * W;
  const zOf = (r) => -D / 2 + (r / Math.max(1, rows - 1)) * D;

  const span = max - min || 1;
  const heightOf = (v) => ((v - min) / span) * H;

  mesh.grid(cols, rows, xOf, zOf, (c, r) => {
    const rec = data.grid[r * 24 + c];
    if (rec < 0) return null;
    const v = values[rec];
    if (!Number.isFinite(v)) return null;
    const t = scale(v);
    let colour = rgb01(ramp.rgb(t));
    if (mask && !mask[rec]) {
      // Unselected hours keep their height but lose their colour, so the
      // analysis period reads as a bright band across the whole year.
      const g = (colour[0] + colour[1] + colour[2]) / 3;
      colour = [g * 0.45, g * 0.45, g * 0.45];
    }
    return { y: heightOf(v), colour };
  });

  // ── base plane and vertical scale ─────────────────────────────────────────
  const baseC = rgb01(hexRgb(theme.surfaceRaised, [40, 40, 40]));
  mesh.quad([-W / 2, -0.004, D / 2], [W / 2, -0.004, D / 2], [W / 2, -0.004, -D / 2], [-W / 2, -0.004, -D / 2], baseC, [0, 1, 0]);

  // Round tick values rather than five equal splits of the raw data range.
  const ticks = niceTicks(min, max, 5).filter((v) => v >= min && v <= max);
  for (const v of (ticks.length >= 2 ? ticks : [min, (min + max) / 2, max])) {
    const y = heightOf(v);
    lines.segment([-W / 2, y, -D / 2], [W / 2, y, -D / 2], gridC);
    lines.segment([-W / 2, y, -D / 2], [-W / 2, y, D / 2], gridC);
    labels.push({
      world: [-W / 2 - 0.02, y, -D / 2],
      text: formatValue(field, v, state.units, { bare: true }),
      color: theme.ink3, size: 10, align: 'right', dx: -4, plateAlpha: 0.55,
    });
  }
  labels.push({
    world: [-W / 2 - 0.02, H * 1.12, -D / 2],
    text: `${field.short} (${unitFor(field, state.units)})`,
    color: theme.ink2, size: 11, weight: 600, align: 'right', dx: -4,
  });

  // ── hour axis ─────────────────────────────────────────────────────────────
  for (let h = 0; h <= 23; h += 3) {
    const x = xOf(h);
    lines.segment([x, 0, D / 2], [x, 0, D / 2 + 0.1], ink3);
    labels.push({
      world: [x, 0, D / 2 + 0.2], text: `${String(h).padStart(2, '0')}h`,
      color: theme.ink3, size: 10,
    });
  }

  // ── month axis ────────────────────────────────────────────────────────────
  for (let m = 0; m < 12; m += 1) {
    const start = dayOfYear(m + 1, 1, data.isLeap) - 1;
    const next = m === 11 ? rows : dayOfYear(m + 2, 1, data.isLeap) - 1;
    const z = zOf((start + next) / 2);
    labels.push({ world: [W / 2 + 0.3, 0, z], text: MONTH_ABBR[m], color: theme.ink3, size: 10 });
    if (m > 0) {
      const zs = zOf(start);
      lines.segment([-W / 2, 0.001, zs], [W / 2, 0.001, zs], gridC);
      lines.segment([W / 2, 0, zs], [W / 2 + 0.2, 0, zs], ink3);
    }
  }

  // ── cutting planes at the selected day and hour ───────────────────────────
  const cur = state.cursor;
  const dayIdx = data.dayKeys.findIndex((k) => k.month === cur.month && k.day === cur.day);
  if (dayIdx >= 0) {
    const z = zOf(dayIdx);
    const pts = [];
    for (let c = 0; c < cols; c += 1) {
      const rec = data.grid[dayIdx * 24 + c];
      const v = rec >= 0 ? values[rec] : NaN;
      pts.push([xOf(c), Number.isFinite(v) ? heightOf(v) + 0.006 : 0.006, z]);
    }
    lines.polyline(pts, accent);
    lines.segment([-W / 2, 0.002, z], [W / 2, 0.002, z], accent);
    labels.push({
      world: [W / 2 + 0.05, 0.02, z],
      text: `${cur.day} ${MONTH_ABBR[cur.month - 1]}`,
      color: theme.accent2, size: 10, weight: 600, align: 'left',
    });
  }
  const hx = xOf(Math.min(23, Math.max(0, cur.hour)));
  const hourPts = [];
  for (let r = 0; r < rows; r += 1) {
    const rec = data.grid[r * 24 + cur.hour];
    const v = rec >= 0 ? values[rec] : NaN;
    hourPts.push([hx, Number.isFinite(v) ? heightOf(v) + 0.006 : 0.006, zOf(r)]);
  }
  lines.polyline(hourPts, accent);

  return {
    objects: [
      { kind: 'mesh', data: mesh.build(view.uint32), opts: { ambient: 0.42, cull: false, light: { x: 0.35, y: 0.86, z: 0.38 } } },
      { kind: 'lines', data: lines.build(), opts: { opacity: 0.95 } },
    ],
    labels,
    camera: { azimuth: -0.62, elevation: 0.6, distance: 5.6, target: [0, 0.32, 0], minDistance: 1.6, maxDistance: 14 },
    caption: `${field.label} · height and colour both show value`,
  };
}

export { build };
