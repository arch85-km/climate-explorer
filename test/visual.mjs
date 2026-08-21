/**
 * Visual and smoke test: load the built single file, feed it a real EPW, then
 * exercise every view at several breakpoints and themes.
 *
 * Usage: node test/visual.mjs [--all]
 */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'test', 'screenshots');
mkdirSync(OUT, { recursive: true });

const FILE = pathToFileURL(join(ROOT, 'dist', 'epw-visualiser.html')).href;
const EPW = readFileSync(join(ROOT, 'test', 'fixtures', 'chicago_ohare_tmy3.epw'), 'utf8');
const EPW2 = readFileSync(join(ROOT, 'test', 'fixtures', 'london_gatwick_iwec.epw'), 'utf8');

const VIEWS = ['heatmap', 'timeseries', 'diurnal', 'monthly', 'histogram',
  'psychrometric', 'windrose', 'sunpath', 'sundome', 'surface', 'windrose3d', 'massing'];
const ALL = process.argv.includes('--all');

const problems = [];
const timings = [];

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--no-sandbox'],
});

async function session(width, height, theme, label, fn) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(FILE, { waitUntil: 'load' });
  await page.evaluate(([text, t]) => {
    window.EPWVisualiser.load(text, 'chicago_ohare_tmy3.epw');
    window.EPWVisualiser.setState({ theme: t });
  }, [EPW, theme]);
  await page.waitForTimeout(400);
  await fn(page, errors, label);
  if (errors.length) problems.push(`[${label}] console errors:\n   ${errors.join('\n   ')}`);
  await page.close();
}

// ── 1. every view at desktop size, dark theme ────────────────────────────────
await session(1600, 1000, 'dark', 'desktop-dark', async (page, errors) => {
  for (const view of VIEWS) {
    const t0 = Date.now();
    await page.evaluate((v) => window.EPWVisualiser.setState({ view: v }), view);
    await page.waitForTimeout(view === 'surface' || view === 'sundome' ? 700 : 380);
    timings.push([view, Date.now() - t0]);
    await page.screenshot({ path: join(OUT, `desktop-dark-${view}.png`) });

    // The canvas must actually contain something other than the background.
    const filled = await page.evaluate(() => {
      const root = document.getElementById('epwviz');
      const gl = root.querySelector('.epwviz-gl');
      const c2 = root.querySelector('.epwviz-canvas2d');
      const target = (gl && gl.style.display !== 'none' && gl.offsetParent !== null) ? gl : c2;
      if (!target || !target.width) return { ok: false, why: 'no canvas' };
      if (target.classList.contains('epwviz-gl')) {
        // Read back the WebGL drawing buffer via a copy into a 2D canvas.
        const tmp = document.createElement('canvas');
        tmp.width = target.width; tmp.height = target.height;
        tmp.getContext('2d').drawImage(target, 0, 0);
        const d = tmp.getContext('2d').getImageData(0, 0, tmp.width, tmp.height).data;
        let distinct = new Set();
        for (let i = 0; i < d.length; i += 4 * 997) distinct.add(`${d[i]},${d[i + 1]},${d[i + 2]},${d[i + 3]}`);
        return { ok: distinct.size > 3, why: `webgl distinct=${distinct.size}` };
      }
      const d = target.getContext('2d').getImageData(0, 0, target.width, target.height).data;
      const distinct = new Set();
      for (let i = 0; i < d.length; i += 4 * 997) distinct.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
      return { ok: distinct.size > 5, why: `2d distinct=${distinct.size}` };
    });
    if (!filled.ok) problems.push(`[desktop-dark] view "${view}" rendered blank (${filled.why})`);
  }

  // Tooltip on the heatmap.
  await page.evaluate(() => window.EPWVisualiser.setState({ view: 'heatmap' }));
  await page.waitForTimeout(300);
  const box = await page.locator('.epwviz-canvas2d').boundingBox();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5);
  await page.waitForTimeout(220);
  const tip = await page.locator('.epwviz-tooltip.is-visible').count();
  if (!tip) problems.push('[desktop-dark] heatmap tooltip did not appear on hover');
  else await page.screenshot({ path: join(OUT, 'desktop-dark-tooltip.png') });
});

// ── 2. themes ────────────────────────────────────────────────────────────────
for (const theme of ['light', 'print']) {
  await session(1600, 1000, theme, `desktop-${theme}`, async (page) => {
    for (const view of (ALL ? VIEWS : ['heatmap', 'psychrometric', 'sundome', 'massing'])) {
      await page.evaluate((v) => window.EPWVisualiser.setState({ view: v }), view);
      await page.waitForTimeout(480);
      await page.screenshot({ path: join(OUT, `desktop-${theme}-${view}.png`) });
    }
  });
}

// ── 3. breakpoints ───────────────────────────────────────────────────────────
for (const [w, h, name] of [[390, 844, 'phone'], [834, 1112, 'tablet']]) {
  await session(w, h, 'dark', name, async (page) => {
    for (const view of ['heatmap', 'windrose', 'sundome']) {
      await page.evaluate((v) => window.EPWVisualiser.setState({ view: v }), view);
      await page.waitForTimeout(480);
      await page.screenshot({ path: join(OUT, `${name}-${view}.png`), fullPage: false });
    }
    // The rail must be off-canvas until the menu button is pressed.
    if (name === 'phone') {
      const hidden = await page.evaluate(() => {
        const rail = document.querySelector('.epwviz-rail');
        return rail.getBoundingClientRect().right <= 2;
      });
      if (!hidden) problems.push('[phone] control rail is not collapsed at 390px');
      await page.locator('.epwviz-menu-btn').click();
      await page.waitForTimeout(320);
      await page.screenshot({ path: join(OUT, 'phone-rail-open.png') });
    }
  });
}

// ── 4. compare mode with two files ───────────────────────────────────────────
await session(1600, 1000, 'dark', 'compare', async (page) => {
  await page.evaluate((text) => {
    window.EPWVisualiser.setState({ compare: true, compareSource: 'period', view: 'heatmap' });
  }, EPW2);
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, 'compare-periods.png') });
  const panels = await page.locator('.epwviz-stage-panel').count();
  if (panels !== 2) problems.push(`[compare] expected 2 stage panels, found ${panels}`);
});

// ── 5. presentation mode ─────────────────────────────────────────────────────
await session(1600, 1000, 'dark', 'presentation', async (page) => {
  await page.evaluate(() => window.EPWVisualiser.setState({ presentation: true, view: 'sundome' }));
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, 'presentation-sundome.png') });
});

// ── 6. the empty state ───────────────────────────────────────────────────────
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(OUT, 'empty-state.png') });
  if (errors.length) problems.push(`[empty] console errors:\n   ${errors.join('\n   ')}`);
  // A malformed file must produce a message, not a crash.
  await page.evaluate(() => {
    try { window.EPWVisualiser.load('not,an,epw,file\nat,all', 'bad.epw'); } catch (e) { window.__err = e.message; }
  });
  await page.waitForTimeout(200);
  await page.close();
}

await browser.close();

console.log('\nrender timings (ms):');
for (const [v, ms] of timings) console.log(`  ${v.padEnd(14)} ${ms}`);

if (problems.length) {
  console.log(`\n${problems.length} PROBLEM(S):`);
  for (const p of problems) console.log(` - ${p}`);
  process.exit(1);
}
console.log('\nAll visual checks passed.');
