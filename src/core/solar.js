/**
 * Solar position, following the NOAA General Solar Position Calculations.
 *
 * Angles are degrees at the API boundary and radians internally.
 * Azimuth is measured clockwise from true north (0 = N, 90 = E, 180 = S, 270 = W).
 * Altitude is degrees above the horizon; negative values are below it.
 *
 * Times are *local standard time* with no daylight-saving shift, matching the
 * EnergyPlus convention for EPW files.
 *
 * @version 1.0.0 — 2026-09-15
 */

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const DAYS_IN_MONTH_LEAP = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

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

  // Fractional year, radians.
  const gamma = (2 * Math.PI / 365) * (doy - 1 + (hour - 12) / 24);

  const eqTime = 229.18 * (
    0.000075
    + 0.001868 * Math.cos(gamma)
    - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma)
    - 0.040849 * Math.sin(2 * gamma)
  );

  const decl = 0.006918
    - 0.399912 * Math.cos(gamma)
    + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma)
    + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma)
    + 0.00148 * Math.sin(3 * gamma);

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

export { sunPosition, sunVector, sunTimes, annualSunPositions, dayArc, analemma, keyDays };
export { dayOfYear, monthDayFromDoy, daysInMonth, refractionCorrection };
export { DEG, RAD, DAYS_IN_MONTH };
