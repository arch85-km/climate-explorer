/**
 * EPW file parser.
 *
 * An EPW file is 8 header lines followed by one comma-separated record per hour:
 *   LOCATION, DESIGN CONDITIONS, TYPICAL/EXTREME PERIODS, GROUND TEMPERATURES,
 *   HOLIDAYS/DAYLIGHT SAVINGS, COMMENTS 1, COMMENTS 2, DATA PERIODS
 *
 * The record count comes from counting the data lines rather than being assumed to
 * be 8760, so leap-year files (8784) and partial-year files parse correctly. The
 * DATA PERIODS header is parsed and reported, but nothing is sized from it — a
 * file whose header disagrees with its own contents is read as written.
 *
 * @version 1.0.0 — 2026-09-15
 */
import { FIELDS } from './fields.js';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_ABBR = MONTH_NAMES.map((m) => m.slice(0, 3));

class EpwParseError extends Error {}

function splitCsv(line) {
  return line.split(',').map((s) => s.trim());
}

function num(text, fallback = NaN) {
  if (text == null || text === '') return fallback;
  const v = Number(text);
  return Number.isFinite(v) ? v : fallback;
}

// EPW writers use "-" as an empty placeholder for state/region.
function clean(text) {
  const t = (text || '').trim();
  return t === '-' || t === '_' ? '' : t;
}

function parseLocation(parts) {
  if (!parts.length || parts[0].toUpperCase() !== 'LOCATION') {
    throw new EpwParseError('First line is not a LOCATION header — this does not look like an EPW file.');
  }
  const latitude = num(parts[6]);
  const longitude = num(parts[7]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new EpwParseError('LOCATION header is missing a usable latitude/longitude.');
  }
  return {
    city: clean(parts[1]) || 'Unknown location',
    state: clean(parts[2]),
    country: clean(parts[3]),
    source: clean(parts[4]),
    wmo: clean(parts[5]),
    latitude,
    longitude,
    // EPW timezone is hours from UTC; some files omit it.
    timezone: Number.isFinite(num(parts[8])) ? num(parts[8]) : Math.round(longitude / 15),
    elevation: num(parts[9], 0),
  };
}

/** GROUND TEMPERATURES,<n>,<depth>,<cond>,<dens>,<spec heat>,<12 monthly values>,... */
function parseGroundTemperatures(parts) {
  const out = [];
  const count = num(parts[1], 0);
  let i = 2;
  for (let d = 0; d < count; d += 1) {
    const depth = num(parts[i]);
    const monthly = [];
    for (let m = 0; m < 12; m += 1) monthly.push(num(parts[i + 4 + m]));
    if (Number.isFinite(depth)) out.push({ depth, monthly });
    i += 16; // depth + 3 soil properties + 12 monthly values
  }
  return out;
}

/** DATA PERIODS,<nPeriods>,<recordsPerHour>,<name>,<startDayOfWeek>,<start>,<end> */
function parseDataPeriods(parts) {
  return {
    periods: num(parts[1], 1),
    recordsPerHour: num(parts[2], 1) || 1,
    name: parts[3] || 'Data',
    startDayOfWeek: parts[4] || '',
    start: parts[5] || '',
    end: parts[6] || '',
  };
}

/** TYPICAL/EXTREME PERIODS,<n>,(name,type,start,end)* — used to offer quick date presets. */
function parseTypicalPeriods(parts) {
  const out = [];
  const count = num(parts[1], 0);
  for (let i = 0; i < count; i += 1) {
    const o = 2 + i * 4;
    if (!parts[o]) break;
    out.push({ name: parts[o], type: parts[o + 1], start: parts[o + 2], end: parts[o + 3] });
  }
  return out;
}

/**
 * Parse EPW text into typed arrays.
 * @param {string} text raw file contents
 * @returns {object} parsed weather dataset
 */
function parseEpw(text) {
  if (typeof text !== 'string' || text.length < 200) {
    throw new EpwParseError('File is empty or too short to be an EPW file.');
  }
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.length < 20) throw new EpwParseError('File has too few lines to be an EPW file.');

  const header = lines.slice(0, 8).map(splitCsv);
  const location = parseLocation(header[0]);
  const typicalPeriods = header[2] && header[2][0]?.toUpperCase().startsWith('TYPICAL')
    ? parseTypicalPeriods(header[2]) : [];
  const groundTemperatures = header[3] && header[3][0]?.toUpperCase().startsWith('GROUND')
    ? parseGroundTemperatures(header[3]) : [];
  const dataPeriods = header[7] && header[7][0]?.toUpperCase().startsWith('DATA PERIODS')
    ? parseDataPeriods(header[7]) : { periods: 1, recordsPerHour: 1, name: 'Data' };
  const comments = [
    (header[5] || []).slice(1).join(',').trim(),
    (header[6] || []).slice(1).join(',').trim(),
  ];

  // Collect non-empty data lines.
  const rows = [];
  for (let i = 8; i < lines.length; i += 1) {
    const line = lines[i];
    if (line && line.length > 20) rows.push(line);
  }
  if (!rows.length) throw new EpwParseError('EPW header parsed, but the file contains no hourly records.');

  const n = rows.length;
  const month = new Uint8Array(n);
  const day = new Uint8Array(n);
  const hour = new Uint8Array(n); // normalised to 0..23
  const year = new Int16Array(n);

  const series = {};
  for (const f of FIELDS) series[f.key] = new Float32Array(n);
  const missingCounts = {};
  const outOfRange = {};

  const active = FIELDS.map((f) => ({
    key: f.key,
    index: f.index,
    // Sentinels are compared with ">=" because EPW writers vary (999900 vs 999999).
    threshold: Math.abs(f.missing) - 1e-9,
    min: f.min,
    max: f.max,
    arr: series[f.key],
  }));

  let shortRows = 0;
  for (let r = 0; r < n; r += 1) {
    const parts = rows[r].split(',');
    if (parts.length < 22) { shortRows += 1; }
    year[r] = num(parts[0], 0);
    month[r] = num(parts[1], 1);
    day[r] = num(parts[2], 1);
    // EPW hour is 1..24, where 24 is the interval ending at midnight of that same day.
    const h = num(parts[3], 1);
    hour[r] = Math.min(23, Math.max(0, h - 1));

    for (let k = 0; k < active.length; k += 1) {
      const f = active[k];
      const raw = parts[f.index];
      let v = raw === undefined || raw === '' ? NaN : +raw;
      if (!Number.isFinite(v) || Math.abs(v) >= f.threshold) {
        missingCounts[f.key] = (missingCounts[f.key] || 0) + 1;
        v = NaN;
      } else if ((f.min != null && v < f.min) || (f.max != null && v > f.max)) {
        // Keep the value but record it — a real data problem should be visible, not hidden.
        outOfRange[f.key] = (outOfRange[f.key] || 0) + 1;
      }
      f.arr[r] = v;
    }
  }

  // Build a calendar index: sequential day number, plus a (day, hour) -> record lookup.
  const dayKeys = [];
  const dayIndexOf = new Int16Array(n);
  const dayKeyToIndex = new Map();
  for (let r = 0; r < n; r += 1) {
    const key = month[r] * 100 + day[r];
    let idx = dayKeyToIndex.get(key);
    if (idx === undefined) {
      idx = dayKeys.length;
      dayKeyToIndex.set(key, idx);
      dayKeys.push({ month: month[r], day: day[r] });
    }
    dayIndexOf[r] = idx;
  }
  const nDays = dayKeys.length;

  // grid[dayIndex * 24 + hour] -> record index, or -1 where the file has a gap.
  const grid = new Int32Array(nDays * 24).fill(-1);
  for (let r = 0; r < n; r += 1) grid[dayIndexOf[r] * 24 + hour[r]] = r;
  let gaps = 0;
  for (let i = 0; i < grid.length; i += 1) if (grid[i] < 0) gaps += 1;

  const warnings = [];
  if (shortRows) warnings.push(`${shortRows} record(s) had fewer fields than the EPW spec requires.`);
  if (gaps) warnings.push(`${gaps} hour(s) of the calendar have no record and are drawn as gaps.`);
  if (n !== 8760 && n !== 8784) warnings.push(`File contains ${n} records (a full year is 8760, or 8784 in a leap year).`);
  for (const [key, count] of Object.entries(outOfRange)) {
    warnings.push(`${count} value(s) of "${key}" fall outside the documented valid range.`);
  }

  return {
    location,
    typicalPeriods,
    groundTemperatures,
    dataPeriods,
    comments,
    n,
    nDays,
    year,
    month,
    day,
    hour,
    dayIndexOf,
    dayKeys,
    grid,
    series,
    missingCounts,
    warnings,
    isLeap: nDays > 365,
  };
}

/** Human-readable "Chicago Ohare Intl Ap, IL, USA" */
function locationLabel(location) {
  return [location.city, location.state, location.country].filter(Boolean).join(', ');
}

/**
 * The name to show for a dataset: a curated label when one was supplied (only the
 * bundled sample has one), otherwise whatever the file's LOCATION header says.
 */
function datasetLabel(data) {
  if (!data) return '';
  return data.displayLabel || locationLabel(data.location);
}

/** "41.98°N, 87.92°W" */
function coordLabel(location) {
  const lat = `${Math.abs(location.latitude).toFixed(2)}°${location.latitude >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(location.longitude).toFixed(2)}°${location.longitude >= 0 ? 'E' : 'W'}`;
  return `${lat}, ${lon}`;
}

/** Index of the first record of a given month/day, or -1. */
function dayIndexFor(data, month, day) {
  for (let i = 0; i < data.dayKeys.length; i += 1) {
    if (data.dayKeys[i].month === month && data.dayKeys[i].day === day) return i;
  }
  return -1;
}

export { parseEpw, EpwParseError, locationLabel, datasetLabel, coordLabel, dayIndexFor };
export { MONTH_NAMES, MONTH_ABBR };
