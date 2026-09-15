/**
 * Host for the 3D views.
 *
 * Owns the WebGL canvas, the 2D label overlay drawn on top of it, the orbit
 * camera and the render loop. Each scene module is a pure function from app
 * state to a scene description; this module turns that description into GL
 * buffers and keeps them in step with the camera.
 *
 * @version 1.0.0 — 2026-09-15
 */
import { createRenderer } from '../render/webgl.js';
import { createCamera } from '../render/camera.js';
import { multiply, transformPoint, identity } from '../render/mat4.js';
import { readTheme, FONT_STACK, hexRgb } from '../render/canvas2d.js';
import { rgb01 } from '../render/geometry.js';

function createScene(container, root) {
  const canvas = document.createElement('canvas');
  canvas.className = 'epwviz-gl';
  const overlay = document.createElement('canvas');
  overlay.className = 'epwviz-gl-overlay';
  container.appendChild(canvas);
  container.appendChild(overlay);

  const renderer = createRenderer(canvas);
  if (!renderer) {
    container.innerHTML = '<div class="epwviz-fallback">'
      + '<strong>3D views need WebGL.</strong>'
      + '<span>This browser or device has WebGL disabled. The 2D views all work — '
      + 'switch to one from the view shelf.</span></div>';
    return null;
  }

  const camera = createCamera(overlay, {});
  const vp = new Float32Array(16);
  const modelVP = new Float32Array(16);
  const out = [0, 0, 0, 1];
  const identityM = identity();

  let description = null;
  let objects = [];
  let dirty = true;
  let size = { width: 1, height: 1, dpr: 1 };
  let raf = 0;
  let disposed = false;
  // Counts frames actually drawn. Cheap, and it is the only honest way to assert
  // "the scene redrew in response to input" — comparing screenshots cannot, because
  // element captures are not byte-stable.
  let frames = 0;

  // Must schedule a frame, not merely flag one: nothing else drives the loop while
  // the pointer is down, so setting `dirty` alone left orbit, zoom and pan dead.
  camera.onChange(() => requestRender());

  function disposeObjects() {
    for (const o of objects) o.mesh.dispose();
    objects = [];
  }

  /** Turn a scene description into GL buffers. */
  function setScene(desc) {
    disposeObjects();
    description = desc;
    if (!desc) { dirty = true; return; }
    const { gl } = renderer;
    for (const item of desc.objects || []) {
      if (!item || !item.data) continue;
      const spec = item.data;
      const attrCount = spec.attributes.aPosition.length / 3;
      if (!attrCount) continue;
      const modeMap = { 0: gl.POINTS, 1: gl.LINES, 4: gl.TRIANGLES };
      const mesh = renderer.createMesh({
        attributes: spec.attributes,
        indices: spec.indices,
        mode: spec.mode != null ? modeMap[spec.mode] : gl.TRIANGLES,
      });
      objects.push({ mesh, kind: item.kind, opts: item.opts || {} });
    }
    if (desc.camera) camera.reset({ ...camera.state, ...desc.camera });
    dirty = true;
  }

  function resize() {
    size = renderer.resize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    overlay.width = Math.max(1, Math.round(size.width * dpr));
    overlay.height = Math.max(1, Math.round(size.height * dpr));
    dirty = true;
  }

  function drawLabels(theme) {
    const ctx = overlay.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    if (!description || !description.labels) return;

    const labels = [];
    for (const label of description.labels) {
      const m = label.model || identityM;
      multiply(vp, m, modelVP);
      transformPoint(modelVP, label.world[0], label.world[1], label.world[2], out);
      if (out[3] <= 0.0001) continue;
      const sx = ((out[0] / out[3]) * 0.5 + 0.5) * size.width;
      const sy = (1 - ((out[1] / out[3]) * 0.5 + 0.5)) * size.height;
      if (sx < -80 || sx > size.width + 80 || sy < -40 || sy > size.height + 40) continue;
      labels.push({ ...label, sx, sy, depth: out[2] / out[3] });
    }
    // Far labels first, so near ones win any overlap.
    labels.sort((a, b) => b.depth - a.depth);

    const placed = [];
    for (const label of labels) {
      const size2 = label.size || 11;
      ctx.font = `${label.weight || 500} ${size2}px ${FONT_STACK}`;
      ctx.textAlign = label.align || 'center';
      ctx.textBaseline = label.baseline || 'middle';
      const w = ctx.measureText(label.text).width;
      const x = label.sx + (label.dx || 0);
      const y = label.sy + (label.dy || 0);
      // Skip labels that would collide with one already drawn.
      if (!label.always) {
        const box = { x0: x - w / 2 - 3, x1: x + w / 2 + 3, y0: y - size2 * 0.7, y1: y + size2 * 0.7 };
        if (placed.some((p) => !(box.x1 < p.x0 || box.x0 > p.x1 || box.y1 < p.y0 || box.y0 > p.y1))) continue;
        placed.push(box);
      }
      if (label.plate !== false) {
        ctx.fillStyle = theme.surface;
        ctx.globalAlpha = label.plateAlpha != null ? label.plateAlpha : 0.72;
        const px = label.align === 'left' ? x - 3 : label.align === 'right' ? x - w - 3 : x - w / 2 - 3;
        ctx.fillRect(px, y - size2 * 0.72, w + 6, size2 * 1.44);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = label.color || theme.ink2;
      ctx.fillText(label.text, x, y);
    }
  }

  function frame() {
    raf = 0;
    if (disposed || renderer.lost) return;
    if (!size.width) resize();
    const theme = readTheme(root);
    const aspect = size.width / Math.max(1, size.height);
    const cam = camera.update(aspect);
    multiply(cam.projection, cam.view, vp);

    const bg = rgb01(hexRgb(theme.surface, [18, 18, 18]));
    renderer.clear(bg, 0);

    const common = {
      projection: cam.projection,
      view: cam.view,
      fogColor: bg,
    };

    for (const o of objects) {
      const opts = { ...common, ...o.opts };
      if (o.kind === 'lines') renderer.drawLines(o.mesh, opts);
      else if (o.kind === 'points') renderer.drawPoints(o.mesh, opts);
      else renderer.drawMesh(o.mesh, opts);
    }

    drawLabels(theme);
    dirty = false;
    frames += 1;
  }

  function requestRender() {
    dirty = true;
    if (!raf && !disposed) raf = requestAnimationFrame(frame);
  }

  /** The camera preset a scene opened with, for "reset view". */
  function homeCamera() {
    return description && description.camera ? description.camera : null;
  }

  return {
    canvas,
    overlay,
    camera,
    renderer,
    homeCamera,
    get frames() { return frames; },
    setScene,
    resize() { resize(); requestRender(); },
    render: requestRender,
    get needsRender() { return dirty; },
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      disposeObjects();
      camera.dispose();
      renderer.dispose();
      canvas.remove();
      overlay.remove();
    },
  };
}

export { createScene };
