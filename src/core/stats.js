/**
 * Statistical reductions over hourly weather series.
 *
 * Every function takes an optional `mask` (Uint8Array, 1 = include) so that all views
 * respond to the toolbar's analysis period without each one re-implementing filtering.
 *
 * @version 1.0.0 — 2026-09-17
 */

/** Basic descriptive statistics, ignoring NaN and masked-out hours. */
function summarise(values, mask) {
  let count = 0;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  const n = values.length;
  for (let i = 0; i < n; i += 1) {
    if (mask && !mask[i]) continue;
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    count += 1;
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!count) return { count: 0, mean: NaN, min: NaN, max: NaN, sum: NaN, std: NaN, range: NaN };
  const mean = sum / count;
  let sq = 0;
  for (let i = 0; i < n; i += 1) {
    if (mask && !mask[i]) continue;
    const v = values[i];
    if (Number.isFinite(v)) sq += (v - mean) ** 2;
  }
  return {
    count, mean, min, max, sum, range: max - min,
    std: count > 1 ? Math.sqrt(sq / (count - 1)) : 0,
  };
}

/** Collect the finite, unmasked values into a sorted Float64Array (for percentiles). */
function sortedValues(values, mask) {
  const out = [];
  for (let i = 0; i < values.length; i += 1) {
    if (mask && !mask[i]) continue;
    if (Number.isFinite(values[i])) out.push(values[i]);
  }
  const arr = Float64Array.from(out);
  arr.sort();
  return arr;
}

/** Linear-interpolated percentile of an already-sorted array. p in 0..100. */
function percentileOf(sorted, p) {
  const n = sorted.length;
  if (!n) return NaN;
  if (n === 1) return sorted[0];
  const idx = (p / 100) * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Several percentiles in one pass over the sorted data. */
function percentiles(values, mask, ps = [1, 5, 25, 50, 75, 95, 99]) {
  const sorted = sortedValues(values, mask);
  const out = {};
  for (const p of ps) out[p] = percentileOf(sorted, p);
  out.n = sorted.length;
  return out;
}

/** Mean of a circular quantity (degrees), e.g. wind direction. */
function circularMean(values, mask, weights) {
  let sx = 0;
  let sy = 0;
  let total = 0;
  for (let i = 0; i < values.length; i += 1) {
    if (mask && !mask[i]) continue;
    const a = values[i];
    if (!Number.isFinite(a)) continue;
    const w = weights ? weights[i] : 1;
    if (!Number.isFinite(w)) continue;
    const r = a * Math.PI / 180;
    sx += Math.cos(r) * w;
    sy += Math.sin(r) * w;
    total += w;
  }
  if (!total) return { direction: NaN, strength: 0 };
  const dir = (Math.atan2(sy / total, sx / total) * 180 / Math.PI + 360) % 360;
  return { direction: dir, strength: Math.hypot(sx, sy) / total };
}

/** Reduce a series to one value per calendar month. */
function monthlyAggregate(data, values, mask, agg = 'mean') {
  const sums = new Float64Array(12);
  const counts = new Int32Array(12);
  const mins = new Float64Array(12).fill(Infinity);
  const maxs = new Float64Array(12).fill(-Infinity);
  for (let i = 0; i < data.n; i += 1) {
    if (mask && !mask[i]) continue;
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    const m = data.month[i] - 1;
    if (m < 0 || m > 11) continue;
    sums[m] += v;
    counts[m] += 1;
    if (v < mins[m]) mins[m] = v;
    if (v > maxs[m]) maxs[m] = v;
  }
  const out = new Float64Array(12);
  for (let m = 0; m < 12; m += 1) {
    if (!counts[m]) { out[m] = NaN; continue; }
    if (agg === 'sum') out[m] = sums[m];
    else if (agg === 'min') out[m] = mins[m];
    else if (agg === 'max') out[m] = maxs[m];
    else out[m] = sums[m] / counts[m];
  }
  return { values: out, counts, mins, maxs, sums };
}

/** Full monthly statistics including percentile whiskers, for the monthly bar view. */
function monthlyStats(data, values, mask, ps = [5, 25, 50, 75, 95]) {
  const buckets = Array.from({ length: 12 }, () => []);
  for (let i = 0; i < data.n; i += 1) {
    if (mask && !mask[i]) continue;
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    buckets[data.month[i] - 1].push(v);
  }
  return buckets.map((b) => {
    if (!b.length) return { count: 0, mean: NaN, min: NaN, max: NaN, p: {} };
    const arr = Float64Array.from(b);
    arr.sort();
    let sum = 0;
    for (const v of arr) sum += v;
    const p = {};
    for (const q of ps) p[q] = percentileOf(arr, q);
    return { count: arr.length, mean: sum / arr.length, min: arr[0], max: arr[arr.length - 1], p };
  });
}

/** Average value for each hour of the day, per month: a 12 x 24 grid. */
function diurnalByMonth(data, values, mask) {
  const sums = new Float64Array(12 * 24);
  const counts = new Int32Array(12 * 24);
  for (let i = 0; i < data.n; i += 1) {
    if (mask && !mask[i]) continue;
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    const k = (data.month[i] - 1) * 24 + data.hour[i];
    sums[k] += v;
    counts[k] += 1;
  }
  const out = new Float64Array(12 * 24);
  for (let k = 0; k < out.length; k += 1) out[k] = counts[k] ? sums[k] / counts[k] : NaN;
  return out;
}

/** Average value for each hour of the day across the whole selection. */
function diurnalProfile(data, values, mask) {
  const sums = new Float64Array(24);
  const counts = new Int32Array(24);
  const mins = new Float64Array(24).fill(Infinity);
  const maxs = new Float64Array(24).fill(-Infinity);
  for (let i = 0; i < data.n; i += 1) {
    if (mask && !mask[i]) continue;
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    const h = data.hour[i];
    sums[h] += v; counts[h] += 1;
    if (v < mins[h]) mins[h] = v;
    if (v > maxs[h]) maxs[h] = v;
  }
  const mean = new Float64Array(24);
  for (let h = 0; h < 24; h += 1) {
    mean[h] = counts[h] ? sums[h] / counts[h] : NaN;
    if (!counts[h]) { mins[h] = NaN; maxs[h] = NaN; }
  }
  return { mean, min: mins, max: maxs, counts };
}

/** One value per calendar day of the file. */
function dailyAggregate(data, values, agg = 'mean', mask) {
  const sums = new Float64Array(data.nDays);
  const counts = new Int32Array(data.nDays);
  const mins = new Float64Array(data.nDays).fill(Infinity);
  const maxs = new Float64Array(data.nDays).fill(-Infinity);
  for (let i = 0; i < data.n; i += 1) {
    if (mask && !mask[i]) continue;
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    const d = data.dayIndexOf[i];
    sums[d] += v; counts[d] += 1;
    if (v < mins[d]) mins[d] = v;
    if (v > maxs[d]) maxs[d] = v;
  }
  const out = new Float64Array(data.nDays);
  for (let d = 0; d < data.nDays; d += 1) {
    if (!counts[d]) { out[d] = NaN; mins[d] = NaN; maxs[d] = NaN; continue; }
    if (agg === 'sum') out[d] = sums[d];
    else if (agg === 'min') out[d] = mins[d];
    else if (agg === 'max') out[d] = maxs[d];
    else out[d] = sums[d] / counts[d];
  }
  return { values: out, min: mins, max: maxs, counts };
}

/** Frequency distribution. Returns bin edges, counts and the cumulative fraction. */
function histogram(values, mask, binCount = 30, forceMin, forceMax) {
  const s = summarise(values, mask);
  if (!s.count) return { bins: [], counts: [], cumulative: [], total: 0, min: NaN, max: NaN };
  const min = Number.isFinite(forceMin) ? forceMin : s.min;
  const max = Number.isFinite(forceMax) ? forceMax : s.max;
  const span = max - min || 1;
  const counts = new Int32Array(binCount);
  let total = 0;
  for (let i = 0; i < values.length; i += 1) {
    if (mask && !mask[i]) continue;
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    let b = Math.floor(((v - min) / span) * binCount);
    if (b < 0) b = 0;
    if (b >= binCount) b = binCount - 1;
    counts[b] += 1;
    total += 1;
  }
  const bins = [];
  const cumulative = [];
  let running = 0;
  for (let b = 0; b < binCount; b += 1) {
    bins.push({ lo: min + (span * b) / binCount, hi: min + (span * (b + 1)) / binCount });
    running += counts[b];
    cumulative.push(total ? running / total : 0);
  }
  return { bins, counts, cumulative, total, min, max };
}

/**
 * Heating and cooling degree days about a base temperature.
 * Computed hourly then divided by 24, which handles partial days and gaps correctly.
 */
function degreeDays(data, dryBulb, base = 18, mask) {
  let heating = 0;
  let cooling = 0;
  let hours = 0;
  for (let i = 0; i < data.n; i += 1) {
    if (mask && !mask[i]) continue;
    const t = dryBulb[i];
    if (!Number.isFinite(t)) continue;
    hours += 1;
    if (t < base) heating += base - t;
    else cooling += t - base;
  }
  return { hdd: heating / 24, cdd: cooling / 24, hours, base };
}

/** Monthly heating/cooling degree days, for the thermal analysis mode. */
function monthlyDegreeDays(data, dryBulb, base = 18, mask) {
  const hdd = new Float64Array(12);
  const cdd = new Float64Array(12);
  for (let i = 0; i < data.n; i += 1) {
    if (mask && !mask[i]) continue;
    const t = dryBulb[i];
    if (!Number.isFinite(t)) continue;
    const m = data.month[i] - 1;
    if (t < base) hdd[m] += (base - t) / 24;
    else cdd[m] += (t - base) / 24;
  }
  return { hdd, cdd };
}

/** Count of hours where a predicate holds, plus the fraction of the selection. */
function countHours(values, mask, predicate) {
  let hits = 0;
  let total = 0;
  for (let i = 0; i < values.length; i += 1) {
    if (mask && !mask[i]) continue;
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    total += 1;
    if (predicate(v, i)) hits += 1;
  }
  return { hits, total, fraction: total ? hits / total : 0 };
}

const CARDINALS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/**
 * Wind-rose binning: frequency of each (direction sector, speed band) pair.
 *
 * Calm hours (speed below `calmThreshold`) are counted separately rather than
 * assigned to a direction, because EPW records calm hours with direction 0,
 * which would otherwise pile a spurious spike onto due north.
 */
function windRose(data, mask, opts = {}) {
  const sectors = opts.sectors || 16;
  const speedBands = opts.speedBands || [0.5, 2, 4, 6, 8, 10];
  const calmThreshold = opts.calmThreshold != null ? opts.calmThreshold : 0.5;
  const dir = data.series.windDirection;
  const spd = data.series.windSpeed;
  const values = opts.values || spd;

  const bandCount = speedBands.length;
  const counts = new Float64Array(sectors * bandCount);
  const sectorTotals = new Float64Array(sectors);
  const sectorValueSum = new Float64Array(sectors);
  let calm = 0;
  let total = 0;
  let maxSpeed = 0;

  const sectorSize = 360 / sectors;
  for (let i = 0; i < data.n; i += 1) {
    if (mask && !mask[i]) continue;
    const s = spd[i];
    const d = dir[i];
    if (!Number.isFinite(s)) continue;
    total += 1;
    if (s < calmThreshold) { calm += 1; continue; }
    if (!Number.isFinite(d)) continue;
    if (s > maxSpeed) maxSpeed = s;
    // Sector 0 is centred on north, so shift by half a sector before binning.
    const sector = Math.floor((((d + sectorSize / 2) % 360) + 360) % 360 / sectorSize) % sectors;
    let band = 0;
    while (band < bandCount - 1 && s >= speedBands[band + 1]) band += 1;
    counts[sector * bandCount + band] += 1;
    sectorTotals[sector] += 1;
    if (Number.isFinite(values[i])) sectorValueSum[sector] += values[i];
  }

  let maxSector = 0;
  for (let s = 0; s < sectors; s += 1) if (sectorTotals[s] > maxSector) maxSector = sectorTotals[s];

  const prevailing = sectorTotals.indexOf(maxSector);
  return {
    sectors, bandCount, speedBands, counts, sectorTotals, total, calm, maxSector, maxSpeed,
    calmFraction: total ? calm / total : 0,
    sectorMeans: Float64Array.from(sectorValueSum, (v, i) => (sectorTotals[i] ? v / sectorTotals[i] : NaN)),
    prevailing,
    prevailingLabel: sectors === 16 ? CARDINALS[prevailing] : `${(prevailing * sectorSize).toFixed(0)}°`,
    labels: sectors === 16 ? CARDINALS
      : Array.from({ length: sectors }, (_, i) => `${Math.round(i * sectorSize)}°`),
  };
}

/** Compass label for a bearing, e.g. 200 -> "SSW". */
function cardinal(deg) {
  if (!Number.isFinite(deg)) return '—';
  return CARDINALS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

export { summarise, sortedValues, percentileOf, percentiles, circularMean };
export { monthlyAggregate, monthlyStats, diurnalByMonth, diurnalProfile, dailyAggregate };
export { histogram, degreeDays, monthlyDegreeDays, countHours, windRose, cardinal, CARDINALS };
