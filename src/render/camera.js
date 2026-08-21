/**
 * Orbit camera: drag to rotate, wheel or pinch to zoom, two-finger or right-drag
 * to pan. Elevation is clamped so the scene never turns upside down, which is
 * disorienting when the ground plane carries meaning.
 */
import { perspective, lookAt } from './mat4.js';

function createCamera(element, opts = {}) {
  const state = {
    azimuth: opts.azimuth != null ? opts.azimuth : Math.PI * 0.25,
    elevation: opts.elevation != null ? opts.elevation : 0.5,
    distance: opts.distance != null ? opts.distance : 4,
    target: opts.target ? opts.target.slice() : [0, 0, 0],
    minDistance: opts.minDistance || 0.6,
    maxDistance: opts.maxDistance || 60,
    minElevation: opts.minElevation != null ? opts.minElevation : -0.15,
    maxElevation: opts.maxElevation != null ? opts.maxElevation : 1.52,
    fov: opts.fov || 45,
    allowPan: opts.allowPan !== false,
  };

  const projection = new Float32Array(16);
  const view = new Float32Array(16);
  const eye = [0, 0, 0];
  let onChange = () => {};

  function update(aspect) {
    const ce = Math.cos(state.elevation);
    eye[0] = state.target[0] + state.distance * ce * Math.sin(state.azimuth);
    eye[1] = state.target[1] + state.distance * Math.sin(state.elevation);
    eye[2] = state.target[2] + state.distance * ce * Math.cos(state.azimuth);
    perspective(state.fov, aspect || 1, Math.max(0.01, state.distance * 0.02), state.distance * 40, projection);
    lookAt(eye, state.target, [0, 1, 0], view);
    return { projection, view, eye };
  }

  // ── pointer handling ──────────────────────────────────────────────────────
  const pointers = new Map();
  let mode = null;
  let last = null;
  let pinchDistance = 0;

  function pointerPos(e) {
    const rect = element.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerDown(e) {
    element.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, pointerPos(e));
    if (pointers.size === 1) {
      mode = (e.button === 2 || e.shiftKey) && state.allowPan ? 'pan' : 'orbit';
      last = pointerPos(e);
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
      mode = 'pinch';
    }
    element.style.cursor = 'grabbing';
  }

  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) return;
    const pos = pointerPos(e);
    pointers.set(e.pointerId, pos);

    if (mode === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDistance > 0) {
        state.distance = clamp(state.distance * (pinchDistance / (d || 1)), state.minDistance, state.maxDistance);
      }
      pinchDistance = d;
      onChange();
      return;
    }

    if (!last) return;
    const dx = pos.x - last.x;
    const dy = pos.y - last.y;
    last = pos;

    if (mode === 'pan') {
      const scale = state.distance * 0.0022;
      const right = [Math.cos(state.azimuth), 0, -Math.sin(state.azimuth)];
      state.target[0] -= (dx * right[0]) * scale;
      state.target[2] -= (dx * right[2]) * scale;
      state.target[1] += dy * scale;
    } else {
      state.azimuth -= dx * 0.008;
      state.elevation = clamp(state.elevation + dy * 0.006, state.minElevation, state.maxElevation);
    }
    onChange();
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    element.releasePointerCapture?.(e.pointerId);
    if (!pointers.size) { mode = null; last = null; }
    else if (pointers.size === 1) { mode = 'orbit'; last = [...pointers.values()][0]; }
    element.style.cursor = 'grab';
  }

  function onWheel(e) {
    e.preventDefault();
    const factor = Math.exp(Math.sign(e.deltaY) * Math.min(0.35, Math.abs(e.deltaY) * 0.0015));
    state.distance = clamp(state.distance * factor, state.minDistance, state.maxDistance);
    onChange();
  }

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointercancel', onPointerUp);
  element.addEventListener('wheel', onWheel, { passive: false });
  element.addEventListener('contextmenu', (e) => e.preventDefault());
  element.style.cursor = 'grab';
  element.style.touchAction = 'none';

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  return {
    state,
    update,
    get eye() { return eye; },
    onChange(fn) { onChange = fn; },
    set(patch) { Object.assign(state, patch); onChange(); },
    reset(preset) {
      Object.assign(state, preset);
      onChange();
    },
    dispose() {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerUp);
      element.removeEventListener('wheel', onWheel);
    },
  };
}

export { createCamera };
