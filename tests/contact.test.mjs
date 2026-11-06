import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMessage } from '../lib/contact-message.mjs';

test('routes a valid request to Innow with the visitor as reply-to', () => {
  const message = makeMessage({ organization: 'Example', email: 'person@example.com', course: 'Secure Coding', learners: '20', expectation: 'Bootcamp', details: 'อยากได้ต้นแบบ' });
  assert.deepEqual(message.Destination.ToAddresses, ['ask@innow.co.th']);
  assert.deepEqual(message.ReplyToAddresses, ['person@example.com']);
  assert.match(message.Content.Simple.Body.Text.Data, /Example/);
  assert.match(message.Content.Simple.Body.Text.Data, /Bootcamp/);
  assert.match(message.Content.Simple.Body.Text.Data, /อยากได้ต้นแบบ/);
});

test('rejects header injection and invalid quantities', () => {
  assert.throws(() => makeMessage({ organization: 'X', email: 'a@example.com\nBcc:x@y.com', course: 'Secure Coding', learners: '1' }));
  assert.throws(() => makeMessage({ organization: 'X', email: 'a@example.com', course: 'Secure Coding', learners: '0' }));
});
