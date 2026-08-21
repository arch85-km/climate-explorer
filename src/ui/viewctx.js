/**
 * Builds the context object every view draws from.
 *
 * Centralising this is what keeps the 2D charts, the 3D scenes and the summary
 * panel showing the same numbers: they all derive their scale, mask and colour
 * ramp here rather than each computing its own.
 */
import { ALL_BY_KEY } from '../epw/fields.js';
import { buildMask, describePeriod, normalisePeriod } from '../core/filter.js';
import { rampFor, makeScale, midpointFor } from '../render/colormaps.js';
import { summarise } from '../core/stats.js';
import { locationLabel } from '../epw/parse.js';

/**
 * @param {object} state app state
 * @param {object} opts  { compare: boolean, root: HTMLElement, theme: object }
 */
function buildViewContext(state, opts = {}) {
  const data = opts.compare && state.compareSource === 'file' && state.compareData
    ? state.compareData
    : state.data;
  if (!data) return null;

  const period = opts.compare && state.compareSource === 'period'
    ? state.comparePeriod
    : state.period;

  const key = state.variable;
  const field = ALL_BY_KEY[key] || ALL_BY_KEY.dryBulb;
  const values = data.series[field.key] || data.series.dryBulb;
  const mask = buildMask(data, period);
  const p = normalisePeriod(period, data.isLeap);
  const maskKey = `${p.fromMonth}-${p.fromDay}-${p.toMonth}-${p.toDay}-${p.fromHour}-${p.toHour}`;

  const ramp = rampFor(field, state.theme);

  // Scales use the WHOLE year, not just the selection, so that changing the
  // period never silently re-colours the data and invalidates a comparison.
  const full = summarise(values, null);
  const min = Number.isFinite(field.min) && field.min > full.min ? field.min : full.min;
  const max = Number.isFinite(field.max) && field.max < full.max ? field.max : full.max;
  const mid = midpointFor(field);
  const scale = makeScale(ramp, min, max, mid);

  return {
    data,
    field,
    values,
    // Mode-derived overlays: degree days belong to a thermal reading of the year,
    // the comfort band to a comfort one.
    showDegreeDays: state.mode === 'thermal',
    showComfortBand: state.mode === 'comfort' || state.mode === 'thermal',
    mask,
    maskKey,
    ramp,
    scale,
    scale01: scale,
    min,
    max,
    stats: summarise(values, mask),
    state,
    theme: state.theme,
    root: opts.root,
    uint32: opts.uint32 !== false,
    subtitle: `${locationLabel(data.location)} · ${describePeriod(period, data.isLeap)}`,
    period,
  };
}

export { buildViewContext };
