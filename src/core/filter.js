/**
 * The analysis period: the shared date/time selection every view reads from.
 *
 * A period is { fromMonth, fromDay, toMonth, toDay, fromHour, toHour }.
 * Date ranges may wrap the year end (e.g. 1 Nov to 28 Feb) and hour ranges may wrap
 * midnight (e.g. 22:00 to 06:00), because both are things students genuinely want
 * to look at.
 */
import { dayOfYear, daysInMonth } from './solar.js';
import { MONTH_ABBR } from '../epw/parse.js';

const FULL_YEAR = { fromMonth: 1, fromDay: 1, toMonth: 12, toDay: 31, fromHour: 0, toHour: 23 };

function clampDay(month, day, leap) {
  return Math.max(1, Math.min(daysInMonth(month, leap), day));
}

/** Normalise a period, clamping days to the length of their month. */
function normalisePeriod(period, leap = false) {
  const p = { ...FULL_YEAR, ...period };
  p.fromMonth = Math.max(1, Math.min(12, Math.round(p.fromMonth)));
  p.toMonth = Math.max(1, Math.min(12, Math.round(p.toMonth)));
  p.fromDay = clampDay(p.fromMonth, Math.round(p.fromDay), leap);
  p.toDay = clampDay(p.toMonth, Math.round(p.toDay), leap);
  p.fromHour = Math.max(0, Math.min(23, Math.round(p.fromHour)));
  p.toHour = Math.max(0, Math.min(23, Math.round(p.toHour)));
  return p;
}

/** True when the period selects every hour of the year. */
function isFullYear(period) {
  const p = normalisePeriod(period);
  return p.fromMonth === 1 && p.fromDay === 1 && p.toMonth === 12 && p.toDay === 31
    && p.fromHour === 0 && p.toHour === 23;
}

/**
 * Build a Uint8Array mask of length data.n, 1 where the record is inside the period.
 * Results are cached on the dataset so repeated view renders are cheap.
 */
function buildMask(data, period) {
  const p = normalisePeriod(period, data.isLeap);
  const cacheKey = `${p.fromMonth}-${p.fromDay}-${p.toMonth}-${p.toDay}-${p.fromHour}-${p.toHour}`;
  if (!data._maskCache) data._maskCache = new Map();
  const hit = data._maskCache.get(cacheKey);
  if (hit) return hit;

  const from = dayOfYear(p.fromMonth, p.fromDay, data.isLeap);
  const to = dayOfYear(p.toMonth, p.toDay, data.isLeap);
  const dateWraps = from > to;
  const hourWraps = p.fromHour > p.toHour;

  const mask = new Uint8Array(data.n);
  for (let i = 0; i < data.n; i += 1) {
    const doy = dayOfYear(data.month[i], data.day[i], data.isLeap);
    const inDate = dateWraps ? (doy >= from || doy <= to) : (doy >= from && doy <= to);
    if (!inDate) continue;
    const h = data.hour[i];
    const inHour = hourWraps ? (h >= p.fromHour || h <= p.toHour) : (h >= p.fromHour && h <= p.toHour);
    if (inHour) mask[i] = 1;
  }

  // Keep the cache small; periods change one at a time as the user drags sliders.
  if (data._maskCache.size > 24) data._maskCache.clear();
  data._maskCache.set(cacheKey, mask);
  return mask;
}

/** Number of selected hours. */
function maskCount(mask) {
  let n = 0;
  for (let i = 0; i < mask.length; i += 1) n += mask[i];
  return n;
}

/** "1 Jan – 31 Dec, 00:00–23:00" */
function describePeriod(period, leap = false) {
  const p = normalisePeriod(period, leap);
  const date = isFullYear({ ...p, fromHour: 0, toHour: 23 })
    ? 'Whole year'
    : `${p.fromDay} ${MONTH_ABBR[p.fromMonth - 1]} – ${p.toDay} ${MONTH_ABBR[p.toMonth - 1]}`;
  const hours = p.fromHour === 0 && p.toHour === 23
    ? 'all hours'
    : `${String(p.fromHour).padStart(2, '0')}:00–${String(p.toHour).padStart(2, '0')}:59`;
  return `${date}, ${hours}`;
}

/** Ready-made periods offered in the toolbar. */
function presetPeriods(data) {
  const presets = [
    { key: 'year', label: 'Whole year', period: { ...FULL_YEAR } },
    { key: 'winter', label: 'Winter (DJF)', period: { fromMonth: 12, fromDay: 1, toMonth: 2, toDay: 28, fromHour: 0, toHour: 23 } },
    { key: 'spring', label: 'Spring (MAM)', period: { fromMonth: 3, fromDay: 1, toMonth: 5, toDay: 31, fromHour: 0, toHour: 23 } },
    { key: 'summer', label: 'Summer (JJA)', period: { fromMonth: 6, fromDay: 1, toMonth: 8, toDay: 31, fromHour: 0, toHour: 23 } },
    { key: 'autumn', label: 'Autumn (SON)', period: { fromMonth: 9, fromDay: 1, toMonth: 11, toDay: 30, fromHour: 0, toHour: 23 } },
    { key: 'occupied', label: 'Occupied hours (08–18)', period: { ...FULL_YEAR, fromHour: 8, toHour: 18 } },
    { key: 'night', label: 'Night (22–06)', period: { ...FULL_YEAR, fromHour: 22, toHour: 6 } },
  ];

  // The EPW header names its own typical and extreme weeks; offer them as presets
  // because they are exactly the weeks a design study should look at.
  for (const tp of (data?.typicalPeriods || [])) {
    const from = parseMonthDay(tp.start);
    const to = parseMonthDay(tp.end);
    if (!from || !to) continue;
    presets.push({
      key: `epw:${tp.name}`,
      label: tp.name.replace(/ For Period$/, ''),
      period: { fromMonth: from.month, fromDay: from.day, toMonth: to.month, toDay: to.day, fromHour: 0, toHour: 23 },
      fromFile: true,
    });
  }
  return presets;
}

/** EPW header dates look like "7/13" or "2/ 2". */
function parseMonthDay(text) {
  if (!text) return null;
  const m = String(text).match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (!m) return null;
  return { month: +m[1], day: +m[2] };
}

export { FULL_YEAR, normalisePeriod, isFullYear, buildMask, maskCount, describePeriod };
export { presetPeriods, parseMonthDay, clampDay };
