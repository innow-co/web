import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

// Minimal _headers parser: a path line starts at column 0, header lines are indented.
function parse(text) {
  const rules = []; let cur = null;
  for (const raw of text.split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (/^\S/.test(raw)) { cur = { path: raw.trim(), headers: {} }; rules.push(cur); }
    else { const i = raw.indexOf(':'); cur.headers[raw.slice(0, i).trim().toLowerCase()] = raw.slice(i + 1).trim(); }
  }
  return rules;
}

test('_headers: admin pages cannot be framed and have a CSP; everything gets nosniff + no-referrer', () => {
  const rules = parse(readFileSync(path.join(PUBLIC, '_headers'), 'utf8'));
  const adminRules = rules.filter((r) => r.path.startsWith('/admin'));
  assert.ok(adminRules.length >= 1);
  for (const r of adminRules) {
    assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.match(r.headers['content-security-policy'], /default-src 'self'/);
    assert.match(r.headers['content-security-policy'], /object-src/);
  }
  const all = rules.find((r) => r.path === '/*');
  assert.equal(all.headers['referrer-policy'], 'no-referrer');
  assert.equal(all.headers['x-content-type-options'], 'nosniff');
  // learner pages get no CSP here (needs LIFF/LINE hosts that cannot be verified without a device)
  assert.equal(all.headers['content-security-policy'], undefined);
});

test('app.js exposes window.__app only in dev mode', () => {
  const src = readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');
  const line = src.split('\n').find((l) => l.includes('window.__app'));
  assert.ok(line, 'window.__app assignment exists');
  assert.match(line, /state\.config\??\.dev|config\.dev/, 'must be guarded by config.dev');
});
