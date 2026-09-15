/**
 * Column-major 4x4 matrix and vector helpers, in the layout WebGL expects
 * (m[column * 4 + row]).
 *
 * Only the operations the 3D views actually need are implemented, so this stays
 * small enough to read in one sitting.
 *
 * @version 1.0.0 — 2026-09-15
 */

function identity(out = new Float32Array(16)) {
  out.fill(0);
  out[0] = 1; out[5] = 1; out[10] = 1; out[15] = 1;
  return out;
}

function multiply(a, b, out = new Float32Array(16)) {
  const o = out === a || out === b ? new Float32Array(16) : out;
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      o[c * 4 + r] = a[r] * b[c * 4]
        + a[4 + r] * b[c * 4 + 1]
        + a[8 + r] * b[c * 4 + 2]
        + a[12 + r] * b[c * 4 + 3];
    }
  }
  if (o !== out) out.set(o);
  return out;
}

function perspective(fovYDeg, aspect, near, far, out = new Float32Array(16)) {
  const f = 1 / Math.tan((fovYDeg * Math.PI) / 360);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

function lookAt(eye, target, up, out = new Float32Array(16)) {
  let zx = eye[0] - target[0];
  let zy = eye[1] - target[1];
  let zz = eye[2] - target[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len; zy /= len; zz /= len;

  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz);
  if (!len) { xx = 1; xy = 0; xz = 0; } else { xx /= len; xy /= len; xz /= len; }

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  out[15] = 1;
  return out;
}

function translation(x, y, z, out = new Float32Array(16)) {
  identity(out);
  out[12] = x; out[13] = y; out[14] = z;
  return out;
}

function scaling(x, y, z, out = new Float32Array(16)) {
  identity(out);
  out[0] = x; out[5] = y; out[10] = z;
  return out;
}

function rotationY(rad, out = new Float32Array(16)) {
  identity(out);
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  out[0] = c; out[2] = -s; out[8] = s; out[10] = c;
  return out;
}

/**
 * Planar shadow projection: flattens geometry onto the y = 0 plane along the
 * direction of a directional light.
 *
 * @param {{x:number,y:number,z:number}} light unit vector pointing towards the sun
 */
function shadowOntoGround(light, out = new Float32Array(16)) {
  const { x: lx, y: ly, z: lz } = light;
  out.fill(0);
  // Columns, so that p' = (ly*x - lx*y, 0, ly*z - lz*y, ly).
  out[0] = ly;
  out[4] = -lx; out[6] = -lz;
  out[10] = ly;
  out[15] = ly;
  return out;
}

/** Transform a point by a matrix and perspective-divide. */
function transformPoint(m, x, y, z, out = [0, 0, 0, 1]) {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  out[3] = w;
  return out;
}

/** Inverse-transpose of the upper-left 3x3, for transforming normals. */
function normalMatrix(m, out = new Float32Array(9)) {
  const a = m[0]; const b = m[1]; const c = m[2];
  const d = m[4]; const e = m[5]; const f = m[6];
  const g = m[8]; const h = m[9]; const i = m[10];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!det) { out.set([1, 0, 0, 0, 1, 0, 0, 0, 1]); return out; }
  const id = 1 / det;
  // (M^-1)^T
  out[0] = A * id;
  out[1] = B * id;
  out[2] = C * id;
  out[3] = -(b * i - c * h) * id;
  out[4] = (a * i - c * g) * id;
  out[5] = -(a * h - b * g) * id;
  out[6] = (b * f - c * e) * id;
  out[7] = -(a * f - c * d) * id;
  out[8] = (a * e - b * d) * id;
  return out;
}

export { identity, multiply, perspective, lookAt, translation, scaling, rotationY };
export { shadowOntoGround, transformPoint, normalMatrix };
