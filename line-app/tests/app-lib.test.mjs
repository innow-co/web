import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isNotFriendError, parseRoute, routeUrl, addFriendUrl, isHttps, spreadDigits, codeString, codeComplete,
  formatSize, groupByWorkshop, tabFor,
} from '../public/lib-app.js';

test('isNotFriendError only matches notFriend errors', () => {
  assert.ok(isNotFriendError({ status: 403, notFriend: true }));
  assert.ok(!isNotFriendError({ status: 403 }));
  assert.ok(!isNotFriendError(null));
});

test('parseRoute: plain, workshop id, unknown and unsafe input', () => {
  assert.deepEqual(parseRoute(''), { name: 'home' });
  assert.deepEqual(parseRoute('?p=prompts'), { name: 'prompts' });
  assert.deepEqual(parseRoute('?p=workshop&id=abc-123'), { name: 'workshop', id: 'abc-123' });
  assert.deepEqual(parseRoute('?p=workshop'), { name: 'workshops' });
  assert.deepEqual(parseRoute('?p=workshop&id=../x'), { name: 'workshops' });
  assert.deepEqual(parseRoute('?p=admin'), { name: 'home' });
  assert.deepEqual(parseRoute('?p=__proto__'), { name: 'home' });
});

test('parseRoute unwraps liff.state', () => {
  assert.deepEqual(parseRoute('?liff.state=%3Fp%3Dredeem'), { name: 'redeem' });
  assert.deepEqual(parseRoute('?liff.state=%2F%3Fp%3Dworkshop%26id%3Dw1'), { name: 'workshop', id: 'w1' });
  assert.deepEqual(parseRoute('?liff.state=p%3Dbonus'), { name: 'bonus' });
  assert.deepEqual(parseRoute('?liff.state=garbage&p=profile'), { name: 'profile' });
});

test('routeUrl round-trips and keeps dev', () => {
  assert.equal(routeUrl({ name: 'home' }), '?');
  assert.equal(routeUrl({ name: 'workshop', id: 'w1' }, { dev: 'u1' }), '?p=workshop&id=w1&dev=u1');
  assert.deepEqual(parseRoute(routeUrl({ name: 'workshop', id: 'w1' })), { name: 'workshop', id: 'w1' });
});

test('addFriendUrl handles @ prefix', () => {
  const want = 'https://line.me/R/ti/p/@innow';
  assert.equal(addFriendUrl('@innow'), want);
  assert.equal(addFriendUrl('innow'), want);
  assert.equal(addFriendUrl(' @@innow '), want);
  assert.equal(addFriendUrl(''), '');
  assert.equal(addFriendUrl(undefined), '');
  assert.equal(addFriendUrl('a b/c'), 'https://line.me/R/ti/p/@a%20b%2Fc');
});

test('isHttps only accepts https links', () => {
  assert.ok(isHttps('https://example.com/a'));
  assert.ok(!isHttps('http://example.com'));
  assert.ok(!isHttps('javascript:alert(1)'));
  assert.ok(!isHttps(''));
});

test('spreadDigits: typing, paste, autofill, delete', () => {
  const e = ['', '', '', ''];
  assert.deepEqual(spreadDigits(e, 0, '4'), { values: ['4', '', '', ''], focus: 1 });
  assert.deepEqual(spreadDigits(['4', '', '', ''], 3, '2'), { values: ['4', '', '', '2'], focus: 3 });
  assert.deepEqual(spreadDigits(e, 0, '0042'), { values: ['0', '0', '4', '2'], focus: 3 });
  assert.deepEqual(spreadDigits(e, 2, ' 1-2-3-4 '), { values: ['1', '2', '3', '4'], focus: 3 });
  assert.deepEqual(spreadDigits(e, 0, '12345678'), { values: ['1', '2', '3', '4'], focus: 3 });
  assert.deepEqual(spreadDigits(['1', '2', '', ''], 1, '3'), { values: ['1', '3', '', ''], focus: 2 });
  assert.deepEqual(spreadDigits(['1', '2', '3', ''], 1, 'x'), { values: ['1', '', '3', ''], focus: 1 });
  assert.deepEqual(spreadDigits(e, 1, '12'), { values: ['', '1', '2', ''], focus: 3 });
});

test('code is a string and keeps leading zeros', () => {
  const v = spreadDigits(['', '', '', ''], 0, '0042').values;
  assert.equal(codeString(v), '0042');
  assert.equal(typeof codeString(v), 'string');
  assert.ok(codeComplete(v));
  assert.ok(!codeComplete(['0', '0', '4', '']));
});

test('formatSize', () => {
  assert.equal(formatSize(0), '');
  assert.equal(formatSize(512), '512 B');
  assert.equal(formatSize(2048), '2.0 KB');
  assert.equal(formatSize(5 * 1024 * 1024), '5.0 MB');
});

test('groupByWorkshop keeps first-seen order', () => {
  const g = groupByWorkshop([
    { workshopId: 'b', workshopTitle: 'B', id: 1 }, { workshopId: 'a', workshopTitle: 'A', id: 2 }, { workshopId: 'b', workshopTitle: 'B', id: 3 },
  ]);
  assert.deepEqual(g.map((x) => [x.workshopId, x.items.map((i) => i.id)]), [['b', [1, 3]], ['a', [2]]]);
});

test('tabFor', () => {
  assert.equal(tabFor('workshop'), 'workshops');
  assert.equal(tabFor('prompts'), 'workshops');
  assert.equal(tabFor('register'), 'redeem');
  assert.equal(tabFor('home'), 'home');
});
