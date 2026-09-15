import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawColorbar, drawValueAxis, scaleLinear, niceTicks } from '../src/render/canvas2d.js';
import { makeRamp } from '../src/render/colormaps.js';

/**
 * A canvas context stub that records what was drawn and the transform in force at
 * the time. Lets the drawing code be asserted directly, instead of by scraping
 * pixels out of a screenshot — which cannot tell a label apart from a plot frame.
 */
function stubFrame({ width = 900, height = 500, margins } = {}) {
  const m = margins || { top: 30, right: 88, bottom: 42, left: 52 };
  const ops = [];
  // Only translation and rotation are used by the drawing code, so tracking those
  // two is enough to know where a label actually lands.
  let rotation = 0;
  let ox = 0;
  let oy = 0;
  const stack = [];
  const ctx = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    textAlign: 'start',
    textBaseline: 'alphabetic',
    save() { stack.push([rotation, ox, oy]); },
    restore() { [rotation, ox, oy] = stack.pop() || [0, 0, 0]; },
    translate(dx, dy) { ox += dx; oy += dy; },
    rotate(r) { rotation += r; },
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, closePath() {},
    fillRect() {}, strokeRect() {}, arc() {}, arcTo() {}, fill() {}, clip() {}, rect() {},
    setLineDash() {}, drawImage() {},
    measureText: (t) => ({ width: String(t).length * 6 }),
    fillText(text, x, y) {
      // Rotated text is anchored at the translated origin; unrotated text offsets
      // from it. Either way the origin is what matters for placement.
      ops.push({
        text: String(text),
        x: rotation ? ox : ox + x,
        y: rotation ? oy : oy + y,
        rotation,
        align: ctx.textAlign,
        baseline: ctx.textBaseline,
      });
    },
    setTransform() {}, clearRect() {}, createImageData() {}, putImageData() {}, getImageData() {},
  };
  return {
    ops,
    frame: {
      ctx,
      canvas: { width, height },
      width,
      height,
      dpr: 1,
      margins: m,
      plot: {
        x: m.left,
        y: m.top,
        w: width - m.left - m.right,
        h: height - m.top - m.bottom,
        get right() { return this.x + this.w; },
        get bottom() { return this.y + this.h; },
      },
      theme: {
        surface: '#ffffff', surfaceRaised: '#f0f0f0', ink1: '#111', ink2: '#555', ink3: '#888',
        grid: '#eee', gridStrong: '#ddd', axis: '#999', accent: '#2a78d6', accent2: '#eb6834',
        series: ['#1', '#2', '#3', '#4', '#5', '#6'], night: '#eee',
      },
      font() {},
    },
  };
}

const RAMP = makeRamp(['#cde2fb', '#2a78d6', '#0d366b']);

test('the colour-scale caption sits above the strip, not rotated beside it', () => {
  const { ops, frame } = stubFrame();
  const barX = frame.plot.right + 14;
  drawColorbar(frame, RAMP, (v) => v / 40, 0, 40, { x: barX, label: '°C' });

  const caption = ops.find((o) => o.text === '°C');
  assert.ok(caption, 'the caption was drawn');
  // Never rotated: rotating it into the gap between plot and strip is what put it
  // in contact with both.
  assert.equal(caption.rotation, 0, 'the caption must not be rotated');
  // Above the strip, which starts at plot.y.
  assert.ok(caption.y < frame.plot.y, `caption y ${caption.y} should sit above the strip top ${frame.plot.y}`);
  // Belongs to the strip: aligned with its left edge, not stranded at the canvas
  // edge and not reaching back into the gap beside the chart.
  assert.equal(caption.align, 'left');
  assert.equal(caption.x, barX, 'a short caption sits directly above the strip');
  assert.ok(caption.x > frame.plot.right, 'the caption never intrudes on the chart');
});

test('a long caption is right-aligned so it runs into the free top margin', () => {
  const { ops, frame } = stubFrame();
  const label = 'Global horiz. (Wh/m²)';
  drawColorbar(frame, RAMP, (v) => v / 900, 0, 900, { x: frame.plot.right + 10, label });
  const caption = ops.find((o) => o.text === label);
  assert.ok(caption);
  assert.equal(caption.align, 'left');
  assert.equal(caption.rotation, 0);
  // Too wide to start at the strip, so it is pulled left — but only as far as
  // needed, and it keeps a margin from the canvas edge rather than hugging it.
  const captionW = label.length * 6; // the stub's measureText
  assert.ok(caption.x < frame.plot.right + 10, 'a long caption is pulled left of the strip');
  const rightEdgeGap = frame.width - (caption.x + captionW);
  assert.ok(rightEdgeGap >= 8 && rightEdgeGap <= 14,
    `long caption should end 8-14px from the edge, ended ${rightEdgeGap}px`);
});

test('the value-axis title tracks its tick labels instead of a fixed offset', () => {
  // Narrow ticks (0-30) and wide ticks (0-100000) must place the title differently,
  // otherwise it is stranded far from the numbers on one of them.
  const narrow = stubFrame();
  drawValueAxis(narrow.frame, scaleLinear(0, 30, 458, 30), { label: 'Humidity ratio' });
  const wide = stubFrame();
  drawValueAxis(wide.frame, scaleLinear(0, 100000, 458, 30), { label: 'Illuminance' });

  const nx = narrow.ops.find((o) => o.text === 'Humidity ratio').x;
  const wx = wide.ops.find((o) => o.text === 'Illuminance').x;
  assert.ok(nx > wx, `narrow-tick title (${nx}) should sit further right than wide-tick (${wx})`);
  assert.ok(nx >= 11, 'the title stays inside the canvas');
});


// ── export resolution ───────────────────────────────────────────────────────────

test('chart layout is identical at any render scale', () => {
  // This is the property that makes a high-resolution export a true re-render
  // rather than an upscale: every view works in logical units, so raising the pixel
  // density must move nothing. If layout drifted with scale, the exported image
  // would not match what is on screen.
  const place = (scale) => {
    const { ops, frame } = stubFrame();
    frame.dpr = scale;
    drawValueAxis(frame, scaleLinear(0, 30, 458, 30), { label: 'Humidity ratio' });
    drawColorbar(frame, RAMP, (v) => v / 40, 0, 40, { x: frame.plot.right + 14, label: '°C' });
    return {
      plot: { x: frame.plot.x, y: frame.plot.y, w: frame.plot.w, h: frame.plot.h },
      text: ops.map((o) => `${o.text}@${Math.round(o.x)},${Math.round(o.y)}`),
    };
  };
  const at1 = place(1);
  const at3 = place(3);
  assert.deepEqual(at3.plot, at1.plot, 'the plot rectangle must not move with scale');
  assert.deepEqual(at3.text, at1.text, 'every label must land in the same logical spot');
});

test('beginFrame honours an explicit renderScale over the display density', async () => {
  // Exercises the real beginFrame against a minimal canvas stub, since this is the
  // single hook the export relies on.
  const { beginFrame } = await import('../src/render/canvas2d.js');
  const calls = [];
  const makeCanvas = (renderScale, w, h) => ({
    width: w,
    height: h,
    renderScale,
    getBoundingClientRect: () => ({ width: 600, height: 400 }),
    getContext: () => ({
      setTransform: (...a) => calls.push(a),
      clearRect() {}, save() {}, restore() {}, fillText() {}, measureText: () => ({ width: 10 }),
      beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillRect() {}, strokeRect() {},
      translate() {}, rotate() {}, arcTo() {}, closePath() {}, fill() {}, clip() {}, rect() {},
      setLineDash() {}, arc() {},
    }),
  });
  const root = { }; // readTheme falls back to defaults when getComputedStyle is absent
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });

  const at3 = beginFrame(makeCanvas(3, 1800, 1200), root, {});
  assert.equal(at3.width, 600, 'logical width stays the CSS width');
  assert.equal(at3.height, 400, 'logical height stays the CSS height');
  assert.deepEqual(calls.at(-1), [3, 0, 0, 3, 0, 0], 'the context is scaled by renderScale');

  const at1 = beginFrame(makeCanvas(0, 600, 400), root, {});
  assert.equal(at1.width, 600, 'without an override it falls back to devicePixelRatio');
  assert.deepEqual(calls.at(-1), [1, 0, 0, 1, 0, 0]);
});
