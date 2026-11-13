import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'index.html'), 'utf8');
const dialog = html.slice(html.indexOf('<dialog id="privacy"'), html.indexOf('</dialog>'));

test('privacy notice names the company and the person responsible for data protection', () => {
  assert.ok(dialog.length > 100);
  assert.ok(dialog.includes('บริษัท อินนาวน์ จำกัด'));
  assert.ok(dialog.includes('ผู้รับผิดชอบด้านการคุ้มครองข้อมูลส่วนบุคคล'));
  assert.ok(dialog.includes('นายไพบูลย์ พนัสบดี'));
});

test('privacy notice keeps its required headings and states a retention rule without inventing a number', () => {
  for (const h of ['ข้อมูลที่เก็บ', 'วัตถุประสงค์', 'การเก็บรักษาและสิทธิ์ของคุณ']) {
    assert.ok(dialog.includes(`<h3>${h}</h3>`), h);
  }
  assert.ok(dialog.includes('ระยะเวลาเก็บรักษา'));
  assert.ok(!/ระยะเวลาเก็บรักษา[^<]*\d/.test(dialog), 'no invented retention number');
  assert.ok(dialog.includes('LINE Official Account'));
  assert.ok(!/\d{2,3}-\d{3}-\d{4}|@[\w-]+\.\w+/.test(dialog), 'no phone or email');
});
