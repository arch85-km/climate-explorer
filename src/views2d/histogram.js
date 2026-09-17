/**
 * Distribution: how often each value occurs, and the cumulative curve beneath.
 *
 * Frequency and cumulative frequency are drawn as two stacked panels sharing one
 * x axis rather than as two y scales on one plot — the two quantities differ by
 * an order of magnitude, and a second y axis would misrepresent both.
 *
 * @version 1.0.0 — 2026-09-17
 */
import {
  beginFrame, scaleLinear, niceDomain, drawValueAxis, drawBottomAxis, drawPlotFrame,
  drawTitle, drawEmpty, roundRect, niceTicks, tickLabel,
} from '../render/canvas2d.js';
import { histogram, percentiles } from '../core/stats.js';
import { unitFor, convert, formatValue } from '../epw/fields.js';

const MARGINS = { top: 30, right: 22, bottom: 46, left: 62 };
const SPLIT = 0.66; // fraction of the plot height given to the frequency panel
const GAP = 34;

function panels(plot) {
  const topH = (plot.h - GAP) * SPLIT;
  return {
    freq: { y: plot.y, h: topH, bottom: plot.y + topH },
    cum: { y: plot.y + topH + GAP, h: plot.h - topH - GAP, bottom: plot.bottom },
  };
}

function draw(canvas, view) {
  const s = beginFrame(canvas, view.root, MARGINS);
  const { ctx, plot, theme } = s;
  const { field, values, mask, state, data } = view;
  if (!data) { drawEmpty(s, 'Load an EPW file to begin'); return s; }

  const bins = Math.max(6, Math.min(80, state.stats.bins || 30));
  const h = histogram(values, mask, bins);
  if (!h.total) { drawEmpty(s, 'No data in the selected period'); return s; }

  const u = state.units;
  const conv = (v) => convert(field, v, u);
  const p = panels(plot);

  const xDomain = niceDomain(conv(h.min), conv(h.max), 7);
  const x = scaleLinear(xDomain[0], xDomain[1], plot.x, plot.right);

  const maxPct = Math.max(...h.counts) / h.total * 100;
  const yFreq = scaleLinear(0, niceDomain(0, maxPct, 4)[1], p.freq.bottom, p.freq.y);
  const yCum = scaleLinear(0, 100, p.cum.bottom, p.cum.y);

  // Frequency panel.
  ctx.save();
  s.font(11);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of niceTicks(0, yFreq.domain[1], 4)) {
    const py = Math.round(yFreq(t)) + 0.5;
    ctx.strokeStyle = theme.grid;
    ctx.beginPath();
    ctx.moveTo(plot.x, py);
    ctx.lineTo(plot.right, py);
    ctx.stroke();
    ctx.fillStyle = theme.ink3;
    ctx.fillText(`${tickLabel(t, [0, 1])}%`, plot.x - 8, py);
  }
  ctx.restore();

  const binW = plot.w / bins;
  for (let b = 0; b < bins; b += 1) {
    const pct = (h.counts[b] / h.total) * 100;
    if (pct <= 0) continue;
    const x0 = x(conv(h.bins[b].lo));
    const x1 = x(conv(h.bins[b].hi));
    const top = yFreq(pct);
    ctx.fillStyle = view.ramp.css(view.scale((h.bins[b].lo + h.bins[b].hi) / 2));
    // 2px gap between bars so adjacent fills never merge into one block.
    roundRect(ctx, Math.min(x0, x1) + 1, top, Math.max(1, Math.abs(x1 - x0) - 2), p.freq.bottom - top, 4);
    ctx.fill();
  }

  // Cumulative panel.
  ctx.save();
  s.font(11);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of [0, 25, 50, 75, 100]) {
    const py = Math.round(yCum(t)) + 0.5;
    ctx.strokeStyle = t === 50 ? theme.gridStrong : theme.grid;
    ctx.beginPath();
    ctx.moveTo(plot.x, py);
    ctx.lineTo(plot.right, py);
    ctx.stroke();
    ctx.fillStyle = theme.ink3;
    ctx.fillText(`${t}%`, plot.x - 8, py);
  }
  ctx.restore();

  ctx.beginPath();
  ctx.moveTo(x(conv(h.bins[0].lo)), yCum(0));
  for (let b = 0; b < bins; b += 1) {
    ctx.lineTo(x(conv(h.bins[b].hi)), yCum(h.cumulative[b] * 100));
  }
  ctx.strokeStyle = theme.ink1;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Percentile markers on the cumulative curve.
  const pcts = percentiles(values, mask, [state.stats.percentile]);
  const pv = pcts[state.stats.percentile];
  if (Number.isFinite(pv)) {
    const pxv = x(conv(pv));
    ctx.save();
    ctx.strokeStyle = theme.accent2;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(pxv, p.freq.y);
    ctx.lineTo(pxv, p.cum.bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    s.font(11, 600);
    ctx.fillStyle = theme.accent2;
    ctx.textAlign = pxv > plot.x + plot.w * 0.7 ? 'right' : 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`p${state.stats.percentile} = ${formatValue(field, pv, u)}`,
      pxv + (pxv > plot.x + plot.w * 0.7 ? -6 : 6), p.freq.y + 4);
    ctx.restore();
  }

  drawBottomAxis(s, niceTicks(xDomain[0], xDomain[1], 7).map((t) => ({ x: x(t), label: tickLabel(t, niceTicks(xDomain[0], xDomain[1], 7)) })), {
    label: `${field.label} (${unitFor(field, u)})`,
  });

  ctx.save();
  ctx.strokeStyle = theme.axis;
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(plot.x) + 0.5, Math.round(p.freq.y) + 0.5, Math.round(plot.w), Math.round(p.freq.h));
  ctx.strokeRect(Math.round(plot.x) + 0.5, Math.round(p.cum.y) + 0.5, Math.round(plot.w), Math.round(p.cum.h));
  s.font(11, 500);
  ctx.fillStyle = theme.ink2;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText('Share of hours in each bin', plot.x, p.freq.y - 5);
  ctx.fillText('Cumulative share of hours below', plot.x, p.cum.y - 5);
  ctx.restore();

  drawTitle(s, `${field.label} — distribution`, view.subtitle);
  return s;
}

function probe(s, view, px, py) {
  const { plot } = s;
  if (!view.data || px < plot.x || px > plot.right) return null;
  const bins = Math.max(6, Math.min(80, view.state.stats.bins || 30));
  const h = histogram(view.values, view.mask, bins);
  if (!h.total) return null;
  const b = Math.min(bins - 1, Math.max(0, Math.floor(((px - plot.x) / plot.w) * bins)));
  const f = (v) => formatValue(view.field, v, view.state.units);
  return {
    title: `${f(h.bins[b].lo)} – ${f(h.bins[b].hi)}`,
    rows: [
      { label: 'Hours', text: String(h.counts[b]) },
      { label: 'Share', text: `${((h.counts[b] / h.total) * 100).toFixed(2)}%` },
      { label: 'Cumulative', text: `${(h.cumulative[b] * 100).toFixed(1)}%` },
    ],
    x: plot.x + (plot.w / bins) * (b + 0.5),
    y: py,
  };
}

export { draw, probe, MARGINS };
