/**
 * The single source of truth for the app.
 *
 * Views never hold state of their own: they read from here and re-render when
 * notified, so the toolbar, the 2D charts and the 3D scenes can never disagree
 * about which hour is selected.
 */
import { FULL_YEAR } from './filter.js';

const DEFAULTS = {
  data: null,
  fileName: '',
  compareData: null,
  compareFileName: '',

  view: 'heatmap',
  mode: 'thermal',
  variable: 'dryBulb',

  period: { ...FULL_YEAR },
  comparePeriod: { fromMonth: 6, fromDay: 1, toMonth: 8, toDay: 31, fromHour: 0, toHour: 23 },

  // The single instant used by the sun path marker and the massing shadow.
  cursor: { month: 6, day: 21, hour: 12 },

  units: 'si',
  theme: 'light',
  presentation: false,
  compare: false,
  compareSource: 'period', // 'period' | 'file'

  // Statistical options exposed in the toolbar.
  stats: {
    aggregation: 'mean',   // mean | min | max | sum
    percentile: 50,
    degreeDayBase: 18,
    bins: 30,
    comfortLow: 20,
    comfortHigh: 26,
    humidityLimit: 0.012,
    showStrategies: true,
    adaptive: false,
  },

  // Massing study parameters.
  massing: {
    width: 18, depth: 12, height: 14, rotation: 0,
    courtyard: false, showTrace: true, showAnalemma: true,
  },

  loadingSample: false,
  playing: false,
  playSpeed: 1,
  status: null,
  error: null,
};

function clone(value) {
  if (Array.isArray(value)) return value.slice();
  if (value && typeof value === 'object' && !ArrayBuffer.isView(value)) return { ...value };
  return value;
}

function createStore(initial = {}) {
  const state = { ...DEFAULTS, ...initial };
  for (const key of ['period', 'comparePeriod', 'cursor', 'stats', 'massing']) {
    state[key] = { ...DEFAULTS[key], ...(initial[key] || {}) };
  }
  const listeners = new Set();
  let queued = null;

  function notify(changed) {
    for (const fn of listeners) fn(state, changed);
  }

  return {
    get state() { return state; },

    /** Shallow-merge a patch. Nested option objects are merged one level deep. */
    set(patch, opts = {}) {
      const changed = new Set();
      for (const [key, value] of Object.entries(patch)) {
        if (key in DEFAULTS && DEFAULTS[key] && typeof DEFAULTS[key] === 'object'
          && !Array.isArray(DEFAULTS[key]) && value && typeof value === 'object') {
          const merged = { ...state[key], ...value };
          if (Object.keys(merged).some((k) => merged[k] !== state[key][k])) {
            state[key] = merged;
            changed.add(key);
          }
        } else if (state[key] !== value) {
          state[key] = clone(value);
          changed.add(key);
        }
      }
      if (!changed.size && !opts.force) return changed;

      if (opts.immediate) {
        if (queued) { cancelAnimationFrame(queued.raf); queued = null; }
        notify(changed);
      } else {
        // Coalesce bursts (slider drags) into one render per frame.
        if (queued) {
          for (const c of changed) queued.changed.add(c);
        } else {
          const pending = { changed: new Set(changed), raf: 0 };
          pending.raf = requestAnimationFrame(() => {
            queued = null;
            notify(pending.changed);
          });
          queued = pending;
        }
      }
      return changed;
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export { createStore, DEFAULTS };
