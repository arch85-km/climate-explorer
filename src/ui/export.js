/**
 * Export: a PNG of whatever is on screen, and a CSV of the aggregated data
 * behind it. Students need both — one for the crit wall, one for a spreadsheet.
 */
import { MONTH_ABBR, locationLabel } from '../epw/parse.js';
import { monthlyStats, diurnalByMonth, dailyAggregate, windRose } from '../core/stats.js';
import { unitFor, convert } from '../epw/fields.js';
import { describePeriod } from '../core/filter.js';

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function safeName(text) {
  return String(text).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'export';
}

/**
 * Compose the visible view into a PNG at 2x, with a caption bar so the image
 * still says which climate and which period it came from once it leaves the app.
 */
function exportPng(stage, context, state) {
  const source = stage.is3d ? stage.scene?.canvas : stage.canvas;
  if (!source) return;
  const overlay = stage.is3d ? stage.scene?.overlay : null;

  const scale = 2;
  const w = source.width;
  const h = source.height;
  const captionH = Math.round(52 * (w / 1200 || 1) * 0.9) + 24;

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h + captionH;
  const ctx = out.getContext('2d');

  const styles = getComputedStyle(stage.surface);
  ctx.fillStyle = styles.getPropertyValue('--surface-1').trim() || '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(source, 0, 0);
  if (overlay) ctx.drawImage(overlay, 0, 0, w, h);

  const ink1 = styles.getPropertyValue('--ink-1').trim() || '#111';
  const ink3 = styles.getPropertyValue('--ink-3').trim() || '#888';
  const font = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  const base = Math.max(11, Math.round(w / 90));
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = ink1;
  ctx.font = `600 ${base}px ${font}`;
  const title = context ? `${context.field.label} — ${locationLabel(context.data.location)}` : 'EPW climate data';
  ctx.fillText(title, 24, h + base + 14);
  ctx.fillStyle = ink3;
  ctx.font = `400 ${Math.round(base * 0.82)}px ${font}`;
  const sub = context
    ? `${describePeriod(context.period, context.data.isLeap)} · ${state.fileName || 'EPW file'}`
    : '';
  ctx.fillText(sub, 24, h + base * 2 + 16);

  out.toBlob((blob) => {
    if (blob) download(blob, `${safeName(context ? locationLabel(context.data.location) : 'climate')}-${stage.activeId}.png`);
  }, 'image/png');
}

function toCsv(rows) {
  return rows.map((row) => row.map((cell) => {
    const text = cell == null || (typeof cell === 'number' && !Number.isFinite(cell)) ? '' : String(cell);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(',')).join('\n');
}

/** CSV matched to the active view, so what is exported is what is on screen. */
function exportCsv(viewId, context, state) {
  if (!context) return;
  const { data, field, values, mask } = context;
  const u = state.units;
  const unit = unitFor(field, u);
  const conv = (v) => (Number.isFinite(v) ? +convert(field, v, u).toFixed(4) : '');
  const header = [
    `# EPW climate data export — ${locationLabel(data.location)}`,
    `# ${data.location.latitude}, ${data.location.longitude}, elevation ${data.location.elevation} m`,
    `# Variable: ${field.label} (${unit})`,
    `# Period: ${describePeriod(context.period, data.isLeap)}`,
    `# Source file: ${state.fileName || 'unknown'}`,
  ].join('\n');

  let rows;
  let suffix;
  if (viewId === 'monthly') {
    const st = monthlyStats(data, values, mask);
    rows = [['month', `mean (${unit})`, `median (${unit})`, `p5 (${unit})`, `p25 (${unit})`,
      `p75 (${unit})`, `p95 (${unit})`, `min (${unit})`, `max (${unit})`, 'hours']];
    st.forEach((s, m) => rows.push([MONTH_ABBR[m], conv(s.mean), conv(s.p[50]), conv(s.p[5]),
      conv(s.p[25]), conv(s.p[75]), conv(s.p[95]), conv(s.min), conv(s.max), s.count || 0]));
    suffix = 'monthly';
  } else if (viewId === 'diurnal') {
    const grid = diurnalByMonth(data, values, mask);
    rows = [['hour', ...MONTH_ABBR.map((m) => `${m} (${unit})`)]];
    for (let h = 0; h < 24; h += 1) {
      rows.push([h, ...Array.from({ length: 12 }, (_, m) => conv(grid[m * 24 + h]))]);
    }
    suffix = 'diurnal';
  } else if (viewId === 'windrose' || viewId === 'windrose3d') {
    const rose = windRose(data, mask, { sectors: state.stats.sectors || 16 });
    rows = [['direction', ...rose.speedBands.map((b, i) => {
      const hi = rose.speedBands[i + 1];
      return hi == null ? `>= ${b} m/s (hours)` : `${b}-${hi} m/s (hours)`;
    }), 'total hours', 'share %']];
    for (let s = 0; s < rose.sectors; s += 1) {
      rows.push([rose.labels[s],
        ...Array.from({ length: rose.bandCount }, (_, b) => rose.counts[s * rose.bandCount + b]),
        rose.sectorTotals[s],
        +((rose.sectorTotals[s] / rose.total) * 100).toFixed(3)]);
    }
    rows.push(['Calm', ...Array(rose.bandCount).fill(''), rose.calm, +((rose.calmFraction) * 100).toFixed(3)]);
    suffix = 'windrose';
  } else if (viewId === 'timeseries') {
    const daily = dailyAggregate(data, values, 'mean', null);
    rows = [['month', 'day', `mean (${unit})`, `min (${unit})`, `max (${unit})`, 'hours', 'in period']];
    for (let d = 0; d < data.nDays; d += 1) {
      const key = data.dayKeys[d];
      let inPeriod = 0;
      for (let hh = 0; hh < 24; hh += 1) {
        const rec = data.grid[d * 24 + hh];
        if (rec >= 0 && mask[rec]) inPeriod += 1;
      }
      rows.push([key.month, key.day, conv(daily.values[d]), conv(daily.min[d]), conv(daily.max[d]),
        daily.counts[d], inPeriod]);
    }
    suffix = 'daily';
  } else {
    // Every other view is ultimately reading the hourly record, so export that.
    rows = [['month', 'day', 'hour', `${field.key} (${unit})`, 'in period']];
    for (let i = 0; i < data.n; i += 1) {
      rows.push([data.month[i], data.day[i], data.hour[i], conv(values[i]), mask[i] ? 1 : 0]);
    }
    suffix = 'hourly';
  }

  const csv = `${header}\n${toCsv(rows)}\n`;
  download(new Blob([csv], { type: 'text/csv;charset=utf-8' }),
    `${safeName(locationLabel(data.location))}-${safeName(field.key)}-${suffix}.csv`);
}

export { exportPng, exportCsv, download, safeName };
