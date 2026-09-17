/**
 * The readout strip: the handful of numbers a student should be able to quote
 * about a climate after looking at it for thirty seconds.
 *
 * These are hero numbers, not a chart — they get large type and no decoration.
 *
 * @version 1.0.0 — 2026-09-17
 */
import { el, clear } from './dom.js';
import { summarise, degreeDays, windRose, countHours, percentiles } from '../core/stats.js';
import { maskCount } from '../core/filter.js';
import { formatValue, FIELD_BY_KEY, ALL_BY_KEY, convert, unitFor } from '../epw/fields.js';
import { comfortPolygons, pointInPolygon, STANDARD_PRESSURE } from '../core/psychro.js';

function tile(label, value, note) {
  return el('div.tile', {},
    el('div.tile-label', { text: label }),
    el('div.tile-value', { text: value }),
    note ? el('div.tile-note', { text: note }) : null);
}

/** Share of selected hours that fall inside either ASHRAE 55 comfort zone. */
function comfortShare(data, mask, stats) {
  const p = data.pressureFallback || STANDARD_PRESSURE;
  const polys = comfortPolygons(p, { humidityLimit: stats.humidityLimit, strategies: false });
  const t = data.series.dryBulb;
  const w = data.series.humidityRatio;
  let hits = 0;
  let total = 0;
  for (let i = 0; i < data.n; i += 1) {
    if (mask && !mask[i]) continue;
    if (!Number.isFinite(t[i]) || !Number.isFinite(w[i])) continue;
    total += 1;
    const wi = w[i] / 1000;
    if (polys.some((poly) => pointInPolygon(t[i], wi, poly.points))) hits += 1;
  }
  return total ? hits / total : NaN;
}

function render(node, context) {
  clear(node);
  if (!context) return;
  const { data, field, values, mask, state } = context;
  const u = state.units;
  const s = summarise(values, mask);
  const hours = maskCount(mask);
  if (!s.count) {
    node.appendChild(el('div.tile-empty', { text: 'No data in the selected period.' }));
    return;
  }

  const pcts = percentiles(values, mask, [state.stats.percentile]);
  const tiles = [
    tile(`Mean ${field.short.toLowerCase()}`, formatValue(field, s.mean, u)),
    // Unit lives in the label so the two numbers never wrap apart from it.
    tile(`Range (${unitFor(field, u)})`,
      `${formatValue(field, s.min, u, { bare: true })} – ${formatValue(field, s.max, u, { bare: true })}`,
      `spread ${formatValue(field, s.range, u, { delta: true })}`),
    tile(`p${state.stats.percentile}`, formatValue(field, pcts[state.stats.percentile], u)),
  ];

  // Degree days: the number that turns a temperature record into a design brief.
  if (data.series.dryBulb) {
    const base = state.stats.degreeDayBase;
    const dd = degreeDays(data, data.series.dryBulb, base, mask);
    const tf = FIELD_BY_KEY.dryBulb;
    const baseLabel = `base ${convert(tf, base, u).toFixed(0)}${unitFor(tf, u)}`;
    tiles.push(tile('Heating degree days', Math.round(dd.hdd).toLocaleString(), baseLabel));
    tiles.push(tile('Cooling degree days', Math.round(dd.cdd).toLocaleString(), baseLabel));
  }

  if (data.series.globalHorizontal) {
    const ghi = summarise(data.series.globalHorizontal, mask);
    tiles.push(tile('Global horizontal', `${Math.round(ghi.sum / 1000).toLocaleString()} kWh/m²`,
      'total over the period'));
  }

  if (data.series.windSpeed) {
    const rose = windRose(data, mask);
    const wf = FIELD_BY_KEY.windSpeed;
    const ws = summarise(data.series.windSpeed, mask);
    tiles.push(tile('Prevailing wind', rose.prevailingLabel,
      `mean ${formatValue(wf, ws.mean, u)} · calm ${(rose.calmFraction * 100).toFixed(0)}%`));
  }

  if (data.series.humidityRatio) {
    const share = comfortShare(data, mask, state.stats);
    if (Number.isFinite(share)) {
      tiles.push(tile('Comfortable hours', `${(share * 100).toFixed(1)}%`,
        `${Math.round(share * hours).toLocaleString()} of ${hours.toLocaleString()} h`));
    }
  }

  if (field.key === 'dryBulb') {
    const lowField = ALL_BY_KEY.dryBulb;
    const below = countHours(values, mask, (v) => v < state.stats.comfortLow);
    const above = countHours(values, mask, (v) => v > state.stats.comfortHigh);
    tiles.push(tile('Outside comfort band',
      `${((below.fraction + above.fraction) * 100).toFixed(0)}%`,
      `${(below.fraction * 100).toFixed(0)}% below ${formatValue(lowField, state.stats.comfortLow, u)}, `
      + `${(above.fraction * 100).toFixed(0)}% above ${formatValue(lowField, state.stats.comfortHigh, u)}`));
  }

  for (const t of tiles) node.appendChild(t);
}

export { render, comfortShare };
