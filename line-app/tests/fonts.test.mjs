import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { start, stop, BASE } from './api.helper.mjs';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const FONTS = path.join(PUBLIC, 'fonts');
const FILES = ['Anuphan-Variable.ttf', 'IBMPlexSansThai-Regular.ttf', 'IBMPlexSansThai-Medium.ttf', 'IBMPlexSansThai-SemiBold.ttf'];
const read = (f) => readFileSync(path.join(PUBLIC, f), 'utf8');

before(start);
after(stop);

// Tiny cmap reader (formats 4 and 12) returning a predicate codepoint -> glyph present.
function cmapReader(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const numTables = dv.getUint16(4);
  let cmapOff = -1;
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    if (buf.toString('latin1', o, o + 4) === 'cmap') cmapOff = dv.getUint32(o + 8);
  }
  assert.ok(cmapOff >= 0, 'cmap table');
  const n = dv.getUint16(cmapOff + 2);
  const ranges = [];
  for (let i = 0; i < n; i++) {
    const pid = dv.getUint16(cmapOff + 4 + i * 8), eid = dv.getUint16(cmapOff + 6 + i * 8), off = cmapOff + dv.getUint32(cmapOff + 8 + i * 8);
    const fmt = dv.getUint16(off);
    if (!((pid === 3 && (eid === 1 || eid === 10)) || pid === 0)) continue;
    if (fmt === 4) {
      const segX2 = dv.getUint16(off + 6), segs = segX2 / 2;
      const endO = off + 14, startO = endO + segX2 + 2, deltaO = startO + segX2, roO = deltaO + segX2;
      for (let s = 0; s < segs; s++) {
        const end = dv.getUint16(endO + s * 2), st = dv.getUint16(startO + s * 2), ro = dv.getUint16(roO + s * 2), delta = dv.getInt16(deltaO + s * 2);
        for (let c = st; c <= end && c !== 0xffff; c++) {
          let g;
          if (ro === 0) g = (c + delta) & 0xffff;
          else { g = dv.getUint16(roO + s * 2 + ro + (c - st) * 2); if (g) g = (g + delta) & 0xffff; }
          if (g) ranges.push([c, c]);
        }
      }
    } else if (fmt === 12) {
      const ng = dv.getUint32(off + 12);
      for (let g = 0; g < ng; g++) {
        const o = off + 16 + g * 12;
        if (dv.getUint32(o + 8) !== 0) ranges.push([dv.getUint32(o), dv.getUint32(o + 4)]);
      }
    }
  }
  return (cp) => ranges.some(([a, b]) => cp >= a && cp <= b);
}

test('font files exist in public/fonts with valid TTF headers', () => {
  assert.deepEqual(readdirSync(FONTS).sort(), [...FILES].sort());
  for (const f of FILES) {
    const b = readFileSync(path.join(FONTS, f));
    const magic = b.subarray(0, 4);
    assert.ok(magic.equals(Buffer.from([0, 1, 0, 0])) || magic.toString('latin1') === 'true' || magic.toString('latin1') === 'wOF2', f + ' has a font magic number');
    assert.ok(b.length > 50_000, f + ' is not truncated');
  }
});

for (const css of ['app.css', 'admin.css']) {
  test(`${css} declares self-hosted @font-face for every family/weight in use, with font-display: swap`, () => {
    const src = read(css);
    const faces = [...src.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
    assert.equal(faces.length, 4, '4 @font-face rules');
    const get = (b, k) => b.match(new RegExp(k + '\\s*:\\s*([^;]+);'))?.[1].trim();
    const seen = faces.map((b) => `${get(b, 'font-family').replace(/['"]/g, '')}|${get(b, 'font-weight')}`).sort();
    assert.deepEqual(seen, ['Anuphan|500 700', 'IBM Plex Sans Thai|400', 'IBM Plex Sans Thai|500', 'IBM Plex Sans Thai|600']);
    for (const b of faces) {
      assert.equal(get(b, 'font-display'), 'swap');
      assert.equal(get(b, 'font-style'), 'normal');
      const url = b.match(/url\('(\/fonts\/[^']+)'\)/)?.[1];
      assert.ok(url, 'local /fonts/ url');
      assert.ok(existsSync(path.join(PUBLIC, url)), url + ' exists');
    }
    assert.ok(src.trimStart().startsWith('@font-face'), '@font-face rules are at the top');
    assert.match(src, /--f-display: 'Anuphan', 'IBM Plex Sans Thai', system-ui, sans-serif;/);
    assert.match(src, /--f-read: 'IBM Plex Sans Thai', 'Anuphan', system-ui, sans-serif;/);
  });
}

test('no Google Fonts or any third-party font host in public html/css/js', () => {
  for (const f of readdirSync(PUBLIC).filter((n) => /\.(html|css|js)$/.test(n))) {
    const t = read(f);
    assert.ok(!/googleapis|gstatic/i.test(t), f + ' mentions googleapis/gstatic');
  }
  for (const f of ['index.html', 'admin.html']) assert.ok(!/<link[^>]+href="https?:/i.test(read(f)), f + ' has an external <link>');
});

function parseHeaders(text) {
  const rules = []; let cur = null;
  for (const raw of text.split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (/^\S/.test(raw)) { cur = { path: raw.trim(), headers: {} }; rules.push(cur); }
    else { const i = raw.indexOf(':'); const k = raw.slice(0, i).trim().toLowerCase(); assert.ok(!(k in cur.headers), 'duplicate header ' + k + ' in ' + cur.path); cur.headers[k] = raw.slice(i + 1).trim(); }
  }
  return rules;
}

test('_headers: admin CSP is self-only for styles and fonts; /fonts/* is cached for a day (not immutable)', () => {
  const rules = parseHeaders(read('_headers'));
  assert.equal(new Set(rules.map((r) => r.path)).size, rules.length, 'no duplicate path rules');
  const csp = rules.find((r) => r.path === '/admin*').headers['content-security-policy'];
  assert.match(csp, /(^|; )style-src 'self'(;|$)/);
  assert.match(csp, /(^|; )font-src 'self'(;|$)/);
  assert.ok(!/https?:/.test(csp), 'no external origin in the CSP');
  const fonts = rules.find((r) => r.path === '/fonts/*');
  assert.equal(fonts.headers['cache-control'], 'public, max-age=86400');
  assert.ok(!/immutable/.test(fonts.headers['cache-control']));
  assert.ok(rules.find((r) => r.path === '/*').headers['x-content-type-options'] === 'nosniff');
});

test('every character in the UI sources is covered by the shipped fonts (emoji/pictographs fall back to the OS by design)', () => {
  const covers = {};
  for (const f of FILES) covers[f] = cmapReader(readFileSync(path.join(FONTS, f)));
  const text = readdirSync(PUBLIC).filter((n) => /\.(html|css|js)$/.test(n)).map(read).join('\n');
  const missing = new Map();
  for (const ch of new Set(text)) {
    const cp = ch.codePointAt(0);
    if (cp < 0x20 || cp === 0x7f) continue; // whitespace / control
    if (/\p{Extended_Pictographic}|[‍︎️⃣]/u.test(ch)) continue; // emoji: never in a text font
    for (const f of FILES) if (!covers[f](cp)) (missing.get(f) ?? missing.set(f, []).get(f)).push('U+' + cp.toString(16).toUpperCase() + ' ' + ch);
  }
  assert.deepEqual(Object.fromEntries(missing), {}, 'characters used in the UI that a shipped font lacks');
});

test('static route serves /fonts/Anuphan-Variable.ttf as a font through the Worker', async () => {
  const res = await fetch(BASE + '/fonts/Anuphan-Variable.ttf');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /font|octet-stream/);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=86400');
  const b = Buffer.from(await res.arrayBuffer());
  assert.deepEqual(b, readFileSync(path.join(FONTS, 'Anuphan-Variable.ttf')));
  const missing = await fetch(BASE + '/fonts/nope.ttf');
  assert.notEqual(missing.status, 500);
});

test('wrangler run_worker_first leaves /fonts/* to the static assets', () => {
  assert.match(readFileSync(fileURLToPath(new URL('../wrangler.jsonc', import.meta.url)), 'utf8'), /"run_worker_first": \["\/api\/\*", "\/f\/\*"\]/);
});
