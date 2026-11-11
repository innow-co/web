// Own file: this test locks out the shared test IP for admin login, so it runs on its own fresh server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, stop, call, adminLogin } from './api.helper.mjs';

before(async () => { await start(); });
after(async () => { await stop(); });

test('11th wrong admin password from one IP is 429, even with the right password', async () => {
  for (let i = 0; i < 10; i++) {
    const r = await call('POST', '/api/admin/login', { json: { password: 'wrong-' + i } });
    assert.equal(r.status, 401, 'attempt ' + (i + 1));
  }
  const r = await call('POST', '/api/admin/login', { json: { password: 'wrong-11' } });
  assert.equal(r.status, 429);
  await assert.rejects(adminLogin(), /429/);
});
