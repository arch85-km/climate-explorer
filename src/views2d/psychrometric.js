/**
 * Psychrometric chart with comfort and passive-strategy polygons.
 *
 * Hours are binned onto the chart and drawn as a density field rather than as
 * 8760 overlapping dots, so the shape of the climate is visible instead of a
 * solid smear. The polygons answer the question the chart exists to answer:
 * which hours are already comfortable, and which passive strategy reaches the rest.
 */
import {
  beginFrame, scaleLinear, drawValueAxis, drawBottomAxis, drawPlotFrame, drawTitle,
  drawEmpty, drawLegend, measureLegend, niceTicks, clipPlot,
} from '../render/canvas2d.js';
import {
  humidityRatio, satHumidityRatio, comfortPolygons, pointInPolygon, rhCurve,
  wForWetBulb, STANDARD_PRESSURE,
} from '../core/psychro.js';
import { RAMPS } from '../render/colormaps.js';
import { convert, unitFor } from '../epw/fields.js';
import { FIELD_BY_KEY } from '../epw/fields.js';

const MARGINS = { top: 30, right: 76, bottom: 76, left: 62 };
// Clears the tick row (+7), the axis title (+27) and its descenders before the
// first legend row starts.
const LEGEND_GAP = 54;
const T_MIN = -10;
const T_MAX = 50;
const W_MAX = 0.030; // kg/kg

/**
 * The legend's labels, for measurement only — the percentages are filled in for
 * real once the hours have been counted, and a placeholder of the same width is
 * enough to work out how many rows the legend will wrap to.
 */
function legendLabels(view) {
  const polys = comfortPolygons(view.data.pressureFallback || STANDARD_PRESSURE, {
    humidityLimit: view.state.stats.humidityLimit,
    strategies: view.state.stats.showStrategies,
  });
  return polys.map((poly) => ({ label: `${poly.label} — 00.0%` }));
}

function draw(canvas, view) {
  const { data, mask, state } = view;
  // First pass exists only to obtain a context for measuring; the legend here runs
  // to five entries and wraps to a second row on most panel widths, which the fixed
  // bottom margin used to cut off.
  let s = beginFrame(canvas, view.root, MARGINS);
  if (!data) { drawEmpty(s, 'Load an EPW file to begin'); return s; }
  const legendRows = measureLegend(s, legendLabels(view), s.plot.w);
  s = beginFrame(canvas, view.root, {
    ...MARGINS,
    bottom: MARGINS.bottom + Math.max(0, legendRows.height - 16),
  });
  const { ctx, plot, theme } = s;

  const p = data.pressureFallback || STANDARD_PRESSURE;
  const u = state.units;
  const tField = FIELD_BY_KEY.dryBulb;

  const x = scaleLinear(T_MIN, T_MAX, plot.x, plot.right);
  const y = scaleLinear(0, W_MAX * 1000, plot.bottom, plot.y); // y in g/kg

  const toXY = (t, w) => ({ px: x(t), py: y(w * 1000) });

  // ── grid ──────────────────────────────────────────────────────────────────
  ctx.save();
  s.font(11);
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  for (const t of niceTicks(T_MIN, T_MAX, 7)) {
    const px = Math.round(x(t)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(px, plot.y);
    ctx.lineTo(px, plot.bottom);
    ctx.stroke();
  }
  ctx.restore();

  drawValueAxis(s, y, { label: 'Humidity ratio (g/kg dry air)', target: 6 });
  drawBottomAxis(s, niceTicks(T_MIN, T_MAX, 7).map((t) => ({
    x: x(t), label: convert(tField, t, u).toFixed(0),
  })), { label: `Dry bulb temperature (${unitFor(tField, u)})` });

  clipPlot(s);

  // ── constant relative humidity curves ─────────────────────────────────────
  ctx.save();
  for (let rh = 10; rh <= 100; rh += 10) {
    const pts = rhCurve(rh, T_MIN, T_MAX, p, 90).filter((q) => Number.isFinite(q.w));
    if (!pts.length) continue;
    ctx.beginPath();
    let started = false;
    for (const q of pts) {
      const { px, py } = toXY(q.t, q.w);
      if (py < plot.y - 40) { started = false; continue; }
      if (started) ctx.lineTo(px, py); else { ctx.moveTo(px, py); started = true; }
    }
    ctx.strokeStyle = rh === 100 ? theme.ink2 : theme.grid;
    ctx.lineWidth = rh === 100 ? 1.8 : 1;
    ctx.stroke();

    // Label each curve where it leaves the top of the plot or the right edge.
    const label = `${rh}%`;
    let anchor = null;
    for (const q of pts) {
      const { px, py } = toXY(q.t, q.w);
      // Far enough inside that the 10px label, drawn above the curve, still fits.
      if (py >= plot.y + 16 && px <= plot.right - 4) anchor = { px, py };
      else if (anchor) break;
    }
    if (anchor && rh % 20 === 0) {
      s.font(10, 500);
      ctx.fillStyle = theme.ink3;
      ctx.textBaseline = 'bottom';
      // Flip the label inside the plot when the curve exits at the right edge.
      const w = ctx.measureText(label).width;
      const flip = anchor.px + w + 6 > plot.right;
      ctx.textAlign = flip ? 'right' : 'left';
      ctx.fillText(label, anchor.px + (flip ? -3 : 3), anchor.py - 2);
    }
  }
  ctx.restore();

  // ── constant wet-bulb diagonals ───────────────────────────────────────────
  // Every psychrometric chart carries these: they are the lines an evaporative
  // cooling process moves along, so the strategy polygon cannot be read without them.
  ctx.save();
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  for (let tw = -5; tw <= 35; tw += 5) {
    const pts = [];
    for (let t = tw; t <= T_MAX; t += 1) {
      const w = wForWetBulb(t, tw, p);
      if (!Number.isFinite(w) || w < 0) break;
      pts.push({ t, w });
    }
    if (pts.length < 2) continue;
    ctx.beginPath();
    pts.forEach((q, i) => {
      const { px, py } = toXY(q.t, q.w);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();

    // Label on the saturation curve, where the line begins.
    if (tw % 10 === 0 && tw >= 0) {
      const head = toXY(pts[0].t, pts[0].w);
      if (head.py > plot.y + 12 && head.py < plot.bottom - 4) {
        ctx.setLineDash([]);
        s.font(9, 500);
        ctx.fillStyle = theme.ink3;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${tw}°`, head.px - 4, head.py - 4);
        ctx.setLineDash([2, 3]);
      }
    }
  }
  ctx.setLineDash([]);
  s.font(9, 500);
  ctx.fillStyle = theme.ink3;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('wet bulb °C', plot.x + 6, plot.y + 12);
  ctx.restore();

  // ── density of hours ──────────────────────────────────────────────────────
  const COLS = 120;
  const ROWS = 90;
  const counts = new Int32Array(COLS * ROWS);
  const dryBulb = data.series.dryBulb;
  const wSeries = data.series.humidityRatio; // g/kg
  let maxCount = 0;
  let plotted = 0;
  for (let i = 0; i < data.n; i += 1) {
    if (mask && !mask[i]) continue;
    const t = dryBulb[i];
    const w = wSeries[i];
    if (!Number.isFinite(t) || !Number.isFinite(w)) continue;
    const c = Math.floor(((t - T_MIN) / (T_MAX - T_MIN)) * COLS);
    const r = Math.floor((w / (W_MAX * 1000)) * ROWS);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) continue;
    const k = r * COLS + c;
    counts[k] += 1;
    plotted += 1;
    if (counts[k] > maxCount) maxCount = counts[k];
  }

  const densityRamp = RAMPS[view.theme].humidity;
  const cw = plot.w / COLS;
  const ch = plot.h / ROWS;
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const n = counts[r * COLS + c];
      if (!n) continue;
      // Square-root scaling: linear counts hide everything but the mode.
      const t = Math.sqrt(n / maxCount);
      ctx.fillStyle = densityRamp.css(0.25 + 0.75 * t, 0.35 + 0.6 * t);
      ctx.fillRect(plot.x + c * cw, plot.bottom - (r + 1) * ch, cw + 0.6, ch + 0.6);
    }
  }

  // ── comfort and strategy polygons ─────────────────────────────────────────
  const polys = comfortPolygons(p, {
    humidityLimit: state.stats.humidityLimit,
    strategies: state.stats.showStrategies,
  });
  // Explicit colour per polygon key. Index arithmetic previously gave the
  // "internal heat gain" strategy the same blue as the winter comfort zone.
  const POLY_COLOUR = {
    winter: 0, summer: 1, ventilation: 2, evaporative: 3, internalGains: 5,
  };
  const colourFor = (poly) => theme.series[POLY_COLOUR[poly.key] != null ? POLY_COLOUR[poly.key] : 4];

  const legend = [];
  const counts2 = {};
  for (const poly of polys) counts2[poly.key] = 0;

  for (let i = 0; i < data.n; i += 1) {
    if (mask && !mask[i]) continue;
    const t = dryBulb[i];
    const w = wSeries[i] / 1000;
    if (!Number.isFinite(t) || !Number.isFinite(w)) continue;
    for (const poly of polys) if (pointInPolygon(t, w, poly.points)) counts2[poly.key] += 1;
  }

  polys.forEach((poly) => {
    const colour = colourFor(poly);
    ctx.save();
    ctx.beginPath();
    poly.points.forEach((q, i2) => {
      // Clip the polygon to the saturation curve; states above it cannot exist.
      const wSat = satHumidityRatio(q.t, p);
      const w = Math.min(q.w, Number.isFinite(wSat) ? wSat : q.w);
      const { px, py } = toXY(q.t, w);
      if (i2 === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.strokeStyle = colour;
    ctx.lineWidth = poly.kind === 'comfort' ? 2.2 : 1.6;
    if (poly.kind !== 'comfort') ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (poly.kind === 'comfort') {
      ctx.fillStyle = colour;
      ctx.globalAlpha = 0.13;
      ctx.fill();
    }
    ctx.restore();

    const pct = plotted ? (counts2[poly.key] / plotted) * 100 : 0;
    legend.push({ label: `${poly.label} — ${pct.toFixed(1)}%`, color: colour, dash: poly.kind !== 'comfort' });
  });

  // Direct labels on the polygons — required as relief, since several of these
  // hues sit below 3:1 against a light surface. Labels are nudged apart so the
  // overlapping comfort and strategy polygons do not stack their names.
  ctx.save();
  s.font(10, 600);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const placed = [];
  polys.forEach((poly) => {
    const colour = colourFor(poly);
    let sx = 0;
    let sy = 0;
    let top = Infinity;
    for (const q of poly.points) {
      const { px, py } = toXY(q.t, Math.min(q.w, satHumidityRatio(q.t, p) || q.w));
      sx += px; sy += py; top = Math.min(top, py);
    }
    sx /= poly.points.length;
    // Comfort zones label at their centre; strategies label just inside their
    // top edge, where they are not competing with the comfort boxes.
    sy = poly.kind === 'comfort' ? sy / poly.points.length : top + 10;
    if (sx < plot.x || sx > plot.right || sy < plot.y || sy > plot.bottom) return;
    // "Comfort — winter (1.0 clo)" must label as "Winter", not as a second "Comfort".
    const short = poly.label.startsWith('Comfort — ')
      ? poly.label.slice('Comfort — '.length).replace(/\s*\(.*/, '').replace(/^./, (c) => c.toUpperCase())
      : poly.label.replace(/ —.*/, '');
    const w = ctx.measureText(short).width;
    let attempts = 0;
    while (attempts < 8 && placed.some((b) => Math.abs(b.x - sx) < (b.w + w) / 2 + 6 && Math.abs(b.y - sy) < 15)) {
      sy += 15;
      attempts += 1;
    }
    if (sy > plot.bottom - 6) return;
    placed.push({ x: sx, y: sy, w });
    ctx.fillStyle = theme.surface;
    ctx.globalAlpha = 0.86;
    ctx.fillRect(sx - w / 2 - 3, sy - 7, w + 6, 14);
    ctx.globalAlpha = 1;
    ctx.fillStyle = colour;
    ctx.fillText(short, sx, sy);
  });
  ctx.restore();

  ctx.restore(); // clipPlot
  drawPlotFrame(s);
  drawLegend(s, legend, { y: plot.bottom + LEGEND_GAP, maxWidth: plot.w });
  drawTitle(s, 'Psychrometric chart', `${plotted.toLocaleString()} hours · ${view.subtitle}`);
  return s;
}

function probe(s, view, px, py) {
  const { plot } = s;
  if (!view.data || px < plot.x || px > plot.right || py < plot.y || py > plot.bottom) return null;
  const t = T_MIN + ((px - plot.x) / plot.w) * (T_MAX - T_MIN);
  const w = ((plot.bottom - py) / plot.h) * W_MAX * 1000;
  const p = view.data.pressureFallback || STANDARD_PRESSURE;
  const wSat = satHumidityRatio(t, p) * 1000;
  const rh = wSat > 0 ? Math.min(100, (w / wSat) * 100) : NaN;
  const tField = FIELD_BY_KEY.dryBulb;
  return {
    title: 'Chart position',
    rows: [
      { label: 'Dry bulb', text: `${convert(tField, t, view.state.units).toFixed(1)} ${unitFor(tField, view.state.units)}` },
      { label: 'Humidity ratio', text: `${w.toFixed(1)} g/kg` },
      { label: 'Relative humidity', text: Number.isFinite(rh) ? `${rh.toFixed(0)}%` : '—' },
    ],
    x: px,
    y: py,
  };
}

export { draw, probe, MARGINS };
