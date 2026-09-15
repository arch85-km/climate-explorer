/**
 * A small WebGL renderer, written for exactly the four scenes this app draws:
 * a sky dome, an extruded annual surface, a 3D wind rose and a massing study.
 *
 * Deliberately not a general engine. Three programs — shaded mesh, unlit line,
 * round point — cover every scene, and text is drawn on a 2D canvas layered over
 * the WebGL one so no font atlas is needed.
 *
 * Shaders are GLSL ES 1.00 so the same source runs on a WebGL 1 context, which
 * matters for the older machines found in teaching labs.
 *
 * @version 1.0.0 — 2026-09-15
 */
import { identity, multiply, normalMatrix } from './mat4.js';

const MESH_VS = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec3 aColor;
uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uModel;
uniform mat3 uNormalMatrix;
varying vec3 vNormal;
varying vec3 vColor;
varying float vDepth;
void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vec4 eye = uView * world;
  gl_Position = uProjection * eye;
  vNormal = normalize(uNormalMatrix * aNormal);
  vColor = aColor;
  vDepth = -eye.z;
}`;

const MESH_FS = `
precision mediump float;
varying vec3 vNormal;
varying vec3 vColor;
varying float vDepth;
uniform vec3 uLightDir;
uniform float uAmbient;
uniform float uOpacity;
uniform vec3 uFogColor;
uniform vec2 uFogRange;
uniform float uFlat;
void main() {
  vec3 n = normalize(vNormal);
  // Two-sided shading: the annual surface and the dome are both viewed from
  // either side, and an unlit back face reads as a hole.
  float lambert = abs(dot(n, normalize(uLightDir)));
  float shade = mix(uAmbient + (1.0 - uAmbient) * lambert, 1.0, uFlat);
  vec3 colour = vColor * shade;
  float fog = clamp((vDepth - uFogRange.x) / max(0.001, uFogRange.y - uFogRange.x), 0.0, 1.0);
  colour = mix(colour, uFogColor, fog * 0.85);
  gl_FragColor = vec4(colour, uOpacity);
}`;

const LINE_VS = `
attribute vec3 aPosition;
attribute vec3 aColor;
uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uModel;
varying vec3 vColor;
void main() {
  gl_Position = uProjection * uView * uModel * vec4(aPosition, 1.0);
  vColor = aColor;
}`;

const LINE_FS = `
precision mediump float;
varying vec3 vColor;
uniform float uOpacity;
void main() { gl_FragColor = vec4(vColor, uOpacity); }`;

const POINT_VS = `
attribute vec3 aPosition;
attribute vec3 aColor;
attribute float aSize;
uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uModel;
uniform float uScale;
varying vec3 vColor;
void main() {
  vec4 eye = uView * uModel * vec4(aPosition, 1.0);
  gl_Position = uProjection * eye;
  gl_PointSize = max(1.0, aSize * uScale / max(1.0, -eye.z));
  vColor = aColor;
}`;

const POINT_FS = `
precision mediump float;
varying vec3 vColor;
uniform float uOpacity;
void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = dot(d, d);
  if (r > 0.25) discard;
  float edge = smoothstep(0.25, 0.16, r);
  gl_FragColor = vec4(vColor, uOpacity * edge);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader compile failed: ${log}`);
  }
  return shader;
}

function link(gl, vsSource, fsSource, attributes) {
  const program = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSource);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  attributes.forEach((name, i) => gl.bindAttribLocation(program, i, name));
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`program link failed: ${gl.getProgramInfoLog(program)}`);
  }
  // Cache uniform locations up front; lookups per frame are surprisingly costly.
  const uniforms = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i += 1) {
    const info = gl.getActiveUniform(program, i);
    uniforms[info.name] = gl.getUniformLocation(program, info.name);
  }
  return { program, uniforms, attributes };
}

/** A geometry buffer: interleaved or separate attribute arrays plus an index buffer. */
function createMesh(gl, spec) {
  const buffers = {};
  for (const [name, array] of Object.entries(spec.attributes)) {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, array, spec.dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    buffers[name] = { buffer: buf, size: name === 'aSize' ? 1 : 3, length: array.length };
  }
  let index = null;
  let count = 0;
  if (spec.indices) {
    index = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, spec.indices, gl.STATIC_DRAW);
    count = spec.indices.length;
  } else {
    const first = Object.values(buffers)[0];
    count = first ? first.length / first.size : 0;
  }
  return {
    buffers,
    index,
    count,
    indexType: spec.indices instanceof Uint32Array ? 0x1405 : 0x1403, // UNSIGNED_INT : UNSIGNED_SHORT
    mode: spec.mode != null ? spec.mode : gl.TRIANGLES,
    dispose() {
      for (const b of Object.values(buffers)) gl.deleteBuffer(b.buffer);
      if (index) gl.deleteBuffer(index);
    },
    update(name, array) {
      const b = buffers[name];
      if (!b) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, b.buffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, array);
    },
  };
}

/**
 * Create a renderer bound to a canvas.
 * @returns {object|null} null when WebGL is unavailable, so callers can fall back
 */
function createRenderer(canvas) {
  // preserveDrawingBuffer is required so the PNG export can read the 3D views
  // back after the frame has been composited.
  const opts = {
    antialias: true, alpha: true, premultipliedAlpha: false, depth: true,
    preserveDrawingBuffer: true,
  };
  const gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts)
    || canvas.getContext('experimental-webgl', opts);
  if (!gl) return null;

  let programs;
  try {
    programs = {
      mesh: link(gl, MESH_VS, MESH_FS, ['aPosition', 'aNormal', 'aColor']),
      line: link(gl, LINE_VS, LINE_FS, ['aPosition', 'aColor']),
      point: link(gl, POINT_VS, POINT_FS, ['aPosition', 'aColor', 'aSize']),
    };
  } catch (err) {
    return null;
  }

  // WebGL 1 needs an extension for 32-bit indices; the annual surface has more
  // than 65 536 vertices, so fall back to splitting it if the extension is absent.
  const uint32Indices = !!(gl.getExtension('OES_element_index_uint') || gl.getParameter(gl.VERSION).includes('2.0'));

  const identityM = identity();
  const nrm = new Float32Array(9);

  const api = {
    gl,
    uint32Indices,
    lost: false,

    /**
     * @param {number} [scaleOverride] pixel density to use instead of the display's,
     *   so the PNG export can render one frame at a higher resolution.
     */
    resize(scaleOverride) {
      const rect = canvas.getBoundingClientRect();
      const dpr = scaleOverride || Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      return { width: rect.width, height: rect.height, dpr };
    },

    clear(rgb, alpha = 0) {
      gl.clearColor(rgb[0], rgb[1], rgb[2], alpha);
      gl.clearDepth(1);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    },

    createMesh: (spec) => createMesh(gl, spec),

    /** Draw a mesh with the Lambert program. */
    drawMesh(mesh, opts = {}) {
      const p = programs.mesh;
      gl.useProgram(p.program);
      bindAttributes(gl, p, mesh);
      const model = opts.model || identityM;
      gl.uniformMatrix4fv(p.uniforms.uProjection, false, opts.projection);
      gl.uniformMatrix4fv(p.uniforms.uView, false, opts.view);
      gl.uniformMatrix4fv(p.uniforms.uModel, false, model);
      gl.uniformMatrix3fv(p.uniforms.uNormalMatrix, false, normalMatrix(model, nrm));
      const l = opts.light || { x: 0.4, y: 0.8, z: 0.45 };
      gl.uniform3f(p.uniforms.uLightDir, l.x, l.y, l.z);
      gl.uniform1f(p.uniforms.uAmbient, opts.ambient != null ? opts.ambient : 0.45);
      gl.uniform1f(p.uniforms.uOpacity, opts.opacity != null ? opts.opacity : 1);
      gl.uniform1f(p.uniforms.uFlat, opts.flat ? 1 : 0);
      const fog = opts.fogColor || [0, 0, 0];
      gl.uniform3f(p.uniforms.uFogColor, fog[0], fog[1], fog[2]);
      const range = opts.fogRange || [1e9, 1e9 + 1];
      gl.uniform2f(p.uniforms.uFogRange, range[0], range[1]);
      if (opts.depthWrite === false) gl.depthMask(false);
      if (opts.cull === false) gl.disable(gl.CULL_FACE);
      else { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); }
      issueDraw(gl, mesh);
      gl.depthMask(true);
      gl.disable(gl.CULL_FACE);
    },

    /** Draw line geometry (gl.LINES or gl.LINE_STRIP). */
    drawLines(mesh, opts = {}) {
      const p = programs.line;
      gl.useProgram(p.program);
      bindAttributes(gl, p, mesh);
      gl.uniformMatrix4fv(p.uniforms.uProjection, false, opts.projection);
      gl.uniformMatrix4fv(p.uniforms.uView, false, opts.view);
      gl.uniformMatrix4fv(p.uniforms.uModel, false, opts.model || identityM);
      gl.uniform1f(p.uniforms.uOpacity, opts.opacity != null ? opts.opacity : 1);
      if (opts.depthTest === false) gl.disable(gl.DEPTH_TEST);
      gl.lineWidth(1);
      issueDraw(gl, mesh);
      gl.enable(gl.DEPTH_TEST);
    },

    /** Draw round points sized in world units. */
    drawPoints(mesh, opts = {}) {
      const p = programs.point;
      gl.useProgram(p.program);
      bindAttributes(gl, p, mesh);
      gl.uniformMatrix4fv(p.uniforms.uProjection, false, opts.projection);
      gl.uniformMatrix4fv(p.uniforms.uView, false, opts.view);
      gl.uniformMatrix4fv(p.uniforms.uModel, false, opts.model || identityM);
      gl.uniform1f(p.uniforms.uScale, opts.scale != null ? opts.scale : 400);
      gl.uniform1f(p.uniforms.uOpacity, opts.opacity != null ? opts.opacity : 1);
      issueDraw(gl, mesh);
    },

    dispose() {
      for (const p of Object.values(programs)) gl.deleteProgram(p.program);
    },
  };

  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); api.lost = true; });
  canvas.addEventListener('webglcontextrestored', () => { api.lost = false; });
  return api;
}

function bindAttributes(gl, program, mesh) {
  program.attributes.forEach((name, i) => {
    const b = mesh.buffers[name];
    if (!b) { gl.disableVertexAttribArray(i); return; }
    gl.bindBuffer(gl.ARRAY_BUFFER, b.buffer);
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i, b.size, gl.FLOAT, false, 0, 0);
  });
  if (mesh.index) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.index);
}

function issueDraw(gl, mesh) {
  if (mesh.index) gl.drawElements(mesh.mode, mesh.count, mesh.indexType, 0);
  else gl.drawArrays(mesh.mode, 0, mesh.count);
}

/** Multiply projection and view once per frame for screen-space projection. */
function viewProjection(projection, view, out = new Float32Array(16)) {
  return multiply(projection, view, out);
}

export { createRenderer, viewProjection };
