import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEpw } from '../src/epw/parse.js';
import { buildDataset } from '../src/core/dataset.js';
import {
  summarise, percentiles, percentileOf, circularMean, monthlyAggregate, monthlyStats,
  diurnalProfile, dailyAggregate, histogram, degreeDays, monthlyDegreeDays, windRose, cardinal,
} from '../src/core/stats.js';
import { buildMask, maskCount, normalisePeriod, describePeriod, FULL_YEAR, presetPeriods } from '../src/core/filter.js';
import {
  satPressure, humidityRatio, enthalpy, wetBulb, dewPointFromW, relHumidityFromW,
  adaptiveComfort, runningMean, pressureAtElevation, STANDARD_PRESSURE,
} from '../src/core/psychro.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = buildDataset(parseEpw(readFileSync(join(ROOT, 'test/fixtures/chicago_ohare_tmy3.epw'), 'utf8')));
const full = buildMask(data, FULL_YEAR);

test('summarise matches hand-computed values on a known array', () => {
  const a = Float32Array.from([1, 2, 3, 4, NaN, 5]);
  const s = summarise(a, null);
  assert.equal(s.count, 5);
  assert.equal(s.mean, 3);
  assert.equal(s.min, 1);
  assert.equal(s.max, 5);
  assert.equal(s.sum, 15);
  assert.equal(s.range, 4);
  assert.ok(Math.abs(s.std - Math.sqrt(2.5)) < 1e-6);
  assert.equal(summarise(Float32Array.from([NaN, NaN]), null).count, 0);
});

test('percentiles interpolate the way a spreadsheet does', () => {
  const sorted = Float64Array.from([1, 2, 3, 4, 5]);
  assert.equal(percentileOf(sorted, 0), 1);
  assert.equal(percentileOf(sorted, 50), 3);
  assert.equal(percentileOf(sorted, 100), 5);
  assert.equal(percentileOf(sorted, 25), 2);
  assert.ok(Math.abs(percentileOf(Float64Array.from([1, 2, 3, 4]), 50) - 2.5) < 1e-9);
  const p = percentiles(data.series.dryBulb, full);
  assert.ok(p[1] < p[25] && p[25] < p[50] && p[50] < p[75] && p[75] < p[99]);
  assert.equal(p.n, 8760);
});

test('Chicago TMY3 reproduces its published annual statistics', () => {
  const s = summarise(data.series.dryBulb, full);
  assert.ok(Math.abs(s.mean - 9.99) < 0.05, `annual mean dry bulb ${s.mean}`);
  assert.ok(s.min < -20 && s.max > 33);
  const ghi = summarise(data.series.globalHorizontal, full);
  assert.ok(Math.abs(ghi.sum / 1000 - 1407) < 15, `annual GHI ${ghi.sum / 1000} kWh/m2`);
});

test('degree days about base 18 match the expected magnitude for Chicago', () => {
  const dd = degreeDays(data, data.series.dryBulb, 18, full);
  assert.ok(Math.abs(dd.hdd - 3524) < 40, `HDD18 ${dd.hdd}`);
  assert.ok(Math.abs(dd.cdd - 599) < 30, `CDD18 ${dd.cdd}`);
  assert.equal(dd.hours, 8760);
  // Monthly degree days must sum to the annual figure.
  const m = monthlyDegreeDays(data, data.series.dryBulb, 18, full);
  const sumH = m.hdd.reduce((a, b) => a + b, 0);
  const sumC = m.cdd.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sumH - dd.hdd) < 0.5);
  assert.ok(Math.abs(sumC - dd.cdd) < 0.5);
  // A higher base can only increase heating and decrease cooling degree days.
  const hot = degreeDays(data, data.series.dryBulb, 24, full);
  assert.ok(hot.hdd > dd.hdd && hot.cdd < dd.cdd);
});

test('circular mean handles the 0/360 wrap that a plain average gets wrong', () => {
  const wrap = Float32Array.from([350, 10]);
  const m = circularMean(wrap, null);
  assert.ok(Math.abs(((m.direction + 180) % 360) - 180) < 1e-6, `got ${m.direction}`);
  const north = circularMean(Float32Array.from([0, 0, 0]), null);
  assert.equal(Math.round(north.direction), 0);
  assert.ok(north.strength > 0.999);
  // Opposed directions cancel: no meaningful prevailing direction.
  assert.ok(circularMean(Float32Array.from([0, 180]), null).strength < 1e-6);
  assert.equal(cardinal(0), 'N');
  assert.equal(cardinal(90), 'E');
  assert.equal(cardinal(202.5), 'SSW');
  assert.equal(cardinal(359), 'N');
});

test('analysis-period masks select exactly the expected number of hours', () => {
  assert.equal(maskCount(full), 8760);
  const jja = buildMask(data, { fromMonth: 6, fromDay: 1, toMonth: 8, toDay: 31, fromHour: 0, toHour: 23 });
  assert.equal(maskCount(jja), (30 + 31 + 31) * 24);
  // A date range that wraps the year end.
  const djf = buildMask(data, { fromMonth: 12, fromDay: 1, toMonth: 2, toDay: 28, fromHour: 0, toHour: 23 });
  assert.equal(maskCount(djf), (31 + 31 + 28) * 24);
  // An hour range that wraps midnight.
  const night = buildMask(data, { ...FULL_YEAR, fromHour: 22, toHour: 6 });
  assert.equal(maskCount(night), 365 * 9);
  const office = buildMask(data, { ...FULL_YEAR, fromHour: 8, toHour: 18 });
  assert.equal(maskCount(office), 365 * 11);
  // Both wrapping at once.
  const winterNights = buildMask(data, { fromMonth: 12, fromDay: 1, toMonth: 2, toDay: 28, fromHour: 22, toHour: 6 });
  assert.equal(maskCount(winterNights), 90 * 9);
});

test('period days are clamped to the length of their month', () => {
  const p = normalisePeriod({ fromMonth: 2, fromDay: 31, toMonth: 4, toDay: 31 }, false);
  assert.equal(p.fromDay, 28);
  assert.equal(p.toDay, 30);
  assert.equal(normalisePeriod({ fromMonth: 2, fromDay: 30 }, true).fromDay, 29);
  assert.match(describePeriod(FULL_YEAR), /Whole year/);
  assert.match(describePeriod({ ...FULL_YEAR, fromHour: 9, toHour: 17 }), /09:00–17:59/);
});

test('presets include the typical and extreme weeks named in the file header', () => {
  const presets = presetPeriods(data);
  assert.ok(presets.some((p) => p.key === 'year'));
  const fromFile = presets.filter((p) => p.fromFile);
  assert.equal(fromFile.length, 6);
  for (const p of fromFile) {
    assert.ok(p.period.fromMonth >= 1 && p.period.fromMonth <= 12);
    assert.ok(maskCount(buildMask(data, p.period)) > 0);
  }
});

test('monthly and daily aggregates are consistent with the hourly data', () => {
  const monthly = monthlyAggregate(data, data.series.dryBulb, full, 'mean');
  let weighted = 0;
  let hours = 0;
  for (let m = 0; m < 12; m += 1) { weighted += monthly.values[m] * monthly.counts[m]; hours += monthly.counts[m]; }
  assert.equal(hours, 8760);
  assert.ok(Math.abs(weighted / hours - summarise(data.series.dryBulb, full).mean) < 1e-3);

  const daily = dailyAggregate(data, data.series.dryBulb, 'mean');
  assert.equal(daily.values.length, 365);
  for (let d = 0; d < 365; d += 1) {
    assert.equal(daily.counts[d], 24);
    assert.ok(daily.min[d] <= daily.values[d] && daily.values[d] <= daily.max[d]);
  }
  // Monthly sums of radiation must equal the annual total.
  const rad = monthlyAggregate(data, data.series.globalHorizontal, full, 'sum');
  const total = Array.from(rad.values).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - summarise(data.series.globalHorizontal, full).sum) < 1);
});

test('monthly percentiles are ordered and bracket the mean', () => {
  for (const st of monthlyStats(data, data.series.dryBulb, full)) {
    assert.ok(st.count > 0);
    assert.ok(st.min <= st.p[5] && st.p[5] <= st.p[25] && st.p[25] <= st.p[50]);
    assert.ok(st.p[50] <= st.p[75] && st.p[75] <= st.p[95] && st.p[95] <= st.max);
    assert.ok(st.mean >= st.min && st.mean <= st.max);
  }
});

test('the diurnal profile has one entry per hour and is warmest in the afternoon', () => {
  const p = diurnalProfile(data, data.series.dryBulb, full);
  assert.equal(p.mean.length, 24);
  for (let h = 0; h < 24; h += 1) assert.equal(p.counts[h], 365);
  let warmest = 0;
  for (let h = 1; h < 24; h += 1) if (p.mean[h] > p.mean[warmest]) warmest = h;
  assert.ok(warmest >= 13 && warmest <= 17, `warmest hour is ${warmest}`);
});

test('histogram counts every selected hour exactly once and its CDF ends at 1', () => {
  const h = histogram(data.series.dryBulb, full, 24);
  assert.equal(h.counts.reduce((a, b) => a + b, 0), h.total);
  assert.equal(h.total, 8760);
  assert.equal(h.bins.length, 24);
  assert.ok(Math.abs(h.cumulative[h.cumulative.length - 1] - 1) < 1e-9);
  for (let i = 1; i < h.cumulative.length; i += 1) {
    assert.ok(h.cumulative[i] >= h.cumulative[i - 1], 'cumulative frequency is monotonic');
  }
});

test('wind rose bins every non-calm hour and finds the prevailing direction', () => {
  const rose = windRose(data, full);
  assert.equal(rose.total, 8760);
  const binned = Array.from(rose.counts).reduce((a, b) => a + b, 0);
  assert.equal(binned + rose.calm, rose.total, 'every hour is either binned or calm');
  assert.equal(rose.sectors, 16);
  assert.equal(rose.prevailingLabel, 'S', 'Chicago prevails from the south');
  // Calm hours must not pile onto due north.
  assert.ok(rose.calm > 0);
  assert.ok(rose.sectorTotals[0] < rose.maxSector);
  const coarse = windRose(data, full, { sectors: 8 });
  assert.equal(coarse.sectors, 8);
  assert.equal(Array.from(coarse.counts).reduce((a, b) => a + b, 0) + coarse.calm, coarse.total);
});

test('saturation pressure matches ASHRAE Fundamentals Table 1', () => {
  const refs = [[-10, 259.9], [0, 611.2], [10, 1228.1], [20, 2339.3], [25, 3169.7], [30, 4246.0], [40, 7384.9]];
  for (const [t, ref] of refs) {
    const err = Math.abs(satPressure(t) - ref) / ref;
    assert.ok(err < 0.0005, `t=${t}: ${satPressure(t)} vs ${ref} (${(err * 100).toFixed(3)}%)`);
  }
});

test('psychrometric state at 25 C / 50% RH matches the published values', () => {
  const p = STANDARD_PRESSURE;
  const w = humidityRatio(25, 50, p);
  assert.ok(Math.abs(w - 0.00994) < 0.0002, `humidity ratio ${w}`);
  assert.ok(Math.abs(enthalpy(25, w) - 50.4) < 0.3);
  assert.ok(Math.abs(wetBulb(25, w, p) - 17.87) < 0.1);
  assert.ok(Math.abs(dewPointFromW(w, p) - 13.85) < 0.1);
  assert.ok(Math.abs(relHumidityFromW(25, w, p) - 50) < 0.01, 'round-trips back to 50%');
});

test('at saturation the dry bulb, wet bulb and dew point coincide', () => {
  for (const t of [-5, 5, 15, 25, 35]) {
    const w = humidityRatio(t, 100, STANDARD_PRESSURE);
    assert.ok(Math.abs(wetBulb(t, w) - t) < 0.02, `wet bulb at ${t}C saturated`);
    assert.ok(Math.abs(dewPointFromW(w) - t) < 0.02, `dew point at ${t}C saturated`);
  }
});

test('station pressure falls with elevation', () => {
  assert.ok(Math.abs(pressureAtElevation(0) - 101325) < 1);
  assert.ok(Math.abs(pressureAtElevation(1000) - 89875) < 60);
  assert.ok(pressureAtElevation(2000) < pressureAtElevation(1000));
});

test('the ASHRAE 55 adaptive comfort band follows 0.31 x prevailing + 17.8', () => {
  const c = adaptiveComfort(20);
  assert.ok(Math.abs(c.neutral - 24) < 1e-9);
  assert.ok(Math.abs(c.lo80 - 20.5) < 1e-9);
  assert.ok(Math.abs(c.hi80 - 27.5) < 1e-9);
  assert.ok(Math.abs(c.hi90 - 26.5) < 1e-9);
  assert.equal(adaptiveComfort(5).inRange, false, 'outside the model validity range');
  assert.equal(adaptiveComfort(40).inRange, false);
  // Clamped, not extrapolated.
  assert.equal(adaptiveComfort(5).neutral, adaptiveComfort(10).neutral);
});

test('the prevailing mean is an exponentially weighted running mean, alpha 0.8', () => {
  // A constant climate must converge to its own value and stay there.
  const flat = Float64Array.from({ length: 30 }, () => 18);
  const steady = runningMean(flat, 0.8);
  assert.ok(Math.abs(steady[29] - 18) < 1e-6, `got ${steady[29]}`);

  // One step change: each day closes (1 - alpha) of the remaining gap, so the
  // series lags rather than jumping. Seeded from the trailing week, which is
  // the warm end here, so it decays towards the cold start.
  const step = Float64Array.from({ length: 14 }, (_, i) => (i < 7 ? 10 : 30));
  const r = runningMean(step, 0.8);
  const seed = 30; // mean of the last seven entries
  assert.ok(Math.abs(r[0] - (0.2 * 10 + 0.8 * seed)) < 1e-6, `got ${r[0]}`);
  assert.ok(r[6] < r[0], 'the cold week must pull the running mean down');
  assert.ok(r[13] > r[6], 'the warm week must pull it back up');
  assert.ok(r[13] < 30, 'and it must lag the step rather than reaching it');

  // Alpha is how much memory it keeps, so a higher alpha responds more slowly
  // and therefore lags further behind the temperature actually being recorded.
  const slow = runningMean(step, 0.9);
  assert.ok(Math.abs(slow[13] - 30) > Math.abs(r[13] - 30),
    `alpha 0.9 must lag the recent 30 more than alpha 0.8: ${slow[13]} vs ${r[13]}`);

  // A gap carries the previous value forward rather than emitting NaN.
  const gappy = Float64Array.from([20, NaN, 20, 20]);
  assert.ok(runningMean(gappy, 0.8).every(Number.isFinite), 'no NaN may escape');

  assert.equal(runningMean(Float64Array.from([]), 0.8).length, 0);
});
