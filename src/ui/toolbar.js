/**
 * The toolbar.
 *
 * Built once, then updated in place from state. Controls are grouped by the
 * question they answer — where, when, what, how — rather than by which module
 * implements them, because that is the order a student works in.
 *
 * @version 1.0.0 — 2026-09-15
 */
import { el, clear, icon, ICONS } from './dom.js';
import { group, select, slider, segmented, toggle, button, dayPicker } from './controls.js';
import { MODES, viewsForMode, controlInMode, VIEW_BY_ID } from './modes.js';
import { ALL_BY_KEY, ALL_FIELDS, FIELD_BY_KEY, convert, unitFor } from '../epw/fields.js';
import { presetPeriods, describePeriod, FULL_YEAR } from '../core/filter.js';
import { daysInMonth, dayOfYear, sunTimes } from '../core/solar.js';
import { locationLabel, datasetLabel, coordLabel, MONTH_ABBR } from '../epw/parse.js';

const HOUR_FMT = (h) => `${String(Math.round(h)).padStart(2, '0')}:00`;

function createToolbar(store, actions) {
  const controls = {};
  const sections = {};
  const node = el('div.toolbar', { role: 'region', 'aria-label': 'Controls' });

  const state = () => store.state;
  const set = (patch, opts) => store.set(patch, opts);

  // ── file ──────────────────────────────────────────────────────────────────
  const fileInput = el('input', {
    type: 'file', accept: '.epw,text/plain', style: { display: 'none' }, 'aria-hidden': 'true',
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files?.[0]) actions.loadFile(fileInput.files[0]);
    fileInput.value = '';
  });
  const importBtn = button('Import EPW', () => fileInput.click(), { icon: ICONS.upload, variant: 'primary' });

  const compareInput = el('input', {
    type: 'file', accept: '.epw,text/plain', style: { display: 'none' }, 'aria-hidden': 'true',
  });
  compareInput.addEventListener('change', () => {
    if (compareInput.files?.[0]) actions.loadFile(compareInput.files[0], true);
    compareInput.value = '';
  });

  // A way back to the bundled example after a student has loaded their own file.
  const sampleBtn = button('Load example climate', () => actions.openSample(),
    { icon: ICONS.reset, title: 'Return to the bundled example climate' });

  const locationBox = el('div.location');
  sections.file = group('Weather file', importBtn.node, sampleBtn.node, fileInput, compareInput, locationBox);

  // ── analysis mode ─────────────────────────────────────────────────────────
  controls.mode = segmented(
    MODES.map((m) => ({ value: m.id, label: m.label, title: m.blurb })),
    state().mode,
    (v) => actions.setMode(v),
    { label: 'Analysis mode', showLabel: false },
  );
  const modeBlurb = el('div.mode-blurb');
  sections.mode = group('Analysis mode', controls.mode.node, modeBlurb);

  // ── views ─────────────────────────────────────────────────────────────────
  const viewShelf = el('div.view-shelf', { role: 'tablist', 'aria-label': 'Views' });
  sections.views = group('View', viewShelf);

  // ── variable ──────────────────────────────────────────────────────────────
  controls.variable = select([], state().variable, (v) => set({ variable: v }), { label: 'Variable' });
  const variableAbout = el('div.hint');
  sections.variable = group('Variable', controls.variable.node, variableAbout);

  // ── analysis period ───────────────────────────────────────────────────────
  controls.preset = select([], 'year', (v) => actions.applyPreset(v), { label: 'Preset' });
  controls.from = dayPicker('From', { month: 1, day: 1 }, (v) => {
    set({ period: { fromMonth: v.month, fromDay: v.day } });
  }, (m) => daysInMonth(m, state().data?.isLeap));
  controls.to = dayPicker('To', { month: 12, day: 31 }, (v) => {
    set({ period: { toMonth: v.month, toDay: v.day } });
  }, (m) => daysInMonth(m, state().data?.isLeap));
  controls.fromHour = slider({
    label: 'From hour', min: 0, max: 23, value: 0, format: HOUR_FMT,
    onInput: (v) => set({ period: { fromHour: v } }),
  });
  controls.toHour = slider({
    label: 'To hour', min: 0, max: 23, value: 23, format: HOUR_FMT,
    onInput: (v) => set({ period: { toHour: v } }),
  });
  const periodSummary = el('div.hint');
  sections.period = group('Analysis period',
    controls.preset.node,
    el('div.row', {}, controls.from.node, controls.to.node),
    controls.fromHour.node,
    controls.toHour.node,
    periodSummary);

  // ── instant (date + time cursor) ──────────────────────────────────────────
  controls.cursorDate = dayPicker('Date', { month: 6, day: 21 }, (v) => {
    set({ cursor: { month: v.month, day: v.day } });
  }, (m) => daysInMonth(m, state().data?.isLeap));
  controls.cursorHour = slider({
    label: 'Time', min: 0, max: 23, value: 12, format: HOUR_FMT,
    onInput: (v) => set({ cursor: { hour: v } }),
  });
  controls.play = button('Play', () => actions.togglePlay(), { icon: ICONS.play, iconOnly: true, ariaLabel: 'Animate the hour' });
  controls.solstice = el('div.chips', {},
    ...[[21, 6, '21 Jun'], [21, 3, '21 Mar'], [21, 12, '21 Dec']].map(([day, month, label]) => el('button.chip', {
      type: 'button',
      onclick: () => set({ cursor: { month, day } }),
    }, label)));
  const sunReadout = el('div.hint');
  sections.cursor = group('Date & time',
    controls.cursorDate.node,
    el('div.row.row-tight', {}, controls.cursorHour.node, controls.play.node),
    controls.solstice,
    sunReadout);

  // ── statistical options ───────────────────────────────────────────────────
  controls.aggregation = segmented([
    { value: 'mean', label: 'Mean' },
    { value: 'min', label: 'Min' },
    { value: 'max', label: 'Max' },
    { value: 'sum', label: 'Total' },
  ], state().stats.aggregation, (v) => set({ stats: { aggregation: v } }), { label: 'Aggregation' });

  controls.percentile = slider({
    label: 'Percentile', min: 1, max: 99, value: 50, format: (v) => `p${v}`,
    onInput: (v) => set({ stats: { percentile: v } }),
  });
  controls.ddBase = slider({
    label: 'Degree-day base', min: 5, max: 30, step: 0.5, value: 18,
    format: (v) => `${convert(FIELD_BY_KEY.dryBulb, v, state().units).toFixed(1)} ${unitFor(FIELD_BY_KEY.dryBulb, state().units)}`,
    onInput: (v) => set({ stats: { degreeDayBase: v } }),
  });
  controls.bins = slider({
    label: 'Histogram bins', min: 6, max: 80, value: 30,
    onInput: (v) => set({ stats: { bins: v } }),
  });
  controls.comfortLow = slider({
    label: 'Comfort lower', min: 10, max: 28, step: 0.5, value: 20,
    format: (v) => `${convert(FIELD_BY_KEY.dryBulb, v, state().units).toFixed(1)}`,
    onInput: (v) => set({ stats: { comfortLow: v } }),
  });
  controls.comfortHigh = slider({
    label: 'Comfort upper', min: 18, max: 36, step: 0.5, value: 26,
    format: (v) => `${convert(FIELD_BY_KEY.dryBulb, v, state().units).toFixed(1)}`,
    onInput: (v) => set({ stats: { comfortHigh: v } }),
  });
  controls.strategies = toggle('Passive strategies', true, (v) => set({ stats: { showStrategies: v } }),
    { title: 'Show the Givoni polygons for ventilation, evaporative cooling and internal gains' });
  controls.sectors = segmented([
    { value: 8, label: '8' }, { value: 12, label: '12' }, { value: 16, label: '16' }, { value: 36, label: '36' },
  ], 16, (v) => set({ stats: { sectors: Number(v) } }), { label: 'Wind sectors' });
  controls.sunHours = toggle('Sunrise / sunset overlay', true, (v) => set({ showSunHours: v }));

  sections.stats = group('Statistics',
    controls.aggregation.node,
    controls.percentile.node,
    controls.ddBase.node,
    controls.bins.node,
    controls.comfortLow.node,
    controls.comfortHigh.node,
    controls.strategies.node,
    controls.sectors.node,
    controls.sunHours.node);

  // ── massing ───────────────────────────────────────────────────────────────
  const metres = (v) => `${v} m`;
  controls.mWidth = slider({ label: 'Width', min: 4, max: 80, value: 18, format: metres, onInput: (v) => set({ massing: { width: v } }) });
  controls.mDepth = slider({ label: 'Depth', min: 4, max: 80, value: 12, format: metres, onInput: (v) => set({ massing: { depth: v } }) });
  controls.mHeight = slider({ label: 'Height', min: 3, max: 120, value: 14, format: metres, onInput: (v) => set({ massing: { height: v } }) });
  controls.mRotation = slider({ label: 'Rotation', min: -90, max: 90, value: 0, format: (v) => `${v}°`, onInput: (v) => set({ massing: { rotation: v } }) });
  controls.mCourtyard = toggle('Perimeter block', false, (v) => set({ massing: { courtyard: v } }),
    { title: 'Open the block into a courtyard to study self-shading' });
  controls.mTrace = toggle('Hourly shadow trace', true, (v) => set({ massing: { showTrace: v } }));
  sections.massing = group('Massing',
    controls.mWidth.node, controls.mDepth.node, controls.mHeight.node, controls.mRotation.node,
    controls.mCourtyard.node, controls.mTrace.node);

  // ── sun path options ──────────────────────────────────────────────────────
  controls.projection = segmented([
    { value: 'stereo', label: 'Stereographic' },
    { value: 'ortho', label: 'Orthographic' },
  ], 'stereo', (v) => set({ sunpathProjection: v }), { label: 'Projection' });
  controls.tint = select([
    { value: '', label: 'None' },
    { value: 'globalHorizontal', label: 'Global horizontal radiation' },
    { value: 'directNormal', label: 'Direct normal radiation' },
    { value: 'dryBulb', label: 'Dry bulb temperature' },
    { value: 'totalSkyCover', label: 'Total sky cover' },
  ], '', (v) => set({ sunpathTint: v || null }), { label: 'Colour sun positions by' });
  sections.sunpath = group('Sun path', controls.projection.node, controls.tint.node);

  // ── presentation ──────────────────────────────────────────────────────────
  controls.theme = segmented([
    { value: 'dark', icon: ICONS.moon, title: 'Dark — for projection' },
    { value: 'light', icon: ICONS.sun, title: 'Light — for screens' },
    { value: 'print', icon: ICONS.printer, title: 'High contrast — for print and PDF' },
  ], state().theme, (v) => set({ theme: v }), { label: 'Theme' });
  controls.units = segmented([
    { value: 'si', label: 'SI' }, { value: 'ip', label: 'IP' },
  ], state().units, (v) => set({ units: v }), { label: 'Units' });
  controls.presentation = toggle('Presentation mode', false, (v) => actions.setPresentation(v),
    { title: 'Fullscreen, larger type, toolbar collapsed' });
  controls.compare = toggle('Compare', false, (v) => set({ compare: v }));
  controls.compareSource = segmented([
    { value: 'period', label: 'Two periods' },
    { value: 'file', label: 'Two files' },
  ], 'period', (v) => actions.setCompareSource(v), { label: 'Compare' });
  const compareLoad = button('Load second EPW', () => compareInput.click(), { icon: ICONS.upload });
  controls.compareFrom = dayPicker('From', { month: 6, day: 1 }, (v) => {
    set({ comparePeriod: { fromMonth: v.month, fromDay: v.day } });
  }, (m) => daysInMonth(m, state().data?.isLeap));
  controls.compareTo = dayPicker('To', { month: 8, day: 31 }, (v) => {
    set({ comparePeriod: { toMonth: v.month, toDay: v.day } });
  }, (m) => daysInMonth(m, state().data?.isLeap));
  const compareBody = el('div.compare-body', {},
    controls.compareSource.node, compareLoad.node,
    el('div.row', {}, controls.compareFrom.node, controls.compareTo.node));

  sections.presentation = group('Presentation',
    el('div.row', {}, controls.theme.node, controls.units.node),
    controls.presentation.node,
    controls.compare.node,
    compareBody);

  // ── export ────────────────────────────────────────────────────────────────
  controls.exportScale = segmented(
    [1, 2, 3, 4].map((v) => ({ value: v, label: `${v}\u00d7`, title: `Export at ${v} times screen resolution` })),
    state().exportScale,
    (v) => set({ exportScale: Number(v) }),
    { label: 'PNG resolution' },
  );
  const exportHint = el('div.hint');
  sections.export = group('Export',
    controls.exportScale.node,
    exportHint,
    el('div.row.row-tight', {},
      button('PNG', () => actions.exportPng(), { icon: ICONS.download }).node,
      button('CSV', () => actions.exportCsv(), { icon: ICONS.download }).node,
      button('Reset', () => actions.reset(), { icon: ICONS.reset }).node));

  node.append(
    sections.file, sections.mode, sections.views, sections.variable, sections.period,
    sections.cursor, sections.sunpath, sections.massing, sections.stats,
    sections.presentation, sections.export,
  );

  // ── updating ──────────────────────────────────────────────────────────────
  let lastFileKey = '';
  let lastMode = '';
  let lastView = '';

  function update() {
    const s = state();
    const data = s.data;
    const mode = MODES.find((m) => m.id === s.mode) || MODES[0];

    importBtn.setLabel(data ? 'Import a different EPW' : 'Import EPW');
    // Offer the example only when it exists and is not already what is loaded.
    sampleBtn.node.style.display = (actions.sampleAvailable && actions.sampleAvailable() && !data?.isSample)
      ? '' : 'none';
    modeBlurb.textContent = mode.blurb;
    controls.mode.set(s.mode);

    // Location readout.
    const fileKey = `${s.fileName}|${data?.location?.city || ''}|${s.units}`;
    if (fileKey !== lastFileKey) {
      lastFileKey = fileKey;
      clear(locationBox);
      if (data) {
        const l = data.location;
        locationBox.append(
          el('div.location-name', { text: datasetLabel(data) }),
          el('dl.meta', {},
            el('dt', { text: 'Coordinates' }), el('dd', { text: coordLabel(l) }),
            el('dt', { text: 'Elevation' }), el('dd', { text: `${Math.round(l.elevation)} m` }),
            el('dt', { text: 'Time zone' }), el('dd', { text: `UTC${l.timezone >= 0 ? '+' : ''}${l.timezone}` }),
            ...(l.wmo ? [el('dt', { text: 'WMO' }), el('dd', { text: l.wmo })] : []),
            ...(l.source ? [el('dt', { text: 'Source' }), el('dd', { text: l.source })] : []),
            el('dt', { text: 'Records' }), el('dd', { text: `${data.n.toLocaleString()} h` })),
          data.isSample
            ? el('div.badge', { text: 'Bundled example' })
            : el('div.filename', { text: s.fileName || '' }),
          ...(data.warnings.length
            ? [el('details.warnings', {}, el('summary', { text: `${data.warnings.length} note(s) about this file` }),
              el('ul', {}, ...data.warnings.map((w) => el('li', { text: w }))))]
            : []),
        );
      } else {
        locationBox.append(el('div.hint', { text: 'No file loaded yet.' }));
      }
    }

    // View shelf.
    if (lastMode !== s.mode || lastView !== s.view) {
      lastMode = s.mode;
      lastView = s.view;
      clear(viewShelf);
      // A view reached from outside the mode (a deep link, or the API) must still
      // appear on the shelf, otherwise nothing shows as selected.
      const shelf = viewsForMode(s.mode);
      if (!shelf.some((v) => v.id === s.view) && VIEW_BY_ID[s.view]) shelf.push(VIEW_BY_ID[s.view]);
      for (const v of shelf) {
        const active = v.id === s.view;
        viewShelf.appendChild(el('button.view-chip', {
          type: 'button',
          role: 'tab',
          'aria-selected': active ? 'true' : 'false',
          class: `epwviz-view-chip${active ? ' is-active' : ''}`,
          title: v.hint,
          onclick: () => set({ view: v.id }),
        }, el('span.view-chip-kind', { text: v.kind === '3d' ? '3D' : '2D' }),
        el('span', { text: v.label })));
      }
    }

    // Variable options: the mode's own variables first, then everything the file has.
    const available = data ? data.availableKeys : ALL_FIELDS.map((f) => f.key);
    const modeKeys = mode.variables.filter((k) => available.includes(k));
    const rest = available.filter((k) => !modeKeys.includes(k));
    controls.variable.setOptions([
      { group: `${mode.label} variables`, options: modeKeys.map((k) => ({ value: k, label: ALL_BY_KEY[k].label })) },
      { group: 'All variables in this file', options: rest.map((k) => ({ value: k, label: ALL_BY_KEY[k].label })) },
    ], s.variable);
    variableAbout.textContent = ALL_BY_KEY[s.variable]?.about || '';

    // Period.
    controls.preset.setOptions(
      presetPeriods(data).map((p) => ({ value: p.key, label: p.fromFile ? `${p.label} (from file)` : p.label })),
      s.presetKey || 'year',
    );
    controls.from.set({ month: s.period.fromMonth, day: s.period.fromDay });
    controls.to.set({ month: s.period.toMonth, day: s.period.toDay });
    controls.fromHour.set(s.period.fromHour);
    controls.toHour.set(s.period.toHour);
    periodSummary.textContent = describePeriod(s.period, data?.isLeap);

    // Cursor.
    controls.cursorDate.set({ month: s.cursor.month, day: s.cursor.day });
    controls.cursorHour.set(s.cursor.hour);
    controls.play.setActive(s.playing);
    controls.play.node.replaceChildren(icon(s.playing ? ICONS.pause : ICONS.play, 15));
    if (data) {
      const t = sunTimes(data.location, dayOfYear(s.cursor.month, s.cursor.day, data.isLeap));
      sunReadout.textContent = t.polar === 'day' ? 'Sun up all day'
        : t.polar === 'night' ? 'Sun never rises'
          : `Sunrise ${HOUR_FMT(Math.floor(t.sunrise))}${String(Math.round((t.sunrise % 1) * 60)).padStart(2, '0')}`
            .replace(':00', ':') + ` · sunset ${Math.floor(t.sunset)}:${String(Math.round((t.sunset % 1) * 60)).padStart(2, '0')}`
            + ` · ${t.dayLength.toFixed(1)} h of daylight`;
    } else {
      sunReadout.textContent = '';
    }

    // Statistics.
    controls.aggregation.set(s.stats.aggregation);
    controls.percentile.set(s.stats.percentile);
    controls.ddBase.set(s.stats.degreeDayBase);
    controls.bins.set(s.stats.bins);
    controls.comfortLow.set(s.stats.comfortLow);
    controls.comfortHigh.set(s.stats.comfortHigh);
    controls.strategies.set(s.stats.showStrategies);
    controls.sectors.set(s.stats.sectors || 16);
    controls.sunHours.set(s.showSunHours !== false);

    // Massing.
    controls.mWidth.set(s.massing.width);
    controls.mDepth.set(s.massing.depth);
    controls.mHeight.set(s.massing.height);
    controls.mRotation.set(s.massing.rotation);
    controls.mCourtyard.set(s.massing.courtyard);
    controls.mTrace.set(s.massing.showTrace !== false);

    // Sun path.
    controls.projection.set(s.sunpathProjection || 'stereo');
    controls.tint.set(s.sunpathTint || '');

    // Export.
    controls.exportScale.set(s.exportScale);
    const size = actions.exportSize && actions.exportSize();
    exportHint.textContent = size
      ? `PNG will be ${size.width.toLocaleString()} \u00d7 ${size.height.toLocaleString()} px`
      : '';

    // Presentation.
    controls.theme.set(s.theme);
    controls.units.set(s.units);
    controls.presentation.set(s.presentation);
    controls.compare.set(s.compare);
    controls.compareSource.set(s.compareSource);
    controls.compareFrom.set({ month: s.comparePeriod.fromMonth, day: s.comparePeriod.fromDay });
    controls.compareTo.set({ month: s.comparePeriod.toMonth, day: s.comparePeriod.toDay });
    compareBody.style.display = s.compare ? 'grid' : 'none';
    compareLoad.node.style.display = s.compare && s.compareSource === 'file' ? '' : 'none';
    compareLoad.setLabel(s.compareData ? `Replace: ${s.compareFileName}` : 'Load second EPW');

    // Relevance: controls outside the active mode are dimmed, not hidden, so a
    // student can still reach them and can see what the mode chose for them.
    const view = VIEW_BY_ID[s.view];
    sections.massing.style.display = s.view === 'massing' ? '' : 'none';
    sections.sunpath.style.display = (s.view === 'sunpath' || s.view === 'sundome') ? '' : 'none';
    controls.bins.node.style.display = s.view === 'histogram' ? '' : 'none';
    controls.percentile.node.style.display = (s.view === 'histogram' || s.view === 'monthly') ? '' : 'none';
    controls.sectors.node.style.display = (s.view === 'windrose' || s.view === 'windrose3d') ? '' : 'none';
    controls.sunHours.node.style.display = s.view === 'heatmap' ? '' : 'none';
    controls.strategies.node.style.display = s.view === 'psychrometric' ? '' : 'none';
    controls.aggregation.node.style.display = s.view === 'monthly' ? '' : 'none';
    const comfortRelevant = s.mode === 'comfort' || s.view === 'psychrometric' || s.view === 'timeseries';
    controls.comfortLow.node.style.display = comfortRelevant ? '' : 'none';
    controls.comfortHigh.node.style.display = comfortRelevant ? '' : 'none';
    sections.variable.style.display = (s.view === 'sundome' || s.view === 'massing' || s.view === 'windrose' || s.view === 'windrose3d') ? 'none' : '';
    sections.cursor.classList.toggle('is-dimmed', !controlInMode(s.mode, 'cursor') && !['sunpath', 'sundome', 'massing', 'surface'].includes(s.view));
    if (view) node.dataset.view = view.id;
  }

  return { node, update, controls, sections };
}

export { createToolbar };
