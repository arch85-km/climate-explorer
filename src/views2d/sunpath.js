/**
 * Sun path diagram, in stereographic or orthographic projection.
 *
 * Stereographic is the projection used in architectural shading studies: it keeps
 * angles true, so a shading mask traced onto it reads correctly. Orthographic is
 * the "view from above" that students find easier to relate to a site plan, so
 * both are offered.
 *
 * The day arcs are the solstices and equinox plus the first of each month; the
 * analemmas are the sun's position at each clock hour across the year.
 *
 * @version 1.0.0 — 2026-09-17
 */
import { beginFrame, drawTitle, drawEmpty, drawLegend, drawColorbar } from '../render/canvas2d.js';
import { sunPosition, dayArc, analemma, dayOfYear, sunTimes } from '../core/solar.js';
import { MONTH_ABBR } from '../epw/parse.js';
import { RAMPS } from '../render/colormaps.js';
import { ALL_BY_KEY, formatValue, unitFor } from '../epw/fields.js';

const MARGINS = { top: 30, right: 72, bottom: 56, left: 24 };
const ARC_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function geometry(s) {
  const { plot } = s;
  return {
    cx: plot.x + plot.w / 2,
    cy: plot.y + plot.h / 2,
    r: Math.max(20, Math.min(plot.w, plot.h) / 2 - 20),
  };
}

/** Project an (altitude, azimuth) pair onto the diagram. */
function project(g, altitude, azimuth, mode) {
  const z = 90 - altitude; // zenith angle
  // Stereographic keeps angles true; orthographic is the plan-view projection.
  const rr = mode === 'ortho'
    ? Math.sin((z * Math.PI) / 180)
    : Math.tan((z * Math.PI) / 360);
  const a = (azimuth * Math.PI) / 180;
  return {
    px: g.cx + g.r * rr * Math.sin(a),
    py: g.cy - g.r * rr * Math.cos(a),
  };
}

function draw(canvas, view) {
  const s = beginFrame(canvas, view.root, MARGINS);
  const { ctx, plot, theme } = s;
  const { data, state } = view;
  if (!data) { drawEmpty(s, 'Load an EPW file to begin'); return s; }

  const mode = state.sunpathProjection || 'stereo';
  const g = geometry(s);
  const loc = data.location;

  // ── horizon, altitude rings and azimuth spokes ────────────────────────────
  ctx.save();
  ctx.beginPath();
  ctx.arc(g.cx, g.cy, g.r, 0, Math.PI * 2);
  ctx.fillStyle = theme.surfaceRaised;
  ctx.fill();
  ctx.strokeStyle = theme.axis;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  s.font(10);
  ctx.fillStyle = theme.ink3;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let alt = 15; alt < 90; alt += 15) {
    const p = project(g, alt, 0, mode);
    const rr = g.cy - p.py;
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, rr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillText(`${alt}°`, g.cx + 3 + rr * Math.SQRT1_2 * 0.02, g.cy - rr + 7);
  }
  for (let az = 0; az < 360; az += 30) {
    const p = project(g, 0, az, mode);
    ctx.beginPath();
    ctx.moveTo(g.cx, g.cy);
    ctx.lineTo(p.px, p.py);
    ctx.stroke();
  }
  ctx.restore();

  // Compass labels outside the horizon.
  ctx.save();
  s.font(12, 600);
  ctx.fillStyle = theme.ink2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [label, az] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]]) {
    const a = (az * Math.PI) / 180;
    ctx.fillText(label, g.cx + Math.sin(a) * (g.r + 13), g.cy - Math.cos(a) * (g.r + 13));
  }
  s.font(9, 400);
  ctx.fillStyle = theme.ink3;
  for (let az = 30; az < 360; az += 30) {
    if (az % 90 === 0) continue;
    const a = (az * Math.PI) / 180;
    ctx.fillText(`${az}°`, g.cx + Math.sin(a) * (g.r + 12), g.cy - Math.cos(a) * (g.r + 12));
  }
  ctx.restore();

  // ── analemmas: the sun at each clock hour through the year ────────────────
  ctx.save();
  ctx.strokeStyle = theme.ink3;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.8;
  for (let hour = 4; hour <= 20; hour += 1) {
    const pts = analemma(loc, hour, data.isLeap, 4).filter((p) => p.altitude > -1);
    if (pts.length < 3) continue;
    ctx.beginPath();
    let started = false;
    for (const p of pts) {
      const q = project(g, Math.max(0, p.altitude), p.azimuth, mode);
      if (started) ctx.lineTo(q.px, q.py); else { ctx.moveTo(q.px, q.py); started = true; }
    }
    ctx.stroke();

    // Label the analemma at its highest point.
    let best = null;
    for (const p of pts) if (!best || p.altitude > best.altitude) best = p;
    if (best && best.altitude > 4) {
      const q = project(g, best.altitude, best.azimuth, mode);
      s.font(9, 500);
      ctx.fillStyle = theme.ink3;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${hour}`, q.px, q.py - 3);
    }
  }
  ctx.restore();

  // ── monthly day arcs ──────────────────────────────────────────────────────
  const monthRamp = RAMPS[view.theme].cyclic;
  for (const m of ARC_MONTHS) {
    const doy = dayOfYear(m, 21, data.isLeap);
    const pts = dayArc(loc, doy, 193);
    if (pts.length < 2) continue;
    const solstice = m === 6 || m === 12;
    ctx.save();
    ctx.beginPath();
    let started = false;
    for (const p of pts) {
      const q = project(g, p.altitude, p.azimuth, mode);
      if (started) ctx.lineTo(q.px, q.py); else { ctx.moveTo(q.px, q.py); started = true; }
    }
    ctx.strokeStyle = solstice ? theme.ink1 : monthRamp.css((m - 1) / 12);
    ctx.lineWidth = solstice ? 2.2 : 1.6;
    ctx.globalAlpha = solstice ? 0.95 : 0.85;
    ctx.stroke();
    ctx.restore();

    // Direct-label the three arcs a student is asked to know.
    if (m === 6 || m === 12 || m === 3) {
      const p = pts[Math.floor(pts.length / 2)];
      const q = project(g, p.altitude, p.azimuth, mode);
      ctx.save();
      s.font(10, 600);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const label = m === 6 ? '21 Jun' : m === 12 ? '21 Dec' : '21 Mar/Sep';
      const w = ctx.measureText(label).width;
      ctx.fillStyle = theme.surfaceRaised;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(q.px - w / 2 - 3, q.py - 15, w + 6, 13);
      ctx.globalAlpha = 1;
      ctx.fillStyle = solstice ? theme.ink1 : monthRamp.css((m - 1) / 12);
      ctx.fillText(label, q.px, q.py - 4);
      ctx.restore();
    }
  }

  // ── hourly sun positions, optionally tinted by a weather variable ─────────
  const tintKey = state.sunpathTint;
  const tintField = tintKey ? ALL_BY_KEY[tintKey] : null;
  if (tintField && data.series[tintKey]) {
    const values = data.series[tintKey];
    const ramp = RAMPS[view.theme][tintField.ramp] || RAMPS[view.theme].solar;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < data.n; i += 1) {
      if (data.series.solarAltitude[i] <= 0) continue;
      const v = values[i];
      if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }
    const span = hi - lo || 1;
    ctx.save();
    for (let i = 0; i < data.n; i += 1) {
      const alt = data.series.solarAltitude[i];
      if (alt <= 0) continue;
      if (view.mask && !view.mask[i]) continue;
      const v = values[i];
      if (!Number.isFinite(v)) continue;
      const q = project(g, alt, data.series.solarAzimuth[i], mode);
      ctx.fillStyle = ramp.css((v - lo) / span, 0.85);
      ctx.fillRect(q.px - 1.5, q.py - 1.5, 3, 3);
    }
    ctx.restore();
    drawColorbar(s, ramp, (v) => (v - lo) / span, lo, hi, {
      x: plot.right + 10,
      label: `${tintField.short} (${unitFor(tintField, state.units)})`,
      format: (v) => formatValue(tintField, v, state.units, { bare: true }),
    });
  }

  // ── the selected instant ──────────────────────────────────────────────────
  const cur = state.cursor;
  const curDoy = dayOfYear(cur.month, cur.day, data.isLeap);
  const pos = sunPosition(loc, curDoy, cur.hour + 0.5);
  const times = sunTimes(loc, curDoy);

  // The whole of the selected day, highlighted.
  const todayArc = dayArc(loc, curDoy, 193);
  if (todayArc.length > 1) {
    ctx.save();
    ctx.beginPath();
    let started = false;
    for (const p of todayArc) {
      const q = project(g, p.altitude, p.azimuth, mode);
      if (started) ctx.lineTo(q.px, q.py); else { ctx.moveTo(q.px, q.py); started = true; }
    }
    ctx.strokeStyle = theme.accent2;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }

  if (pos.altitude > 0) {
    const q = project(g, pos.altitude, pos.azimuth, mode);
    ctx.save();
    ctx.beginPath();
    ctx.arc(q.px, q.py, 7, 0, Math.PI * 2);
    ctx.fillStyle = theme.accent2;
    ctx.fill();
    ctx.strokeStyle = theme.surface;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  drawLegend(s, [
    { label: `${cur.day} ${MONTH_ABBR[cur.month - 1]} ${String(cur.hour).padStart(2, '0')}:00 — alt ${pos.altitude.toFixed(1)}°, az ${pos.azimuth.toFixed(1)}°`, color: theme.accent2 },
    { label: 'Solstices', color: theme.ink1 },
    { label: 'Analemma (clock hour)', color: theme.ink3, dash: true },
  ], { y: plot.bottom + 24, maxWidth: plot.w });

  const dayLen = times.polar === 'day' ? '24 h (polar day)'
    : times.polar === 'night' ? '0 h (polar night)'
      : `${times.dayLength.toFixed(1)} h`;
  drawTitle(s, `Sun path — ${mode === 'ortho' ? 'orthographic' : 'stereographic'}`,
    `${loc.latitude.toFixed(2)}°, ${loc.longitude.toFixed(2)}° · day length ${dayLen}`);
  return s;
}

function probe(s, view, px, py) {
  const { data } = view;
  if (!data) return null;
  const g = geometry(s);
  const mode = view.state.sunpathProjection || 'stereo';
  const dx = px - g.cx;
  const dy = py - g.cy;
  const dist = Math.hypot(dx, dy) / g.r;
  if (dist > 1.02) return null;
  const azimuth = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  const z = mode === 'ortho'
    ? (Math.asin(Math.min(1, dist)) * 180) / Math.PI
    : (Math.atan(Math.min(1, dist)) * 360) / Math.PI;
  return {
    title: 'Sky position',
    rows: [
      { label: 'Altitude', text: `${(90 - z).toFixed(1)}°` },
      { label: 'Azimuth', text: `${azimuth.toFixed(1)}°` },
    ],
    x: px,
    y: py,
  };
}

export { draw, probe, MARGINS, project, geometry };
