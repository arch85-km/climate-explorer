/**
 * 3D sun path dome.
 *
 * The sky hemisphere with the sun's tracks drawn on it: one arc per month, an
 * analemma for each clock hour, and a marker at the selected instant. This is
 * the diagram that connects a number in a weather file to where the sun actually
 * is over a site, so it is worth being generous with it.
 */
import { MeshBuilder, LineBuilder, PointBuilder, skyPoint, rgb01, towards } from '../render/geometry.js';
import { dayArc, analemma, sunPosition, dayOfYear, sunTimes } from '../core/solar.js';
import { MONTH_ABBR } from '../epw/parse.js';
import { RAMPS } from '../render/colormaps.js';
import { hexRgb } from '../render/canvas2d.js';
import { ALL_BY_KEY, formatValue } from '../epw/fields.js';

const R = 1;

function build(view, theme) {
  const { data, state } = view;
  const loc = data.location;
  const ink1 = rgb01(hexRgb(theme.ink1, [230, 230, 230]));
  const ink3 = rgb01(hexRgb(theme.ink3, [130, 130, 130]));
  const surfaceC = rgb01(hexRgb(theme.surface, [18, 18, 18]));
  // Recede towards the surface, so guide lines stay quiet in every theme.
  const gridC = towards(ink3, surfaceC, 0.55);
  const accent = rgb01(hexRgb(theme.accent2, [235, 104, 52]));
  const groundC = rgb01(hexRgb(theme.surfaceRaised, [40, 40, 40]));

  const mesh = new MeshBuilder();
  const lines = new LineBuilder();
  const points = new PointBuilder();
  const labels = [];

  // ── ground disc ───────────────────────────────────────────────────────────
  const SEG = 72;
  const centre = mesh.vertex(0, 0, 0, 0, 1, 0, groundC);
  const rim = [];
  for (let i = 0; i <= SEG; i += 1) {
    const a = (i / SEG) * Math.PI * 2;
    rim.push(mesh.vertex(Math.sin(a) * R, 0, -Math.cos(a) * R, 0, 1, 0, groundC));
  }
  for (let i = 0; i < SEG; i += 1) mesh.triangle(centre, rim[i + 1], rim[i]);

  // ── dome wireframe ────────────────────────────────────────────────────────
  for (const alt of [0, 15, 30, 45, 60, 75]) {
    const pts = [];
    for (let i = 0; i <= SEG; i += 1) pts.push(skyPoint(alt, (i / SEG) * 360, R));
    lines.polyline(pts, alt === 0 ? ink3 : gridC);
    if (alt > 0) {
      labels.push({ world: skyPoint(alt, 90, R), text: `${alt}°`, color: theme.ink3, size: 10, plateAlpha: 0.5 });
    }
  }
  for (let az = 0; az < 360; az += 30) {
    const pts = [];
    for (let alt = 0; alt <= 90; alt += 5) pts.push(skyPoint(alt, az, R));
    lines.polyline(pts, gridC);
  }

  // Compass, drawn just outside the horizon so it never sits on an arc.
  for (const [text, az] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]]) {
    labels.push({
      world: skyPoint(0, az, R * 1.12), text, color: theme.ink1, size: 14, weight: 700, always: true, plate: false,
    });
    lines.segment(skyPoint(0, az, R), skyPoint(0, az, R * 1.06), ink3);
  }

  // ── monthly day arcs ──────────────────────────────────────────────────────
  const monthRamp = RAMPS[view.theme].cyclic;
  for (let m = 1; m <= 12; m += 1) {
    const doy = dayOfYear(m, 21, data.isLeap);
    const arc = dayArc(loc, doy, 145);
    if (arc.length < 2) continue;
    const solstice = m === 6 || m === 12;
    const colour = solstice ? ink1 : rgb01(monthRamp.rgb((m - 1) / 12));
    lines.polyline(arc.map((p) => skyPoint(p.altitude, p.azimuth, R)), colour);
    if (solstice || m === 3) {
      const mid = arc[Math.floor(arc.length / 2)];
      labels.push({
        world: skyPoint(mid.altitude, mid.azimuth, R * 1.02),
        text: m === 6 ? '21 Jun' : m === 12 ? '21 Dec' : '21 Mar',
        color: solstice ? theme.ink1 : monthRamp.css((m - 1) / 12),
        size: 11, weight: 600, dy: -12,
      });
    }
  }

  // ── analemmas ─────────────────────────────────────────────────────────────
  if (state.massing.showAnalemma !== false) {
    for (let hour = 4; hour <= 20; hour += 1) {
      const pts = analemma(loc, hour, data.isLeap, 4).filter((p) => p.altitude > 0);
      if (pts.length < 3) continue;
      lines.polyline(pts.map((p) => skyPoint(p.altitude, p.azimuth, R)), gridC);
      let best = null;
      for (const p of pts) if (!best || p.altitude > best.altitude) best = p;
      if (best && best.altitude > 6) {
        labels.push({
          world: skyPoint(best.altitude, best.azimuth, R * 1.01),
          text: `${hour}h`, color: theme.ink3, size: 9, plateAlpha: 0.5,
        });
      }
    }
  }

  // ── hourly sun positions, tinted by a weather variable ────────────────────
  const tintKey = state.sunpathTint;
  const tintField = tintKey ? ALL_BY_KEY[tintKey] : null;
  let tintRange = null;
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
    for (let i = 0; i < data.n; i += 1) {
      const alt = data.series.solarAltitude[i];
      if (alt <= 0) continue;
      if (view.mask && !view.mask[i]) continue;
      const v = values[i];
      if (!Number.isFinite(v)) continue;
      points.point(skyPoint(alt, data.series.solarAzimuth[i], R * 0.995),
        rgb01(ramp.rgb((v - lo) / span)), 4.5);
    }
    tintRange = { lo, hi, field: tintField };
  }

  // ── the selected instant ──────────────────────────────────────────────────
  const cur = state.cursor;
  const curDoy = dayOfYear(cur.month, cur.day, data.isLeap);
  const pos = sunPosition(loc, curDoy, cur.hour + 0.5);
  const times = sunTimes(loc, curDoy);

  const todayArc = dayArc(loc, curDoy, 145);
  if (todayArc.length > 1) {
    lines.polyline(todayArc.map((p) => skyPoint(p.altitude, p.azimuth, R * 1.004)), accent);
  }

  if (pos.altitude > 0) {
    const sp = skyPoint(pos.altitude, pos.azimuth, R);
    // A small sphere, and the ray it casts to the centre of the site.
    mesh.box(sp[0], sp[1] - 0.022, sp[2], 0.045, 0.045, 0.045, accent, accent);
    lines.segment(sp, [0, 0, 0], accent, [accent[0] * 0.3, accent[1] * 0.3, accent[2] * 0.3]);
    // Ground projection of the sun's bearing.
    const gp = skyPoint(0, pos.azimuth, R);
    lines.segment([0, 0.002, 0], [gp[0], 0.002, gp[2]], accent);
    labels.push({
      world: [sp[0], sp[1] + 0.06, sp[2]],
      text: `${cur.day} ${MONTH_ABBR[cur.month - 1]} ${String(cur.hour).padStart(2, '0')}:00 · ${pos.altitude.toFixed(0)}° alt · ${pos.azimuth.toFixed(0)}° az`,
      color: theme.accent2, size: 11, weight: 600, always: true,
    });
  } else {
    labels.push({
      world: [0, 0.12, 0],
      text: `${cur.day} ${MONTH_ABBR[cur.month - 1]} ${String(cur.hour).padStart(2, '0')}:00 — sun is below the horizon`,
      color: theme.ink3, size: 11, weight: 600, always: true,
    });
  }

  const dayLen = times.polar === 'day' ? '24 h'
    : times.polar === 'night' ? '0 h' : `${times.dayLength.toFixed(1)} h`;

  return {
    objects: [
      { kind: 'mesh', data: mesh.build(view.uint32), opts: { ambient: 0.72, cull: false } },
      { kind: 'lines', data: lines.build(), opts: { opacity: 0.9 } },
      ...(points.count ? [{ kind: 'points', data: points.build(), opts: { opacity: 0.9, scale: 260 } }] : []),
    ],
    labels,
    camera: { azimuth: Math.PI, elevation: 0.42, distance: 3.1, target: [0, 0.15, 0], minDistance: 1.3, maxDistance: 9 },
    caption: `Day length ${dayLen} · ${loc.latitude.toFixed(2)}°, ${loc.longitude.toFixed(2)}°`,
    legend: tintRange ? {
      ramp: RAMPS[view.theme][tintRange.field.ramp] || RAMPS[view.theme].solar,
      lo: tintRange.lo,
      hi: tintRange.hi,
      label: tintRange.field.label,
      format: (v) => formatValue(tintRange.field, v, state.units),
    } : null,
  };
}

export { build };
