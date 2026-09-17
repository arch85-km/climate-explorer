/**
 * Analysis modes and the view registry.
 *
 * A mode is a teaching workflow: it decides which views are on the shelf, which
 * variable they open on, and which toolbar controls are relevant. Switching mode
 * reconfigures the whole instrument in one move, so a tutor can step a class
 * through a structured climate study without hunting through menus.
 *
 * @version 1.0.0 — 2026-09-17
 */

const VIEWS = [
  { id: 'heatmap', label: 'Annual heatmap', kind: '2d', hint: 'Every hour of the year as one picture' },
  { id: 'timeseries', label: 'Time series', kind: '2d', hint: 'Daily range and mean through the year' },
  { id: 'diurnal', label: 'Daily profiles', kind: '2d', hint: 'Average 24-hour curve for each month' },
  { id: 'monthly', label: 'Monthly statistics', kind: '2d', hint: 'Means with percentile whiskers' },
  { id: 'histogram', label: 'Distribution', kind: '2d', hint: 'How often each value occurs' },
  { id: 'psychrometric', label: 'Psychrometric chart', kind: '2d', hint: 'Comfort and passive strategies' },
  { id: 'windrose', label: 'Wind rose', kind: '2d', hint: 'Frequency by direction and speed' },
  { id: 'sunpath', label: 'Sun path (2D)', kind: '2d', hint: 'Stereographic and orthographic projections' },
  { id: 'sundome', label: 'Sun path dome', kind: '3d', hint: 'The sky hemisphere, orbitable' },
  { id: 'surface', label: 'Annual surface', kind: '3d', hint: 'The heatmap extruded into relief' },
  { id: 'windrose3d', label: 'Wind rose (3D)', kind: '3d', hint: 'Direction, speed and frequency at once' },
  { id: 'massing', label: 'Massing & shadows', kind: '3d', hint: 'A block casting the real sun shadow' },
];

const VIEW_BY_ID = Object.fromEntries(VIEWS.map((v) => [v.id, v]));

const MODES = [
  {
    id: 'thermal',
    label: 'Thermal',
    blurb: 'Temperature through the year, and how much heating or cooling it implies.',
    variable: 'dryBulb',
    views: ['heatmap', 'timeseries', 'diurnal', 'monthly', 'histogram', 'surface'],
    variables: ['dryBulb', 'dewPoint', 'wetBulb', 'relHumidity'],
    controls: ['variable', 'period', 'degreeDayBase', 'aggregation'],
  },
  {
    id: 'solar',
    label: 'Solar',
    blurb: 'Where the sun is, how much energy it delivers, and what it shades.',
    variable: 'globalHorizontal',
    views: ['sundome', 'sunpath', 'massing', 'heatmap', 'surface', 'monthly'],
    variables: ['globalHorizontal', 'directNormal', 'diffuseHorizontal', 'solarAltitude'],
    controls: ['variable', 'period', 'cursor', 'massing'],
  },
  {
    id: 'wind',
    label: 'Wind',
    blurb: 'Prevailing directions and speeds — the starting point for site massing.',
    variable: 'windSpeed',
    views: ['windrose', 'windrose3d', 'heatmap', 'timeseries', 'monthly', 'histogram'],
    variables: ['windSpeed', 'windDirection'],
    controls: ['period', 'sectors'],
  },
  {
    id: 'daylight',
    label: 'Daylight',
    blurb: 'Available daylight and sky conditions through the year.',
    variable: 'globalHorizontalIllum',
    views: ['heatmap', 'diurnal', 'monthly', 'sunpath', 'surface', 'timeseries'],
    variables: ['globalHorizontalIllum', 'diffuseHorizontalIllum', 'directNormalIllum', 'totalSkyCover'],
    controls: ['variable', 'period', 'aggregation'],
  },
  {
    id: 'comfort',
    label: 'Comfort',
    blurb: 'Which hours are comfortable, and which passive strategy could fix the rest.',
    variable: 'dryBulb',
    views: ['psychrometric', 'heatmap', 'histogram', 'monthly', 'diurnal'],
    variables: ['dryBulb', 'relHumidity', 'humidityRatio', 'enthalpy'],
    controls: ['period', 'strategies'],
  },
];

const MODE_BY_ID = Object.fromEntries(MODES.map((m) => [m.id, m]));

/** Views available in a mode, in the mode's own order. */
function viewsForMode(modeId) {
  const mode = MODE_BY_ID[modeId] || MODES[0];
  return mode.views.map((id) => VIEW_BY_ID[id]).filter(Boolean);
}

/** True when a control is relevant to the active mode (used to de-emphasise, not hide). */
function controlInMode(modeId, control) {
  const mode = MODE_BY_ID[modeId];
  return !mode || mode.controls.includes(control);
}

export { VIEWS, VIEW_BY_ID, MODES, MODE_BY_ID, viewsForMode, controlInMode };
