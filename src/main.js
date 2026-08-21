/**
 * Application entry point.
 *
 * Wires the store to the toolbar, the stage(s) and the readout strip, and owns
 * the things that are genuinely global: file loading, the animation loop,
 * presentation mode, and the responsive layout.
 */
import { el, clear, icon, ICONS, NS } from './ui/dom.js';
import { createStore } from './core/state.js';
import { createToolbar } from './ui/toolbar.js';
import { createStage } from './ui/stage.js';
import { buildViewContext } from './ui/viewctx.js';
import { render as renderSummary } from './ui/summary.js';
import { exportPng, exportCsv } from './ui/export.js';
import { parseEpw, EpwParseError, locationLabel } from './epw/parse.js';
import { buildDataset } from './core/dataset.js';
import { presetPeriods, FULL_YEAR } from './core/filter.js';
import { VIEW_BY_ID, MODE_BY_ID, viewsForMode } from './ui/modes.js';
import { invalidate as invalidateHeatmap } from './views2d/heatmap.js';
import { daysInMonth } from './core/solar.js';

import * as heatmap from './views2d/heatmap.js';
import * as timeseries from './views2d/timeseries.js';
import * as diurnal from './views2d/diurnal.js';
import * as monthly from './views2d/monthly.js';
import * as histogram from './views2d/histogram.js';
import * as psychrometric from './views2d/psychrometric.js';
import * as windroseView from './views2d/windrose.js';
import * as sunpath from './views2d/sunpath.js';
import * as sundome from './views3d/sundome.js';
import * as surface from './views3d/surface.js';
import * as windrose3d from './views3d/windrose3d.js';
import * as massing from './views3d/massing.js';

const VIEWS_2D = { heatmap, timeseries, diurnal, monthly, histogram, psychrometric, windrose: windroseView, sunpath };
const VIEWS_3D = { sundome, surface, windrose3d, massing };

function boot() {
  const root = document.getElementById('epwviz')
    || document.body.appendChild(el('div', { id: 'epwviz' }));
  root.classList.add(`${NS}-root`);

  const store = createStore();
  let stages = [];
  let toolbar = null;
  let playTimer = 0;

  // ── shell ─────────────────────────────────────────────────────────────────
  const title = el('div.brand', {},
    el('span.brand-mark', {}, icon(ICONS.sun, 18)),
    el('span.brand-text', {}, el('strong', { text: 'Climate Explorer' }),
      el('span', { text: 'EPW weather data for design' })));
  const headerLocation = el('div.header-location');
  const menuBtn = el('button.icon-btn.menu-btn', {
    type: 'button', 'aria-label': 'Show controls', 'aria-expanded': 'false',
    onclick: () => toggleRail(),
  }, icon(ICONS.menu, 18));
  const presentBtn = el('button.icon-btn', {
    type: 'button', 'aria-label': 'Presentation mode', title: 'Presentation mode (P)',
    onclick: () => setPresentation(!store.state.presentation),
  }, icon(ICONS.expand, 18));
  const header = el('header.header', {}, title, headerLocation,
    el('div.header-actions', {}, presentBtn, menuBtn));

  const rail = el('aside.rail', { 'aria-label': 'Controls' });
  const stageWrap = el('div.stages');
  const tiles = el('div.tiles');
  const main = el('main.main', {}, stageWrap, tiles);
  const body = el('div.body', {}, rail, main);
  const scrim = el('div.scrim', { onclick: () => toggleRail(false) });

  const empty = el('div.empty', {},
    el('div.empty-card', {},
      el('div.empty-icon', {}, icon(ICONS.upload, 34)),
      el('h2', { text: 'Drop an EPW file to begin' }),
      el('p', {}, 'An ', el('strong', { text: 'EPW' }), ' file is one year of hourly weather — '
        + 'temperature, humidity, solar radiation, wind and sky conditions — for one location. '
        + 'It is the file building simulation runs on.'),
      el('p.empty-sources', {}, 'Free files for thousands of locations: ',
        el('code', { text: 'climate.onebuilding.org' }), ' and ',
        el('code', { text: 'energyplus.net/weather' }), '.'),
      el('button.btn.btn-primary', {
        type: 'button',
        onclick: () => toolbar?.controls && rail.querySelector('input[type=file]')?.click(),
      }, icon(ICONS.upload, 16), el('span', { text: 'Choose an EPW file' })),
      el('p.empty-note', { text: 'The file is read in your browser. Nothing is uploaded anywhere.' })));

  const dropHint = el('div.drop-hint', {}, el('div', { text: 'Release to load this EPW file' }));
  const errorBar = el('div.error-bar', { role: 'alert' });

  body.appendChild(empty);
  root.append(el('div.app', {}, header, errorBar, body, dropHint, scrim));

  // ── stages ────────────────────────────────────────────────────────────────
  function rebuildStages() {
    for (const s of stages) s.dispose();
    clear(stageWrap);
    stages = [];
    const count = store.state.compare ? 2 : 1;
    stageWrap.classList.toggle('is-compare', count === 2);
    for (let i = 0; i < count; i += 1) {
      const panel = el('div.stage-panel');
      if (count === 2) panel.appendChild(el('div.stage-tag', { text: i === 0 ? 'A' : 'B' }));
      stageWrap.appendChild(panel);
      const stage = createStage(panel, root, VIEWS_2D, VIEWS_3D, (cursor) => {
        store.set({ cursor });
      });
      stage.setActive(store.state.view);
      stages.push(stage);
    }
  }

  // ── rendering ─────────────────────────────────────────────────────────────
  let renderQueued = false;
  function render() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      const s = store.state;
      root.dataset.theme = s.theme;
      root.dataset.presentation = s.presentation ? 'on' : 'off';
      root.dataset.hasData = s.data ? 'yes' : 'no';

      empty.style.display = s.data ? 'none' : 'flex';
      headerLocation.textContent = s.data ? locationLabel(s.data.location) : '';

      toolbar.update();

      for (let i = 0; i < stages.length; i += 1) {
        stages[i].setActive(s.view);
        const context = buildViewContext(s, { compare: i === 1, root });
        stages[i].render(context);
      }
      renderSummary(tiles, buildViewContext(s, { root }));
      postHeight();
    });
  }

  // ── file loading ──────────────────────────────────────────────────────────
  function showError(message) {
    errorBar.textContent = message;
    errorBar.classList.toggle('is-visible', !!message);
    if (message) setTimeout(() => errorBar.classList.remove('is-visible'), 9000);
  }

  async function loadFile(file, asCompare = false) {
    if (!file) return;
    if (file.size > 60 * 1024 * 1024) {
      showError('That file is larger than 60 MB — it is probably not an EPW file.');
      return;
    }
    try {
      const text = await file.text();
      const data = buildDataset(parseEpw(text));
      invalidateHeatmap();
      if (asCompare) {
        store.set({ compareData: data, compareFileName: file.name, compare: true, compareSource: 'file' }, { immediate: true });
      } else {
        // Open on a variable the file actually contains.
        const mode = MODE_BY_ID[store.state.mode];
        const preferred = [mode?.variable, store.state.variable, 'dryBulb']
          .find((k) => k && data.availableKeys.includes(k)) || data.availableKeys[0];
        store.set({
          data,
          fileName: file.name,
          variable: preferred,
          period: { ...FULL_YEAR },
          presetKey: 'year',
          cursor: { month: 6, day: 21, hour: 12 },
        }, { immediate: true });
      }
      showError('');
    } catch (err) {
      const message = err instanceof EpwParseError
        ? err.message
        : `Could not read that file: ${err.message}`;
      showError(message);
    }
  }

  // Drag and drop anywhere over the app.
  let dragDepth = 0;
  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  root.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth += 1;
    root.classList.add('is-dragging');
  });
  root.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  root.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) root.classList.remove('is-dragging');
  });
  root.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    root.classList.remove('is-dragging');
    const file = e.dataTransfer.files[0];
    // A second file dropped while comparing goes into the B panel.
    loadFile(file, store.state.compare && store.state.compareSource === 'file' && !!store.state.compareData);
  });

  // ── actions ───────────────────────────────────────────────────────────────
  function setPresentation(on) {
    store.set({ presentation: on }, { immediate: true });
    presentBtn.replaceChildren(icon(on ? ICONS.collapse : ICONS.expand, 18));
    if (on && root.requestFullscreen) root.requestFullscreen().catch(() => {});
    else if (!on && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    requestAnimationFrame(() => stages.forEach((s) => s.resize()));
  }

  function togglePlay() {
    const on = !store.state.playing;
    store.set({ playing: on }, { immediate: true });
    clearInterval(playTimer);
    if (on) {
      playTimer = setInterval(() => {
        const s = store.state;
        if (!s.data) return;
        let { hour, day, month } = s.cursor;
        hour += 1;
        if (hour > 23) {
          hour = 0;
          day += 1;
          if (day > daysInMonth(month, s.data.isLeap)) { day = 1; month = month === 12 ? 1 : month + 1; }
        }
        store.set({ cursor: { hour, day, month } }, { immediate: true });
      }, 260);
    }
  }

  const actions = {
    loadFile,
    togglePlay,
    setPresentation,
    setMode(id) {
      const mode = MODE_BY_ID[id];
      const s = store.state;
      const views = viewsForMode(id);
      const view = views.some((v) => v.id === s.view) ? s.view : views[0].id;
      const available = s.data ? s.data.availableKeys : null;
      const variable = mode.variables.find((k) => !available || available.includes(k)) || s.variable;
      store.set({ mode: id, view, variable }, { immediate: true });
    },
    setCompareSource(v) {
      store.set({ compareSource: v }, { immediate: true });
    },
    applyPreset(key) {
      const preset = presetPeriods(store.state.data).find((p) => p.key === key);
      if (preset) store.set({ period: { ...preset.period }, presetKey: key }, { immediate: true });
    },
    exportPng() {
      exportPng(stages[0], buildViewContext(store.state, { root }), store.state);
    },
    exportCsv() {
      exportCsv(store.state.view, buildViewContext(store.state, { root }), store.state);
    },
    reset() {
      store.set({
        period: { ...FULL_YEAR },
        presetKey: 'year',
        cursor: { month: 6, day: 21, hour: 12 },
        stats: { aggregation: 'mean', percentile: 50, degreeDayBase: 18, bins: 30, comfortLow: 20, comfortHigh: 26, showStrategies: true },
        massing: { width: 18, depth: 12, height: 14, rotation: 0, courtyard: false, showTrace: true, showAnalemma: true },
        compare: false,
      }, { immediate: true });
      stages.forEach((s) => s.scene?.camera.reset({}));
    },
  };

  toolbar = createToolbar(store, actions);
  rail.appendChild(toolbar.node);

  // ── responsive rail ───────────────────────────────────────────────────────
  function toggleRail(force) {
    const open = force != null ? force : !root.classList.contains('rail-open');
    root.classList.toggle('rail-open', open);
    menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    requestAnimationFrame(() => stages.forEach((s) => s.resize()));
  }

  // ── iframe height, so a WordPress embed can size itself ───────────────────
  //
  // Standalone, the app fills the viewport. Embedded, it must instead derive a
  // height from its own content — otherwise it is 100vh of the iframe and would
  // simply report the iframe's current height straight back to it.
  const embedded = window.parent !== window;
  if (embedded) root.classList.add('epwviz-embedded');
  let lastHeight = 0;

  function contentHeight() {
    const width = main.clientWidth || root.clientWidth || 900;
    // A stage that keeps roughly 16:10 proportions, bounded so a wide embed does
    // not become absurdly tall and a narrow one stays usable.
    const stage = Math.round(Math.max(320, Math.min(720, width * 0.56)));
    const chrome = header.offsetHeight + tiles.offsetHeight
      + (errorBar.classList.contains('is-visible') ? errorBar.offsetHeight : 0);
    return Math.max(600, chrome + stage + 34);
  }

  function postHeight() {
    if (!embedded) return;
    const h = contentHeight();
    if (Math.abs(h - lastHeight) < 6) return;
    lastHeight = h;
    root.style.height = `${h}px`;
    try {
      window.parent.postMessage({ type: 'epwviz:height', height: h }, '*');
    } catch (err) { /* cross-origin parent: the embed falls back to a fixed height */ }
    requestAnimationFrame(() => stages.forEach((s) => s.resize()));
  }

  // ── wiring ────────────────────────────────────────────────────────────────
  let lastCompare = null;
  store.subscribe((s, changed) => {
    if (changed.has('theme')) invalidateHeatmap();
    if (changed.has('data')) invalidateHeatmap();
    if (s.compare !== lastCompare) {
      lastCompare = s.compare;
      rebuildStages();
    }
    render();
  });

  const resizeObserver = new ResizeObserver(() => {
    stages.forEach((st) => st.resize());
    postHeight();
  });
  resizeObserver.observe(main);
  window.addEventListener('resize', () => stages.forEach((st) => st.resize()));

  // Keyboard shortcuts, aimed at someone presenting rather than editing.
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === 'p' || e.key === 'P') { setPresentation(!store.state.presentation); }
    else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const delta = e.key === 'ArrowRight' ? 1 : -1;
      const s = store.state;
      let h = s.cursor.hour + delta;
      let d = s.cursor.day;
      let m = s.cursor.month;
      if (h > 23) { h = 0; d += 1; }
      if (h < 0) { h = 23; d -= 1; }
      const dim = daysInMonth(m, s.data?.isLeap);
      if (d > dim) { d = 1; m = m === 12 ? 1 : m + 1; }
      if (d < 1) { m = m === 1 ? 12 : m - 1; d = daysInMonth(m, s.data?.isLeap); }
      store.set({ cursor: { hour: h, day: d, month: m } }, { immediate: true });
    } else if (e.key === 'Escape' && store.state.presentation) {
      setPresentation(false);
    }
  });

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && store.state.presentation) {
      store.set({ presentation: false }, { immediate: true });
      presentBtn.replaceChildren(icon(ICONS.expand, 18));
    }
    requestAnimationFrame(() => stages.forEach((s) => s.resize()));
  });

  lastCompare = store.state.compare;
  rebuildStages();
  render();

  // Exposed so a host page (or a test harness) can feed a file in directly.
  window.EPWVisualiser = {
    load: (text, name = 'inline.epw') => {
      const data = buildDataset(parseEpw(text));
      invalidateHeatmap();
      store.set({ data, fileName: name, period: { ...FULL_YEAR } }, { immediate: true });
    },
    setState: (patch) => store.set(patch, { immediate: true }),
    getState: () => store.state,
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
