/**
 * Embed test: renders the built file inside an iframe on a page whose stylesheet
 * is deliberately hostile — the kind of global control styling a WordPress theme
 * applies — and checks that none of it reaches the app.
 *
 * Usage: node test/embed.mjs
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);
const EPW = readFileSync('test/fixtures/chicago_ohare_tmy3.epw', 'utf8');

// A stand-in for the WordPress page: theme-ish global CSS plus the documented embed.
writeFileSync('/tmp/host.html', `<!doctype html><html><head><meta charset="utf-8">
<style>
  /* Aggressive "theme" rules, of the kind that break naive embeds. */
  body { font-family: Georgia, serif; background:#fff; margin:0; padding:24px; }
  * { box-sizing: content-box !important; }
  button, select, input { font-size: 22px !important; padding: 14px !important;
    border: 3px solid hotpink !important; border-radius: 0 !important; background: yellow !important; }
  div { line-height: 3 !important; }
  h2 { color: red; }
  canvas { width: 40px !important; }
</style></head><body>
<h2>Course page</h2>
<div class="epw-embed" style="position:relative;width:100%">
  <iframe id="epw-visualiser" src="${pathToFileURL(process.cwd() + '/dist/epw-visualiser.html').href}"
    title="EPW Climate Explorer" allowfullscreen
    style="width:100%;height:900px;border:0;border-radius:8px;display:block"></iframe>
</div>
<script>
(function () {
  var frame = document.getElementById('epw-visualiser');
  window.__heights = [];
  window.addEventListener('message', function (event) {
    if (!frame || event.source !== frame.contentWindow) return;
    var data = event.data;
    if (data && data.type === 'epwviz:height' && typeof data.height === 'number') {
      window.__heights.push(data.height);
      frame.style.height = Math.max(640, Math.min(2400, data.height)) + 'px';
    }
  });
})();
</script></body></html>`);

const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const failures = [];
const page = await b.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
await page.goto(pathToFileURL('/tmp/host.html').href, { waitUntil: 'load' });
await page.waitForTimeout(700);

const frame = page.frameLocator('#epw-visualiser');
await frame.locator('#epwviz').waitFor({ timeout: 5000 });
await page.frames()[1].evaluate((t) => window.EPWVisualiser.load(t, 'chicago.epw'), EPW);
await page.waitForTimeout(900);

// Did the host theme leak in?
const probe = await page.frames()[1].evaluate(() => {
  const btn = document.querySelector('.epwviz-btn-primary');
  const sel = document.querySelector('.epwviz-select');
  const cs = getComputedStyle(btn);
  const cs2 = getComputedStyle(sel);
  const canvas = document.querySelector('.epwviz-canvas2d');
  return {
    btnFont: cs.fontSize, btnBorder: cs.borderTopColor, btnBg: cs.backgroundColor,
    accent: getComputedStyle(document.getElementById('epwviz')).getPropertyValue('--accent').trim(),
    theme: document.getElementById('epwviz').dataset.theme,
    selBg: cs2.backgroundColor, boxSizing: cs.boxSizing,
    canvasCssWidth: getComputedStyle(canvas).width,
    canvasBackingWidth: canvas.width,
    tiles: document.querySelectorAll('.epwviz-tile').length,
  };
});
console.log('inside the iframe, with a hostile host theme applied:');
console.log('  primary button font-size :', probe.btnFont, '(host forces 22px)');
console.log('  primary button background:', probe.btnBg, `(theme "${probe.theme}" accent ${probe.accent}; host forces yellow)`);
console.log('  select background        :', probe.selBg);
console.log('  border colour            :', probe.btnBorder, '(host forces hotpink)');
console.log('  box-sizing               :', probe.boxSizing, '(host forces content-box)');
console.log('  canvas css width         :', probe.canvasCssWidth, '(host forces 40px)');
console.log('  canvas backing width     :', probe.canvasBackingWidth);
console.log('  readout tiles rendered   :', probe.tiles);

const heights = await page.evaluate(() => window.__heights);
const frameH = await page.evaluate(() => document.getElementById('epw-visualiser').style.height);
console.log('\nheight messages received  :', heights.length, heights.slice(0,3));
console.log('iframe height now         :', frameH);

await page.screenshot({ path: 'test/screenshots/wordpress-embed.png' });

// Resize to a phone-ish width and confirm it adapts inside the iframe.
await page.setViewportSize({ width: 420, height: 900 });
await page.waitForTimeout(800);
await page.screenshot({ path: 'test/screenshots/wordpress-embed-narrow.png' });
const railHidden = await page.frames()[1].evaluate(() =>
  document.querySelector('.epwviz-rail').getBoundingClientRect().right <= 2);
console.log('narrow embed collapses the rail:', railHidden);

// ── the host page fullscreening the iframe must not leave a band ────────────────
//
// Embedded, the app pins its own height to its computed content height. When the
// host fullscreens the iframe the viewport grows but that pinned height does not,
// so the frame's own background showed below the app.
await page.setViewportSize({ width: 1920, height: 1080 });
await page.waitForTimeout(600);
await page.evaluate(() => document.getElementById('epw-visualiser').requestFullscreen());
await page.waitForTimeout(1400);
const fs = await page.frames()[1].evaluate(() => {
  const root = document.getElementById('epwviz');
  return { app: Math.round(root.getBoundingClientRect().height), win: window.innerHeight };
});
console.log('fullscreen band          :', fs.win - fs.app, 'px');
if (fs.win - fs.app > 4) {
  failures.push(`fullscreening the iframe leaves a ${fs.win - fs.app}px band below the app`);
}
await page.screenshot({ path: 'test/screenshots/embed-fullscreen.png' });
await page.evaluate(() => document.exitFullscreen()).catch(() => {});
await page.waitForTimeout(800);

console.log('\nconsole errors:', errors.length ? errors : 'none');

if (probe.btnFont !== '11.5px') failures.push(`host font-size leaked into buttons: ${probe.btnFont}`);
if (probe.boxSizing !== 'border-box') failures.push(`host box-sizing leaked: ${probe.boxSizing}`);
// Compare against the theme's own accent token rather than a hardcoded hex, so the
// check survives a change of default theme.
const hexToRgb = (h) => {
  const m = h.replace('#', '');
  return `rgb(${parseInt(m.slice(0, 2), 16)}, ${parseInt(m.slice(2, 4), 16)}, ${parseInt(m.slice(4, 6), 16)})`;
};
if (probe.btnBg !== hexToRgb(probe.accent)) {
  failures.push(`primary button background is ${probe.btnBg}, expected the accent ${probe.accent} (${hexToRgb(probe.accent)})`);
}
if (probe.canvasBackingWidth < 400) failures.push(`host canvas width leaked: ${probe.canvasCssWidth}`);
if (probe.tiles < 6) failures.push(`readout tiles did not render: ${probe.tiles}`);
if (!heights.length) failures.push('no height message was posted to the parent');
if (!railHidden) failures.push('the rail did not collapse in a narrow embed');
failures.push(...errors.map((e) => `console error: ${e}`));

await b.close();
if (failures.length) {
  console.log(`\n${failures.length} PROBLEM(S):`);
  for (const f of failures) console.log(' -', f);
  process.exit(1);
}
console.log('\nEmbed checks passed: the app is isolated from the host theme.');
