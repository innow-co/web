import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isNotFriendError, parseRoute, routeUrl, addFriendUrl, isHttps, spreadDigits, codeString, codeComplete,
  formatSize, groupByWorkshop, tabFor, canCallLiffLogin, googleSlidesInfo, slidesCardState,
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

test('canCallLiffLogin: never inside the LINE client, allowed in an external browser', () => {
  assert.equal(canCallLiffLogin({ inClient: true }), false);
  assert.equal(canCallLiffLogin({ inClient: false }), true);
  assert.equal(canCallLiffLogin({}), true);
  assert.equal(canCallLiffLogin(), true);
});

const ID = '1co_d3SABtpDn_J90KdThz_u-Mk_Q_Gk6w36uj0-ql8Q';
const BASE = 'https://docs.google.com/presentation/d/' + ID;
const OK = { id: ID, embedUrl: BASE + '/embed?start=false&loop=false&delayms=3000', openUrl: BASE + '/preview' };

test('googleSlidesInfo accepts Google Slides deck links and builds fixed embed/open urls', () => {
  for (const u of [
    BASE, BASE + '/', BASE + '/edit', BASE + '/preview', BASE + '/embed',
    BASE + '/edit?slide=id.watcharapol_trainer_slide', BASE + '/edit#slide=id.p3', BASE + '?usp=sharing',
    BASE + '/edit?usp=sharing&slide=id.g1#x',
  ]) assert.deepEqual(googleSlidesInfo(u), OK, u);
  assert.ok(!OK.openUrl.includes('/edit'));
});

test('googleSlidesInfo never forwards query or fragment of the original url', () => {
  const r = googleSlidesInfo(BASE + '/edit?slide=id.abc&rm=minimal#slide=id.p9');
  assert.ok(!/slide|rm=|#/.test(r.embedUrl.replace('start=false&loop=false&delayms=3000', '')));
  assert.ok(!/[?#]/.test(r.openUrl));
});

test('googleSlidesInfo rejects hostile and unsupported inputs', () => {
  const bad = [
    null, undefined, 42, {}, [], '', ' ', 'docs.google.com/presentation/d/' + ID,
    'http://docs.google.com/presentation/d/' + ID + '/edit',
    'HTTPS://docs.google.com/presentation/d/' + ID,
    'https://DOCS.GOOGLE.COM/presentation/d/' + ID + '/edit',
    'https://Docs.google.com/presentation/d/' + ID,
    'https://docs.google.com./presentation/d/' + ID,
    'https://docs.google.com:443/presentation/d/' + ID,
    'https://docs.google.com:8080/presentation/d/' + ID,
    'https://docs.google.com@evil.com/presentation/d/' + ID,
    'https://user:pw@docs.google.com/presentation/d/' + ID,
    'https://evil.com@docs.google.com/presentation/d/' + ID,
    'https://docs.google.com.evil.com/presentation/d/' + ID,
    'https://evildocs.google.com/presentation/d/' + ID,
    'https://docs.google.com.evil.com@docs.google.com/presentation/d/' + ID,
    'https://xdocs.google.com/presentation/d/' + ID,
    'https://docs.google.co/presentation/d/' + ID,
    'https://drive.google.com/presentation/d/' + ID,
    'https://docs.google.com/document/d/' + ID + '/edit',
    'https://docs.google.com/spreadsheets/d/' + ID + '/edit',
    'https://docs.google.com/forms/d/' + ID + '/edit',
    'https://docs.google.com/presentation/d/e/2PACX-1vQabcdefghijklmnopqrstuvwxyz/pub?start=false',
    'https://docs.google.com/presentation/d/e/2PACX-1vQabcdefghijklmnopqrstuvwxyz/embed',
    'https://docs.google.com/presentation/u/0/d/' + ID + '/edit',
    'https://docs.google.com/presentation/' + ID,
    'https://docs.google.com/presentation/d/',
    'https://docs.google.com/presentation/d//edit',
    'https://docs.google.com/presentation/d/short/edit',
    'https://docs.google.com/presentation/d/' + 'a'.repeat(19) + '/edit',
    'https://docs.google.com/presentation/d/' + 'a'.repeat(101) + '/edit',
    'https://docs.google.com/presentation/d/' + ID + 'x'.repeat(200),
    'https://docs.google.com/presentation/d/' + ID.slice(0, 20) + '%41' + ID.slice(23) + '/edit',
    'https://docs.google.com/presentation/d/' + ID.slice(0, 10) + '%2f..%2f' + ID.slice(10),
    'https://docs.google.com/presentation/d/' + ID.slice(0, 10) + '.' + ID.slice(10),
    'https://docs.google.com/presentation/d/' + ID.slice(0, 10) + '$' + ID.slice(10),
    'https://docs.google.com/presentation/d/' + ID + '.evil/edit',
    'https://docs.google.com/presentation/d/' + ID + '%2fedit',
    'https://docs.google.com\\@evil.com/presentation/d/' + ID,
    'https://docs.google.com\\presentation\\d\\' + ID,
    'https://docs.google.com//presentation/d/' + ID,
    ' ' + BASE + '/edit', BASE + '/edit ', '\t' + BASE, BASE + '\n', BASE + '/edit\n?x=1', BASE + '/ed it',
    'https://docs.google.com/pres entation/d/' + ID,
    BASE + '/edit\\evil', BASE + '/edit\u0000', BASE + '/\u202eedit',
    'javascript:alert(1)', 'javascript://docs.google.com/presentation/d/' + ID + '/%0aalert(1)',
    'data:text/html,<script>alert(1)</script>', 'data:text/html;base64,' + btoa(BASE),
    'file:///etc/passwd', 'ftp://docs.google.com/presentation/d/' + ID,
    'https:///docs.google.com/presentation/d/' + ID,
    'https:docs.google.com/presentation/d/' + ID,
    '//docs.google.com/presentation/d/' + ID,
    'https://docs.google.com/presentation/d/' + ID + '/edit' + 'a'.repeat(5000) + ' ',
    '#' + BASE, '?u=' + BASE, 'https://example.com/?u=' + BASE, 'https://example.com/#' + BASE,
  ];
  for (const u of bad) assert.equal(googleSlidesInfo(u), null, JSON.stringify(String(u)).slice(0, 120));
});

test('googleSlidesInfo accepts ids of 20 and 100 chars and ignores a lookalike embedded later in the url', () => {
  assert.equal(googleSlidesInfo('https://docs.google.com/presentation/d/' + 'a'.repeat(20) + '/edit').id, 'a'.repeat(20));
  assert.equal(googleSlidesInfo('https://docs.google.com/presentation/d/' + 'A_-9'.repeat(25) + '/edit').id.length, 100);
  const r = googleSlidesInfo(BASE + '/edit?next=https://evil.com/presentation/d/' + 'z'.repeat(30));
  assert.equal(r.id, ID);
  assert.ok(r.embedUrl.startsWith('https://docs.google.com/presentation/d/' + ID + '/embed?'));
});

test('slidesCardState: poster -> loaded -> fullscreen (native or overlay) -> close keeps loaded', () => {
  assert.equal(slidesCardState(undefined, 'load'), 'loaded');
  assert.equal(slidesCardState('poster', 'load'), 'loaded');
  assert.equal(slidesCardState('loaded', 'load'), 'loaded');
  assert.equal(slidesCardState('loaded', 'fullscreen', { native: true }), 'native');
  assert.equal(slidesCardState('loaded', 'fullscreen', { native: false }), 'overlay');
  assert.equal(slidesCardState('loaded', 'fullscreen'), 'overlay', 'unsupported by default -> overlay');
  assert.equal(slidesCardState('poster', 'fullscreen', { native: true }), 'native', 'fullscreen from the poster loads the deck');
  assert.equal(slidesCardState('poster', 'fullscreen', { native: false }), 'overlay');
  assert.equal(slidesCardState('native', 'close'), 'loaded');
  assert.equal(slidesCardState('overlay', 'close'), 'loaded');
  assert.equal(slidesCardState('poster', 'close'), 'poster', 'close never loads anything');
  assert.equal(slidesCardState('loaded', 'close'), 'loaded');
  assert.equal(slidesCardState('native', 'fullscreen', { native: false }), 'overlay', 'native failed -> overlay');
  assert.equal(slidesCardState('overlay', 'load'), 'overlay', 'load does not leave fullscreen');
  assert.equal(slidesCardState('native', 'load'), 'native');
});

test('slidesCardState ignores unknown states and events', () => {
  assert.equal(slidesCardState('bogus', 'close'), 'poster');
  assert.equal(slidesCardState('loaded', 'nope'), 'loaded');
  assert.equal(slidesCardState('loaded', undefined), 'loaded');
  assert.equal(slidesCardState('__proto__', 'load'), 'loaded');
});
