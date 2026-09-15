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

const FILE = pathToFileURL(join(ROOT, 'dist', 'climate-explorer.html')).href;
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

// ── 5b. the app ships with no weather data and opens on its empty state ─────
//
// Nothing is bundled: publishing the app would otherwise redistribute whatever
// weather file was embedded. A student supplies their own.
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(1200);

  const boot = await page.evaluate(() => ({
    hasData: !!window.EPWVisualiser.getState().data,
    theme: window.EPWVisualiser.getState().theme,
    emptyShown: getComputedStyle(document.querySelector('.epwviz-empty')).display !== 'none',
    loadingHidden: getComputedStyle(document.querySelector('.epwviz-loading')).display === 'none',
    copyright: document.querySelector('.epwviz-copyright')?.textContent,
    // offsetParent is null for a hidden element: the button exists in the DOM
    // because the bundling mechanism is kept, but must not be offered.
    sampleButton: [...document.querySelectorAll('.epwviz-btn')]
      .some((b) => /example/i.test(b.textContent) && b.offsetParent !== null),
    sources: [...document.querySelectorAll('.epwviz-empty-sources a')].map((a2) => a2.getAttribute('href')),
    lead: document.querySelector('.epwviz-empty-lead')?.textContent || '',
  }));
  if (boot.hasData) problems.push('[boot] weather data loaded on its own — nothing should be bundled');
  if (!boot.emptyShown) problems.push('[boot] the empty state is not showing');
  if (!boot.loadingHidden) problems.push('[boot] the app is stuck on the loading state');
  if (boot.theme !== 'light') problems.push(`[boot] default theme is "${boot.theme}", expected light`);
  if (boot.copyright !== '\u00a9 Karam Al-Obaidi') problems.push(`[boot] copyright reads "${boot.copyright}"`);
  if (boot.sampleButton) problems.push('[boot] the example-climate button is visible but nothing is bundled');
  if (boot.sources.length !== 2) problems.push(`[boot] expected 2 source links, found ${boot.sources.length}`);
  if (!/browser-based weather data analysis and visualisation/.test(boot.lead)) {
    problems.push(`[boot] the empty state does not carry the full description: "${boot.lead}"`);
  }
  await page.screenshot({ path: join(OUT, 'boot-empty.png') });

  // The path a student actually takes: the real file input, not the JS API.
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.epwviz-empty .epwviz-btn-primary').click();
  await (await chooser).setFiles(join(ROOT, 'test', 'fixtures', 'chicago_ohare_tmy3.epw'));
  await page.waitForFunction(() => window.EPWVisualiser?.getState()?.data, null, { timeout: 20000 });
  await page.waitForTimeout(700);

  const loaded = await page.evaluate(() => {
    const s2 = window.EPWVisualiser.getState();
    const canvas = document.querySelector('.epwviz-canvas2d');
    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 4 * 997) seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
    return {
      n: s2.data.n,
      city: s2.data.location.city,
      file: s2.fileName,
      emptyHidden: getComputedStyle(document.querySelector('.epwviz-empty')).display === 'none',
      distinct: seen.size,
    };
  });
  if (loaded.n !== 8760) problems.push(`[picker] expected 8760 records, got ${loaded.n}`);
  if (!/Chicago/i.test(loaded.city)) problems.push(`[picker] wrong location "${loaded.city}"`);
  if (loaded.file !== 'chicago_ohare_tmy3.epw') problems.push(`[picker] wrong filename "${loaded.file}"`);
  if (!loaded.emptyHidden) problems.push('[picker] the empty state is still showing after a file loaded');
  if (loaded.distinct < 6) problems.push(`[picker] the chart did not render (${loaded.distinct} distinct colours)`);
  await page.screenshot({ path: join(OUT, 'boot-after-picker.png') });
  if (errors.length) problems.push(`[boot] console errors:\n   ${errors.join('\n   ')}`);
  await page.close();
}

// ── 5c. no crash on a browser without DecompressionStream ───────────────────
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
  await page.evaluate((t) => window.EPWVisualiser.load(t, 'chicago_ohare_tmy3.epw'), EPW);
  await page.waitForFunction(() => window.EPWVisualiser?.getState()?.data, null, { timeout: 20000 });

  // The full sentence belongs where there is room for it — the tab title, the meta
  // description and the empty state. The header lockup keeps a short strapline, or
  // it grows a second line on every screen.
  const FULL = 'a browser-based weather data analysis and visualisation tool';
  const brand = await page.evaluate(() => ({
    name: document.querySelector('.epwviz-brand-text strong').textContent.trim(),
    strapline: document.querySelector('.epwviz-brand-text span').textContent.trim(),
    description: document.querySelector('meta[name=description]')?.content || '',
    version: document.querySelector('meta[name=version]')?.content || '',
    buildDate: document.querySelector('meta[name="build-date"]')?.content || '',
    license: document.querySelector('meta[name=license]')?.content || '',
    rail: document.querySelector('.epwviz-rail-version')?.textContent || '',
  }));
  const title = await page.title();

  if (brand.name !== 'Climate Explorer') problems.push(`[brand] main title reads "${brand.name}"`);
  if (!title.includes(FULL)) problems.push(`[brand] the tab title omits the full sentence: "${title}"`);
  if (!brand.description.includes(FULL)) problems.push('[brand] the meta description omits the full sentence');
  if (brand.strapline.length > 45) {
    problems.push(`[brand] the header strapline is ${brand.strapline.length} chars — too long for the lockup`);
  }
  if (brand.strapline.includes(FULL)) problems.push('[brand] the full sentence leaked into the header lockup');

  // Version identity: package.json is the single source, so the page must agree.
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  if (brand.version !== pkg.version) problems.push(`[version] meta version "${brand.version}" != package.json "${pkg.version}"`);
  if (brand.buildDate !== pkg.releaseDate) problems.push(`[version] meta build-date "${brand.buildDate}" != "${pkg.releaseDate}"`);
  if (brand.license !== 'MIT') problems.push(`[version] meta license reads "${brand.license}"`);
  if (!brand.rail.includes(pkg.version)) problems.push(`[version] the rail does not show v${pkg.version} (reads "${brand.rail.trim()}")`);

  // ...and must not sit beside the copyright.
  const footer = await page.evaluate(() => document.querySelector('.epwviz-footer')?.textContent || '');
  if (footer.includes(pkg.version)) problems.push('[version] the version is in the footer, next to the copyright');

  // Exported images must carry the attribution. The caption bar is drawn below the
  // chart, so a correct export is taller than the canvas it came from.
  await page.evaluate(() => window.EPWVisualiser.setState({ mode: 'comfort', view: 'psychrometric' }));
  await page.waitForTimeout(700);
  const canvasHeight = await page.evaluate(() => document.querySelector('.epwviz-canvas2d').height);
  const canvasWidthBefore = await page.evaluate(() => document.querySelector('.epwviz-canvas2d').width);
  const canvasHeightBefore = canvasHeight;
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

  // Resolution: exporting at 1x and 3x must differ by exactly 3x in width, which
  // only holds if the chart is re-rendered rather than the bitmap stretched.
  const dims = {};
  for (const factor of [1, 3]) {
    await page.evaluate((f) => window.EPWVisualiser.setState({ exportScale: f }), factor);
    await page.waitForTimeout(400);
    const pending2 = page.waitForEvent('download');
    await page.locator('.epwviz-btn', { hasText: 'PNG' }).click();
    const dl = await pending2;
    const file = join(OUT, `export-${factor}x.png`);
    await dl.saveAs(file);
    const buf = readFileSync(file);
    dims[factor] = { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), bytes: buf.length };
  }
  console.log(`  export 1x ${dims[1].w}x${dims[1].h}  ->  3x ${dims[3].w}x${dims[3].h}`);
  if (dims[3].w !== dims[1].w * 3) {
    problems.push(`[export] 3x width is ${dims[3].w}, expected ${dims[1].w * 3}`);
  }
  if (dims[3].h < dims[1].h * 2.9) {
    problems.push(`[export] 3x height is ${dims[3].h}, expected about ${dims[1].h * 3}`);
  }
  if (dims[3].bytes <= dims[1].bytes) {
    problems.push('[export] the 3x PNG is no larger than the 1x — it may be an upscale of the same pixels');
  }

  // The live canvas must be untouched by exporting.
  const liveAfter = await page.evaluate(() => {
    const c = document.querySelector('.epwviz-canvas2d');
    return { w: c.width, h: c.height };
  });
  if (liveAfter.w !== canvasWidthBefore || liveAfter.h !== canvasHeightBefore) {
    problems.push(`[export] the live canvas changed size after exporting: ${liveAfter.w}x${liveAfter.h}`);
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

// ── 5f. the chart must keep its share of a short, scaled-down viewport ───────
//
// A 1920x1080 laptop at 150% Windows scaling presents a 1280x720 CSS viewport.
// The readout strip used to wrap to two rows there and the rail stayed at its
// full width, leaving the chart 58% of the app — which reads as "the graph is
// small and the values are large".
for (const [w, h, minShare, maxTileRows, label] of [
  [1600, 1000, 0.74, 1, 'desktop'],
  [1280, 720, 0.70, 1, 'laptop at 150% scaling'],
  [1100, 620, 0.55, 2, 'laptop at 175% scaling'],
]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(FILE, { waitUntil: 'load' });
  await page.evaluate((t) => window.EPWVisualiser.load(t, 'chicago_ohare_tmy3.epw'), EPW);
  await page.waitForFunction(() => window.EPWVisualiser?.getState()?.data, null, { timeout: 20000 });
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => {
    const q = (sel) => document.querySelector(sel);
    const height = (el) => (el ? el.getBoundingClientRect().height : 0);
    const tiles = q('.epwviz-tiles');
    const cols = getComputedStyle(tiles).gridTemplateColumns.split(' ').length;
    return {
      share: height(q('.epwviz-stage-panel')) / height(q('.epwviz-app')),
      rows: Math.ceil(document.querySelectorAll('.epwviz-tile').length / cols),
      rail: q('.epwviz-rail').getBoundingClientRect().width,
    };
  });
  if (m.share < minShare) {
    problems.push(`[layout] ${label}: chart is only ${(m.share * 100).toFixed(0)}% of the app (want >= ${minShare * 100}%)`);
  }
  if (m.rows > maxTileRows) {
    problems.push(`[layout] ${label}: readout wraps to ${m.rows} rows (want <= ${maxTileRows})`);
  }
  if (w <= 1400 && m.rail >= 288) {
    problems.push(`[layout] ${label}: rail did not narrow (${m.rail}px) — a @container rule cannot restyle its own container`);
  }
  if (errors.length) problems.push(`[layout] ${label} console errors: ${errors.join('; ')}`);
  await page.close();
}

// ── 5g. the colour-scale caption must not be clipped at the canvas edge ──────
// (that the caption sits above the strip rather than crammed beside it is
//  asserted precisely in test/render.test.mjs)
await session(1500, 900, 'light', 'colorbar', async (page) => {
  await page.evaluate(() => window.EPWVisualiser.setState({
    mode: 'solar', view: 'sunpath', sunpathTint: 'globalHorizontal',
  }));
  await page.waitForTimeout(700);
  const clipped = await page.evaluate(() => {
    const canvas = document.querySelector('.epwviz-canvas2d');
    const ctx = canvas.getContext('2d');
    const band = ctx.getImageData(canvas.width - 3, 0, 3, Math.round(canvas.height * 0.12)).data;
    let inked = 0;
    for (let i = 3; i < band.length; i += 4) if (band[i] > 12) inked += 1;
    return inked;
  });
  if (clipped > 6) problems.push(`[colorbar] the sun path caption runs off the right edge (${clipped}px)`);
  await page.screenshot({ path: join(OUT, 'colorbar-sunpath.png') });
});

// ── 6. the empty state ───────────────────────────────────────────────────────
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
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
