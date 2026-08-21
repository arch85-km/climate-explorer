/**
 * Shared scaffolding for the 2D charts: device-pixel-ratio handling, scales,
 * tick generation, axes, legends and hit-testing.
 *
 * Every chart draws through this module so that typography, spacing and grid
 * weight stay identical across views — which is what makes a set of charts read
 * as one instrument rather than eight unrelated pictures.
 */

const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/** Read the theme's drawing tokens off the root element. */
function readTheme(root) {
  const cs = getComputedStyle(root);
  const get = (name, fallback) => (cs.getPropertyValue(name) || '').trim() || fallback;
  return {
    surface: get('--surface-1', '#ffffff'),
    surfaceRaised: get('--surface-2', '#f6f6f4'),
    ink1: get('--ink-1', '#111111'),
    ink2: get('--ink-2', '#555555'),
    ink3: get('--ink-3', '#888888'),
    grid: get('--grid', 'rgba(0,0,0,0.09)'),
    gridStrong: get('--grid-strong', 'rgba(0,0,0,0.18)'),
    axis: get('--axis', 'rgba(0,0,0,0.35)'),
    accent: get('--accent', '#2a78d6'),
    accent2: get('--accent-2', '#eb6834'),
    series: [1, 2, 3, 4, 5, 6].map((i) => get(`--series-${i}`, '#2a78d6')),
    night: get('--night', 'rgba(0,0,0,0.05)'),
  };
}

/**
 * Size a canvas to its CSS box at the device pixel ratio.
 * @returns {boolean} true when the backing store changed size
 */
function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width === w && canvas.height === h) return false;
  canvas.width = w;
  canvas.height = h;
  return true;
}

/**
 * A drawing surface: the canvas context pre-scaled to CSS pixels, plus the plot
 * rectangle inside the margins.
 */
function beginFrame(canvas, root, margins = {}) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const m = {
    top: margins.top != null ? margins.top : 28,
    right: margins.right != null ? margins.right : 20,
    bottom: margins.bottom != null ? margins.bottom : 40,
    left: margins.left != null ? margins.left : 58,
  };
  return {
    ctx,
    canvas,
    width,
    height,
    dpr,
    margins: m,
    plot: {
      x: m.left,
      y: m.top,
      w: Math.max(1, width - m.left - m.right),
      h: Math.max(1, height - m.top - m.bottom),
      get right() { return this.x + this.w; },
      get bottom() { return this.y + this.h; },
    },
    theme: readTheme(root),
    font(size, weight = 400) {
      ctx.font = `${weight} ${size}px ${FONT_STACK}`;
    },
  };
}

/** Linear scale from a data domain to a pixel range. */
function scaleLinear(d0, d1, r0, r1) {
  const span = d1 - d0 || 1;
  const fn = (v) => r0 + ((v - d0) / span) * (r1 - r0);
  fn.invert = (px) => d0 + ((px - r0) / (r1 - r0 || 1)) * span;
  fn.domain = [d0, d1];
  fn.range = [r0, r1];
  return fn;
}

/**
 * "Nice" tick values at 1/2/2.5/5 x 10^n intervals covering [min, max].
 */
function niceTicks(min, max, target = 6) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const raw = (max - min) / Math.max(1, target);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  let step;
  if (norm <= 1) step = 1;
  else if (norm <= 2) step = 2;
  else if (norm <= 2.5) step = 2.5;
  else if (norm <= 5) step = 5;
  else step = 10;
  step *= mag;
  const first = Math.ceil(min / step) * step;
  const ticks = [];
  for (let v = first; v <= max + step * 1e-6; v += step) {
    // Re-round to kill floating-point drift like 0.30000000000000004.
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : +v.toPrecision(12));
  }
  return ticks;
}

/** Expand a domain outward to nice round bounds. */
function niceDomain(min, max, target = 6) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) return [min - 0.5, max + 0.5];
  const raw = (max - min) / Math.max(1, target);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  let step;
  if (norm <= 1) step = 1;
  else if (norm <= 2) step = 2;
  else if (norm <= 2.5) step = 2.5;
  else if (norm <= 5) step = 5;
  else step = 10;
  step *= mag;
  return [Math.floor(min / step) * step, Math.ceil(max / step) * step];
}

/** Format a tick, choosing decimals from the step size rather than the value. */
function tickLabel(v, ticks) {
  if (!Number.isFinite(v)) return '';
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : Math.abs(v) || 1;
  if (Math.abs(v) >= 10000) return `${Math.round(v / 1000)}k`;
  const decimals = step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step)));
  return v.toFixed(decimals);
}

/** Horizontal gridlines plus a left value axis. */
function drawValueAxis(s, y, opts = {}) {
  const { ctx, plot, theme } = s;
  const ticks = opts.ticks || niceTicks(y.domain[0], y.domain[1], opts.target || 6);
  ctx.save();
  s.font(11);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of ticks) {
    const py = Math.round(y(t)) + 0.5;
    if (py < plot.y - 1 || py > plot.bottom + 1) continue;
    ctx.strokeStyle = (opts.zeroLine && t === 0) ? theme.gridStrong : theme.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plot.x, py);
    ctx.lineTo(plot.right, py);
    ctx.stroke();
    ctx.fillStyle = theme.ink3;
    ctx.fillText(opts.format ? opts.format(t) : tickLabel(t, ticks), plot.x - 8, py);
  }
  if (opts.label) {
    ctx.save();
    ctx.translate(12, plot.y + plot.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    s.font(11, 500);
    ctx.fillStyle = theme.ink2;
    ctx.fillText(opts.label, 0, 0);
    ctx.restore();
  }
  ctx.restore();
  return ticks;
}

/** Bottom category or value axis. */
function drawBottomAxis(s, entries, opts = {}) {
  const { ctx, plot, theme } = s;
  ctx.save();
  s.font(11);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = theme.ink3;
  for (const e of entries) {
    if (e.x < plot.x - 1 || e.x > plot.right + 1) continue;
    if (opts.gridlines) {
      ctx.strokeStyle = e.strong ? theme.gridStrong : theme.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(e.x) + 0.5, plot.y);
      ctx.lineTo(Math.round(e.x) + 0.5, plot.bottom);
      ctx.stroke();
    }
    if (e.label) ctx.fillText(e.label, e.x, plot.bottom + 7);
  }
  if (opts.label) {
    s.font(11, 500);
    ctx.fillStyle = theme.ink2;
    ctx.fillText(opts.label, plot.x + plot.w / 2, plot.bottom + 24);
  }
  ctx.restore();
}

/** A thin frame around the plot area. */
function drawPlotFrame(s) {
  const { ctx, plot, theme } = s;
  ctx.save();
  ctx.strokeStyle = theme.axis;
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(plot.x) + 0.5, Math.round(plot.y) + 0.5, Math.round(plot.w), Math.round(plot.h));
  ctx.restore();
}

/** Chart title and subtitle, drawn in the top margin. */
function drawTitle(s, title, subtitle) {
  const { ctx, theme, margins } = s;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  s.font(13, 600);
  ctx.fillStyle = theme.ink1;
  // Measure with the title's OWN font, before switching to the subtitle's.
  const titleWidth = ctx.measureText(title).width;
  ctx.fillText(title, margins.left, 16);
  if (subtitle) {
    const x = margins.left + titleWidth + 12;
    const available = s.width - margins.right - x;
    // Below this there is no room for a subtitle worth reading; drop it entirely.
    if (available > 90) {
      s.font(11, 400);
      ctx.fillStyle = theme.ink3;
      ctx.fillText(fitText(ctx, subtitle, available), x, 16);
    }
  }
  ctx.restore();
}

/**
 * A continuous colour legend. Returns its bounding box so callers can avoid it.
 */
function drawColorbar(s, ramp, scale, min, max, opts = {}) {
  const { ctx, theme } = s;
  const x = opts.x != null ? opts.x : s.plot.right + 12;
  const y = opts.y != null ? opts.y : s.plot.y;
  const w = opts.w || 12;
  const h = opts.h || s.plot.h;
  const steps = 64;
  ctx.save();
  for (let i = 0; i < steps; i += 1) {
    const t = 1 - i / (steps - 1);
    ctx.fillStyle = ramp.css(t);
    ctx.fillRect(x, y + (i * h) / steps, w, h / steps + 1);
  }
  ctx.strokeStyle = theme.axis;
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, w, h);

  s.font(10);
  ctx.fillStyle = theme.ink3;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const ticks = opts.ticks || niceTicks(min, max, 5);
  for (const t of ticks) {
    const frac = scale(t);
    if (!Number.isFinite(frac)) continue;
    const py = y + h - frac * h;
    if (py < y - 1 || py > y + h + 1) continue;
    ctx.beginPath();
    ctx.moveTo(x + w, py);
    ctx.lineTo(x + w + 3, py);
    ctx.stroke();
    ctx.fillText(opts.format ? opts.format(t) : tickLabel(t, ticks), x + w + 6, py);
  }
  if (opts.label) {
    ctx.save();
    ctx.translate(x - 4, y + h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    s.font(10, 500);
    ctx.fillStyle = theme.ink2;
    ctx.fillText(opts.label, 0, 0);
    ctx.restore();
  }
  ctx.restore();
  return { x, y, w, h };
}

/** A swatch-and-label legend laid out in a row, wrapping if needed. */
function drawLegend(s, items, opts = {}) {
  const { ctx, theme } = s;
  const x0 = opts.x != null ? opts.x : s.plot.x;
  const y0 = opts.y != null ? opts.y : s.plot.bottom + 30;
  const maxW = opts.maxWidth || s.plot.w;
  ctx.save();
  s.font(11);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  let x = x0;
  let y = y0;
  for (const item of items) {
    const label = item.label;
    const tw = ctx.measureText(label).width;
    const itemW = 14 + tw + 16;
    if (x + itemW > x0 + maxW && x > x0) { x = x0; y += 16; }
    if (item.dash) {
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 2;
      ctx.setLineDash(item.dash === true ? [4, 3] : item.dash);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 10, y);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = item.color;
      roundRect(ctx, x, y - 4, 10, 8, 2);
      ctx.fill();
    }
    ctx.fillStyle = theme.ink2;
    ctx.fillText(label, x + 14, y);
    x += itemW;
  }
  ctx.restore();
  return { height: y - y0 + 16 };
}

/** Rounded rectangle path (data-ends are rounded at 4px per the house style). */
function roundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

/** A message drawn in the middle of the plot when there is nothing to show. */
function drawEmpty(s, message) {
  const { ctx, plot, theme } = s;
  ctx.save();
  s.font(12);
  ctx.fillStyle = theme.ink3;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(message, plot.x + plot.w / 2, plot.y + plot.h / 2);
  ctx.restore();
}

/** Truncate a string to fit a pixel width, appending an ellipsis. */
function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid; else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

/** Parse a #rgb / #rrggbb token into [r,g,b]. */
function hexRgb(hex, fallback = [255, 255, 255]) {
  const m = String(hex).trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return fallback;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Clip subsequent drawing to the plot rectangle. */
function clipPlot(s) {
  const { ctx, plot } = s;
  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.x, plot.y, plot.w, plot.h);
  ctx.clip();
}

export { FONT_STACK, readTheme, fitCanvas, beginFrame, scaleLinear, niceTicks, niceDomain };
export { tickLabel, drawValueAxis, drawBottomAxis, drawPlotFrame, drawTitle, drawColorbar };
export { drawLegend, roundRect, drawEmpty, fitText, clipPlot, hexRgb };
