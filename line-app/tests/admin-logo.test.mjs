import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const P = (f) => fileURLToPath(new URL('../public/' + f, import.meta.url));

test('white Innow logo is a plain copy: PNG, 1416x463, transparent (RGBA)', () => {
  assert.ok(existsSync(P('innow-logo-white.png')));
  const b = readFileSync(P('innow-logo-white.png'));
  assert.equal(b.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(b.readUInt32BE(16), 1416);
  assert.equal(b.readUInt32BE(20), 463);
  assert.equal(b[25], 6); // colour type 6 = RGBA
  assert.deepEqual(readFileSync(P('innow-logo-white.png')), readFileSync(fileURLToPath(new URL('../../images/innow-logo-white.png', import.meta.url))));
});

test('admin page renders the logo from same-origin, with alt text and explicit size; no inline styles', () => {
  const js = readFileSync(P('admin.js'), 'utf8');
  assert.match(js, /src: '\/innow-logo-white\.png', alt: 'Innow', width, height/);
  assert.match(js, /logo\('logo-top', 110, 36\)/);
  assert.match(js, /logo\('logo-login', 159, 52\)/);
  assert.ok(Math.abs(110 / 36 - 1416 / 463) < 0.05 && Math.abs(159 / 52 - 1416 / 463) < 0.05);
  const html = readFileSync(P('admin.html'), 'utf8');
  assert.ok(!/\sstyle\s*=/i.test(html), 'admin.html must have no inline style attribute');
  assert.ok(!/\sstyle:/.test(js.slice(js.indexOf('const logo ='), js.indexOf('function shell'))));
});

test('static assets serve the logo: run_worker_first covers only /api/* and /f/*', () => {
  const cfg = readFileSync(fileURLToPath(new URL('../wrangler.jsonc', import.meta.url)), 'utf8');
  assert.match(cfg, /"run_worker_first": \["\/api\/\*", "\/f\/\*"\]/);
});
