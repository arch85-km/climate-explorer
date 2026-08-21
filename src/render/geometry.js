/**
 * Geometry builders for the 3D scenes.
 *
 * Everything accumulates into flat arrays through a builder, so a whole scene
 * (dome, grid, arcs, labels' anchor points) can be assembled into two or three
 * buffers rather than hundreds of draw calls.
 */

/** Accumulates triangles with per-vertex normals and colours. */
class MeshBuilder {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.colors = [];
    this.indices = [];
  }

  get vertexCount() { return this.positions.length / 3; }

  vertex(x, y, z, nx, ny, nz, c) {
    this.positions.push(x, y, z);
    this.normals.push(nx, ny, nz);
    this.colors.push(c[0], c[1], c[2]);
    return this.vertexCount - 1;
  }

  triangle(a, b, c) { this.indices.push(a, b, c); }

  /** A flat quad, wound counter-clockwise when seen from the normal's side. */
  quad(p0, p1, p2, p3, colour, normal) {
    const n = normal || faceNormal(p0, p1, p2);
    const i0 = this.vertex(p0[0], p0[1], p0[2], n[0], n[1], n[2], colour);
    const i1 = this.vertex(p1[0], p1[1], p1[2], n[0], n[1], n[2], colour);
    const i2 = this.vertex(p2[0], p2[1], p2[2], n[0], n[1], n[2], colour);
    const i3 = this.vertex(p3[0], p3[1], p3[2], n[0], n[1], n[2], colour);
    this.triangle(i0, i1, i2);
    this.triangle(i0, i2, i3);
  }

  /** Axis-aligned box centred on (cx, cz), sitting on y = base. */
  box(cx, base, cz, w, h, d, colour, topColour) {
    const x0 = cx - w / 2;
    const x1 = cx + w / 2;
    const z0 = cz - d / 2;
    const z1 = cz + d / 2;
    const y0 = base;
    const y1 = base + h;
    const top = topColour || colour;
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], top, [0, 1, 0]);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], colour, [0, -1, 0]);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], colour, [0, 0, 1]);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], colour, [0, 0, -1]);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], colour, [1, 0, 0]);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], colour, [-1, 0, 0]);
  }

  /**
   * An annular wedge extruded vertically — one segment of a 3D wind rose.
   * Angles are radians measured clockwise from north (-Z).
   */
  wedge(innerR, outerR, a0, a1, y0, y1, colour, segments = 6) {
    const pt = (r, a, y) => [Math.sin(a) * r, y, -Math.cos(a) * r];
    for (let i = 0; i < segments; i += 1) {
      const t0 = a0 + ((a1 - a0) * i) / segments;
      const t1 = a0 + ((a1 - a0) * (i + 1)) / segments;
      // top and bottom
      this.quad(pt(innerR, t0, y1), pt(outerR, t0, y1), pt(outerR, t1, y1), pt(innerR, t1, y1), colour, [0, 1, 0]);
      this.quad(pt(innerR, t1, y0), pt(outerR, t1, y0), pt(outerR, t0, y0), pt(innerR, t0, y0), colour, [0, -1, 0]);
      // outer and inner walls
      this.quad(pt(outerR, t0, y0), pt(outerR, t1, y0), pt(outerR, t1, y1), pt(outerR, t0, y1), colour);
      if (innerR > 1e-6) {
        this.quad(pt(innerR, t1, y0), pt(innerR, t0, y0), pt(innerR, t0, y1), pt(innerR, t1, y1), colour);
      }
    }
    // end caps
    this.quad(pt(innerR, a0, y0), pt(innerR, a0, y1), pt(outerR, a0, y1), pt(outerR, a0, y0), colour);
    this.quad(pt(outerR, a1, y0), pt(outerR, a1, y1), pt(innerR, a1, y1), pt(innerR, a1, y0), colour);
  }

  /**
   * A height-field grid. `sample(col, row)` returns { y, colour } or null for a gap.
   */
  grid(cols, rows, xOf, zOf, sample) {
    const idx = new Int32Array(cols * rows).fill(-1);
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const s = sample(c, r);
        if (!s) continue;
        idx[r * cols + c] = this.vertex(xOf(c), s.y, zOf(r), 0, 1, 0, s.colour);
      }
    }
    for (let r = 0; r < rows - 1; r += 1) {
      for (let c = 0; c < cols - 1; c += 1) {
        const a = idx[r * cols + c];
        const b = idx[r * cols + c + 1];
        const d = idx[(r + 1) * cols + c];
        const e = idx[(r + 1) * cols + c + 1];
        if (a < 0 || b < 0 || d < 0 || e < 0) continue;
        this.triangle(a, d, b);
        this.triangle(b, d, e);
      }
    }
    this.recomputeNormals();
    return idx;
  }

  /** Area-weighted vertex normals, for smooth shading of the annual surface. */
  recomputeNormals() {
    const n = this.normals;
    n.fill(0);
    const p = this.positions;
    for (let i = 0; i < this.indices.length; i += 3) {
      const a = this.indices[i] * 3;
      const b = this.indices[i + 1] * 3;
      const c = this.indices[i + 2] * 3;
      const ux = p[b] - p[a];
      const uy = p[b + 1] - p[a + 1];
      const uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a];
      const vy = p[c + 1] - p[a + 1];
      const vz = p[c + 2] - p[a + 2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      for (const k of [a, b, c]) { n[k] += nx; n[k + 1] += ny; n[k + 2] += nz; }
    }
    for (let i = 0; i < n.length; i += 3) {
      const len = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
      n[i] /= len; n[i + 1] /= len; n[i + 2] /= len;
    }
  }

  build(useUint32) {
    const big = useUint32 && this.vertexCount > 65535;
    return {
      attributes: {
        aPosition: new Float32Array(this.positions),
        aNormal: new Float32Array(this.normals),
        aColor: new Float32Array(this.colors),
      },
      indices: big ? new Uint32Array(this.indices) : new Uint16Array(this.indices),
      vertexCount: this.vertexCount,
    };
  }
}

/** Accumulates GL_LINES pairs, so many disjoint polylines share one buffer. */
class LineBuilder {
  constructor() {
    this.positions = [];
    this.colors = [];
  }

  segment(a, b, colour, colourB) {
    const c2 = colourB || colour;
    this.positions.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    this.colors.push(colour[0], colour[1], colour[2], c2[0], c2[1], c2[2]);
  }

  polyline(points, colour) {
    for (let i = 1; i < points.length; i += 1) this.segment(points[i - 1], points[i], colour);
  }

  /** A horizontal circle at height y. */
  circle(radius, y, colour, segments = 96, cx = 0, cz = 0) {
    const pts = [];
    for (let i = 0; i <= segments; i += 1) {
      const a = (i / segments) * Math.PI * 2;
      pts.push([cx + Math.sin(a) * radius, y, cz - Math.cos(a) * radius]);
    }
    this.polyline(pts, colour);
  }

  get count() { return this.positions.length / 3; }

  build() {
    return {
      attributes: {
        aPosition: new Float32Array(this.positions),
        aColor: new Float32Array(this.colors),
      },
      mode: 1, // gl.LINES
    };
  }
}

/** Accumulates round points. */
class PointBuilder {
  constructor() {
    this.positions = [];
    this.colors = [];
    this.sizes = [];
  }

  point(p, colour, size = 6) {
    this.positions.push(p[0], p[1], p[2]);
    this.colors.push(colour[0], colour[1], colour[2]);
    this.sizes.push(size);
  }

  get count() { return this.sizes.length; }

  build() {
    return {
      attributes: {
        aPosition: new Float32Array(this.positions),
        aColor: new Float32Array(this.colors),
        aSize: new Float32Array(this.sizes),
      },
      mode: 0, // gl.POINTS
    };
  }
}

/**
 * Blend a colour towards another by `t`.
 *
 * Used to dim guide lines towards the *surface* colour rather than towards black.
 * Multiplying a colour by 0.7 recedes on a dark ground but advances on a light one,
 * which turned the sky dome's wireframe into a heavy cage in the light theme.
 */
function towards(colour, target, t) {
  return [
    colour[0] + (target[0] - colour[0]) * t,
    colour[1] + (target[1] - colour[1]) * t,
    colour[2] + (target[2] - colour[2]) * t,
  ];
}

function faceNormal(p0, p1, p2) {
  const ux = p1[0] - p0[0];
  const uy = p1[1] - p0[1];
  const uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0];
  const vy = p2[1] - p0[1];
  const vz = p2[2] - p0[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

/** Point on the unit sky dome for an (altitude, azimuth) pair, in Y-up world space. */
function skyPoint(altitude, azimuth, radius = 1) {
  const alt = (altitude * Math.PI) / 180;
  const az = (azimuth * Math.PI) / 180;
  const h = Math.cos(alt) * radius;
  return [h * Math.sin(az), Math.sin(alt) * radius, -h * Math.cos(az)];
}

/** '#rrggbb' or an [r,g,b] 0-255 triple to a normalised [0..1] triple. */
function rgb01(colour) {
  if (Array.isArray(colour)) return [colour[0] / 255, colour[1] / 255, colour[2] / 255];
  const h = String(colour).replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

export { MeshBuilder, LineBuilder, PointBuilder, faceNormal, skyPoint, rgb01, towards };
