/**
 * Application entry point.
 *
 * Wires the store to the toolbar, the stage(s) and the readout strip, and owns
 * the things that are genuinely global: file loading, the animation loop,
 * presentation mode, and the responsive layout.
 *
 * @version 1.1.0 — 2026-10-04
 */
import { el, clear, icon, ICONS, NS } from './ui/dom.js';
import { createStore } from './core/state.js';
import { createToolbar } from './ui/toolbar.js';
import { createStage } from './ui/stage.js';
import { buildViewContext } from './ui/viewctx.js';
import { render as renderSummary } from './ui/summary.js';
import { exportPng, exportSize, exportCsv } from './ui/export.js';
import { APP_NAME, APP_TAGLINE, APP_STRAPLINE } from './data/branding.js';
import { parseEpw, EpwParseError, datasetLabel } from './epw/parse.js';
import { buildDataset } from './core/dataset.js';
import { loadSample, sampleAvailable, SAMPLE_LABEL } from './core/sample.js';
import { VERSION, releaseDateLong } from './data/version.js';
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
  const root = document.getElementById('climate-explorer')
    || document.body.appendChild(el('div', { id: 'climate-explorer' }));
  root.classList.add(`${NS}-root`);

  const store = createStore();
  let stages = [];
  let toolbar = null;
  let playTimer = 0;

  // ── shell ─────────────────────────────────────────────────────────────────
  const title = el('div.brand', {},
    el('span.brand-mark', {}, icon(ICONS.sun, 18)),
    el('span.brand-text', {}, el('strong', { text: APP_NAME }),
      el('span', { text: APP_STRAPLINE })));
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

  // The app ships with no weather data, so this is the front door for every
  // visitor: it has to say what an EPW file is, where to get one, and what to do.
  const empty = el('div.empty', {},
    el('div.empty-card', {},
      el('div.empty-icon', {}, icon(ICONS.upload, 30)),
      el('h2', { text: 'Open a weather file to begin' }),
      el('p.empty-lead', { text: `${APP_NAME} is ${APP_TAGLINE}.` }),
      el('p', {}, 'An ', el('strong', { text: 'EPW' }), ' file holds one year of hourly '
        + 'weather for a single location — temperature, humidity, solar radiation, wind '
        + 'and sky conditions. It is the file building simulation runs on.'),
      el('div.empty-actions', {},
        el('button.btn.btn-primary', {
          type: 'button',
          onclick: () => rail.querySelector('input[type=file]')?.click(),
        }, icon(ICONS.upload, 16), el('span', { text: 'Choose an EPW file' })),
        el('span.empty-or', { text: 'or drag one anywhere onto this page' })),
      el('div.empty-sources', {},
        el('span.empty-sources-label', { text: 'Free files for thousands of locations' }),
        el('a', {
          href: 'https://climate.onebuilding.org', target: '_blank', rel: 'noopener noreferrer',
        }, 'climate.onebuilding.org'),
        el('a', {
          href: 'https://energyplus.net/weather', target: '_blank', rel: 'noopener noreferrer',
        }, 'energyplus.net/weather')),
      el('p.empty-note', {}, icon(ICONS.info, 13),
        el('span', { text: 'The file is read in your browser. Nothing is uploaded anywhere.' }))));

  // Shown while the bundled example inflates, so the empty card does not flash up
  // for a few hundred milliseconds before being replaced.
  const loading = el('div.loading', { role: 'status' },
    el('div.loading-card', {},
      el('div.spinner'),
      el('span', { text: `Loading ${SAMPLE_LABEL}…` })));

  const dropHint = el('div.drop-hint', {}, el('div', { text: 'Release to load this EPW file' }));
  const errorBar = el('div.error-bar', { role: 'alert' });
  // The copyright line is the handle for the About panel: licence, credits and
  // the release this file is. Nothing else in the chrome has room for it, and a
  // reader looking for the terms looks at the copyright first.
  const aboutBtn = el('button.copyright', {
    type: 'button',
    title: 'Licence, credits and release',
    'aria-haspopup': 'dialog',
    onclick: () => setAbout(true),
  }, '© Karam Al-Obaidi');
  const footer = el('footer.footer', {}, aboutBtn, el('span.footer-file'));

  // ── about panel ───────────────────────────────────────────────────────
  //
  // An overlay inside the app rather than a <dialog>, for the same reason the
  // empty state and the loading card are: the app is embedded in a WordPress
  // page as often as it is opened standalone, and everything it draws has to
  // stay inside its own root.
  const aboutCite = el('pre.about-cite', {
    text: 'Al-Obaidi, K. M. (2026). Climate Explorer: A browser-based weather\n'
      + 'data analysis and visualisation tool'
      + (VERSION ? ` (Version ${VERSION})` : '') + ' [Computer software].\n'
      + 'Zenodo. https://doi.org/10.5281/zenodo.22814692',
  });
  const aboutClose = el('button.icon-btn.about-close', {
    type: 'button', 'aria-label': 'Close', onclick: () => setAbout(false),
  }, icon(ICONS.close, 16));
  const about = el('div.about', {
    role: 'dialog', 'aria-modal': 'true', 'aria-label': `About ${APP_NAME}`,
    onclick: (e) => { if (e.target === about) setAbout(false); },
  }, el('div.about-card', {}, aboutClose,
    el('h2.about-title', { text: APP_NAME }),
    ...(VERSION ? [el('section.about-sec', {},
      el('h3', { text: 'This release' }),
      el('p', {}, el('b', { text: `${VERSION} · ${releaseDateLong()}` }),
        ' — the version of this file and the date it was released. Quote it alongside '
        + 'any figure you publish: the tool has changed before, and two runs of the same '
        + 'weather file on different releases can differ.'))] : []),
    el('section.about-sec', {},
      el('h3', { text: 'Licence and credits' }),
      el('p', {}, '© 2026 Karam Al-Obaidi. The application is licensed ',
        el('b', { text: 'MIT' }), ' and the documentation ', el('b', { text: 'CC BY 4.0' }),
        ' — use it, adapt it, build on it, for any purpose including commercially. '
        + 'Credit is the only condition.'),
      el('p', {}, 'The ', el('b', { text: 'cube device' }), ' \u2014 the icon and logo \u2014 is the author\u2019s own mark and '
        + 'is not covered by either licence; all rights in it are reserved. Keep it on a copy you '
        + 'redistribute, but do not adopt it as your own badge.'),
      el('p', {}, 'The weather file you open is ', el('b', { text: 'yours' }),
        '. It is read in your browser and never uploaded; neither licence claims '
        + 'anything over your data, your charts or the images you export.'),
      el('p', {}, 'No third-party library is bundled and no network request is made: '
        + 'every chart, projection and solar calculation here is this project’s own code. '
        + 'Psychrometrics follow the ASHRAE Handbook of Fundamentals; solar position follows '
        + 'the NOAA General Solar Position Calculations; the comfort polygons follow ASHRAE 55 '
        + 'and Givoni–Milne. Those are published methods, not code: they are credited here '
        + 'because the numbers come from them, and the Method Notes give the equations.')),
    el('section.about-sec', {},
      el('h3', { text: 'How to cite' }),
      aboutCite,
      el('p.about-note', { text: 'The DOI above always resolves to the latest release.' }))));

  function setAbout(open) {
    about.classList.toggle('is-open', !!open);
    if (open) aboutClose.focus();
    else aboutBtn.focus();
  }

  body.appendChild(empty);
  body.appendChild(loading);
  root.append(el('div.app', {}, header, errorBar, body, footer, about, dropHint, scrim));

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

  const footerFile = footer.querySelector('.cx-footer-file');

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

      loading.style.display = s.loadingSample ? 'flex' : 'none';
      empty.style.display = (s.data || s.loadingSample) ? 'none' : 'flex';
      footerFile.textContent = s.data
        ? (s.data.isSample ? 'Example climate — import an EPW file to replace it' : s.fileName)
        : '';
      headerLocation.textContent = s.data ? datasetLabel(s.data) : '';

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
          loadingSample: false,
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
    // Embedded, the host page owns fullscreen — going fullscreen from in here as
    // well gives the viewer two competing controls. In that case this button is
    // purely the presentation layout: larger type, toolbar collapsed.
    if (!embedded) {
      if (on && root.requestFullscreen) root.requestFullscreen().catch(() => {});
      else if (!on && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    }
    requestAnimationFrame(() => { postHeight(); stages.forEach((s) => s.resize()); });
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
    openSample: () => openSample(),
    sampleAvailable,
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
      exportPng(stages[0], buildViewContext(store.state, { root }), store.state, VIEWS_2D);
    },
    exportCsv() {
      exportCsv(store.state.view, buildViewContext(store.state, { root }), store.state);
    },
    exportSize: () => (stages[0] ? exportSize(stages[0], store.state) : null),
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
  if (VERSION) {
    rail.appendChild(el('div.rail-version', {},
      el('span', { text: `Version ${VERSION}` }),
      el('span', { text: releaseDateLong() })));
  }

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
  if (embedded) root.classList.add('cx-embedded');
  let lastHeight = 0;

  function contentHeight() {
    const width = main.clientWidth || root.clientWidth || 900;
    // A stage that keeps roughly 16:10 proportions, bounded so a wide embed does
    // not become absurdly tall and a narrow one stays usable.
    const stage = Math.round(Math.max(320, Math.min(720, width * 0.56)));
    const chrome = header.offsetHeight + tiles.offsetHeight + footer.offsetHeight
      + (errorBar.classList.contains('is-visible') ? errorBar.offsetHeight : 0);
    return Math.max(600, chrome + stage + 34);
  }

  function postHeight() {
    if (!embedded) return;
    const wanted = contentHeight();
    // Fill the frame whenever it is taller than we asked for. A host page that
    // fullscreens the iframe — or simply gives it more height than requested —
    // would otherwise leave the frame's own background showing below the app.
    // Only `wanted` is posted upward, so this can never feed back on itself.
    const applied = Math.max(wanted, window.innerHeight || 0);
    if (root.style.height !== `${applied}px`) {
      root.style.height = `${applied}px`;
      requestAnimationFrame(() => stages.forEach((s) => s.resize()));
    }
    if (Math.abs(wanted - lastHeight) < 6) return;
    lastHeight = wanted;
    try {
      window.parent.postMessage({ type: 'climate-explorer:height', height: wanted }, '*');
    } catch (err) { /* cross-origin parent: the embed falls back to a fixed height */ }
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
  window.addEventListener('resize', () => { postHeight(); stages.forEach((st) => st.resize()); });

  // Keyboard shortcuts, aimed at someone presenting rather than editing.
  window.addEventListener('keydown', (e) => {
    // Escape closes the About panel first, whatever has focus — including the
    // fields the guard below would otherwise skip the handler for.
    if (e.key === 'Escape' && about.classList.contains('is-open')) {
      setAbout(false);
      return;
    }
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

  /**
   * Open on the bundled example so a class sees a climate immediately. If no sample
   * is embedded, or the browser cannot inflate it, this quietly leaves the empty
   * state in place — the app is still fully usable by importing a file.
   */
  async function openSample() {
    if (!sampleAvailable()) { render(); return; }
    store.set({ loadingSample: true }, { immediate: true });
    try {
      const sample = await loadSample();
      if (!sample) { store.set({ loadingSample: false }, { immediate: true }); return; }
      const preferred = sample.data.availableKeys.includes('dryBulb')
        ? 'dryBulb' : sample.data.availableKeys[0];
      store.set({
        data: sample.data,
        fileName: sample.name,
        variable: preferred,
        loadingSample: false,
      }, { immediate: true });
    } catch (err) {
      store.set({ loadingSample: false }, { immediate: true });
      showError(`The bundled example climate could not be read: ${err.message}`);
    }
  }

  render();
  openSample();

  // Exposed so a host page (or a test harness) can feed a file in directly.
  window.ClimateExplorer = {
    load: (text, name = 'inline.epw') => {
      const data = buildDataset(parseEpw(text));
      invalidateHeatmap();
      store.set({ data, fileName: name, period: { ...FULL_YEAR } }, { immediate: true });
    },
    setState: (patch) => store.set(patch, { immediate: true }),
    getState: () => store.state,
    /** Frames drawn by the active 3D scene, and the current camera. */
    sceneInfo: () => {
      const scene = stages[0]?.scene;
      if (!scene) return null;
      const { azimuth, elevation, distance, target } = scene.camera.state;
      return { frames: scene.frames, azimuth, elevation, distance, target: target.slice() };
    },
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
