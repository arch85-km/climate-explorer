/**
 * Annual time series: the daily minimum-to-maximum range as a band, with the
 * daily mean drawn over it. The band is what shows a climate's diurnal swing,
 * which a mean-only line hides completely.
 *
 * @version 1.0.0 — 2026-09-15
 */
import {
  beginFrame, scaleLinear, niceDomain, drawValueAxis, drawBottomAxis, drawPlotFrame,
  drawTitle, drawEmpty, drawLegend, clipPlot,
} from '../render/canvas2d.js';
import { MONTH_ABBR } from '../epw/parse.js';
import { dayOfYear } from '../core/solar.js';
import { dailyAggregate } from '../core/stats.js';
import { formatValue, unitFor, convert } from '../epw/fields.js';

const MARGINS = { top: 30, right: 22, bottom: 58, left: 62 };

function draw(canvas, view) {
  const s = beginFrame(canvas, view.root, MARGINS);
  const { ctx, plot, theme } = s;
  const { data, field, values, mask, state } = view;
  if (!data) { drawEmpty(s, 'Load an EPW file to begin'); return s; }

  const daily = dailyAggregate(data, values, 'mean');
  const u = state.units;
  const conv = (v) => convert(field, v, u);

  let lo = Infinity;
  let hi = -Infinity;
  for (let d = 0; d < data.nDays; d += 1) {
    if (Number.isFinite(daily.min[d])) lo = Math.min(lo, daily.min[d]);
    if (Number.isFinite(daily.max[d])) hi = Math.max(hi, daily.max[d]);
  }
  if (!Number.isFinite(lo)) { drawEmpty(s, `No ${field.label.toLowerCase()} data in this file`); return s; }

  const [d0, d1] = niceDomain(conv(lo), conv(hi), 6);
  const y = scaleLinear(d0, d1, plot.bottom, plot.y);
  const x = (dayIdx) => plot.x + ((dayIdx + 0.5) / data.nDays) * plot.w;

  // Shade the days outside the analysis period.
  const inPeriod = new Uint8Array(data.nDays);
  for (let i = 0; i < data.n; i += 1) if (mask[i]) inPeriod[data.dayIndexOf[i]] = 1;
  ctx.save();
  ctx.fillStyle = theme.night;
  for (let d = 0; d < data.nDays; d += 1) {
    if (inPeriod[d]) continue;
    ctx.fillRect(plot.x + (d / data.nDays) * plot.w, plot.y, plot.w / data.nDays + 0.5, plot.h);
  }
  ctx.restore();

  drawValueAxis(s, y, { label: `${field.label} (${unitFor(field, u)})`, zeroLine: d0 < 0 && d1 > 0 });

  // Month gridlines and labels.
  const entries = [];
  for (let m = 0; m < 12; m += 1) {
    const start = dayOfYear(m + 1, 1, data.isLeap) - 1;
    const next = m === 11 ? data.nDays : dayOfYear(m + 2, 1, data.isLeap) - 1;
    entries.push({ x: plot.x + ((start + next) / 2 / data.nDays) * plot.w, label: MONTH_ABBR[m] });
    if (m > 0) entries.push({ x: plot.x + (start / data.nDays) * plot.w, label: '', gridline: true });
  }
  drawBottomAxis(s, entries.filter((e) => e.label), {});
  ctx.save();
  ctx.strokeStyle = theme.grid;
  for (let m = 1; m < 12; m += 1) {
    const px = Math.round(plot.x + ((dayOfYear(m + 1, 1, data.isLeap) - 1) / data.nDays) * plot.w) + 0.5;
    ctx.beginPath();
    ctx.moveTo(px, plot.y);
    ctx.lineTo(px, plot.bottom);
    ctx.stroke();
  }
  ctx.restore();

  clipPlot(s);

  // Daily range band.
  ctx.beginPath();
  let started = false;
  for (let d = 0; d < data.nDays; d += 1) {
    if (!Number.isFinite(daily.max[d])) continue;
    const px = x(d);
    if (started) ctx.lineTo(px, y(conv(daily.max[d]))); else { ctx.moveTo(px, y(conv(daily.max[d]))); started = true; }
  }
  for (let d = data.nDays - 1; d >= 0; d -= 1) {
    if (!Number.isFinite(daily.min[d])) continue;
    ctx.lineTo(x(d), y(conv(daily.min[d])));
  }
  ctx.closePath();
  ctx.fillStyle = theme.accent;
  ctx.globalAlpha = 0.3;
  ctx.fill();
  ctx.globalAlpha = 1;

  // Daily mean.
  ctx.beginPath();
  started = false;
  for (let d = 0; d < data.nDays; d += 1) {
    const v = daily.values[d];
    if (!Number.isFinite(v)) { started = false; continue; }
    const px = x(d);
    const py = y(conv(v));
    if (started) ctx.lineTo(px, py); else { ctx.moveTo(px, py); started = true; }
  }
  ctx.strokeStyle = theme.ink1;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Comfort band, when the variable is a temperature and the mode asks for it.
  if (view.showComfortBand && field.unit === '°C') {
    const lo2 = y(conv(state.stats.comfortLow));
    const hi2 = y(conv(state.stats.comfortHigh));
    ctx.fillStyle = theme.series[2];
    ctx.globalAlpha = 0.14;
    ctx.fillRect(plot.x, hi2, plot.w, lo2 - hi2);
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  drawPlotFrame(s);
  drawLegend(s, [
    { label: 'Daily mean', color: theme.ink1, dash: false },
    { label: 'Daily minimum to maximum', color: theme.accent },
    ...(view.showComfortBand && field.unit === '°C'
      ? [{ label: `Comfort band ${formatValue(field, state.stats.comfortLow, u)}–${formatValue(field, state.stats.comfortHigh, u)}`, color: theme.series[2] }]
      : []),
  ], { y: plot.bottom + 40 });

  drawTitle(s, `${field.label} — daily range`, view.subtitle);
  return s;
}

function probe(s, view, px, py) {
  const { plot } = s;
  const { data } = view;
  if (!data || px < plot.x || px > plot.right || py < plot.y || py > plot.bottom) return null;
  const d = Math.min(data.nDays - 1, Math.max(0, Math.floor(((px - plot.x) / plot.w) * data.nDays)));
  const key = data.dayKeys[d];
  const rec = data.grid[d * 24 + Math.min(23, Math.max(0, view.state.cursor.hour))];
  return {
    record: rec >= 0 ? rec : data.grid[d * 24],
    day: d,
    title: `${key.day} ${MONTH_ABBR[key.month - 1]}`,
    daily: true,
    x: plot.x + ((d + 0.5) / data.nDays) * plot.w,
    y: py,
  };
}

export { draw, probe, MARGINS };
