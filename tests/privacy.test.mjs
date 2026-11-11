import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const pagePath = new URL('privacy/index.html', root);
const read = url => readFileSync(url, 'utf8');

test('privacy page exists and is a Thai page with one h1 and the canonical URL', () => {
  assert.ok(existsSync(pagePath), 'privacy/index.html is missing');
  const html = read(pagePath);
  assert.match(html, /<html lang="th">/);
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
  assert.match(html, /<link rel="canonical" href="https:\/\/innow\.co\.th\/privacy\/">/);
  assert.match(html, /<meta name="robots" content="index,follow">/);
  assert.match(html, /<a class="skip" href="#main">/);
  assert.match(html, /<a [^>]*href="\/">กลับหน้าแรก<\/a>/);
});

test('privacy page names the controller, the responsible person, the contact and every section', () => {
  const html = read(pagePath);
  for (const text of [
    'บริษัท อินนาวน์ จำกัด',
    'นายไพบูลย์ พนัสบดี',
    'ask@innow.co.th',
    'พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562',
    'สรุปสั้น ๆ',
    '1. ผู้ควบคุมข้อมูลและผู้รับผิดชอบ',
    '2. ข้อมูลที่เราเก็บ',
    '3. วัตถุประสงค์และฐานทางกฎหมาย',
    '4. ผู้ที่เราแบ่งปันข้อมูลด้วยและการส่งข้อมูลไปต่างประเทศ',
    '5. ระยะเวลาเก็บรักษา',
    '6. สิทธิของคุณและวิธีใช้สิทธิ',
    '7. ความปลอดภัยของข้อมูล',
    '8. คุกกี้และการติดตาม',
    '9. การเปลี่ยนแปลงนโยบาย',
    '10. ติดต่อเรา',
    'ปรับปรุงล่าสุด',
  ]) assert.ok(html.includes(text), `missing: ${text}`);
  for (const heading of ['controller', 'data', 'purposes', 'sharing', 'retention', 'rights', 'security', 'cookies', 'changes', 'contact']) {
    assert.match(html, new RegExp(`<h2 id="${heading}-heading">`), `missing h2 for #${heading}`);
  }
});

test('privacy page makes no external requests and links out only to allowed hosts', () => {
  const html = read(pagePath);
  const allowed = [/^https:\/\/innow\.co\.th\//, /^https:\/\/line\.me\//];
  const urls = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map(m => m[1]);
  assert.ok(urls.length > 0);
  for (const url of urls) {
    if (!/^(?:https?:)?\/\//i.test(url)) continue; // relative, root-relative, #anchor or mailto:
    assert.ok(allowed.some(re => re.test(url)), `external URL not allowed: ${url}`);
  }
  assert.doesNotMatch(html, /\bsrc="(?:https?:)?\/\//i, 'no external src');
  assert.doesNotMatch(html, /@import|fonts\.googleapis|fonts\.gstatic/i);
  for (const font of ['Anuphan-Variable.ttf', 'IBMPlexSansThai-Regular.ttf', 'IBMPlexSansThai-Medium.ttf', 'IBMPlexSansThai-SemiBold.ttf']) {
    assert.ok(html.includes(`url("/fonts/${font}")`), `font not self-hosted: ${font}`);
    assert.ok(existsSync(new URL(`fonts/${font}`, root)), `font file missing: ${font}`);
  }
  assert.ok(existsSync(new URL('images/innow-logo-white.png', root)));
});

test('privacy page has no inline style, no script and no raw colour outside the token block', () => {
  const html = read(pagePath);
  assert.doesNotMatch(html, /\sstyle=/i);
  assert.doesNotMatch(html, /<script/i);
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.equal((html.match(/<style[\s>]/g) || []).length, 1);
  const outside = css.replace(/\/\* BEGIN INNOW TOKENS[\s\S]*?\/\* END INNOW TOKENS \*\//, '');
  assert.notEqual(outside, css, 'token block markers missing');
  assert.doesNotMatch(outside, /#[0-9a-f]{3,8}\b/i, 'raw hex outside the token block');
  assert.doesNotMatch(outside, /rgba?\(|hsla?\(/i, 'raw colour function outside the token block');
  assert.doesNotMatch(outside, /\d+px\b/, 'raw px outside the token block');
});

test('home page footer links to the privacy page', () => {
  const home = read(new URL('index.html', root));
  const footer = home.match(/<footer class="site-footer[^"]*">([\s\S]*?)<\/footer>/);
  assert.ok(footer, 'site footer not found');
  assert.match(footer[1], /<a href="\/privacy\/">นโยบายความเป็นส่วนตัว<\/a>/);
});
