/**
 * Average 24-hour profile for each month.
 *
 * Months are an ordered, wrapping sequence rather than twelve unrelated
 * categories, so they are coloured with a cyclic ramp — hue carries the month,
 * and January sits next to December in colour as it does in the calendar.
 *
 * @version 1.0.0 — 2026-09-15
 */
import {
  beginFrame, scaleLinear, niceDomain, drawValueAxis, drawBottomAxis, drawPlotFrame,
  drawTitle, drawEmpty, clipPlot,
} from '../render/canvas2d.js';
import { MONTH_ABBR } from '../epw/parse.js';
import { diurnalByMonth, diurnalProfile } from '../core/stats.js';
import { RAMPS } from '../render/colormaps.js';
import { unitFor, convert } from '../epw/fields.js';

const MARGINS = { top: 30, right: 96, bottom: 46, left: 62 };
const HIGHLIGHT = [0, 3, 6, 9]; // Jan, Apr, Jul, Oct get direct labels

function draw(canvas, view) {
  const s = beginFrame(canvas, view.root, MARGINS);
  const { ctx, plot, theme } = s;
  const { data, field, values, mask, state } = view;
  if (!data) { drawEmpty(s, 'Load an EPW file to begin'); return s; }

  const grid = diurnalByMonth(data, values, mask);
  const overall = diurnalProfile(data, values, mask);
  const u = state.units;
  const conv = (v) => convert(field, v, u);

  let lo = Infinity;
  let hi = -Infinity;
  for (const v of grid) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (!Number.isFinite(lo)) { drawEmpty(s, 'No data in the selected period'); return s; }

  const [d0, d1] = niceDomain(conv(lo), conv(hi), 6);
  const y = scaleLinear(d0, d1, plot.bottom, plot.y);
  const x = (h) => plot.x + (h / 23) * plot.w;

  drawValueAxis(s, y, { label: `${field.label} (${unitFor(field, u)})`, zeroLine: d0 < 0 && d1 > 0 });
  drawBottomAxis(s, [0, 3, 6, 9, 12, 15, 18, 21].map((h) => ({
    x: x(h), label: `${String(h).padStart(2, '0')}:00`,
  })), { gridlines: true, label: 'Hour of day' });

  const monthRamp = RAMPS[view.theme].cyclic;
  clipPlot(s);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (let m = 0; m < 12; m += 1) {
    ctx.beginPath();
    let started = false;
    for (let h = 0; h < 24; h += 1) {
      const v = grid[m * 24 + h];
      if (!Number.isFinite(v)) { started = false; continue; }
      const px = x(h);
      const py = y(conv(v));
      if (started) ctx.lineTo(px, py); else { ctx.moveTo(px, py); started = true; }
    }
    ctx.strokeStyle = monthRamp.css(m / 12);
    ctx.lineWidth = HIGHLIGHT.includes(m) ? 2.2 : 1.4;
    ctx.globalAlpha = HIGHLIGHT.includes(m) ? 1 : 0.72;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // The all-months mean, as the reference the individual months vary about.
  ctx.beginPath();
  let started = false;
  for (let h = 0; h < 24; h += 1) {
    const v = overall.mean[h];
    if (!Number.isFinite(v)) { started = false; continue; }
    if (started) ctx.lineTo(x(h), y(conv(v))); else { ctx.moveTo(x(h), y(conv(v))); started = true; }
  }
  ctx.strokeStyle = theme.ink1;
  ctx.lineWidth = 2.4;
  ctx.setLineDash([5, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // Direct labels at the right-hand end of the highlighted months.
  ctx.save();
  s.font(11, 600);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const placed = [];
  for (const m of HIGHLIGHT) {
    const v = grid[m * 24 + 23];
    if (!Number.isFinite(v)) continue;
    let py = y(conv(v));
    while (placed.some((p) => Math.abs(p - py) < 13)) py += 13;
    placed.push(py);
    ctx.fillStyle = monthRamp.css(m / 12);
    ctx.fillText(MONTH_ABBR[m], plot.right + 8, py);
  }
  // A compact month ramp acts as the legend for the eight unlabelled months.
  const lx = plot.right + 46;
  const ly = plot.y + 4;
  const lh = Math.min(140, plot.h - 8);
  for (let i = 0; i < 48; i += 1) {
    ctx.fillStyle = monthRamp.css(i / 48);
    ctx.fillRect(lx, ly + (i * lh) / 48, 8, lh / 48 + 1);
  }
  ctx.strokeStyle = theme.axis;
  ctx.lineWidth = 1;
  ctx.strokeRect(lx + 0.5, ly + 0.5, 8, lh);
  s.font(10, 400);
  ctx.fillStyle = theme.ink3;
  ctx.fillText('Jan', lx + 12, ly + 5);
  ctx.fillText('Dec', lx + 12, ly + lh - 5);
  ctx.restore();

  drawPlotFrame(s);
  drawTitle(s, `${field.label} — average day by month`, view.subtitle);
  return s;
}

function probe(s, view, px, py) {
  const { plot } = s;
  if (!view.data || px < plot.x || px > plot.right) return null;
  const h = Math.round(((px - plot.x) / plot.w) * 23);
  const grid = diurnalByMonth(view.data, view.values, view.mask);
  return {
    hourOnly: h,
    title: `${String(h).padStart(2, '0')}:00 average`,
    rows: Array.from({ length: 12 }, (_, m) => ({ label: MONTH_ABBR[m], value: grid[m * 24 + h] })),
    x: plot.x + (h / 23) * plot.w,
    y: py,
  };
}

export { draw, probe, MARGINS };
