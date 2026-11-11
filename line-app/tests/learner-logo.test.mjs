import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const R = (f) => fileURLToPath(new URL(f, import.meta.url));

test('learner header shows the white Innow logo with alt text, explicit size and no inline style', () => {
  const html = readFileSync(R('../public/index.html'), 'utf8');
  const img = html.match(/<img class="logo"[^>]*>/)?.[0];
  assert.ok(img, 'logo img in header');
  assert.match(img, /src="\/innow-logo-white\.png"/);
  assert.match(img, /alt="Innow"/);
  assert.match(img, /width="98"/);
  assert.match(img, /height="32"/);
  assert.ok(Math.abs(98 / 32 - 1416 / 463) < 0.05);
  assert.ok(!/\sstyle\s*=/i.test(html), 'index.html has no inline style attribute');
  assert.ok(!/<div class="brand">innow<\/div>/.test(html), 'text brand removed (no double announcement)');
});

test('the logo in public/ is byte-identical to images/innow-logo-white.png and is a static asset', () => {
  assert.deepEqual(readFileSync(R('../public/innow-logo-white.png')), readFileSync(R('../../images/innow-logo-white.png')));
  const cfg = readFileSync(R('../wrangler.jsonc'), 'utf8');
  assert.match(cfg, /"run_worker_first": \["\/api\/\*", "\/f\/\*"\]/);
});
