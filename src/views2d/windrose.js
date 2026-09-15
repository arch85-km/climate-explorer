/**
 * Wind rose: frequency of wind by direction sector and speed band.
 *
 * Speed bands are an ordered sequence, so they take an ordinal ramp rather than
 * categorical hues. Calm hours are pulled out into the centre disc instead of
 * being binned by direction, because EPW records calm hours with direction 0 and
 * would otherwise stack a false spike on due north.
 *
 * @version 1.0.0 — 2026-09-15
 */
import { beginFrame, drawTitle, drawEmpty, drawLegend } from '../render/canvas2d.js';
import { windRose } from '../core/stats.js';
import { RAMPS } from '../render/colormaps.js';
import { formatValue, FIELD_BY_KEY, unitFor, convert } from '../epw/fields.js';

const MARGINS = { top: 30, right: 20, bottom: 62, left: 20 };

function geometry(s) {
  const { plot } = s;
  const cx = plot.x + plot.w / 2;
  const cy = plot.y + plot.h / 2;
  const r = Math.max(20, Math.min(plot.w, plot.h) / 2 - 26);
  return { cx, cy, r };
}

function draw(canvas, view) {
  const s = beginFrame(canvas, view.root, MARGINS);
  const { ctx, plot, theme } = s;
  const { data, mask, state } = view;
  if (!data) { drawEmpty(s, 'Load an EPW file to begin'); return s; }

  const sectors = state.stats.sectors || 16;
  const rose = windRose(data, mask, { sectors });
  if (!rose.total) { drawEmpty(s, 'No wind data in the selected period'); return s; }

  const { cx, cy, r } = geometry(s);
  const speedField = FIELD_BY_KEY.windSpeed;
  const u = state.units;

  // Radial scale in percent of all selected hours.
  const calmShare = (rose.calm / rose.total) * 100;
  const maxPct = (rose.maxSector / rose.total) * 100 + calmShare;
  const ringStep = maxPct <= 5 ? 1 : maxPct <= 12 ? 2 : maxPct <= 30 ? 5 : 10;
  const maxRing = Math.ceil(maxPct / ringStep) * ringStep || ringStep;
  const rOf = (pct) => (pct / maxRing) * r;

  // ── polar grid ────────────────────────────────────────────────────────────
  ctx.save();
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  for (let p = ringStep; p <= maxRing + 1e-9; p += ringStep) {
    ctx.beginPath();
    ctx.arc(cx, cy, rOf(p), 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let i = 0; i < 8; i += 1) {
    const a = (i * Math.PI) / 4;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.sin(a) * r, cy - Math.cos(a) * r);
    ctx.stroke();
  }
  ctx.restore();

  // ── calm centre ───────────────────────────────────────────────────────────
  // Drawn first, and the petals start outside it, so the radial axis reads as a
  // cumulative share of all hours: calm, then each speed band on top.
  const calmPct = (rose.calm / rose.total) * 100;
  const calmR = rOf(calmPct);
  if (calmR > 0.5) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, calmR, 0, Math.PI * 2);
    ctx.fillStyle = theme.surfaceRaised;
    ctx.fill();
    ctx.strokeStyle = theme.axis;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  // ── petals ────────────────────────────────────────────────────────────────
  const ramp = RAMPS[view.theme].wind;
  const sectorAngle = (Math.PI * 2) / sectors;
  const petal = sectorAngle * 0.82;
  for (let sec = 0; sec < sectors; sec += 1) {
    const centre = sec * sectorAngle;
    let acc = 0;
    for (let b = 0; b < rose.bandCount; b += 1) {
      const n = rose.counts[sec * rose.bandCount + b];
      if (!n) continue;
      const from = calmR + rOf((acc / rose.total) * 100);
      acc += n;
      const to = calmR + rOf((acc / rose.total) * 100);
      // Ordinal ramp: the fastest band sits furthest from the surface.
      const t = 0.25 + 0.7 * (b / Math.max(1, rose.bandCount - 1));
      ctx.beginPath();
      ctx.arc(cx, cy, to, centre - petal / 2 - Math.PI / 2, centre + petal / 2 - Math.PI / 2);
      ctx.arc(cx, cy, from, centre + petal / 2 - Math.PI / 2, centre - petal / 2 - Math.PI / 2, true);
      ctx.closePath();
      ctx.fillStyle = ramp.css(t);
      ctx.fill();
      // 2px surface ring so stacked bands stay separable.
      ctx.strokeStyle = theme.surface;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  // ── ring labels and compass ───────────────────────────────────────────────
  ctx.save();
  s.font(10);
  ctx.fillStyle = theme.ink3;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let p = ringStep; p <= maxRing + 1e-9; p += ringStep) {
    ctx.fillStyle = theme.surface;
    const label = `${p}%`;
    const w = ctx.measureText(label).width;
    ctx.fillRect(cx + 2, cy - rOf(p) - 6, w + 4, 12);
    ctx.fillStyle = theme.ink3;
    ctx.fillText(label, cx + 4, cy - rOf(p));
  }
  s.font(12, 600);
  ctx.fillStyle = theme.ink2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  for (let i = 0; i < 8; i += 1) {
    const a = (i * Math.PI) / 4;
    ctx.fillText(compass[i], cx + Math.sin(a) * (r + 15), cy - Math.cos(a) * (r + 15));
  }
  ctx.restore();

  // ── legend ────────────────────────────────────────────────────────────────
  const legend = [];
  for (let b = 0; b < rose.bandCount; b += 1) {
    const lo = rose.speedBands[b];
    const hi = rose.speedBands[b + 1];
    const t = 0.25 + 0.7 * (b / Math.max(1, rose.bandCount - 1));
    legend.push({
      color: ramp.css(t),
      label: hi == null
        ? `≥ ${convert(speedField, lo, u).toFixed(1)}`
        : `${convert(speedField, lo, u).toFixed(1)}–${convert(speedField, hi, u).toFixed(1)}`,
    });
  }
  legend.push({ color: theme.surfaceRaised, label: `Calm ${(rose.calmFraction * 100).toFixed(1)}%` });
  drawLegend(s, legend, { y: plot.bottom + 26, maxWidth: plot.w });
  ctx.save();
  s.font(10, 500);
  ctx.fillStyle = theme.ink3;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`Wind speed (${unitFor(speedField, u)})`, plot.x, plot.bottom + 10);
  ctx.restore();

  drawTitle(s, 'Wind rose',
    `prevailing ${rose.prevailingLabel} · ${rose.total.toLocaleString()} hours · ${view.subtitle}`);
  return s;
}

function probe(s, view, px, py) {
  const { data, mask, state } = view;
  if (!data) return null;
  const { cx, cy, r } = geometry(s);
  const dx = px - cx;
  const dy = py - cy;
  const dist = Math.hypot(dx, dy);
  if (dist > r + 12) return null;
  const sectors = state.stats.sectors || 16;
  const rose = windRose(data, mask, { sectors });
  if (!rose.total) return null;
  const angle = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  const sec = Math.floor(((angle + 180 / sectors) % 360) / (360 / sectors)) % sectors;
  const speedField = FIELD_BY_KEY.windSpeed;
  const rows = [];
  for (let b = 0; b < rose.bandCount; b += 1) {
    const n = rose.counts[sec * rose.bandCount + b];
    if (!n) continue;
    const lo = rose.speedBands[b];
    const hi = rose.speedBands[b + 1];
    rows.push({
      label: hi == null
        ? `≥ ${formatValue(speedField, lo, state.units)}`
        : `${formatValue(speedField, lo, state.units, { bare: true })}–${formatValue(speedField, hi, state.units)}`,
      text: `${((n / rose.total) * 100).toFixed(2)}%`,
    });
  }
  return {
    title: `${rose.labels[sec]} — ${((rose.sectorTotals[sec] / rose.total) * 100).toFixed(1)}% of hours`,
    rows,
    x: px,
    y: py,
  };
}

export { draw, probe, MARGINS };
