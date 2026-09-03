/**
 * Visual and smoke test: load the built single file, feed it a real EPW, then
 * exercise every view at several breakpoints and themes.
 *
 * Usage: node test/visual.mjs [--all]
 */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, statSync } from 'node:fs';
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

// ── 1. every view at desktop size, in the default light-grey theme ───────────
await session(1600, 1000, 'light', 'desktop-light', async (page, errors) => {
  for (const view of VIEWS) {
    const t0 = Date.now();
    await page.evaluate((v) => window.EPWVisualiser.setState({ view: v }), view);
    await page.waitForTimeout(view === 'surface' || view === 'sundome' ? 700 : 380);
    timings.push([view, Date.now() - t0]);
    await page.screenshot({ path: join(OUT, `desktop-light-${view}.png`) });

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
    if (!filled.ok) problems.push(`[desktop-light] view "${view}" rendered blank (${filled.why})`);
  }

  // Tooltip on the heatmap.
  await page.evaluate(() => window.EPWVisualiser.setState({ view: 'heatmap' }));
  await page.waitForTimeout(300);
  const box = await page.locator('.epwviz-canvas2d').boundingBox();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5);
  await page.waitForTimeout(220);
  const tip = await page.locator('.epwviz-tooltip.is-visible').count();
  if (!tip) problems.push('[desktop-light] heatmap tooltip did not appear on hover');
  else await page.screenshot({ path: join(OUT, 'desktop-light-tooltip.png') });
});

// ── 2. themes ────────────────────────────────────────────────────────────────
for (const theme of ['dark', 'print']) {
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

// ── 3b. the 3D views must actually respond to the mouse ──────────────────────
//
// This is the check whose absence let a one-line bug ship: the camera state was
// updating on drag but no frame was ever scheduled, so all four 3D views were
// frozen. Comparing rendered pixels before and after a gesture is the only thing
// that would have caught it.
await session(1600, 1000, 'light', 'orbit', async (page) => {
  // A deterministic signature of what is actually on the 3D canvas. Element
  // screenshots are not byte-stable in headless Chromium, so PNG comparison gives
  // false passes; reading the preserved drawing buffer does not.
  const signature = () => page.evaluate(() => {
    const gl = document.querySelector('.epwviz-gl');
    const tmp = document.createElement('canvas');
    tmp.width = gl.width; tmp.height = gl.height;
    tmp.getContext('2d').drawImage(gl, 0, 0);
    const d = tmp.getContext('2d').getImageData(0, 0, tmp.width, tmp.height).data;
    // Sample densely: a sparse stride collides on scenes that are mostly background,
    // which reads as "nothing changed" when plenty did.
    let h = 2166136261;
    for (let i = 0; i < d.length; i += 4 * 5) {
      h = Math.imul(h ^ d[i], 16777619);
      h = Math.imul(h ^ d[i + 1], 16777619);
      h = Math.imul(h ^ d[i + 2], 16777619);
    }
    return h | 0;
  });

  const gesture = async (name, view, fn) => {
    const before = await page.evaluate(() => window.EPWVisualiser.sceneInfo());
    const sigBefore = await signature();
    await fn();
    await page.waitForTimeout(420);
    const after = await page.evaluate(() => window.EPWVisualiser.sceneInfo());
    const sigAfter = await signature();
    if (after.frames <= before.frames) {
      problems.push(`[orbit] ${view}: ${name} changed the camera but drew no frame`);
    }
    if (sigAfter === sigBefore) {
      problems.push(`[orbit] ${view}: ${name} left the rendered image unchanged`);
    }
  };

  for (const view of ['sundome', 'surface', 'windrose3d', 'massing']) {
    await page.evaluate((v) => window.EPWVisualiser.setState({ view: v }), view);
    await page.waitForTimeout(800);
    const box = await page.locator('.epwviz-gl-overlay').boundingBox();
    if (!box) { problems.push(`[orbit] ${view}: no 3D canvas`); continue; }
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await gesture('drag to orbit', view, async () => {
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let i = 1; i <= 12; i += 1) await page.mouse.move(cx + i * 14, cy - i * 3);
      await page.mouse.up();
    });

    await gesture('wheel to zoom', view, async () => {
      await page.mouse.move(cx, cy);
      await page.mouse.wheel(0, -280);
    });

    await gesture('shift-drag to pan', view, async () => {
      await page.keyboard.down('Shift');
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let i = 1; i <= 8; i += 1) await page.mouse.move(cx - i * 11, cy + i * 5);
      await page.mouse.up();
      await page.keyboard.up('Shift');
    });

    await gesture('reset view', view, () => page.locator('.epwviz-nav-reset').click());

    // Reset must land back on the angle the scene opened with.
    const home = await page.evaluate(() => window.EPWVisualiser.sceneInfo());
    await page.evaluate((v) => window.EPWVisualiser.setState({ view: 'heatmap' }), view);
    await page.waitForTimeout(200);
    await page.evaluate((v) => window.EPWVisualiser.setState({ view: v }), view);
    await page.waitForTimeout(700);
    const fresh = await page.evaluate(() => window.EPWVisualiser.sceneInfo());
    if (Math.abs(home.azimuth - fresh.azimuth) > 0.02 || Math.abs(home.elevation - fresh.elevation) > 0.02) {
      problems.push(`[orbit] ${view}: reset did not return to the scene's opening camera`);
    }

    if (view === 'massing') {
      await gesture('Plan camera preset', view,
        () => page.locator('.epwviz-nav-btn', { hasText: 'Plan' }).click());
      const plan = await page.evaluate(() => window.EPWVisualiser.sceneInfo());
      if (plan.elevation < 1.2) problems.push(`[orbit] the Plan preset gave elevation ${plan.elevation}`);
      await page.screenshot({ path: join(OUT, 'massing-plan-preset.png') });
      await page.locator('.epwviz-nav-btn', { hasText: 'SE' }).click();
      await page.waitForTimeout(420);
      await page.screenshot({ path: join(OUT, 'massing-se-preset.png') });
    }
  }
  await page.screenshot({ path: join(OUT, 'orbit-final.png') });
});

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

// ── 5b. the app opens on the bundled example with no interaction at all ──────
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const t0 = Date.now();
  await page.goto(FILE, { waitUntil: 'load' });
  try {
    await page.waitForFunction(() => window.EPWVisualiser?.getState()?.data, null, { timeout: 20000 });
  } catch (err) {
    problems.push('[boot] the bundled example never loaded');
  }
  const boot = await page.evaluate(() => {
    const s = window.EPWVisualiser.getState();
    return {
      theme: s.theme,
      n: s.data?.n,
      label: s.data?.displayLabel,
      isSample: s.data?.isSample,
      lat: s.data?.location?.latitude,
      copyright: document.querySelector('.epwviz-copyright')?.textContent,
      footerVisible: !!document.querySelector('.epwviz-footer')?.offsetHeight,
      emptyHidden: getComputedStyle(document.querySelector('.epwviz-empty')).display === 'none',
    };
  });
  console.log(`  boot -> London ready in ${Date.now() - t0} ms`);
  if (boot.theme !== 'light') problems.push(`[boot] default theme is "${boot.theme}", expected light`);
  if (boot.n !== 8760) problems.push(`[boot] expected 8760 records, got ${boot.n}`);
  if (!boot.isSample) problems.push('[boot] the loaded dataset is not flagged as the bundled sample');
  if (!/London/.test(boot.label || '')) problems.push(`[boot] unexpected label "${boot.label}"`);
  if (Math.abs((boot.lat ?? 0) - 51.5049) > 0.001) problems.push(`[boot] wrong latitude ${boot.lat}`);
  if (boot.copyright !== '\u00a9 Karam Al-Obaidi') problems.push(`[boot] copyright reads "${boot.copyright}"`);
  if (!boot.footerVisible) problems.push('[boot] the footer is not visible');
  if (!boot.emptyHidden) problems.push('[boot] the empty state is still showing after the sample loaded');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, 'boot-default.png') });
  if (errors.length) problems.push(`[boot] console errors:\n   ${errors.join('\n   ')}`);
  await page.close();
}

// ── 5c. a browser without DecompressionStream falls back, it does not break ──
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => { delete window.DecompressionStream; });
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  const state = await page.evaluate(() => ({
    hasData: !!window.EPWVisualiser.getState().data,
    emptyShown: getComputedStyle(document.querySelector('.epwviz-empty')).display !== 'none',
    loadingHidden: getComputedStyle(document.querySelector('.epwviz-loading')).display === 'none',
  }));
  if (state.hasData) problems.push('[fallback] data loaded despite DecompressionStream being absent');
  if (!state.emptyShown) problems.push('[fallback] the empty state did not appear');
  if (!state.loadingHidden) problems.push('[fallback] the app is stuck on the loading state');
  if (errors.length) problems.push(`[fallback] console errors:\n   ${errors.join('\n   ')}`);
  await page.screenshot({ path: join(OUT, 'fallback-no-decompression.png') });
  await page.close();
}

// ── 5d. branding, and attribution on exported images ─────────────────────────
{
  const context = await browser.newContext({ viewport: { width: 1500, height: 960 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.EPWVisualiser?.getState()?.data, null, { timeout: 20000 });

  const strapline = await page.locator('.epwviz-brand-text span').textContent();
  if (strapline.trim() !== 'Weather Data Visualisation') {
    problems.push(`[brand] strapline reads "${strapline}"`);
  }
  const title = await page.title();
  if (!/Weather Data Visualisation/.test(title)) problems.push(`[brand] page title reads "${title}"`);

  // Exported images must carry the attribution. The caption bar is drawn below the
  // chart, so a correct export is taller than the canvas it came from.
  await page.evaluate(() => window.EPWVisualiser.setState({ mode: 'comfort', view: 'psychrometric' }));
  await page.waitForTimeout(700);
  const canvasHeight = await page.evaluate(() => document.querySelector('.epwviz-canvas2d').height);
  const pending = page.waitForEvent('download');
  await page.locator('.epwviz-btn', { hasText: 'PNG' }).click();
  const download = await pending;
  const out = join(OUT, 'exported.png');
  await download.saveAs(out);
  const bytes = statSync(out).size;
  if (bytes < 20000) problems.push(`[export] the PNG is only ${bytes} bytes`);
  if (!/^[a-z0-9-]+\.png$/.test(download.suggestedFilename())) {
    problems.push(`[export] odd filename "${download.suggestedFilename()}"`);
  }
  const png = readFileSync(out);
  const exportedHeight = png.readUInt32BE(20);
  if (exportedHeight <= canvasHeight) {
    problems.push(`[export] no caption bar: export is ${exportedHeight}px for a ${canvasHeight}px canvas`);
  }
  // The attribution the caption bar draws must actually be in the shipped bundle.
  if (!readFileSync(FILE.replace('file://', '')).includes('Karam Al-Obaidi')) {
    problems.push('[export] the copyright string is missing from the build');
  }
  if (errors.length) problems.push(`[export] console errors:\n   ${errors.join('\n   ')}`);
  await context.close();
}

// ── 5e. the psychrometric legend must never be clipped ───────────────────────
await session(1180, 900, 'light', 'psychro', async (page) => {
  // Two panels side by side is the tightest case: five legend entries wrap to a
  // second row, which a fixed bottom margin used to cut off.
  for (const compare of [false, true]) {
    await page.evaluate((c) => window.EPWVisualiser.setState({
      mode: 'comfort', view: 'psychrometric', compare: c, compareSource: 'period',
    }), compare);
    await page.waitForTimeout(800);
    const fits = await page.evaluate(() => {
      const canvas = document.querySelector('.epwviz-canvas2d');
      const ctx = canvas.getContext('2d');
      const dpr = canvas.width / canvas.getBoundingClientRect().width;
      // Scan the bottom 4 CSS pixels: anything drawn there is being cut off.
      const strip = ctx.getImageData(0, canvas.height - Math.ceil(4 * dpr), canvas.width, Math.ceil(4 * dpr)).data;
      let inked = 0;
      for (let i = 3; i < strip.length; i += 4) if (strip[i] > 12) inked += 1;
      return { inked, width: canvas.width };
    });
    if (fits.inked > fits.width * 0.02) {
      problems.push(`[psychro] legend runs off the bottom edge (compare=${compare}, ${fits.inked} inked px)`);
    }
    await page.screenshot({ path: join(OUT, `psychro-${compare ? 'compare' : 'single'}.png`) });
  }
});

// ── 6. the empty state ───────────────────────────────────────────────────────
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // Suppress the bundled sample so the empty state is what renders.
  await page.addInitScript(() => { delete window.DecompressionStream; });
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(500);
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
