/**
 * Wraps a parsed EPW file with the series the app derives rather than reads:
 * solar position for every hour, and the psychrometric quantities the comfort
 * views need. Computed once on load so view switching stays instant.
 */
import { annualSunPositions } from './solar.js';
import { humidityRatio, enthalpy, wetBulb, pressureAtElevation } from './psychro.js';
import { ALL_BY_KEY } from '../epw/fields.js';
import { dailyAggregate } from './stats.js';

/**
 * @param {object} parsed result of parseEpw
 * @returns {object} the same object, with derived series added to `series`
 */
function buildDataset(parsed) {
  const { location, n } = parsed;

  const sun = annualSunPositions(location, parsed.month, parsed.day, parsed.hour, n, parsed.isLeap);
  parsed.series.solarAltitude = sun.altitude;
  parsed.series.solarAzimuth = sun.azimuth;

  // Station pressure is recorded hourly, but fall back to elevation when it is missing.
  const fallbackPressure = pressureAtElevation(location.elevation || 0);
  const pressure = parsed.series.pressure;

  const w = new Float32Array(n);
  const h = new Float32Array(n);
  const wb = new Float32Array(n);
  const dryBulb = parsed.series.dryBulb;
  const rh = parsed.series.relHumidity;

  for (let i = 0; i < n; i += 1) {
    const t = dryBulb[i];
    const r = rh[i];
    const p = Number.isFinite(pressure[i]) ? pressure[i] : fallbackPressure;
    if (!Number.isFinite(t) || !Number.isFinite(r)) {
      w[i] = NaN; h[i] = NaN; wb[i] = NaN;
      continue;
    }
    const wi = humidityRatio(t, r, p);
    w[i] = wi;
    h[i] = enthalpy(t, wi);
    wb[i] = wetBulb(t, wi, p);
  }
  // Humidity ratio is stored in g/kg because that is how it is read on a chart.
  parsed.series.humidityRatio = Float32Array.from(w, (v) => v * 1000);
  parsed.series.enthalpy = h;
  parsed.series.wetBulb = wb;

  parsed.pressureFallback = fallbackPressure;
  parsed.daily = {
    dryBulbMean: dailyAggregate(parsed, dryBulb, 'mean').values,
  };

  parsed.availableKeys = Object.keys(parsed.series).filter((key) => {
    if (!ALL_BY_KEY[key]) return false;
    const arr = parsed.series[key];
    for (let i = 0; i < arr.length; i += 1) if (Number.isFinite(arr[i])) return true;
    return false;
  });

  return parsed;
}

/** The series for a key, or null when the file does not contain it. */
function seriesFor(data, key) {
  return data && data.series[key] ? data.series[key] : null;
}

export { buildDataset, seriesFor };
