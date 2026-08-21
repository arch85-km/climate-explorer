/**
 * EPW hourly-record field registry.
 *
 * Field order and missing-value sentinels follow the EnergyPlus Auxiliary Programs
 * "EnergyPlus Weather File (EPW) Data Dictionary". Indices are 0-based positions in
 * the comma-separated hourly record:
 *   0 year, 1 month, 2 day, 3 hour(1-24), 4 minute, 5 source/uncertainty flags,
 *   6.. meteorological data.
 *
 * `missing` is the sentinel written by EnergyPlus when a value is absent. Values at or
 * above the sentinel are normalised to NaN by the parser (EPW writers are inconsistent,
 * e.g. illuminance uses both 999999 and 999900), so the threshold is treated as ">=".
 */

const C_TO_F = (v) => v * 9 / 5 + 32;
const DC_TO_DF = (v) => v * 9 / 5; // temperature *difference*, no offset

/** Every meteorological field the parser extracts, keyed by index. */
const FIELDS = [
  {
    index: 6, key: 'dryBulb', label: 'Dry bulb temperature', short: 'Dry bulb',
    unit: '°C', ipUnit: '°F', toIP: C_TO_F, missing: 99.9,
    ramp: 'temperature', agg: 'mean', decimals: 1,
    about: 'Air temperature measured by a thermometer shielded from radiation and moisture.',
  },
  {
    index: 7, key: 'dewPoint', label: 'Dew point temperature', short: 'Dew point',
    unit: '°C', ipUnit: '°F', toIP: C_TO_F, missing: 99.9,
    ramp: 'temperature', agg: 'mean', decimals: 1,
    about: 'Temperature at which the air becomes saturated; a direct measure of moisture content.',
  },
  {
    index: 8, key: 'relHumidity', label: 'Relative humidity', short: 'Rel. humidity',
    unit: '%', missing: 999, ramp: 'humidity', agg: 'mean', decimals: 0, min: 0, max: 100,
    about: 'Moisture in the air as a percentage of the maximum the air can hold at that temperature.',
  },
  {
    index: 9, key: 'pressure', label: 'Atmospheric station pressure', short: 'Pressure',
    unit: 'Pa', ipUnit: 'inHg', toIP: (v) => v * 0.0002953, missing: 999999,
    ramp: 'sequential', agg: 'mean', decimals: 0,
    about: 'Barometric pressure at the station, used in psychrometric calculations.',
  },
  {
    index: 10, key: 'extraterrestrialHorizontal', label: 'Extraterrestrial horizontal radiation',
    short: 'ET horizontal', unit: 'Wh/m²', ipUnit: 'Btu/ft²', toIP: (v) => v * 0.316998,
    missing: 9999, ramp: 'solar', agg: 'sum', decimals: 0, min: 0, secondary: true,
    about: 'Solar radiation on a horizontal surface at the top of the atmosphere.',
  },
  {
    index: 11, key: 'extraterrestrialDirectNormal', label: 'Extraterrestrial direct normal radiation',
    short: 'ET direct normal', unit: 'Wh/m²', ipUnit: 'Btu/ft²', toIP: (v) => v * 0.316998,
    missing: 9999, ramp: 'solar', agg: 'sum', decimals: 0, min: 0, secondary: true,
    about: 'Solar radiation normal to the sun at the top of the atmosphere.',
  },
  {
    index: 12, key: 'horizontalInfrared', label: 'Horizontal infrared radiation from sky',
    short: 'Sky infrared', unit: 'Wh/m²', ipUnit: 'Btu/ft²', toIP: (v) => v * 0.316998,
    missing: 9999, ramp: 'solar', agg: 'mean', decimals: 0, min: 0, secondary: true,
    about: 'Long-wave radiation from the sky, which drives night-time radiant cooling.',
  },
  {
    index: 13, key: 'globalHorizontal', label: 'Global horizontal radiation', short: 'Global horiz.',
    unit: 'Wh/m²', ipUnit: 'Btu/ft²', toIP: (v) => v * 0.316998, missing: 9999,
    ramp: 'solar', agg: 'sum', decimals: 0, min: 0,
    about: 'Total solar radiation (direct plus diffuse) falling on a horizontal surface.',
  },
  {
    index: 14, key: 'directNormal', label: 'Direct normal radiation', short: 'Direct normal',
    unit: 'Wh/m²', ipUnit: 'Btu/ft²', toIP: (v) => v * 0.316998, missing: 9999,
    ramp: 'solar', agg: 'sum', decimals: 0, min: 0,
    about: 'Beam radiation arriving normal to the sun. Drives shading design and glare.',
  },
  {
    index: 15, key: 'diffuseHorizontal', label: 'Diffuse horizontal radiation', short: 'Diffuse horiz.',
    unit: 'Wh/m²', ipUnit: 'Btu/ft²', toIP: (v) => v * 0.316998, missing: 9999,
    ramp: 'solar', agg: 'sum', decimals: 0, min: 0,
    about: 'Sky radiation scattered by the atmosphere. Dominates under overcast skies.',
  },
  {
    index: 16, key: 'globalHorizontalIllum', label: 'Global horizontal illuminance',
    short: 'Global illum.', unit: 'lux', ipUnit: 'fc', toIP: (v) => v * 0.092903, missing: 999900,
    ramp: 'daylight', agg: 'mean', decimals: 0, min: 0,
    about: 'Daylight on a horizontal surface, the basis of daylight-factor work.',
  },
  {
    index: 17, key: 'directNormalIllum', label: 'Direct normal illuminance', short: 'Direct illum.',
    unit: 'lux', ipUnit: 'fc', toIP: (v) => v * 0.092903, missing: 999900,
    ramp: 'daylight', agg: 'mean', decimals: 0, min: 0,
    about: 'Beam daylight normal to the sun.',
  },
  {
    index: 18, key: 'diffuseHorizontalIllum', label: 'Diffuse horizontal illuminance',
    short: 'Diffuse illum.', unit: 'lux', ipUnit: 'fc', toIP: (v) => v * 0.092903, missing: 999900,
    ramp: 'daylight', agg: 'mean', decimals: 0, min: 0,
    about: 'Daylight from the sky dome alone, excluding the sun.',
  },
  {
    index: 19, key: 'zenithLuminance', label: 'Zenith luminance', short: 'Zenith lum.',
    unit: 'cd/m²', missing: 9999, ramp: 'daylight', agg: 'mean', decimals: 0,
    min: 0, secondary: true,
    about: 'Brightness of the sky directly overhead.',
  },
  {
    index: 20, key: 'windDirection', label: 'Wind direction', short: 'Wind dir.',
    unit: '°', missing: 999, ramp: 'cyclic', agg: 'circular', decimals: 0, min: 0, max: 360,
    about: 'Direction the wind blows *from*, clockwise from true north. 0° is calm or north.',
  },
  {
    index: 21, key: 'windSpeed', label: 'Wind speed', short: 'Wind speed',
    unit: 'm/s', ipUnit: 'mph', toIP: (v) => v * 2.236936, missing: 999,
    ramp: 'wind', agg: 'mean', decimals: 1, min: 0,
    about: 'Wind speed at the standard 10 m meteorological height.',
  },
  {
    index: 22, key: 'totalSkyCover', label: 'Total sky cover', short: 'Total sky cover',
    unit: 'tenths', missing: 99, ramp: 'cloud', agg: 'mean', decimals: 0, min: 0, max: 10,
    about: 'Fraction of the sky dome covered by cloud, in tenths.',
  },
  {
    index: 23, key: 'opaqueSkyCover', label: 'Opaque sky cover', short: 'Opaque sky cover',
    unit: 'tenths', missing: 99, ramp: 'cloud', agg: 'mean', decimals: 0, min: 0, max: 10,
    about: 'Fraction of the sky covered by cloud that fully blocks the sun.',
  },
  {
    index: 24, key: 'visibility', label: 'Visibility', short: 'Visibility',
    unit: 'km', ipUnit: 'mi', toIP: (v) => v * 0.621371, missing: 9999,
    ramp: 'sequential', agg: 'mean', decimals: 1, min: 0, secondary: true,
    about: 'Horizontal visibility distance.',
  },
  {
    index: 25, key: 'ceilingHeight', label: 'Ceiling height', short: 'Ceiling height',
    unit: 'm', ipUnit: 'ft', toIP: (v) => v * 3.28084, missing: 99999,
    ramp: 'sequential', agg: 'mean', decimals: 0, min: 0, secondary: true,
    about: 'Height of the cloud base above ground.',
  },
  {
    index: 28, key: 'precipitableWater', label: 'Precipitable water', short: 'Precip. water',
    unit: 'mm', ipUnit: 'in', toIP: (v) => v * 0.0393701, missing: 999,
    ramp: 'humidity', agg: 'mean', decimals: 0, min: 0, secondary: true,
    about: 'Depth of water if all atmospheric vapour in the column condensed.',
  },
  {
    index: 29, key: 'aerosolOpticalDepth', label: 'Aerosol optical depth', short: 'Aerosol depth',
    unit: '', missing: 0.999, ramp: 'sequential', agg: 'mean', decimals: 3, min: 0, secondary: true,
    about: 'Atmospheric turbidity; higher values scatter more beam radiation.',
  },
  {
    index: 30, key: 'snowDepth', label: 'Snow depth', short: 'Snow depth',
    unit: 'cm', ipUnit: 'in', toIP: (v) => v * 0.393701, missing: 999,
    ramp: 'sequential', agg: 'mean', decimals: 0, min: 0, secondary: true,
    about: 'Depth of snow on the ground, which raises ground reflectance.',
  },
  {
    index: 32, key: 'albedo', label: 'Albedo', short: 'Albedo',
    unit: '', missing: 999, ramp: 'sequential', agg: 'mean', decimals: 2, min: 0, secondary: true,
    about: 'Ground reflectance, from 0 (black) to 1 (perfect mirror).',
  },
  {
    index: 33, key: 'liquidPrecipDepth', label: 'Liquid precipitation depth', short: 'Precipitation',
    unit: 'mm', ipUnit: 'in', toIP: (v) => v * 0.0393701, missing: 999,
    ramp: 'humidity', agg: 'sum', decimals: 1, min: 0, secondary: true,
    about: 'Rainfall depth in the hour.',
  },
];

/** Fast lookup by key, e.g. FIELD_BY_KEY.dryBulb */
const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

/** Variables offered in the main selector; the rest are available under "all variables". */
const PRIMARY_KEYS = FIELDS.filter((f) => !f.secondary).map((f) => f.key);

/** Derived series computed by the app rather than read from the file. */
const DERIVED_FIELDS = [
  {
    key: 'humidityRatio', label: 'Humidity ratio', short: 'Humidity ratio',
    unit: 'g/kg', ipUnit: 'gr/lb', toIP: (v) => v * 7, derived: true,
    ramp: 'humidity', agg: 'mean', decimals: 1, min: 0,
    about: 'Mass of water vapour per kilogram of dry air — unlike RH, it does not change with temperature.',
  },
  {
    key: 'enthalpy', label: 'Enthalpy', short: 'Enthalpy',
    unit: 'kJ/kg', ipUnit: 'Btu/lb', toIP: (v) => v * 0.429923, derived: true,
    ramp: 'temperature', agg: 'mean', decimals: 1,
    about: 'Total heat content of moist air, combining temperature and moisture.',
  },
  {
    key: 'wetBulb', label: 'Wet bulb temperature', short: 'Wet bulb',
    unit: '°C', ipUnit: '°F', toIP: C_TO_F, derived: true,
    ramp: 'temperature', agg: 'mean', decimals: 1,
    about: 'Lowest temperature reachable by evaporative cooling in this air.',
  },
  {
    key: 'solarAltitude', label: 'Solar altitude', short: 'Solar altitude',
    unit: '°', derived: true, ramp: 'solar', agg: 'mean', decimals: 1,
    about: 'Angle of the sun above the horizon. Negative values are night.',
  },
  {
    key: 'solarAzimuth', label: 'Solar azimuth', short: 'Solar azimuth',
    unit: '°', derived: true, ramp: 'cyclic', agg: 'circular', decimals: 1,
    about: 'Compass bearing of the sun, clockwise from true north.',
  },
];

const ALL_FIELDS = [...FIELDS, ...DERIVED_FIELDS];
const ALL_BY_KEY = Object.fromEntries(ALL_FIELDS.map((f) => [f.key, f]));

/** Convert a value in the field's native SI unit into the requested unit system. */
function convert(field, value, system) {
  if (!Number.isFinite(value)) return NaN;
  if (system !== 'ip' || !field.toIP) return value;
  return field.toIP(value);
}

/** Convert a *difference* (e.g. a standard deviation) — temperatures skip the offset. */
function convertDelta(field, value, system) {
  if (!Number.isFinite(value)) return NaN;
  if (system !== 'ip' || !field.toIP) return value;
  if (field.unit === '°C') return DC_TO_DF(value);
  return field.toIP(value);
}

function unitFor(field, system) {
  return system === 'ip' && field.ipUnit ? field.ipUnit : field.unit;
}

/** Format a native-unit value for display in the active unit system. */
function formatValue(field, value, system, opts = {}) {
  if (!Number.isFinite(value)) return '—';
  const v = opts.delta ? convertDelta(field, value, system) : convert(field, value, system);
  const decimals = opts.decimals != null ? opts.decimals : field.decimals;
  const text = v.toFixed(decimals);
  return opts.bare ? text : `${text} ${unitFor(field, system)}`.trim();
}

export { FIELDS, FIELD_BY_KEY, PRIMARY_KEYS, DERIVED_FIELDS, ALL_FIELDS, ALL_BY_KEY };
export { convert, convertDelta, unitFor, formatValue };
