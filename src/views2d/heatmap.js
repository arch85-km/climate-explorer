/**
 * Annual heatmap — the "climate carpet".
 *
 * Every hour of the year as one cell: day of year across, hour of day up.
 * Seasonal structure reads vertically, diurnal structure horizontally, and the
 * two together are what makes a climate legible at a glance.
 *
 * Hours outside the analysis period are drawn faded rather than removed, so the
 * selection stays readable in the context of the whole year.
 */
import {
  beginFrame, drawTitle, drawColorbar, drawBottomAxis, drawPlotFrame, drawEmpty, hexRgb,
} from '../render/canvas2d.js';
import { MONTH_ABBR } from '../epw/parse.js';
import { dayOfYear, sunTimes } from '../core/solar.js';
import { formatValue, unitFor } from '../epw/fields.js';

const MARGINS = { top: 30, right: 88, bottom: 42, left: 52 };

/** Cache the pixel buffer between frames; only the data or theme change it. */
let cache = { key: '', canvas: null };

function buildImage(view) {
  const { data, values, mask, scale, ramp, theme } = view;
  const cols = data.nDays;
  const key = [
    data.location.city, view.field.key, view.theme, view.min, view.max, view.maskKey, cols,
  ].join('|');
  if (cache.key === key && cache.canvas) return cache.canvas;

  const off = document.createElement('canvas');
  off.width = cols;
  off.height = 24;
  const octx = off.getContext('2d');
  const img = octx.createImageData(cols, 24);
  const px = img.data;
  const [sr, sg, sb] = hexRgb(theme.surface, [20, 20, 20]);

  for (let d = 0; d < cols; d += 1) {
    for (let h = 0; h < 24; h += 1) {
      const rec = data.grid[d * 24 + h];
      // Row 0 of the image is the top of the chart, which is hour 23.
      const p = ((23 - h) * cols + d) * 4;
      if (rec < 0 || !Number.isFinite(values[rec])) {
        px[p] = sr; px[p + 1] = sg; px[p + 2] = sb; px[p + 3] = 255;
        continue;
      }
      const [r, g, b] = ramp.rgb(scale(values[rec]));
      if (mask && !mask[rec]) {
        // Fade unselected hours toward the surface instead of hiding them.
        px[p] = Math.round(r * 0.22 + sr * 0.78);
        px[p + 1] = Math.round(g * 0.22 + sg * 0.78);
        px[p + 2] = Math.round(b * 0.22 + sb * 0.78);
      } else {
        px[p] = r; px[p + 1] = g; px[p + 2] = b;
      }
      px[p + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  cache = { key, canvas: off };
  return off;
}

function draw(canvas, view) {
  const s = beginFrame(canvas, view.root, MARGINS);
  const { ctx, plot, theme } = s;
  const { data, field, state } = view;
  if (!data) { drawEmpty(s, 'Load an EPW file to begin'); return s; }

  const img = buildImage(view);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, plot.x, plot.y, plot.w, plot.h);
  ctx.imageSmoothingEnabled = true;

  // Month boundaries. On a narrow canvas only every other month is labelled,
  // because twelve abbreviations across a phone screen run together.
  const entries = [];
  const labelEvery = plot.w < 380 ? 3 : plot.w < 560 ? 2 : 1;
  for (let m = 0; m < 12; m += 1) {
    const start = dayOfYear(m + 1, 1, data.isLeap) - 1;
    const next = m === 11 ? data.nDays : dayOfYear(m + 2, 1, data.isLeap) - 1;
    const x0 = plot.x + (start / data.nDays) * plot.w;
    const x1 = plot.x + (next / data.nDays) * plot.w;
    entries.push({ x: (x0 + x1) / 2, label: m % labelEvery === 0 ? MONTH_ABBR[m] : '' });
    if (m > 0) {
      ctx.save();
      ctx.strokeStyle = theme.gridStrong;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x0) + 0.5, plot.y);
      ctx.lineTo(Math.round(x0) + 0.5, plot.bottom);
      ctx.stroke();
      ctx.restore();
    }
  }
  drawBottomAxis(s, entries.filter((e) => e.label), {});

  // Hour axis.
  ctx.save();
  s.font(11);
  ctx.fillStyle = theme.ink3;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let h = 0; h <= 24; h += 6) {
    const y = plot.bottom - (h / 24) * plot.h;
    // The top of the axis is the end of hour 23, i.e. 24:00 — not a second midnight.
    ctx.fillText(`${String(h).padStart(2, '0')}:00`, plot.x - 8, y);
    ctx.strokeStyle = theme.grid;
    ctx.beginPath();
    ctx.moveTo(plot.x, Math.round(y) + 0.5);
    ctx.lineTo(plot.right, Math.round(y) + 0.5);
    ctx.stroke();
  }
  ctx.restore();

  // Sunrise/sunset curve: the single most useful overlay on a climate carpet,
  // because it separates the daylit hours from the dark ones at a glance.
  if (state.showSunHours !== false) {
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = theme.ink1;
    ctx.globalAlpha = 0.55;
    for (const which of ['sunrise', 'sunset']) {
      ctx.beginPath();
      let started = false;
      for (let d = 0; d < data.nDays; d += 1) {
        const t = sunTimes(data.location, d + 1);
        const v = t[which];
        if (v == null) { started = false; continue; }
        const x = plot.x + ((d + 0.5) / data.nDays) * plot.w;
        const y = plot.bottom - (v / 24) * plot.h;
        if (started) ctx.lineTo(x, y); else { ctx.moveTo(x, y); started = true; }
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  drawPlotFrame(s);
  drawColorbar(s, view.ramp, view.scale01, view.min, view.max, {
    x: plot.right + 14,
    label: unitFor(field, state.units),
    format: (v) => formatValue(field, v, state.units, { bare: true }),
  });
  drawTitle(s, field.label, view.subtitle);
  return s;
}

/** Which record is under the pointer, for the tooltip. */
function probe(s, view, px, py) {
  const { plot } = s;
  const { data } = view;
  if (!data || px < plot.x || px > plot.right || py < plot.y || py > plot.bottom) return null;
  const d = Math.min(data.nDays - 1, Math.floor(((px - plot.x) / plot.w) * data.nDays));
  const h = Math.min(23, Math.floor(((plot.bottom - py) / plot.h) * 24));
  const rec = data.grid[d * 24 + h];
  if (rec < 0) return null;
  const key = data.dayKeys[d];
  return {
    record: rec,
    day: d,
    hour: h,
    title: `${key.day} ${MONTH_ABBR[key.month - 1]}, ${String(h).padStart(2, '0')}:00–${String(h).padStart(2, '0')}:59`,
    x: plot.x + ((d + 0.5) / data.nDays) * plot.w,
    y: plot.bottom - ((h + 0.5) / 24) * plot.h,
  };
}

/** Discard the cached pixel buffer (called when the file or theme changes). */
function invalidate() { cache = { key: '', canvas: null }; }

export { draw, probe, invalidate, MARGINS };
