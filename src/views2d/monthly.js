/**
 * Monthly statistics: the mean as a bar, with a p25–p75 box and p5–p95 whiskers.
 *
 * The box and whiskers are the point of this view — a bare monthly mean tells a
 * student almost nothing about what a month is actually like to be in.
 */
import {
  beginFrame, scaleLinear, niceDomain, drawValueAxis, drawBottomAxis, drawPlotFrame,
  drawTitle, drawEmpty, drawLegend, roundRect, clipPlot,
} from '../render/canvas2d.js';
import { MONTH_ABBR } from '../epw/parse.js';
import { monthlyStats, monthlyAggregate, monthlyDegreeDays } from '../core/stats.js';
import { unitFor, convert, formatValue } from '../epw/fields.js';

const MARGINS = { top: 30, right: 22, bottom: 58, left: 66 };

function draw(canvas, view) {
  const s = beginFrame(canvas, view.root, MARGINS);
  const { ctx, plot, theme } = s;
  const { data, field, values, mask, state } = view;
  if (!data) { drawEmpty(s, 'Load an EPW file to begin'); return s; }

  const u = state.units;
  const conv = (v) => convert(field, v, u);
  const isSum = field.agg === 'sum' && state.stats.aggregation !== 'mean';
  const stats = monthlyStats(data, values, mask);
  const totals = isSum ? monthlyAggregate(data, values, mask, 'sum') : null;

  let lo = Infinity;
  let hi = -Infinity;
  for (const m of stats) {
    if (!m.count) continue;
    lo = Math.min(lo, isSum ? 0 : m.p[5], 0);
    hi = Math.max(hi, isSum ? 0 : m.p[95]);
  }
  if (isSum) { lo = 0; hi = Math.max(...Array.from(totals.values, (v) => (Number.isFinite(v) ? v : 0))); }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { drawEmpty(s, 'No data in the selected period'); return s; }

  const [d0, d1] = niceDomain(conv(Math.min(lo, 0)), conv(hi), 6);
  const y = scaleLinear(d0, d1, plot.bottom, plot.y);
  const band = plot.w / 12;
  const barW = Math.min(38, band * 0.52);

  drawValueAxis(s, y, {
    label: `${field.label} (${unitFor(field, u)}${isSum ? ' per month' : ''})`,
    zeroLine: d0 < 0 && d1 > 0,
  });
  drawBottomAxis(s, MONTH_ABBR.map((label, m) => ({ x: plot.x + band * (m + 0.5), label })), {});

  clipPlot(s);
  const zero = y(Math.max(d0, Math.min(d1, 0)));

  for (let m = 0; m < 12; m += 1) {
    const st = stats[m];
    if (!st.count) continue;
    const cx = plot.x + band * (m + 0.5);

    if (isSum) {
      const v = y(conv(totals.values[m]));
      ctx.fillStyle = view.ramp.css(0.35 + 0.5 * (m / 11));
      roundRect(ctx, cx - barW / 2, Math.min(v, zero), barW, Math.abs(zero - v), 4);
      ctx.fill();
      continue;
    }

    // p5–p95 whisker.
    ctx.strokeStyle = theme.ink3;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx, y(conv(st.p[5])));
    ctx.lineTo(cx, y(conv(st.p[95])));
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 5, y(conv(st.p[5])));
    ctx.lineTo(cx + 5, y(conv(st.p[5])));
    ctx.moveTo(cx - 5, y(conv(st.p[95])));
    ctx.lineTo(cx + 5, y(conv(st.p[95])));
    ctx.stroke();

    // p25–p75 box, filled from the ramp at the month's own mean.
    const boxTop = y(conv(st.p[75]));
    const boxBottom = y(conv(st.p[25]));
    ctx.fillStyle = view.ramp.css(view.scale(st.mean), 0.85);
    roundRect(ctx, cx - barW / 2, boxTop, barW, Math.max(2, boxBottom - boxTop), 4);
    ctx.fill();
    ctx.strokeStyle = theme.surface;
    ctx.lineWidth = 2; // 2px surface ring keeps adjacent boxes from merging
    ctx.stroke();

    // Median and mean.
    ctx.strokeStyle = theme.ink1;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - barW / 2, y(conv(st.p[50])));
    ctx.lineTo(cx + barW / 2, y(conv(st.p[50])));
    ctx.stroke();
    ctx.fillStyle = theme.ink1;
    ctx.beginPath();
    ctx.arc(cx, y(conv(st.mean)), 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = theme.surface;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();

  // Degree days ride along as a second row of information in thermal mode.
  if (view.showDegreeDays && field.key === 'dryBulb') {
    const dd = monthlyDegreeDays(data, values, state.stats.degreeDayBase, mask);
    ctx.save();
    s.font(10);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let m = 0; m < 12; m += 1) {
      const cx = plot.x + band * (m + 0.5);
      ctx.fillStyle = theme.series[0];
      ctx.fillText(dd.hdd[m] >= 1 ? Math.round(dd.hdd[m]) : '', cx, plot.bottom + 20);
      ctx.fillStyle = theme.series[1];
      ctx.fillText(dd.cdd[m] >= 1 ? Math.round(dd.cdd[m]) : '', cx, plot.bottom + 32);
    }
    ctx.textAlign = 'right';
    ctx.fillStyle = theme.ink3;
    ctx.fillText('HDD', plot.x - 8, plot.bottom + 20);
    ctx.fillText('CDD', plot.x - 8, plot.bottom + 32);
    ctx.restore();
  }

  drawPlotFrame(s);
  if (!isSum) {
    drawLegend(s, [
      { label: 'Middle half of hours (p25–p75)', color: view.ramp.css(0.6, 0.85) },
      { label: 'p5–p95 range', color: theme.ink3 },
      { label: 'Median', color: theme.ink1 },
    ], { y: plot.bottom + (view.showDegreeDays && field.key === 'dryBulb' ? 50 : 40) });
  }
  drawTitle(s, `${field.label} by month`, view.subtitle);
  return s;
}

function probe(s, view, px, py) {
  const { plot } = s;
  if (!view.data || px < plot.x || px > plot.right) return null;
  const m = Math.min(11, Math.max(0, Math.floor(((px - plot.x) / plot.w) * 12)));
  const st = monthlyStats(view.data, view.values, view.mask)[m];
  if (!st.count) return null;
  const f = (v) => formatValue(view.field, v, view.state.units);
  return {
    title: MONTH_ABBR[m],
    rows: [
      { label: 'Mean', text: f(st.mean) },
      { label: 'Median', text: f(st.p[50]) },
      { label: 'p25 – p75', text: `${f(st.p[25])} – ${f(st.p[75])}` },
      { label: 'p5 – p95', text: `${f(st.p[5])} – ${f(st.p[95])}` },
      { label: 'Min / max', text: `${f(st.min)} / ${f(st.max)}` },
      { label: 'Hours', text: String(st.count) },
    ],
    x: plot.x + (plot.w / 12) * (m + 0.5),
    y: py,
  };
}

export { draw, probe, MARGINS };
