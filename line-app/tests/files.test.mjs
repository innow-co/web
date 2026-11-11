import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, stop, call, seedWorkshop, login, adminLogin, BASE, d1, sessionSecret, saveItemMultipart, r2Get, r2KeysOf, listR2Keys } from './api.helper.mjs';
import { signToken } from '../src/lib.js';

const reg = { firstName: 'สมชาย', lastName: 'ใจดี', email: 'f@example.com', acceptTerms: true };
let T;
before(async () => { await start(); T = await adminLogin(); });
after(async () => { await stop(); });

async function enroll(uid, code) {
  const { token } = await login(uid);
  const rd = await call('POST', '/api/redeem', { token, json: { code } });
  if (rd.data.status === 'register') assert.equal((await call('POST', '/api/register', { token, json: { ...reg, redeemToken: rd.data.redeemToken } })).status, 200);
  return token;
}
const PDF = new TextEncoder().encode('%PDF-1.4 fake pdf bytes \u0000\u0001\u0002');
async function upload(wid, file, fields = { kind: 'slide', title: 'Deck' }, opts) {
  const r = await saveItemMultipart(wid, fields, file, opts);
  return { status: r.status, data: await r.json().catch(() => null) };
}
const pdf = (name = 'deck.pdf') => ({ bytes: PDF, name, type: 'application/pdf' });
const link = (token, id) => call('POST', `/api/items/${id}/link`, { token });
const get = (url, init) => fetch(url, { redirect: 'manual', ...init });
const objectsOf = async (wid) => (await listR2Keys(`workshops/${wid}/`)).length;

test('learner gets a signed link; download returns same bytes with safe headers', async () => {
  const w = await seedWorkshop('Files A');
  const id = (await upload(w.id, pdf())).data.id;
  const tok = await enroll('U-files-a', w.code);
  const l = await link(tok, id);
  assert.equal(l.status, 200);
  const res = await get(l.data.url);
  assert.equal(res.status, 200);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), PDF);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('content-disposition'), /^inline; filename\*=UTF-8''deck\.pdf$/);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
});

test('non-image/pdf types are attachments; Thai file name round-trips', async () => {
  const w = await seedWorkshop('Files Thai');
  const name = 'สไลด์ อบรม.zip';
  const id = (await upload(w.id, { bytes: new Uint8Array([1, 2, 3]), name, type: 'application/zip' })).data.id;
  const tok = await enroll('U-files-thai', w.code);
  const res = await get((await link(tok, id)).data.url);
  assert.equal(res.status, 200);
  const cd = res.headers.get('content-disposition');
  assert.ok(cd.startsWith('attachment; '));
  assert.equal(decodeURIComponent(cd.split("filename*=UTF-8''")[1]), name);
});

test('hostile file names are sanitised: no header injection, no 500', async () => {
  const w = await seedWorkshop('Files Hostile');
  const tok = await enroll('U-files-hostile', w.code);
  for (const name of ['a"b.pdf', 'a\\b.pdf', 'a\r\nSet-Cookie: x=1.pdf', "o'brien (1)*.pdf"]) {
    const up = await upload(w.id, pdf(name));
    assert.equal(up.status, 200, name);
    const res = await get((await link(tok, up.data.id)).data.url);
    assert.equal(res.status, 200, name);
    const cd = res.headers.get('content-disposition');
    assert.match(cd, /^inline; filename\*=UTF-8''[A-Za-z0-9%._-]+$/, name);
    assert.equal(res.headers.get('set-cookie'), null);
    await res.arrayBuffer();
  }
});

test('unsigned, tampered, wrong-item and expired links are 403', async () => {
  const w = await seedWorkshop('Files Tok');
  const a = (await upload(w.id, pdf('a.pdf'))).data.id;
  const b = (await upload(w.id, pdf('b.pdf'), { kind: 'slide', title: 'B' })).data.id;
  const tok = await enroll('U-files-tok', w.code);
  const url = new URL((await link(tok, a)).data.url);
  assert.equal((await get(url)).status, 200);
  assert.equal((await get(BASE + `/f/${a}`)).status, 403);
  assert.equal((await get(BASE + `/f/${a}?t=`)).status, 403);
  const t = url.searchParams.get('t');
  const [body, sig] = t.split('.');
  const flipped = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
  assert.equal((await get(BASE + `/f/${a}?t=${encodeURIComponent(body + '.' + flipped)}`)).status, 403);
  assert.equal((await get(BASE + `/f/${a}?t=${encodeURIComponent(body + 'x.' + sig)}`)).status, 403);
  assert.equal((await get(BASE + `/f/${b}?t=${encodeURIComponent(t)}`)).status, 403, 'token for A must not open B');
  const old = await signToken(sessionSecret(), 'file', { iid: a, uid: 'U-files-tok' }, 300, Date.now() - 3600_000);
  assert.equal((await get(BASE + `/f/${a}?t=${encodeURIComponent(old)}`)).status, 403, 'expired');
  const fresh = await signToken(sessionSecret(), 'file', { iid: a, uid: 'U-files-tok' }, 300);
  assert.equal((await get(BASE + `/f/${a}?t=${encodeURIComponent(fresh)}`)).status, 200, 'control: fresh valid token passes');
  const wrongTyp = await signToken(sessionSecret(), 'session', { iid: a }, 300);
  assert.equal((await get(BASE + `/f/${a}?t=${encodeURIComponent(wrongTyp)}`)).status, 403, 'wrong token type');
});

test('a member of workshop A cannot reach a file of workshop B', async () => {
  const A = await seedWorkshop('Iso A');
  const B = await seedWorkshop('Iso B');
  const fileB = (await upload(B.id, pdf('b.pdf'))).data.id;
  const tokA = await enroll('U-iso-a', A.code);
  assert.equal((await link(tokA, fileB)).status, 403);
  assert.equal((await get(BASE + `/f/${fileB}`, { headers: { authorization: 'Bearer ' + tokA } })).status, 403);
  assert.equal((await call('POST', `/api/items/${fileB}/link`)).status, 401);
  assert.equal((await get(BASE + `/api/admin/items/${fileB}/file`, { headers: { authorization: 'Bearer ' + tokA } })).status, 401);
  const noFile = (await call('POST', `/api/admin/workshops/${A.id}/items`, { token: T, json: { kind: 'prompt', title: 'P' } })).data.id;
  assert.equal((await link(tokA, noFile)).status, 404);
});

test('replacing a file removes the old R2 object; removeFile removes it too', async () => {
  const w = await seedWorkshop('Files Replace');
  const id = (await upload(w.id, pdf('one.pdf'))).data.id;
  const [k1] = r2KeysOf(w.id);
  assert.equal(await objectsOf(w.id), 1, 'control: object exists after upload');
  assert.deepEqual(r2Get(k1), Buffer.from(PDF));
  const second = new TextEncoder().encode('second-file');
  assert.equal((await upload(w.id, { bytes: second, name: 'two.txt', type: 'text/plain' }, { kind: 'slide', title: 'Deck' }, { itemId: id })).status, 200);
  const [k2] = r2KeysOf(w.id);
  assert.notEqual(k1, k2);
  assert.equal(r2Get(k1), null, 'old object removed');
  assert.deepEqual(r2Get(k2), Buffer.from(second));
  assert.equal((await upload(w.id, null, { kind: 'slide', title: 'Deck', removeFile: '1' }, { itemId: id })).status, 200);
  assert.equal(r2Get(k2), null, 'removeFile deletes the object');
  assert.equal(await objectsOf(w.id), 0);
});

test('deleting an item or a workshop removes its R2 objects', async () => {
  const w = await seedWorkshop('Files Delete');
  const i1 = (await upload(w.id, pdf('1.pdf'))).data.id;
  await upload(w.id, pdf('2.pdf'), { kind: 'bonus', title: 'Two' });
  const [k1, k2] = r2KeysOf(w.id);
  assert.equal(await objectsOf(w.id), 2, 'control: both objects exist after upload');
  assert.ok(r2Get(k1) && r2Get(k2));
  assert.equal((await call('DELETE', `/api/admin/workshops/${w.id}/items/${i1}`, { token: T })).status, 200);
  assert.equal(r2Get(k1), null);
  assert.ok(r2Get(k2));
  assert.equal((await call('DELETE', `/api/admin/workshops/${w.id}`, { token: T })).status, 200);
  assert.equal(r2Get(k2), null);
  assert.equal(await objectsOf(w.id), 0);
});

test('validation failures with a file attached leave no orphan R2 object', async () => {
  const w = await seedWorkshop('Files Orphan');
  for (const fields of [{ kind: 'slide', title: '' }, { kind: 'nonsense', title: 'x' }, { kind: 'slide', title: 'x', url: 'http://insecure' }]) {
    assert.equal((await upload(w.id, pdf(), fields)).status, 422);
  }
  assert.equal((await upload(w.id, pdf(), { kind: 'slide', title: 'x' }, { itemId: 999999 })).status, 404);
  assert.equal(await objectsOf(w.id), 0, 'no objects under the workshop prefix');
  assert.equal((await upload(w.id, pdf())).status, 200);
  assert.equal(await objectsOf(w.id), 1, 'control: the counter does see a successful upload');
});

const MB = 1024 * 1024;
const blobOf = (mb, type = 'application/pdf') => new Blob([new Uint8Array(Math.round(mb * MB)).fill(7)], { type });

test('upload over the 40 MB limit is 413 and leaves nothing behind', async () => {
  const w = await seedWorkshop('Files Big');
  assert.equal((await upload(w.id, pdf())).status, 200);
  assert.equal(await objectsOf(w.id), 1, 'control: counter sees an object');
  const before = r2KeysOf(w.id);
  for (const mb of [41, 96]) {
    const r = await saveItemMultipart(w.id, { kind: 'slide', title: 'Big' }, { blob: blobOf(mb), name: 'big.pdf' });
    assert.equal(r.status, 413, mb + ' MB');
    assert.match((await r.json()).error, /40MB/);
  }
  assert.equal(await objectsOf(w.id), 1, 'still only the control object');
  assert.deepEqual(r2KeysOf(w.id), before);
});

test('a file just under the limit uploads and downloads byte-identical', async () => {
  const w = await seedWorkshop('Files Near Limit');
  const blob = blobOf(39, 'application/zip');
  const up = await upload(w.id, { blob, name: 'near.zip' });
  assert.equal(up.status, 200);
  assert.equal(await objectsOf(w.id), 1);
  const res = await get(BASE + `/api/admin/items/${up.data.id}/file`, { headers: { authorization: 'Bearer ' + T } });
  assert.equal(res.status, 200);
  const got = Buffer.from(await res.arrayBuffer());
  assert.equal(got.length, blob.size);
  assert.ok(got.equals(Buffer.from(await blob.arrayBuffer())));
});

test('multipart without Content-Length is refused (411) with a hint to use a link', async () => {
  const w = await seedWorkshop('Files NoLen');
  const boundary = 'xBOUNDARYx';
  const part = `--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nslide\r\n--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nT\r\n--${boundary}--\r\n`;
  const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(part)); c.close(); } });
  const r = await fetch(BASE + `/api/admin/workshops/${w.id}/items`, {
    method: 'POST', duplex: 'half', body: stream,
    headers: { authorization: 'Bearer ' + T, 'content-type': 'multipart/form-data; boundary=' + boundary },
  });
  assert.equal(r.status, 411);
  assert.match((await r.json()).error, /ลิงก์/);
});

test('SVG and HTML uploads are always attachments with a locked-down CSP (no stored XSS)', async () => {
  const w = await seedWorkshop('Files XSS');
  const tok = await enroll('U-files-xss', w.code);
  const cases = [
    ['x.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    ['x.html', 'text/html', '<script>alert(1)</script>'],
    ['x.txt', 'text/plain', 'plain'],
    ['x.bin', '', 'unknown'],
  ];
  for (const [name, type, content] of cases) {
    const up = await upload(w.id, { bytes: new TextEncoder().encode(content), name, type });
    assert.equal(up.status, 200, name);
    const res = await get((await link(tok, up.data.id)).data.url);
    assert.equal(res.status, 200, name);
    assert.match(res.headers.get('content-disposition'), /^attachment;/, name);
    assert.equal(res.headers.get('content-security-policy'), "default-src 'none'; sandbox", name);
    await res.arrayBuffer();
  }
});

test('PDF and PNG stay inline and carry the CSP; admin token downloads identical bytes', async () => {
  const w = await seedWorkshop('Files Inline');
  const tok = await enroll('U-files-inline', w.code);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  for (const f of [pdf('a.pdf'), { bytes: png, name: 'a.png', type: 'image/png' }]) {
    const up = await upload(w.id, f);
    const res = await get((await link(tok, up.data.id)).data.url);
    assert.match(res.headers.get('content-disposition'), /^inline;/, f.name);
    assert.equal(res.headers.get('content-security-policy'), "default-src 'none'; sandbox");
    await res.arrayBuffer();
    const adm = await get(BASE + `/api/admin/items/${up.data.id}/file`, { headers: { authorization: 'Bearer ' + T } });
    assert.equal(adm.status, 200);
    assert.deepEqual(new Uint8Array(await adm.arrayBuffer()), f.bytes);
  }
});

test('copy-from with the same workshop as source is rejected with 400', async () => {
  const w = await seedWorkshop('Copy Self');
  assert.equal((await call('POST', `/api/admin/workshops/${w.id}/copy-from/${w.id}`, { token: T })).status, 400);
});
