import { test } from 'node:test';
import assert from 'node:assert/strict';
import { credentialsFromEnvironment } from '../lib/ses-credentials.mjs';

test('uses the explicitly configured SES access key', () => {
  assert.deepEqual(credentialsFromEnvironment({ SES_ACCESS_KEY_ID: 'id', SES_SECRET_ACCESS_KEY: 'secret' }), { accessKeyId: 'id', secretAccessKey: 'secret' });
});

test('rejects incomplete credentials', () => {
  assert.equal(credentialsFromEnvironment({ SES_ACCESS_KEY_ID: 'id' }), null);
});
