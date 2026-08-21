import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEpw, EpwParseError, locationLabel, coordLabel } from '../src/epw/parse.js';
import { buildDataset } from '../src/core/dataset.js';
import { FIELDS } from '../src/epw/fields.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = (name) => join(ROOT, 'test', 'fixtures', name);
const CHICAGO = fixture('chicago_ohare_tmy3.epw');
const LONDON = fixture('london_gatwick_iwec.epw');

if (!existsSync(CHICAGO)) {
  throw new Error('Test fixtures missing — run ./tools/fetch-samples.sh first.');
}

const chicago = parseEpw(readFileSync(CHICAGO, 'utf8'));
const london = parseEpw(readFileSync(LONDON, 'utf8'));

test('LOCATION header is parsed field by field', () => {
  assert.equal(chicago.location.city, 'Chicago Ohare Intl Ap');
  assert.equal(chicago.location.state, 'IL');
  assert.equal(chicago.location.country, 'USA');
  assert.equal(chicago.location.source, 'TMY3');
  assert.equal(chicago.location.wmo, '725300');
  assert.equal(chicago.location.latitude, 41.98);
  assert.equal(chicago.location.longitude, -87.92);
  assert.equal(chicago.location.timezone, -6);
  assert.equal(chicago.location.elevation, 201);
  assert.equal(locationLabel(chicago.location), 'Chicago Ohare Intl Ap, IL, USA');
  assert.equal(coordLabel(chicago.location), '41.98°N, 87.92°W');
});

test('a "-" placeholder in the state field is dropped, not shown', () => {
  assert.equal(london.location.state, '');
  assert.equal(locationLabel(london.location), 'LONDON/GATWICK, GBR');
});

test('a full year parses to 8760 records over 365 days with no gaps', () => {
  for (const d of [chicago, london]) {
    assert.equal(d.n, 8760);
    assert.equal(d.nDays, 365);
    assert.equal(d.isLeap, false);
    assert.deepEqual(d.warnings, []);
    let gaps = 0;
    for (let i = 0; i < d.grid.length; i += 1) if (d.grid[i] < 0) gaps += 1;
    assert.equal(gaps, 0, 'every calendar hour maps to a record');
  }
});

test('EPW hour 1..24 is normalised to index 0..23', () => {
  assert.deepEqual(Array.from(chicago.hour.slice(0, 24)), Array.from({ length: 24 }, (_, i) => i));
  assert.equal(chicago.hour[chicago.n - 1], 23);
  let max = 0;
  for (const h of chicago.hour) max = Math.max(max, h);
  assert.equal(max, 23);
});

test('the calendar advances correctly across the whole file', () => {
  assert.equal(chicago.month[0], 1);
  assert.equal(chicago.day[0], 1);
  assert.equal(chicago.month[chicago.n - 1], 12);
  assert.equal(chicago.day[chicago.n - 1], 31);
  assert.equal(chicago.dayIndexOf[0], 0);
  assert.equal(chicago.dayIndexOf[chicago.n - 1], 364);
});

test('missing-value sentinels become NaN rather than absurd numbers', () => {
  // Chicago TMY3 leaves albedo and liquid precipitation largely unrecorded.
  assert.ok(chicago.missingCounts.albedo > 8000);
  for (const f of FIELDS) {
    const series = chicago.series[f.key];
    for (let i = 0; i < series.length; i += 1) {
      const v = series[i];
      if (!Number.isFinite(v)) continue;
      assert.ok(Math.abs(v) < Math.abs(f.missing),
        `${f.key} kept a value at or beyond its ${f.missing} sentinel: ${v}`);
    }
  }
});

test('values sit inside their documented physical ranges', () => {
  const checks = [
    ['dryBulb', -70, 70], ['dewPoint', -70, 70], ['relHumidity', 0, 110],
    ['pressure', 31000, 120000], ['windDirection', 0, 360], ['windSpeed', 0, 60],
    ['globalHorizontal', 0, 1600], ['directNormal', 0, 1600], ['totalSkyCover', 0, 10],
  ];
  for (const d of [chicago, london]) {
    for (const [key, lo, hi] of checks) {
      const series = d.series[key];
      for (let i = 0; i < series.length; i += 1) {
        const v = series[i];
        if (!Number.isFinite(v)) continue;
        assert.ok(v >= lo && v <= hi, `${key}[${i}] = ${v} outside ${lo}..${hi}`);
      }
    }
  }
});

test('dew point never exceeds dry bulb', () => {
  let violations = 0;
  for (let i = 0; i < chicago.n; i += 1) {
    const t = chicago.series.dryBulb[i];
    const dp = chicago.series.dewPoint[i];
    if (Number.isFinite(t) && Number.isFinite(dp) && dp > t + 0.15) violations += 1;
  }
  assert.equal(violations, 0);
});

test('all three ground-temperature depths are read from the header', () => {
  assert.equal(chicago.groundTemperatures.length, 3);
  assert.deepEqual(chicago.groundTemperatures.map((g) => g.depth), [0.5, 2, 4]);
  for (const g of chicago.groundTemperatures) {
    assert.equal(g.monthly.length, 12);
    for (const v of g.monthly) assert.ok(Number.isFinite(v));
  }
  // Deeper soil swings less than shallow soil — a physical sanity check on the stride.
  const swing = (g) => Math.max(...g.monthly) - Math.min(...g.monthly);
  assert.ok(swing(chicago.groundTemperatures[0]) > swing(chicago.groundTemperatures[2]));
});

test('typical and extreme periods are offered from the header', () => {
  assert.equal(chicago.typicalPeriods.length, 6);
  assert.match(chicago.typicalPeriods[0].name, /Summer/);
  assert.match(chicago.typicalPeriods[0].start, /\d+\/\s*\d+/);
});

test('DATA PERIODS header is read rather than assumed', () => {
  assert.equal(chicago.dataPeriods.recordsPerHour, 1);
  assert.equal(chicago.dataPeriods.startDayOfWeek, 'Sunday');
  assert.equal(chicago.dataPeriods.start, '1/ 1');
});

test('malformed input raises EpwParseError with a readable message', () => {
  assert.throws(() => parseEpw(''), EpwParseError);
  assert.throws(() => parseEpw('x'.repeat(500)), EpwParseError);
  assert.throws(() => parseEpw(`NOTLOCATION,a\n${'line\n'.repeat(40)}`), EpwParseError);
  assert.throws(
    () => parseEpw(`LOCATION,City,,X,src,1,notanumber,alsonot,0,0\n${'a,b\n'.repeat(40)}`),
    EpwParseError,
  );
  try { parseEpw(''); } catch (e) { assert.match(e.message, /empty|short/i); }
});

test('a leap-year file parses to 8784 records over 366 days', () => {
  // Synthesised by duplicating a February day, since real leap EPWs are rare.
  const text = readFileSync(CHICAGO, 'utf8');
  const lines = text.split('\n');
  const header = lines.slice(0, 8);
  const rows = lines.slice(8).filter((l) => l.length > 20);
  const feb28 = rows.filter((r) => { const p = r.split(','); return p[1] === '2' && p[2] === '28'; });
  const feb29 = feb28.map((r) => { const p = r.split(','); p[2] = '29'; return p.join(','); });
  const idx = rows.indexOf(feb28[feb28.length - 1]) + 1;
  const merged = [...header, ...rows.slice(0, idx), ...feb29, ...rows.slice(idx)].join('\n');
  const leap = parseEpw(merged);
  assert.equal(leap.n, 8784);
  assert.equal(leap.nDays, 366);
  assert.equal(leap.isLeap, true);
});

test('derived series are built and cover the whole file', () => {
  const d = buildDataset(parseEpw(readFileSync(LONDON, 'utf8')));
  for (const key of ['humidityRatio', 'enthalpy', 'wetBulb', 'solarAltitude', 'solarAzimuth']) {
    assert.ok(d.series[key], `${key} missing`);
    assert.equal(d.series[key].length, d.n);
    let finite = 0;
    for (const v of d.series[key]) if (Number.isFinite(v)) finite += 1;
    assert.ok(finite > d.n * 0.99, `${key} is mostly NaN (${finite}/${d.n})`);
  }
  assert.ok(d.availableKeys.includes('dryBulb'));
  assert.ok(d.availableKeys.includes('humidityRatio'));
});

test('wet bulb lies between dew point and dry bulb', () => {
  const d = buildDataset(parseEpw(readFileSync(CHICAGO, 'utf8')));
  for (let i = 0; i < d.n; i += 37) {
    const t = d.series.dryBulb[i];
    const dp = d.series.dewPoint[i];
    const wb = d.series.wetBulb[i];
    if (![t, dp, wb].every(Number.isFinite)) continue;
    assert.ok(wb <= t + 0.05 && wb >= dp - 0.6,
      `hour ${i}: wet bulb ${wb} outside dew point ${dp}..dry bulb ${t}`);
  }
});
