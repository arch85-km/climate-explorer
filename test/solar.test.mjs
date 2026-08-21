import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sunPosition, sunTimes, sunVector, dayOfYear, monthDayFromDoy, daysInMonth, dayArc, analemma,
} from '../src/core/solar.js';

const LOCS = {
  chicago: { latitude: 41.98, longitude: -87.92, timezone: -6 },
  london: { latitude: 51.15, longitude: -0.18, timezone: 0 },
  sydney: { latitude: -33.86, longitude: 151.21, timezone: 10 },
  singapore: { latitude: 1.37, longitude: 103.98, timezone: 8 },
  tromso: { latitude: 69.65, longitude: 18.96, timezone: 1 },
};

test('day-of-year conversion round-trips, leap and common years', () => {
  for (const leap of [false, true]) {
    const total = leap ? 366 : 365;
    for (let doy = 1; doy <= total; doy += 1) {
      const { month, day } = monthDayFromDoy(doy, leap);
      assert.equal(dayOfYear(month, day, leap), doy);
    }
    assert.equal(daysInMonth(2, leap), leap ? 29 : 28);
  }
  assert.equal(dayOfYear(1, 1), 1);
  assert.equal(dayOfYear(12, 31), 365);
});

test('solar-noon altitude equals 90 - |latitude - declination|', () => {
  // The defining identity of solar geometry; any error in declination,
  // equation of time or hour angle breaks it.
  for (const loc of Object.values(LOCS)) {
    for (const doy of [1, 80, 172, 265, 355]) {
      const t = sunTimes(loc, doy);
      const p = sunPosition(loc, doy, t.solarNoon, false);
      const expected = 90 - Math.abs(loc.latitude - p.declination);
      assert.ok(Math.abs(p.altitude - expected) < 0.01,
        `${loc.latitude}° day ${doy}: got ${p.altitude}, expected ${expected}`);
    }
  }
});

test('the sun is due south at noon north of the tropics, due north south of them', () => {
  for (const [name, loc] of Object.entries(LOCS)) {
    if (name === 'singapore') continue; // near-zenith sun: azimuth is ill-conditioned
    for (const doy of [80, 172, 355]) {
      const t = sunTimes(loc, doy);
      const p = sunPosition(loc, doy, t.solarNoon, false);
      const expected = loc.latitude > p.declination ? 180 : 0;
      const err = Math.abs(((p.azimuth - expected + 540) % 360) - 180);
      assert.ok(err < 0.6, `${name} day ${doy}: azimuth ${p.azimuth}, expected ${expected}`);
    }
  }
});

test('declination stays within the axial tilt and reaches both extremes', () => {
  let min = 99;
  let max = -99;
  for (let doy = 1; doy <= 365; doy += 1) {
    const d = sunPosition(LOCS.chicago, doy, 12, false).declination;
    min = Math.min(min, d);
    max = Math.max(max, d);
  }
  assert.ok(min < -23.3 && min > -23.6, `min declination ${min}`);
  assert.ok(max > 23.3 && max < 23.6, `max declination ${max}`);
});

test('the equation of time reaches its textbook extremes on the right days', () => {
  let min = 99;
  let max = -99;
  let minDoy = 0;
  let maxDoy = 0;
  for (let doy = 1; doy <= 365; doy += 1) {
    const e = sunPosition(LOCS.chicago, doy, 12, false).equationOfTime;
    if (e < min) { min = e; minDoy = doy; }
    if (e > max) { max = e; maxDoy = doy; }
  }
  assert.ok(Math.abs(min + 14.2) < 0.6, `minimum ${min} min (expected about -14.2)`);
  assert.ok(Math.abs(max - 16.4) < 0.6, `maximum ${max} min (expected about +16.4)`);
  assert.ok(Math.abs(minDoy - 42) < 6, `minimum on day ${minDoy} (expected about 42)`);
  assert.ok(Math.abs(maxDoy - 307) < 6, `maximum on day ${maxDoy} (expected about 307)`);
});

test('at the equinox the sun rises due east and sets due west everywhere', () => {
  const equinoxDoy = (loc) => {
    let lo = 70;
    let hi = 90;
    for (let i = 0; i < 60; i += 1) {
      const mid = (lo + hi) / 2;
      if (sunPosition(loc, mid, 12, false).declination < 0) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  };
  for (const [name, loc] of Object.entries(LOCS)) {
    if (name === 'tromso') continue; // grazing sun: azimuth moves too fast to sample
    const doy = equinoxDoy(loc);
    const t = sunTimes(loc, doy);
    const rise = sunPosition(loc, doy, t.sunrise + 4.5 / 60, false).azimuth;
    const set = sunPosition(loc, doy, t.sunset - 4.5 / 60, false).azimuth;
    assert.ok(Math.abs(rise - 90) < 0.5, `${name} sunrise azimuth ${rise}`);
    assert.ok(Math.abs(set - 270) < 0.5, `${name} sunset azimuth ${set}`);
    // 12.1 h, not 12.0: the 90.833° zenith allows for refraction and the solar disc.
    assert.ok(Math.abs(t.dayLength - 12.1) < 0.15, `${name} equinox day length ${t.dayLength}`);
  }
});

test('the sun path is symmetric about solar noon', () => {
  for (const loc of Object.values(LOCS)) {
    const t = sunTimes(loc, 172);
    for (const dt of [0.5, 1.5, 3]) {
      const a = sunPosition(loc, 172, t.solarNoon - dt, false);
      const b = sunPosition(loc, 172, t.solarNoon + dt, false);
      // Declination drifts across the day, so a small residual is physical.
      assert.ok(Math.abs(a.altitude - b.altitude) < 0.12);
      assert.ok(Math.abs((a.azimuth - 180) + (b.azimuth - 180)) < 0.25);
    }
  }
});

test('day length is longest at the summer solstice and shortest at the winter one', () => {
  const chi = (doy) => sunTimes(LOCS.chicago, doy).dayLength;
  assert.ok(chi(172) > 15.1 && chi(172) < 15.4, `Jun 21 day length ${chi(172)}`);
  assert.ok(chi(355) > 9.0 && chi(355) < 9.3, `Dec 21 day length ${chi(355)}`);
  // Southern hemisphere is the other way round.
  const syd = (doy) => sunTimes(LOCS.sydney, doy).dayLength;
  assert.ok(syd(355) > syd(172));
});

test('polar day and polar night are reported rather than producing NaN times', () => {
  const summer = sunTimes(LOCS.tromso, 172);
  assert.equal(summer.polar, 'day');
  assert.equal(summer.sunrise, null);
  assert.equal(summer.dayLength, 24);
  const winter = sunTimes(LOCS.tromso, 355);
  assert.equal(winter.polar, 'night');
  assert.equal(winter.dayLength, 0);
});

test('refraction lifts the sun slightly and only near the horizon', () => {
  const geometric = sunPosition(LOCS.london, 172, 12, false);
  const apparent = sunPosition(LOCS.london, 172, 12, true);
  assert.ok(apparent.altitude > geometric.altitude);
  assert.ok(apparent.altitude - geometric.altitude < 0.02, 'high sun is barely refracted');
  const lowG = sunPosition(LOCS.london, 355, 8, false);
  const lowA = sunPosition(LOCS.london, 355, 8, true);
  assert.ok(lowA.altitude - lowG.altitude > 0.05, 'low sun is refracted more');
});

test('the sun vector is a unit vector in the Y-up, +X east, -Z north frame', () => {
  for (const [alt, az] of [[0, 0], [45, 90], [90, 0], [30, 180], [10, 270]]) {
    const v = sunVector(alt, az);
    assert.ok(Math.abs(Math.hypot(v.x, v.y, v.z) - 1) < 1e-9);
  }
  const north = sunVector(0, 0);
  assert.ok(Math.abs(north.z + 1) < 1e-9 && Math.abs(north.x) < 1e-9);
  const east = sunVector(0, 90);
  assert.ok(Math.abs(east.x - 1) < 1e-9);
  const zenith = sunVector(90, 0);
  assert.ok(Math.abs(zenith.y - 1) < 1e-9);
});

test('day arcs and analemmas produce usable geometry', () => {
  const arc = dayArc(LOCS.chicago, 172);
  assert.ok(arc.length > 60, 'summer day arc has plenty of points');
  assert.ok(arc.every((p) => p.altitude > 0), 'daylight-only by default');
  assert.equal(dayArc(LOCS.tromso, 355).length, 0, 'polar night has no arc');

  const an = analemma(LOCS.chicago, 12, false, 5);
  assert.ok(an.length > 60);
  const spread = Math.max(...an.map((p) => p.azimuth)) - Math.min(...an.map((p) => p.azimuth));
  assert.ok(spread > 0.5 && spread < 15, `noon analemma azimuth spread ${spread}°`);
});
