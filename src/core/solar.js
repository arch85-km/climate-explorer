/**
 * Solar position, following the NOAA Solar Calculator (Meeus, Astronomical Algorithms).
 *
 * Angles are degrees at the API boundary and radians internally.
 * Azimuth is measured clockwise from true north (0 = N, 90 = E, 180 = S, 270 = W).
 * Altitude is degrees above the horizon; negative values are below it.
 *
 * Times are *local standard time* with no daylight-saving shift, matching the
 * EnergyPlus convention for EPW files.
 *
 * @version 1.1.0 — 2026-10-04
 */

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const DAYS_IN_MONTH_LEAP = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
// Julian day of 0 January 2025, 00:00 UT (31 December 2024): doy 1 is 1 January 2025.
const REFERENCE_JD0 = 2460675.5;

function daysInMonth(month, leap = false) {
  return (leap ? DAYS_IN_MONTH_LEAP : DAYS_IN_MONTH)[month - 1];
}

/** Day of year, 1-based. */
function dayOfYear(month, day, leap = false) {
  const table = leap ? DAYS_IN_MONTH_LEAP : DAYS_IN_MONTH;
  let doy = day;
  for (let m = 0; m < month - 1; m += 1) doy += table[m];
  return doy;
}

/** Inverse of dayOfYear. */
function monthDayFromDoy(doy, leap = false) {
  const table = leap ? DAYS_IN_MONTH_LEAP : DAYS_IN_MONTH;
  let remaining = Math.max(1, Math.min(leap ? 366 : 365, Math.round(doy)));
  for (let m = 0; m < 12; m += 1) {
    if (remaining <= table[m]) return { month: m + 1, day: remaining };
    remaining -= table[m];
  }
  return { month: 12, day: 31 };
}

/**
 * NOAA atmospheric refraction correction, in degrees, for a geometric elevation.
 * Makes computed altitudes match what an observer actually sees near the horizon.
 */
function refractionCorrection(elevationDeg) {
  if (elevationDeg > 85) return 0;
  const te = Math.tan(elevationDeg * DEG);
  let arcsec;
  if (elevationDeg > 5) {
    arcsec = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
  } else if (elevationDeg > -0.575) {
    const e = elevationDeg;
    arcsec = 1735 + e * (-518.2 + e * (103.4 + e * (-12.79 + e * 0.711)));
  } else {
    arcsec = -20.772 / te;
  }
  return arcsec / 3600;
}

/**
 * Solar position for a location at a given day-of-year and local standard hour.
 *
 * @param {object} loc  { latitude, longitude, timezone }  longitude +E, timezone hours from UTC
 * @param {number} doy  day of year, 1-based
 * @param {number} hour local standard time in decimal hours (13.5 = 13:30)
 * @param {boolean} [applyRefraction=true]
 * @returns {{altitude:number, azimuth:number, zenith:number, declination:number,
 *            equationOfTime:number, hourAngle:number}} degrees (equationOfTime in minutes)
 */
function sunPosition(loc, doy, hour, applyRefraction = true) {
  const lat = loc.latitude * DEG;

  // NOAA Solar Calculator / Meeus: the same formulas as Daylight Lab and Solar Lab, so the
  // three tools agree to within 0.01°. This replaced NOAA's shorter fractional-year series
  // (Spencer, 1971), whose declination was 0.51° off at both equinoxes for a 2020s year,
  // because it places the equinox about a day later than it now falls.
  // An EPW year has no single calendar year, so a fixed non-leap reference year is used,
  // 2025, as in Solar Lab; doy 366 of a leap file simply runs into 1 January 2026.
  const jd = REFERENCE_JD0 + doy + (hour - loc.timezone) / 24;
  const T = (jd - 2451545) / 36525;
  const L0 = ((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360 + 360) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * DEG) * (1.914602 - T * (0.004817 + 0.000014 * T))
    + Math.sin(2 * M * DEG) * (0.019993 - 0.000101 * T)
    + Math.sin(3 * M * DEG) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const appLong = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * DEG);
  const meanObliq = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(omega * DEG);
  const decl = Math.asin(Math.sin(obliq * DEG) * Math.sin(appLong * DEG)); // radians

  const y = Math.tan(obliq * DEG / 2) ** 2;
  const eqTime = 4 * RAD * (
    y * Math.sin(2 * L0 * DEG)
    - 2 * e * Math.sin(M * DEG)
    + 4 * e * y * Math.sin(M * DEG) * Math.cos(2 * L0 * DEG)
    - 0.5 * y * y * Math.sin(4 * L0 * DEG)
    - 1.25 * e * e * Math.sin(2 * M * DEG)
  ); // minutes

  // Minutes to add to local clock time to get true solar time.
  const timeOffset = eqTime + 4 * loc.longitude - 60 * loc.timezone;
  const trueSolarTime = ((hour * 60 + timeOffset) % 1440 + 1440) % 1440;
  const hourAngle = trueSolarTime / 4 - 180; // degrees, 0 at solar noon
  const ha = hourAngle * DEG;

  const cosZenith = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const zenith = Math.acos(Math.max(-1, Math.min(1, cosZenith)));
  let altitude = 90 - zenith * RAD;

  // atan2 form: unambiguous across all quadrants. Result is degrees from south,
  // positive westward; shift by 180 to measure clockwise from north.
  const azFromSouth = Math.atan2(
    Math.sin(ha),
    Math.cos(ha) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat),
  ) * RAD;
  const azimuth = (azFromSouth + 180 + 360) % 360;

  if (applyRefraction) altitude += refractionCorrection(altitude);

  return {
    altitude,
    azimuth,
    zenith: 90 - altitude,
    declination: decl * RAD,
    equationOfTime: eqTime,
    hourAngle,
  };
}

/** Unit vector towards the sun in a Y-up, +X east, -Z north world (WebGL convention). */
function sunVector(altitude, azimuth) {
  const alt = altitude * DEG;
  const az = azimuth * DEG;
  const horizontal = Math.cos(alt);
  return {
    x: horizontal * Math.sin(az),   // east
    y: Math.sin(alt),               // up
    z: -horizontal * Math.cos(az),  // north is -Z
  };
}

/**
 * Sunrise, sunset, solar noon and day length for a day.
 * Uses the standard 90.833° zenith, which allows for refraction and the solar disc.
 * Returns nulls for polar day/night.
 */
function sunTimes(loc, doy) {
  const { declination, equationOfTime } = sunPosition(loc, doy, 12, false);
  const lat = loc.latitude * DEG;
  const decl = declination * DEG;
  const zenith = 90.833 * DEG;

  const cosH = (Math.cos(zenith) - Math.sin(lat) * Math.sin(decl))
    / (Math.cos(lat) * Math.cos(decl));

  const solarNoon = (720 - 4 * loc.longitude - equationOfTime + 60 * loc.timezone) / 60;

  if (cosH > 1) return { sunrise: null, sunset: null, solarNoon, dayLength: 0, polar: 'night' };
  if (cosH < -1) return { sunrise: null, sunset: null, solarNoon, dayLength: 24, polar: 'day' };

  const ha = Math.acos(cosH) * RAD; // degrees
  const halfDay = ha * 4 / 60; // hours
  return {
    sunrise: solarNoon - halfDay,
    sunset: solarNoon + halfDay,
    solarNoon,
    dayLength: halfDay * 2,
    polar: null,
  };
}

/**
 * Sun positions for every hour of a dataset, computed at the centre of each hour
 * (EPW records the interval *ending* at the stated hour, so hour index h spans
 * h:00 to h+1:00 and its midpoint is h + 0.5).
 *
 * @returns {{altitude:Float32Array, azimuth:Float32Array}}
 */
function annualSunPositions(loc, month, day, hour, n, leap) {
  const altitude = new Float32Array(n);
  const azimuth = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const doy = dayOfYear(month[i], day[i], leap);
    const pos = sunPosition(loc, doy, hour[i] + 0.5);
    altitude[i] = pos.altitude;
    azimuth[i] = pos.azimuth;
  }
  return { altitude, azimuth };
}

/**
 * The sun's track across one day, sampled finely enough to draw a smooth arc.
 * Returns only points above the horizon unless `includeNight` is set.
 */
function dayArc(loc, doy, steps = 145, includeNight = false) {
  const points = [];
  for (let i = 0; i < steps; i += 1) {
    const hour = (i / (steps - 1)) * 24;
    const pos = sunPosition(loc, doy, hour);
    if (includeNight || pos.altitude > 0) {
      points.push({ hour, altitude: pos.altitude, azimuth: pos.azimuth });
    }
  }
  return points;
}

/**
 * The analemma for a given clock hour: the sun's position at that hour across the year.
 * This is the figure-of-eight that makes a sun path diagram readable.
 */
function analemma(loc, hour, leap = false, step = 5) {
  const points = [];
  const total = leap ? 366 : 365;
  for (let doy = 1; doy <= total; doy += step) {
    const pos = sunPosition(loc, doy, hour);
    points.push({ doy, altitude: pos.altitude, azimuth: pos.azimuth });
  }
  return points;
}

/** Solstices and equinoxes, as day-of-year, for the characteristic sun path arcs. */
function keyDays(leap = false) {
  return [
    { label: 'Winter solstice', doy: dayOfYear(12, 21, leap), key: 'dec' },
    { label: 'Equinox', doy: dayOfYear(3, 21, leap), key: 'mar' },
    { label: 'Summer solstice', doy: dayOfYear(6, 21, leap), key: 'jun' },
  ];
}

/**
 * How an hour index reads on screen. Hour h is the EPW record for h:00 to h+1:00,
 * and the views place the sun at its midpoint, so a label names both: the hour
 * the data covers and the time the sun is drawn for.
 */
function hourSpan(hour) {
  const hh = (h) => String(h).padStart(2, '0');
  return { range: `${hh(hour)}:00–${hh(hour + 1)}:00`, sunAt: `${hh(hour)}:30` };
}

export { sunPosition, sunVector, sunTimes, annualSunPositions, dayArc, analemma, keyDays, hourSpan };
export { dayOfYear, monthDayFromDoy, daysInMonth, refractionCorrection };
export { DEG, RAD, DAYS_IN_MONTH };
