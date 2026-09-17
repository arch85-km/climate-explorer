/**
 * The presentation space: whichever view is active, plus its tooltip.
 *
 * Owns one 2D canvas and one 3D scene and swaps between them, so switching views
 * never tears down the WebGL context (which is slow and, on some drivers, leaks).
 *
 * @version 1.0.0 — 2026-09-17
 */
import { el, clear, icon, ICONS } from './dom.js';
import { fitCanvas, readTheme } from '../render/canvas2d.js';
import { createScene } from '../views3d/scene.js';
import { VIEW_BY_ID } from './modes.js';
import { formatValue, ALL_BY_KEY } from '../epw/fields.js';
import { MONTH_ABBR } from '../epw/parse.js';

/** The variables shown in a hover tooltip, in reading order. */
const TOOLTIP_KEYS = ['dryBulb', 'relHumidity', 'globalHorizontal', 'directNormal', 'windSpeed', 'windDirection'];

/**
 * Standard viewing angles for a shadow study. Distance and target are left alone so
 * a preset re-aims the camera without also throwing away the student's zoom.
 */
const CAMERA_PRESETS = [
  { key: 'plan', label: 'Plan', azimuth: Math.PI, elevation: 1.5 },
  { key: 'south', label: 'South', azimuth: Math.PI, elevation: 0.18 },
  { key: 'southeast', label: 'SE', azimuth: Math.PI * 0.75, elevation: 0.42 },
  { key: 'perspective', label: 'Perspective', home: true },
];

function createStage(container, root, views2d, views3d, onProbe) {
  const canvas = el('canvas.canvas2d', { 'aria-label': 'Chart' });
  const glHost = el('div.gl-host');
  const tooltip = el('div.tooltip', { role: 'status', 'aria-live': 'polite' });
  const caption = el('div.stage-caption');

  // 3D navigation: preset angles, a reset, and a hint that retires itself once the
  // student has orbited for the first time.
  const navHint = el('div.nav-hint', { text: 'Drag to orbit · scroll to zoom · shift-drag to pan' });
  const nav = el('div.stage-nav', { role: 'group', 'aria-label': 'Camera' });
  const surface = el('div.stage-surface', {}, canvas, glHost, nav, navHint, tooltip, caption);
  container.appendChild(surface);

  let scene = null;
  let sceneFailed = false;
  let hintRetired = false;
  let current = null;   // { id, kind }
  let lastContext = null;
  let lastFrame = null;
  let pointer = null;

  function retireHint() {
    if (hintRetired) return;
    hintRetired = true;
    navHint.classList.add('is-gone');
  }

  function buildNav() {
    clear(nav);
    for (const preset of CAMERA_PRESETS) {
      nav.appendChild(el('button.nav-btn', {
        type: 'button',
        title: preset.home ? 'Return to the default view' : `View from ${preset.label.toLowerCase()}`,
        onclick: () => {
          if (!scene) return;
          retireHint();
          const home = scene.homeCamera() || {};
          scene.camera.reset(preset.home
            ? { ...scene.camera.state, ...home }
            : { ...scene.camera.state, azimuth: preset.azimuth, elevation: preset.elevation });
        },
      }, preset.label));
    }
    nav.appendChild(el('button.nav-btn.nav-reset', {
      type: 'button', title: 'Reset the view', 'aria-label': 'Reset the view',
      onclick: () => {
        if (!scene) return;
        retireHint();
        scene.camera.reset({ ...scene.camera.state, ...(scene.homeCamera() || {}) });
      },
    }, icon(ICONS.reset, 13)));
  }

  function ensureScene() {
    if (scene || sceneFailed) return scene;
    scene = createScene(glHost, root);
    if (!scene) { sceneFailed = true; return scene; }
    buildNav();
    // Any real interaction with the scene means the hint has done its job.
    for (const ev of ['pointerdown', 'wheel']) {
      scene.overlay.addEventListener(ev, retireHint, { passive: true });
    }
    return scene;
  }

  function setActive(viewId) {
    const meta = VIEW_BY_ID[viewId];
    const kind = meta ? meta.kind : '2d';
    current = { id: viewId, kind };
    const is3d = kind === '3d';
    canvas.style.display = is3d ? 'none' : 'block';
    glHost.style.display = is3d ? 'block' : 'none';
    if (is3d) ensureScene();
    const hasScene = is3d && !sceneFailed;
    nav.style.display = hasScene ? 'flex' : 'none';
    navHint.style.display = hasScene && !hintRetired ? 'block' : 'none';
    hideTooltip();
  }

  function render(context) {
    lastContext = context;
    if (!current) return;
    if (current.kind === '3d') {
      const s = ensureScene();
      if (!s) return;
      const builder = views3d[current.id];
      if (!builder || !context) return;
      const theme = readTheme(root);
      const desc = builder.build({ ...context, uint32: s.renderer.uint32Indices }, theme);
      s.setScene(desc);
      s.resize();
      caption.textContent = desc.caption || '';
      caption.style.display = desc.caption ? 'block' : 'none';
    } else {
      fitCanvas(canvas);
      const view = views2d[current.id];
      if (!view) return;
      lastFrame = view.draw(canvas, context || { root, data: null, state: {} });
      caption.style.display = 'none';
      if (pointer) showTooltipAt(pointer.x, pointer.y);
    }
  }

  function resize() {
    if (current?.kind === '3d') scene?.resize();
    else render(lastContext);
  }

  // ── tooltip ───────────────────────────────────────────────────────────────
  function hideTooltip() {
    tooltip.classList.remove('is-visible');
    pointer = null;
  }

  function showTooltipAt(x, y) {
    if (!lastContext || !lastFrame || current?.kind === '3d') return;
    const view = views2d[current.id];
    if (!view?.probe) return hideTooltip();
    const hit = view.probe(lastFrame, lastContext, x, y);
    if (!hit) return hideTooltip();

    const rows = [];
    if (hit.rows) {
      for (const r of hit.rows) {
        rows.push([r.label, r.text != null ? r.text
          : formatValue(lastContext.field, r.value, lastContext.state.units)]);
      }
    } else if (hit.record != null && hit.record >= 0) {
      const d = lastContext.data;
      const keys = [lastContext.field.key, ...TOOLTIP_KEYS.filter((k) => k !== lastContext.field.key)];
      for (const key of keys) {
        const f = ALL_BY_KEY[key];
        const series = d.series[key];
        if (!f || !series) continue;
        const v = series[hit.record];
        if (!Number.isFinite(v)) continue;
        rows.push([f.short, formatValue(f, v, lastContext.state.units)]);
        if (rows.length >= 6) break;
      }
    }

    clear(tooltip);
    tooltip.appendChild(el('div.tooltip-title', { text: hit.title }));
    const grid = el('div.tooltip-grid');
    for (const [label, value] of rows) {
      grid.appendChild(el('span.tooltip-key', { text: label }));
      grid.appendChild(el('span.tooltip-val', { text: value }));
    }
    tooltip.appendChild(grid);
    tooltip.classList.add('is-visible');

    // Keep the tooltip inside the stage.
    const box = surface.getBoundingClientRect();
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    let tx = (hit.x != null ? hit.x : x) + 14;
    let ty = (hit.y != null ? hit.y : y) + 14;
    if (tx + tw > box.width - 8) tx = Math.max(8, (hit.x != null ? hit.x : x) - tw - 14);
    if (ty + th > box.height - 8) ty = Math.max(8, (hit.y != null ? hit.y : y) - th - 14);
    tooltip.style.transform = `translate(${Math.round(tx)}px, ${Math.round(ty)}px)`;
    return hit;
  }

  canvas.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect();
    pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    showTooltipAt(pointer.x, pointer.y);
  });
  canvas.addEventListener('pointerleave', hideTooltip);
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const hit = showTooltipAt(e.clientX - rect.left, e.clientY - rect.top);
    // Clicking a cell moves the shared cursor, so the sun path and massing views
    // jump to the hour the student just pointed at.
    if (hit && onProbe && lastContext?.data) {
      const d = lastContext.data;
      if (hit.day != null) {
        const key = d.dayKeys[hit.day];
        onProbe({ month: key.month, day: key.day, ...(hit.hour != null ? { hour: hit.hour } : {}) });
      }
    }
  });

  return {
    surface,
    canvas,
    glHost,
    setActive,
    render,
    resize,
    hideTooltip,
    get scene() { return scene; },
    get is3d() { return current?.kind === '3d'; },
    get activeId() { return current?.id; },
    dispose() { scene?.dispose(); },
  };
}

export { createStage, MONTH_ABBR };
