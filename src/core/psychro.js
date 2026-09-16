/**
 * Psychrometrics, following ASHRAE Handbook of Fundamentals (Ch. 1) formulations.
 *
 * Temperatures are °C, pressures Pa, humidity ratio kg water / kg dry air,
 * enthalpy kJ/kg dry air.
 *
 * @version 1.0.0 — 2026-09-15
 */

const STANDARD_PRESSURE = 101325;

/** Standard atmospheric pressure at an altitude, ASHRAE eq. 3. */
function pressureAtElevation(metres) {
  return 101325 * (1 - 2.25577e-5 * metres) ** 5.2559;
}

/**
 * Saturation vapour pressure over water (t >= 0) or ice (t < 0).
 * ASHRAE eq. 5 and 6, with temperature in kelvin.
 */
function satPressure(t) {
  const T = t + 273.15;
  if (T <= 0) return 0;
  let ln;
  if (t < 0) {
    ln = -5674.5359 / T + 6.3925247 - 0.009677843 * T + 6.2215701e-7 * T * T
      + 2.0747825e-9 * T ** 3 - 9.484024e-13 * T ** 4 + 4.1635019 * Math.log(T);
  } else {
    ln = -5800.2206 / T + 1.3914993 - 0.048640239 * T + 4.1764768e-5 * T * T
      - 1.4452093e-8 * T ** 3 + 6.5459673 * Math.log(T);
  }
  return Math.exp(ln);
}

/** Humidity ratio from dry bulb and relative humidity (%). */
function humidityRatio(t, rh, p = STANDARD_PRESSURE) {
  if (!Number.isFinite(t) || !Number.isFinite(rh)) return NaN;
  const pw = Math.max(0, Math.min(rh, 100)) / 100 * satPressure(t);
  if (pw >= p) return NaN;
  return 0.621945 * pw / (p - pw);
}

/** Humidity ratio at saturation for a temperature. */
function satHumidityRatio(t, p = STANDARD_PRESSURE) {
  const pws = satPressure(t);
  if (pws >= p) return NaN;
  return 0.621945 * pws / (p - pws);
}

/** Relative humidity (%) from dry bulb and humidity ratio. */
function relHumidityFromW(t, w, p = STANDARD_PRESSURE) {
  if (!Number.isFinite(t) || !Number.isFinite(w)) return NaN;
  const pw = p * w / (0.621945 + w);
  const pws = satPressure(t);
  return pws > 0 ? Math.max(0, Math.min(100, 100 * pw / pws)) : NaN;
}

/** Moist-air enthalpy, kJ per kg of dry air. */
function enthalpy(t, w) {
  if (!Number.isFinite(t) || !Number.isFinite(w)) return NaN;
  return 1.006 * t + w * (2501 + 1.86 * t);
}

/** Dew point from humidity ratio, by inverting the saturation curve. */
function dewPointFromW(w, p = STANDARD_PRESSURE) {
  if (!Number.isFinite(w) || w <= 0) return NaN;
  const pw = p * w / (0.621945 + w);
  // Bisection on satPressure, which is monotonic in t.
  let lo = -100;
  let hi = 100;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (satPressure(mid) < pw) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Wet-bulb temperature, by bisection on the ASHRAE adiabatic-saturation relation
 * (eq. 33/35). Bracketed by dew point and dry bulb, between which the function
 * is monotonic.
 */
function wetBulb(t, w, p = STANDARD_PRESSURE) {
  if (!Number.isFinite(t) || !Number.isFinite(w) || w < 0) return NaN;
  const dp = dewPointFromW(w, p);
  if (!Number.isFinite(dp)) return NaN;
  let lo = Math.min(dp, t);
  let hi = t;
  const wAt = (tw) => {
    const ws = satHumidityRatio(tw, p);
    if (!Number.isFinite(ws)) return NaN;
    return tw >= 0
      ? ((2501 - 2.326 * tw) * ws - 1.006 * (t - tw)) / (2501 + 1.86 * t - 4.186 * tw)
      : ((2830 - 0.24 * tw) * ws - 1.006 * (t - tw)) / (2830 + 1.86 * t - 2.1 * tw);
  };
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (wAt(mid) < w) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Constant-enthalpy line: the humidity ratio at temperature t for a given enthalpy. */
function wForEnthalpy(t, h) {
  return (h - 1.006 * t) / (2501 + 1.86 * t);
}

/** Constant-wet-bulb line: humidity ratio at t for a given wet bulb. */
function wForWetBulb(t, tw, p = STANDARD_PRESSURE) {
  const ws = satHumidityRatio(tw, p);
  if (!Number.isFinite(ws)) return NaN;
  return tw >= 0
    ? ((2501 - 2.326 * tw) * ws - 1.006 * (t - tw)) / (2501 + 1.86 * t - 4.186 * tw)
    : ((2830 - 0.24 * tw) * ws - 1.006 * (t - tw)) / (2830 + 1.86 * t - 2.1 * tw);
}

/** Constant-RH curve, sampled across a temperature range. */
function rhCurve(rh, tMin, tMax, p = STANDARD_PRESSURE, steps = 80) {
  const pts = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = tMin + (tMax - tMin) * (i / steps);
    pts.push({ t, w: humidityRatio(t, rh, p) });
  }
  return pts;
}

/**
 * Comfort and passive-strategy polygons drawn on the psychrometric chart.
 *
 * The comfort zones follow ASHRAE 55 for still air at 50% RH, with the
 * conventional 0.012 kg/kg upper humidity limit. The passive-strategy polygons
 * follow the Givoni–Milne bioclimatic construction used by Ladybug and Climate
 * Consultant: they show which hours a strategy could bring into comfort.
 */
function comfortPolygons(p = STANDARD_PRESSURE, opts = {}) {
  const wMax = opts.humidityLimit != null ? opts.humidityLimit : 0.012;
  const wMin = 0.004;
  const winter = [19.5, 24.5];
  const summer = [22.5, 27.5];

  // A polygon whose top and bottom edges follow constant humidity ratio and whose
  // sides follow the comfort temperature limits.
  const box = (tLo, tHi) => [
    { t: tLo, w: wMin }, { t: tHi, w: wMin }, { t: tHi, w: wMax }, { t: tLo, w: wMax },
  ];

  const polygons = [
    { key: 'winter', label: 'Comfort — winter (1.0 clo)', kind: 'comfort', points: box(winter[0], winter[1]) },
    { key: 'summer', label: 'Comfort — summer (0.5 clo)', kind: 'comfort', points: box(summer[0], summer[1]) },
  ];

  if (opts.strategies !== false) {
    // Natural ventilation: comfort extends to higher temperature when air moves.
    polygons.push({
      key: 'ventilation',
      label: 'Natural ventilation',
      kind: 'strategy',
      points: [
        { t: summer[0], w: wMin }, { t: 32, w: wMin }, { t: 32, w: wMax }, { t: summer[0], w: wMax },
      ],
    });

    // Evaporative cooling: any state whose wet bulb can be driven into comfort.
    const evapWb = 21;
    const evap = [];
    for (let t = summer[1]; t <= 45; t += 1) {
      const w = wForWetBulb(t, evapWb, p);
      if (Number.isFinite(w) && w > 0.0005) evap.push({ t, w });
    }
    if (evap.length > 1) {
      polygons.push({
        key: 'evaporative',
        label: 'Evaporative cooling',
        kind: 'strategy',
        points: [{ t: summer[1], w: wMin }, ...evap.reverse(), { t: summer[1], w: wMax }].reverse(),
      });
    }

    // Internal gains: cool but dry hours a building's own heat can lift into comfort.
    polygons.push({
      key: 'internalGains',
      label: 'Internal heat gain',
      kind: 'strategy',
      points: [
        { t: 12.5, w: wMin }, { t: winter[0], w: wMin },
        { t: winter[0], w: wMax }, { t: 12.5, w: wMax },
      ],
    });
  }

  return polygons;
}

/** True when a point lies inside a polygon, by the even-odd ray rule. */
function pointInPolygon(t, w, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i];
    const b = points[j];
    if ((a.w > w) !== (b.w > w)
      && t < ((b.t - a.t) * (w - a.w)) / (b.w - a.w) + a.t) {
      inside = !inside;
    }
  }
  return inside;
}

/*
 * The two functions below implement ASHRAE 55 adaptive comfort. NO VIEW CALLS
 * THEM — there is no adaptive comfort in the shipped interface, and the Method
 * Notes say so. They are kept because the arithmetic is correct and needs only
 * the weather file, which makes adaptive comfort the one comfort model this tool
 * could compute honestly; `dataset.js` already derives the daily means
 * `runningMean` wants. Wiring them up is a deliberate feature, not a tidy-up:
 * it needs a toggle, a day-varying band on the time series, and a revision of
 * the Method Notes, which document their absence in several places.
 */

/**
 * ASHRAE 55 adaptive comfort band for a prevailing mean outdoor temperature.
 * Valid for 10 °C <= prevailing <= 33.5 °C.
 */
function adaptiveComfort(prevailingMean) {
  const t = Math.max(10, Math.min(33.5, prevailingMean));
  const neutral = 0.31 * t + 17.8;
  return {
    neutral,
    lo80: neutral - 3.5,
    hi80: neutral + 3.5,
    lo90: neutral - 2.5,
    hi90: neutral + 2.5,
    inRange: prevailingMean >= 10 && prevailingMean <= 33.5,
  };
}

/**
 * ASHRAE 55 prevailing mean outdoor temperature: an exponentially weighted
 * running mean of daily mean temperatures, alpha = 0.8.
 */
function runningMean(dailyMeans, alpha = 0.8) {
  const n = dailyMeans.length;
  const out = new Float32Array(n);
  if (!n) return out;
  // Seed with the mean of the trailing week so January is not biased by a cold start.
  let seed = 0;
  let count = 0;
  for (let i = Math.max(0, n - 7); i < n; i += 1) {
    if (Number.isFinite(dailyMeans[i])) { seed += dailyMeans[i]; count += 1; }
  }
  let prev = count ? seed / count : 0;
  for (let i = 0; i < n; i += 1) {
    const today = Number.isFinite(dailyMeans[i]) ? dailyMeans[i] : prev;
    prev = (1 - alpha) * today + alpha * prev;
    out[i] = prev;
  }
  return out;
}

export { STANDARD_PRESSURE, pressureAtElevation, satPressure, humidityRatio, satHumidityRatio };
export { relHumidityFromW, enthalpy, dewPointFromW, wetBulb, wForEnthalpy, wForWetBulb };
export { rhCurve, comfortPolygons, pointInPolygon, adaptiveComfort, runningMean };
