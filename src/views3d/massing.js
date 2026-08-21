/**
 * Massing study with live sun shadows.
 *
 * A ground plane, an adjustable block, and the shadow the block actually casts
 * at the selected date and time — driven by the same solar geometry as the sun
 * path views, not an approximation. The hourly shadow trace shows the sweep
 * across the whole day, which is the thing a site plan has to be tested against.
 *
 * Shadows are cast by projecting the block's geometry onto the ground plane
 * along the sun vector. For a single plane and a directional light this is exact,
 * costs one extra draw call, and needs no shadow map.
 */
import { MeshBuilder, LineBuilder, rgb01, towards } from '../render/geometry.js';
import { shadowOntoGround } from '../render/mat4.js';
import { hexRgb } from '../render/canvas2d.js';
import { sunPosition, sunVector, dayArc, dayOfYear, sunTimes } from '../core/solar.js';
import { MONTH_ABBR } from '../epw/parse.js';

const SCALE = 0.1;      // world units per metre
const GROUND = 9;       // ground half-extent, world units
const MIN_ALTITUDE = 1; // below this the shadow is unbounded and meaningless

/** Convex hull by monotone chain, used to outline the block's shadow. */
function convexHull(points) {
  if (points.length < 3) return points.slice();
  const pts = points.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** The block's corners in world space, honouring rotation and the courtyard option. */
function blockVolumes(m) {
  const w = Math.max(1, m.width) * SCALE;
  const d = Math.max(1, m.depth) * SCALE;
  const h = Math.max(1, m.height) * SCALE;
  if (!m.courtyard) return [{ cx: 0, cz: 0, w, d, h }];
  // A perimeter block: four bars around an open court, which self-shades.
  const t = Math.min(w, d) * 0.28;
  return [
    { cx: 0, cz: -(d - t) / 2, w, d: t, h },
    { cx: 0, cz: (d - t) / 2, w, d: t, h },
    { cx: -(w - t) / 2, cz: 0, w: t, d: d - 2 * t, h },
    { cx: (w - t) / 2, cz: 0, w: t, d: d - 2 * t, h },
  ];
}

function rotatePoint(x, z, rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [x * c + z * s, -x * s + z * c];
}

function build(view, theme) {
  const { data, state } = view;
  const loc = data.location;
  const m = state.massing;
  const rot = ((m.rotation || 0) * Math.PI) / 180;

  const ink1 = rgb01(hexRgb(theme.ink1, [230, 230, 230]));
  const ink3 = rgb01(hexRgb(theme.ink3, [130, 130, 130]));
  const gridC = towards(ink3, rgb01(hexRgb(theme.surface, [18, 18, 18])), 0.62);
  const accent = rgb01(hexRgb(theme.accent2, [235, 104, 52]));
  const groundC = rgb01(hexRgb(theme.surfaceRaised, [38, 38, 38]));
  const surfaceC = rgb01(hexRgb(theme.surface, [18, 18, 18]));

  const ground = new MeshBuilder();
  const block = new MeshBuilder();
  const lines = new LineBuilder();
  const labels = [];

  // ── ground ────────────────────────────────────────────────────────────────
  ground.quad(
    [-GROUND, -0.004, GROUND], [GROUND, -0.004, GROUND],
    [GROUND, -0.004, -GROUND], [-GROUND, -0.004, -GROUND],
    groundC, [0, 1, 0],
  );
  // A 10 m site grid, so students can read distances off the shadow directly.
  const gridStep = 10 * SCALE;
  for (let i = -Math.floor(GROUND / gridStep); i <= Math.floor(GROUND / gridStep); i += 1) {
    const p = i * gridStep;
    const strong = i % 5 === 0;
    const c = strong ? towards(ink3, gridC, 0.35) : gridC;
    lines.segment([p, 0.001, -GROUND], [p, 0.001, GROUND], c);
    lines.segment([-GROUND, 0.001, p], [GROUND, 0.001, p], c);
  }

  // ── the block ─────────────────────────────────────────────────────────────
  const volumes = blockVolumes(m);
  const wallC = rgb01(hexRgb(theme.surface, [200, 200, 200])).map((v) => 0.62 + v * 0.25);
  const roofC = wallC.map((v) => Math.min(1, v * 1.12));
  const footprint = [];
  const allCorners = [];

  for (const v of volumes) {
    // Build in local space, then rotate every vertex, so the shadow projection
    // and the drawn block can never disagree about orientation.
    const before = block.vertexCount;
    block.box(v.cx, 0, v.cz, v.w, v.h, v.d, wallC, roofC);
    for (let i = before; i < block.vertexCount; i += 1) {
      const px = block.positions[i * 3];
      const pz = block.positions[i * 3 + 2];
      const [rx, rz] = rotatePoint(px, pz, rot);
      block.positions[i * 3] = rx;
      block.positions[i * 3 + 2] = rz;
      const nx = block.normals[i * 3];
      const nz = block.normals[i * 3 + 2];
      const [rnx, rnz] = rotatePoint(nx, nz, rot);
      block.normals[i * 3] = rnx;
      block.normals[i * 3 + 2] = rnz;
    }
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const [rx, rz] = rotatePoint(v.cx + (sx * v.w) / 2, v.cz + (sz * v.d) / 2, rot);
      footprint.push([rx, rz]);
      // Flat triples: the shadow trace reads this as a number array.
      allCorners.push(rx, 0, rz, rx, v.h, rz);
    }
  }

  // Outline the footprint so the block reads even when the shadow overlaps it.
  for (const v of volumes) {
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([sx, sz]) => {
      const [rx, rz] = rotatePoint(v.cx + (sx * v.w) / 2, v.cz + (sz * v.d) / 2, rot);
      return [rx, 0.003, rz];
    });
    lines.polyline(corners, ink1);
  }

  // ── the sun at the selected instant ───────────────────────────────────────
  const cur = state.cursor;
  const curDoy = dayOfYear(cur.month, cur.day, data.isLeap);
  const pos = sunPosition(loc, curDoy, cur.hour + 0.5);
  const times = sunTimes(loc, curDoy);
  const sunUp = pos.altitude > MIN_ALTITUDE;
  const L = sunVector(pos.altitude, pos.azimuth);

  // ── the sun path arc, drawn at site scale overhead ────────────────────────
  const domeR = GROUND * 0.42;
  const arc = dayArc(loc, curDoy, 121);
  if (arc.length > 1) {
    lines.polyline(arc.map((p) => {
      const v = sunVector(p.altitude, p.azimuth);
      return [v.x * domeR, v.y * domeR, v.z * domeR];
    }), accent);
  }
  for (const [text, deg] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]]) {
    const a = (deg * Math.PI) / 180;
    const r = GROUND * 0.7;
    labels.push({
      world: [Math.sin(a) * r, 0.02, -Math.cos(a) * r],
      text, color: theme.ink1, size: 13, weight: 700, always: true, plate: false,
    });
  }

  if (sunUp) {
    const sp = [L.x * domeR, L.y * domeR, L.z * domeR];
    block.box(sp[0], sp[1] - 0.09, sp[2], 0.18, 0.18, 0.18, accent, accent);
    lines.segment(sp, [0, 0, 0], accent, [accent[0] * 0.25, accent[1] * 0.25, accent[2] * 0.25]);
    labels.push({
      world: [sp[0], sp[1] + 0.3, sp[2]],
      text: `${pos.altitude.toFixed(0)}° altitude · ${pos.azimuth.toFixed(0)}° azimuth`,
      color: theme.accent2, size: 11, weight: 600, always: true,
    });
  }

  // ── hourly shadow trace across the selected day ───────────────────────────
  if (m.showTrace !== false) {
    const traceC = accent.map((v) => v * 0.55 + 0.12);
    for (let hour = 0; hour < 24; hour += 1) {
      const p = sunPosition(loc, curDoy, hour + 0.5);
      if (p.altitude <= 5) continue; // very low sun gives a shadow off the site
      const l = sunVector(p.altitude, p.azimuth);
      const projected = [];
      for (let i = 0; i < allCorners.length; i += 3) {
        const x = allCorners[i];
        const y = allCorners[i + 1];
        const z = allCorners[i + 2];
        projected.push([x - (l.x / l.y) * y, z - (l.z / l.y) * y]);
      }
      const hull = convexHull(projected);
      if (hull.length < 3) continue;
      const pts = hull.map(([x, z]) => [x, 0.002, z]);
      pts.push(pts[0]);
      const isCurrent = hour === cur.hour;
      lines.polyline(pts, isCurrent ? accent : traceC);
      if (hour % 3 === 0) {
        let cx = 0;
        let cz = 0;
        for (const [x, z] of hull) { cx += x; cz += z; }
        labels.push({
          world: [cx / hull.length, 0.01, cz / hull.length],
          text: `${String(hour).padStart(2, '0')}h`,
          color: isCurrent ? theme.accent2 : theme.ink3,
          size: 9, plateAlpha: 0.45,
        });
      }
    }
  }

  const built = block.build(view.uint32);
  const objects = [
    { kind: 'mesh', data: ground.build(view.uint32), opts: { ambient: 0.78, flat: true, cull: false } },
  ];

  // The shadow: the same block geometry, flattened onto the ground and drawn
  // flat-shaded in a dark tone. Depth writing is off so it never fights the grid.
  if (sunUp) {
    // Pull the shadow well away from the ground tone in both themes, otherwise
    // a dark-theme shadow on a dark ground is invisible.
    const groundLuma = (groundC[0] + groundC[1] + groundC[2]) / 3;
    const shadowColour = groundLuma < 0.4
      ? groundC.map((v) => Math.min(1, v * 0.35 + 0.30))   // lighten on a dark ground
      : groundC.map((v) => v * 0.34);                       // darken on a light one
    const shadowData = {
      attributes: {
        aPosition: built.attributes.aPosition,
        aNormal: built.attributes.aNormal,
        aColor: new Float32Array(built.attributes.aColor.length),
      },
      indices: built.indices,
    };
    for (let i = 0; i < shadowData.attributes.aColor.length; i += 3) {
      shadowData.attributes.aColor[i] = shadowColour[0];
      shadowData.attributes.aColor[i + 1] = shadowColour[1];
      shadowData.attributes.aColor[i + 2] = shadowColour[2];
    }
    objects.push({
      kind: 'mesh',
      data: shadowData,
      opts: {
        model: shadowOntoGround(L),
        flat: true,
        cull: false,
        opacity: 0.72,
        depthWrite: false,
        ambient: 1,
      },
    });
  }

  objects.push({ kind: 'mesh', data: built, opts: { ambient: 0.38, cull: false, light: L } });
  objects.push({ kind: 'lines', data: lines.build(), opts: { opacity: 0.85 } });

  const dayLen = times.polar === 'day' ? '24 h'
    : times.polar === 'night' ? '0 h' : `${times.dayLength.toFixed(1)} h`;
  const caption = sunUp
    ? `${m.width}×${m.depth}×${m.height} m${m.courtyard ? ' perimeter block' : ''} · `
      + `${cur.day} ${MONTH_ABBR[cur.month - 1]} ${String(cur.hour).padStart(2, '0')}:00 · `
      + `sun ${pos.altitude.toFixed(0)}° · day length ${dayLen} · grid squares are 10 m`
    : `${cur.day} ${MONTH_ABBR[cur.month - 1]} ${String(cur.hour).padStart(2, '0')}:00 — sun below the horizon, no shadow cast`;

  return {
    objects,
    labels,
    camera: {
      azimuth: Math.PI * 0.78, elevation: 0.46, distance: 15,
      target: [0, 1.1, 0], minDistance: 2, maxDistance: 40,
    },
    caption,
  };
}

export { build, convexHull };
