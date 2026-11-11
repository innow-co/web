import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const R = (f) => fileURLToPath(new URL(f, import.meta.url));
const app = readFileSync(R('../public/app.js'), 'utf8');
const css = readFileSync(R('../public/app.css'), 'utf8');
const lib = readFileSync(R('../public/lib-app.js'), 'utf8');

// The slide-viewer code is the region between these markers in app.js.
const region = (() => {
  const a = app.indexOf('// ---------- Google Slides viewer');
  const b = app.indexOf('// ---------- end Google Slides viewer');
  assert.ok(a >= 0 && b > a, 'slides viewer markers exist in app.js');
  return app.slice(a, b);
})();

test('the only iframe in app.js is created inside the slides viewer, from googleSlidesInfo().embedUrl', () => {
  const creations = app.match(/createElement\(\s*['"`]iframe|h\(\s*['"`]iframe/g) || [];
  assert.equal(creations.length, 1, 'exactly one iframe creation site');
  assert.ok(region.includes("h('iframe'"), 'it lives in the viewer region');
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(region), 'no HTML string injection in the viewer');
  assert.match(app, /googleSlidesInfo/);
  assert.match(region, /googleSlidesInfo\(/);
  assert.match(region, /\.src\s*=\s*info\.embedUrl/, 'src is assigned from the helper output only');
  assert.ok(!/src:\s*[^,}]*(\.url|it\.|item\.)/.test(region), 'src never comes from raw item data');
  assert.ok(!/(?:^|[^.\w])it\.url/.test(region.replace(/googleSlidesInfo\(\s*it\.url\s*\)/g, '')), 'raw it.url is only passed to the helper');
});

test('the iframe is sandboxed, lazy, no-referrer and allows fullscreen', () => {
  assert.match(region, /sandbox:\s*'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox'/);
  assert.match(region, /referrerpolicy:\s*'no-referrer'/);
  assert.match(region, /allow:\s*'fullscreen'/);
  assert.match(region, /allowfullscreen/);
  assert.match(region, /loading:\s*'lazy'/);
  assert.match(region, /title:\s*it\.title/, 'accessible name is the item title');
});

test('nothing creates the iframe at render time: only the poster tap (or fullscreen) does', () => {
  const fn = region.slice(region.indexOf('function slidesCard('));
  assert.ok(fn.includes('function ensureFrame'), 'iframe creation is wrapped in a function');
  const creations = [...fn.matchAll(/ensureFrame\(/g)].length;
  assert.ok(creations >= 3, 'declared once and called from the tap handlers');
  const body = fn.slice(fn.indexOf('function ensureFrame'));
  const topLevelBeforeHandlers = fn.slice(0, fn.indexOf('function ensureFrame'));
  assert.ok(!/h\('iframe'/.test(topLevelBeforeHandlers), 'no iframe before ensureFrame');
  assert.match(fn, /แตะเพื่อดูสไลด์/);
  assert.match(fn, /สไลด์จาก Google Slides/);
  assert.match(fn, /'เต็มจอ'/);
  assert.match(fn, /'เปิดนอกแอป'/);
  assert.match(fn, /openUrl\(\s*info\.openUrl/, 'open outside the app reuses openUrl with the /preview link');
  assert.ok(body.length > 0);
});

test('fullscreen tries native (standard + webkit) and falls back to the in-app overlay', () => {
  assert.match(region, /requestFullscreen/);
  assert.match(region, /webkitRequestFullscreen/);
  assert.match(region, /slidesCardState\(/);
  assert.match(region, /slides-full/);
  assert.match(region, /Escape/);
  assert.match(region, /aria-modal/);
  assert.match(region, /'ปิด'/);
  assert.match(region, /slides-lock/);
});

test('non-Google and non-slide items keep the old rendering', () => {
  assert.match(app, /kind === 'slide'\s*&&\s*googleSlidesInfo\(\s*i\.url\s*\)/);
  assert.match(app, /itemCard\(i\)/);
  assert.match(app, /function itemCard\(/);
  assert.match(app, /openFile\(it, b\)/);
});

test('the helper and state machine live in lib-app.js, which stays DOM free', () => {
  assert.match(lib, /export function googleSlidesInfo/);
  assert.match(lib, /export function slidesCardState/);
  assert.ok(!/\b(document|window)\b\./.test(lib));
});

test('app.css defines the viewer classes with a 16:9 frame and a fixed full-viewport overlay', () => {
  assert.match(css, /\.slides-card\b/);
  const frame = css.match(/\.slides-frame\s*\{[^}]*\}/)?.[0] || '';
  assert.match(frame, /aspect-ratio:\s*16\s*\/\s*9/);
  assert.match(frame, /width:\s*100%/);
  const full = css.match(/\.slides-frame\.slides-full\s*\{[^}]*\}/)?.[0] || css.match(/\.slides-full\s*\{[^}]*\}/)?.[0] || '';
  assert.match(full, /position:\s*fixed/);
  assert.match(full, /inset:\s*0/);
  const z = Number(full.match(/z-index:\s*(\d+)/)?.[1]);
  const tabZ = Number(css.match(/\.tabbar\s*\{[^}]*z-index:\s*(\d+)/)?.[1]);
  const toastZ = Number(css.match(/\.toast\s*\{[^}]*z-index:\s*(\d+)/)?.[1]);
  assert.ok(z > tabZ && z > toastZ, 'overlay is above the tab bar and toast');
  assert.match(css, /env\(safe-area-inset-top\)/);
  assert.match(css, /100dvh/);
  assert.match(css, /#082955|var\(--navy\)/);
  assert.match(css, /\.slides-close[^{]*\{[^}]*min-height:\s*44px/);
  assert.match(css, /\.slides-close:focus-visible/);
  assert.match(css, /body\.slides-lock\s*\{[^}]*overflow:\s*hidden/);
});

test('no inline style attributes are produced by the viewer', () => {
  assert.ok(!/\bstyle\s*:/.test(region) && !/\.style\b/.test(region) && !/setAttribute\(\s*['"]style/.test(region));
});

test('enterFull re-checks the card after every await, guards re-entry and clears pending on every path', () => {
  const fn = region.slice(region.indexOf('async function enterFull'), region.indexOf('function closeFull'));
  assert.match(fn, /slidesCanEnter\(\s*\{[^}]*pending[^}]*destroyed[^}]*\}/);
  assert.match(fn, /pending\s*=\s*true/);
  const awaits = (fn.match(/\bawait\b/g) || []).length;
  const checks = (fn.match(/slidesCanApply\(/g) || []).length;
  assert.ok(awaits >= 1 && checks >= 1, 'a currency check follows the await');
  assert.match(fn, /finally\s*\{[^}]*pending\s*=\s*false/, 'pending is cleared on every path, including errors');
  assert.match(fn, /isConnected/);
  assert.ok(fn.indexOf('slidesCanApply(') > fn.indexOf('await'), 'check comes after the await');
  assert.ok(fn.indexOf('slidesCanApply(') < fn.indexOf("'fullscreen'"), 'check comes before the state change');
});

test('releaseSlides destroys every live card (destroyed flag, pending cleared, full view closed)', () => {
  assert.match(region, /liveSlides/);
  assert.match(region, /function releaseSlides\([^)]*\)\s*\{[\s\S]*liveSlides[\s\S]*destroy\(\)/);
  const mount = app.slice(app.indexOf('function mountWith'), app.indexOf('function mountWizardDone'));
  assert.match(mount, /releaseSlides\(root\)/, 'cards built for the screen being mounted survive (they are created before mountWith runs)');
  assert.ok(mount.indexOf('releaseSlides(root)') < mount.indexOf('view.replaceChildren'));
  assert.match(region, /destroyed\s*=\s*true/);
  const destroy = region.slice(region.indexOf('const destroy ='), region.indexOf('const destroy =') + 300);
  assert.match(destroy, /pending\s*=\s*false/);
  assert.match(destroy, /closeFull\(/);
});

test('closeFull exits native fullscreen whenever the frame is the fullscreen element, whatever the state', () => {
  const fn = region.slice(region.indexOf('function closeFull'), region.indexOf('const destroy ='));
  assert.ok(!/if\s*\(\s*st\s*===\s*'native'\s*\)\s*\{[^}]*exit/.test(fn), 'not gated on st');
  assert.match(fn, /nativeEl\(\)\s*===\s*frame/);
  assert.match(fn, /exitFullscreen/);
  assert.match(fn, /webkitExitFullscreen/);
  assert.match(region, /nativeEl\s*=\s*\(\)\s*=>\s*document\.fullscreenElement\s*\|\|\s*document\.webkitFullscreenElement/);
});

test('onFullChange: native entry while in overlay becomes native; exit returns to loaded; the iframe own fullscreen is ignored', () => {
  const fn = region.slice(region.indexOf('const onFullChange'), region.indexOf('function apply'));
  assert.match(fn, /'native-entered'/);
  assert.match(fn, /'native-exit'/);
  assert.match(fn, /=== frame/);
});

test('without a promise (old webkit) success is verified, not assumed', () => {
  const fn = region.slice(region.indexOf('async function enterFull'), region.indexOf('function closeFull'));
  assert.ok(!/!\(r && typeof r\.then === 'function'\)/.test(fn), 'no success assumed for a non-promise result');
  assert.match(fn, /fullscreenchange/);
});
