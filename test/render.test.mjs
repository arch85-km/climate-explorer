import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawColorbar, drawValueAxis, scaleLinear } from '../src/render/canvas2d.js';
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
  // And clear of the chart: nothing of it may reach back into the gap column.
  assert.equal(caption.align, 'right');
  assert.ok(caption.x <= frame.width, 'the caption stays inside the canvas');
  assert.ok(caption.x > barX, 'the caption is anchored beyond the strip, not before it');
});

test('a long caption is right-aligned so it runs into the free top margin', () => {
  const { ops, frame } = stubFrame();
  const label = 'Global horiz. (Wh/m²)';
  drawColorbar(frame, RAMP, (v) => v / 900, 0, 900, { x: frame.plot.right + 10, label });
  const caption = ops.find((o) => o.text === label);
  assert.ok(caption);
  assert.equal(caption.align, 'right');
  assert.equal(caption.rotation, 0);
  // Right-aligned at the canvas edge, so its left end runs back over empty margin
  // rather than being clipped.
  assert.ok(frame.width - caption.x <= 8, `caption anchored ${frame.width - caption.x}px from the edge`);
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
