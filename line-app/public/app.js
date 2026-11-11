// Innow learner app (LINE MINI App / LIFF). Plain ES module, no build step.
// All server-provided text is rendered with textContent (never innerHTML) to avoid stored XSS.
import {
  parseRoute, routeUrl, addFriendUrl, isHttps, spreadDigits, codeString, codeComplete,
  formatSize, groupByWorkshop, tabFor, isNotFriendError, oaMessageUrl, canCallLiffLogin, googleSlidesInfo, slidesCardState, slidesCanEnter, slidesCanApply,
} from './lib-app.js';
import {
  STEPS, COURSE_DEFAULT, COURSE_GROUPS, EXPECTATIONS, emptyAnswers, validateStep, nextStep, prevStep,
  stepNumber, summaryRows, buildPayload, firstFailingStep, parseDraft,
} from './lib-wizard.js';
import * as consult from './lib-consult.js';

const $ = (id) => document.getElementById(id);
const view = $('view');
const tabbar = $('tabbar');

const state = {
  config: null, devId: null, inClient: false,
  session: null, isFriend: true, profile: null, member: null,
  pending: null,   // { workshop, redeemToken } between a valid code and the registration form
  success: null,   // { status, workshop }
  gateMessage: '',
};
let renderSeq = 0;

const MSG = {
  offline: 'เชื่อมต่ออินเทอร์เน็ตไม่ได้ กรุณาตรวจสอบสัญญาณแล้วลองอีกครั้ง',
  generic: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง',
  session: 'เข้าสู่ระบบไม่สำเร็จ กรุณาเปิดแอปใหม่อีกครั้ง',
};

// ---------- tiny DOM helpers ----------

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}

// Static, trusted SVG strings only (never server data).
const ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/>',
  library: '<rect x="4" y="4" width="6" height="16" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  hash: '<path d="M9 4 7 20M17 4l-2 16M4 9h17M3 15h17"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20c.8-4 3.7-6 7.5-6s6.7 2 7.5 6"/>',
  slide: '<rect x="3.5" y="4.5" width="17" height="11" rx="2"/><path d="M12 15.5V20M8 20h8"/>',
  prompt: '<path d="M12 3.5a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V17h5.2v-.7c0-.8.4-1.5 1-2A6 6 0 0 0 12 3.5Z"/><path d="M9.7 20.5h4.6"/>',
  gift: '<rect x="4" y="9" width="16" height="11" rx="1.5"/><path d="M3 9h18v-0M12 9v11M12 9c-1-3.5-5-4-5-1.7C7 9 9 9 12 9Zm0 0c1-3.5 5-4 5-1.7C17 9 15 9 12 9Z"/>',
  award: '<circle cx="12" cy="9" r="5.5"/><path d="m8.8 13.8-1.3 6.2 4.5-2.4 4.5 2.4-1.3-6.2"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>',
  file: '<path d="M7 3.5h7l4 4V20.5H7z"/><path d="M14 3.5v4h4"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
  doc: '<path d="M7 3.5h7l4 4V20.5H7z"/><path d="M14 3.5v4h4M9.5 12h5M9.5 15.5h5"/>',
  spark: '<path d="M11 3.5l1.9 5.6 5.6 1.9-5.6 1.9L11 18.5l-1.9-5.6L3.5 11l5.6-1.9z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
  chat: '<path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 17h-7l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5Z"/><path d="M8 10h8M8 13h5"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
};
function icon(name, cls = 'ico') {
  const span = document.createElement('span');
  span.className = cls;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return span;
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

const setBusy = (btn, busy) => { if (btn) { btn.disabled = busy; btn.setAttribute('aria-busy', busy ? 'true' : 'false'); } };

// ---------- API ----------

class ApiError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}

function saveSession(s) {
  state.session = s;
  try { if (s) sessionStorage.setItem('innow.session', s); else sessionStorage.removeItem('innow.session'); } catch { /* storage blocked */ }
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth && state.session) headers.authorization = 'Bearer ' + state.session;
  let res;
  try {
    res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, MSG.offline, { offline: true });
  }
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON error page: never show it */ }
  if (!res.ok) {
    const msg = typeof data?.error === 'string' && data.error ? data.error : MSG.generic;
    throw new ApiError(res.status, msg, { reauth: !!data?.reauth, notFriend: !!data?.notFriend, errors: data?.errors || null });
  }
  return data;
}

let reauthPromise = null;
function reauth() {
  reauthPromise ||= authenticate().finally(() => { reauthPromise = null; });
  return reauthPromise;
}

// Any 401: re-run LINE auth once and retry. 403 notFriend: show the Add / Unblock page.
async function api(path, opts = {}, canRetry = true) {
  try {
    return await request(path, opts);
  } catch (e) {
    if (e.status === 401 && canRetry) {
      await reauth();
      if (!state.isFriend) throw new ApiError(403, '', { notFriend: true });
      return api(path, opts, false);
    }
    if (e.notFriend) state.isFriend = false;
    throw e;
  }
}

// ---------- LINE login / auth ----------

async function lineToken() {
  if (state.devId) return 'dev:' + state.devId;
  if (!window.liff) throw new ApiError(0, MSG.offline, { offline: true });
  if (!liff.isLoggedIn()) {
    // Inside LINE, liff.init() logs in by itself; calling liff.login() there is not allowed.
    if (!canCallLiffLogin({ inClient: liff.isInClient() })) throw new ApiError(401, MSG.session);
    liff.login({ redirectUri: location.href });
    return null;
  }
  return liff.getAccessToken();
}

async function authenticate() {
  const token = await lineToken();
  if (!token) return new Promise(() => {}); // redirecting to LINE Login
  let data;
  try {
    data = await request('/api/auth', { method: 'POST', body: { accessToken: token }, auth: false });
  } catch (e) {
    // Expired LINE token: log in again, but only once per tab so a misconfigured server cannot loop.
    // Never inside the LINE client: there the error screen asks the user to reopen the app.
    if (e.status === 401 && !state.devId && window.liff && canCallLiffLogin({ inClient: liff.isInClient() })) {
      let tried = false;
      try { tried = sessionStorage.getItem('innow.relogin') === '1'; sessionStorage.setItem('innow.relogin', '1'); } catch { /* ignore */ }
      if (!tried) { liff.logout(); liff.login({ redirectUri: location.href }); return new Promise(() => {}); }
    }
    throw e;
  }
  try { sessionStorage.removeItem('innow.relogin'); } catch { /* ignore */ }
  saveSession(data.session);
  state.isFriend = !!data.isFriend;
  state.profile = data.profile || null;
  state.member = data.member || null;
  return data;
}

// ---------- routing ----------

function urlFor(route) { return routeUrl(route, { dev: state.devId }); }

function go(route, { replace = false } = {}) {
  const r = typeof route === 'string' ? { name: route } : route;
  const url = urlFor(r);
  if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
  return render(r);
}

function updateTabs(name) {
  const active = tabFor(name);
  for (const b of tabbar.querySelectorAll('button')) {
    const on = b.dataset.go === active;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
}

function mount(title, ...nodes) { return mountWith(null, title, ...nodes); }
function mountWith(focusEl, title, ...nodes) {
  const root = h('div', { class: 'screen' }, ...nodes);
  releaseSlides(root);
  view.replaceChildren(root);
  document.title = title ? `${title} · Innow Workshop` : 'Innow Workshop';
  window.scrollTo(0, 0);
  const heading = focusEl || view.querySelector('h1');
  if (focusEl) focusEl.focus({ preventScroll: true });
  else if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
}

function loading() {
  view.replaceChildren(h('div', { class: 'center' }, h('div', { class: 'spinner', role: 'status', 'aria-label': 'กำลังโหลด' })));
}

function errorScreen(message, retry) {
  tabbar.hidden = !state.session;
  mount('เกิดข้อผิดพลาด',
    h('div', { class: 'empty' },
      h('h1', { text: 'ไม่สามารถโหลดข้อมูลได้' }),
      h('p', { role: 'alert', text: message || MSG.generic }),
      retry ? h('div', { class: 'row center-row' }, h('button', { class: 'btn small', onclick: retry, text: 'ลองอีกครั้ง' })) : null));
}

const navBtn = (label, route, cls = 'btn') => h('button', { class: cls, type: 'button', onclick: () => go(route), text: label });

async function render(route) {
  const seq = ++renderSeq;
  if (!state.isFriend && state.config?.requireFriend !== false) return renderGate();
  tabbar.hidden = false;
  updateTabs(route.name);
  loading();
  try {
    const screen = await screens[route.name](route, seq);
    if (seq !== renderSeq || !screen) return;
    mountWith(screen.focus, screen.title, ...screen.nodes);
  } catch (e) {
    if (seq !== renderSeq) return;
    if (e.notFriend || (!state.isFriend && state.config?.requireFriend !== false)) return renderGate();
    errorScreen(e.status === 401 ? MSG.session : e.message, () => render(route));
  }
}

// ---------- Step 02: Add / Unblock gate ----------

function renderGate(note = '') {
  renderSeq++;
  tabbar.hidden = true;
  const url = addFriendUrl(state.config?.oaBasicId);
  const status = h('p', { class: 'err', role: 'status', text: note });
  const check = h('button', { class: 'btn ghost', type: 'button', text: 'ตรวจอีกครั้ง' });
  check.addEventListener('click', async () => {
    setBusy(check, true);
    status.textContent = 'กำลังตรวจสอบ…';
    try {
      await authenticate();
      if (state.isFriend) return render(parseRoute(location.search));
      renderGate('ยังไม่พบสถานะเพื่อนของ Innow กรุณาเพิ่มเพื่อนหรือปลดบล็อกก่อน แล้วลองอีกครั้ง');
    } catch (e) {
      status.textContent = e.message || MSG.generic;
      setBusy(check, false);
    }
  });
  const add = url
    ? h('a', {
      class: 'btn line', href: url, target: '_blank', rel: 'noopener noreferrer',
      onclick: (ev) => { if (state.inClient && window.liff) { ev.preventDefault(); liff.openWindow({ url, external: false }); } },
      text: 'เพิ่มเพื่อน Innow',
    })
    : h('p', { class: 'lead', text: 'ค้นหา Innow Official Account ใน LINE แล้วเพิ่มเป็นเพื่อน' });
  mount('เพิ่มเพื่อนก่อนเริ่มใช้งาน',
    h('div', { class: 'card gate stack' },
      h('h1', { text: 'เพิ่มเพื่อน Innow ก่อนเริ่มใช้งาน' }),
      h('p', { class: 'lead', text: 'Innow ใช้ LINE Official Account เป็นช่องทางแจ้งสื่อการเรียนและเปิดแอปนี้ กรุณาเพิ่มเป็นเพื่อน หากเคยบล็อกไว้ให้ปลดบล็อกก่อน แล้วกลับมากด “ตรวจอีกครั้ง”' }),
      add, check, status));
}

// ---------- screens ----------

const KIND = {
  slide: { label: 'Slide ที่เรียน', sub: 'เอกสารประกอบการอบรม', icon: 'slide' },
  prompt: { label: 'Prompt Library', sub: 'Prompt พร้อมคัดลอก', icon: 'prompt' },
  bonus: { label: 'Workshop Bonus', sub: 'บทเรียนและไฟล์เสริม', icon: 'gift' },
};

const getMe = () => api('/api/me');

function backBtn(label, route) {
  return h('button', { class: 'back', type: 'button', onclick: () => go(route) }, '‹ ', label);
}

function emptyBox(text, ...actions) {
  return h('div', { class: 'empty' }, h('p', { text }), actions.length ? h('div', { class: 'row center-row' }, actions) : null);
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through to legacy path */ }
  const ta = h('textarea', { 'aria-hidden': 'true', tabindex: '-1', readonly: true, class: 'offscreen' });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

// Open in a new tab without ever navigating the app's own tab: a real anchor click honours noopener.
function clickAnchor(url) {
  const a = h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: 'offscreen' });
  document.body.append(a);
  a.click();
  a.remove();
}

function linkToast(url) {
  const t = $('toast');
  t.replaceChildren('เบราว์เซอร์บล็อกการเปิดแท็บใหม่ ', h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: 'toast-link', text: 'แตะเพื่อเปิดไฟล์' }));
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 20000);
}

// preOpened: a blank tab opened synchronously on tap (null when blocked or not needed).
function openUrl(url, preOpened, { deferred = false, external = true } = {}) {
  if (state.inClient && window.liff) { preOpened?.close(); liff.openWindow({ url, external }); return; }
  if (preOpened && !preOpened.closed) { preOpened.location.href = url; return; }
  if (deferred) return linkToast(url); // tab was blocked and we are no longer inside the tap
  clickAnchor(url);
}

function actionError(e) {
  if (e.notFriend) return renderGate();
  toast(e.message || MSG.generic);
}

async function openFile(item, btn) {
  // Open the tab synchronously (inside the tap) so the popup blocker allows it, then point it at the signed link.
  const pre = !state.inClient ? window.open('', '_blank') : null;
  try { if (pre) pre.opener = null; } catch { /* ignore */ }
  setBusy(btn, true);
  try {
    const { url } = await api(`/api/items/${item.id}/link`, { method: 'POST' });
    openUrl(url, pre, { deferred: true });
  } catch (e) {
    pre?.close();
    actionError(e);
  } finally {
    setBusy(btn, false);
  }
}

function itemCard(it, showWorkshop = false) {
  const meta = [it.category, it.hasFile ? [it.fileName, formatSize(it.size)].filter(Boolean).join(' · ') : ''].filter(Boolean);
  const actions = [];
  if (it.kind === 'prompt') {
    const copy = h('button', { class: 'btn small', type: 'button' }, icon('copy', 'ico sm'), 'คัดลอก');
    copy.addEventListener('click', async () => {
      const ok = await copyText(it.body || '');
      toast(ok ? 'คัดลอก Prompt แล้ว' : 'คัดลอกไม่สำเร็จ กรุณากดค้างที่ข้อความเพื่อคัดลอก');
      if (ok) { copy.lastChild.textContent = 'คัดลอกแล้ว'; setTimeout(() => { copy.lastChild.textContent = 'คัดลอก'; }, 1800); }
    });
    actions.push(copy);
  }
  if (it.hasFile) {
    const b = h('button', { class: 'btn small', type: 'button' }, icon('file', 'ico sm'), 'เปิดไฟล์');
    b.addEventListener('click', () => openFile(it, b));
    actions.push(b);
  }
  if (isHttps(it.url)) {
    actions.push(h('button', { class: 'btn small ghost', type: 'button', onclick: () => openUrl(it.url) }, icon('link', 'ico sm'), 'เปิดลิงก์'));
  }
  return h('article', { class: 'card item' },
    showWorkshop && it.workshopTitle ? h('div', { class: 'meta', text: it.workshopTitle }) : null,
    h('h3', { text: it.title }),
    meta.length ? h('div', { class: 'meta' }, meta.map((m, i) => (i === 0 && it.category ? h('span', { class: 'chip', text: m }) : h('span', { text: (i ? ' ' : '') + m })))) : null,
    it.kind === 'prompt'
      ? (it.body ? h('pre', { class: 'prompt', tabindex: '0', text: it.body }) : null)
      : (it.body ? h('p', { text: it.body }) : null),
    actions.length ? h('div', { class: 'row' }, actions) : null);
}

// ---------- Google Slides viewer ----------
// A slide item whose url is a Google Slides deck renders as an embedded viewer. The iframe is created ONLY from
// googleSlidesInfo().embedUrl, and only after the learner taps (so Google is not contacted before they opt in).
// Full screen: native Fullscreen API on the frame when it works, otherwise the same frame becomes a fixed in-app
// overlay (class .slides-full). The iframe element is never moved or recreated, so the slide position is kept.
const liveSlides = new Set(); // { frame, destroy } of every rendered card
// Destroy the cards that are not inside `keep` (the root about to be mounted): the screen function builds its cards
// BEFORE mountWith runs, so those must survive, while the previous screen's cards must go.
function releaseSlides(keep = null) {
  for (const c of [...liveSlides]) {
    if (keep && keep.contains(c.frame)) continue;
    liveSlides.delete(c);
    c.destroy();
  }
}

function slidesCard(it) {
  const info = googleSlidesInfo(it.url);
  if (!info) return itemCard(it);
  let st = 'poster';
  let iframe = null;
  let pending = false;   // a native fullscreen request is in flight
  let destroyed = false; // the screen was replaced: late results must not touch the page
  const frame = h('div', { class: 'slides-frame' });
  const closeBtn = h('button', { class: 'slides-close', type: 'button', hidden: true, text: 'ปิด' });
  const fsBtn = h('button', { class: 'btn small', type: 'button' }, icon('expand', 'ico sm'), 'เต็มจอ');
  const extBtn = h('button', { class: 'btn small ghost', type: 'button' }, icon('link', 'ico sm'), 'เปิดนอกแอป');

  function ensureFrame() {
    if (iframe) return;
    iframe = h('iframe', {
      class: 'slides-iframe', title: it.title, loading: 'lazy', referrerpolicy: 'no-referrer',
      allow: 'fullscreen', allowfullscreen: true,
      sandbox: 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox',
    });
    iframe.src = info.embedUrl;
    frame.prepend(iframe);
    poster.hidden = true;
  }

  const poster = h('div', { class: 'slides-poster' },
    h('button', { class: 'slides-play', type: 'button', onclick: () => { ensureFrame(); apply(slidesCardState(st, 'load')); iframe.focus(); } },
      icon('slide', 'ico big'),
      h('b', { text: 'แตะเพื่อดูสไลด์' }),
      h('em', { text: 'สไลด์จาก Google Slides' })));
  frame.append(poster, closeBtn);

  const keepFocusInside = (e) => { if (!frame.contains(e.target)) closeBtn.focus(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); closeFull(); } };
  const nativeEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  const onFullChange = () => {
    if (destroyed) return;
    const el = nativeEl();
    if (el === frame) { if (st === 'overlay') apply(slidesCardState(st, 'native-entered')); } // late success: overlay -> native
    else if (!el && (st === 'native' || st === 'overlay')) apply(slidesCardState(st, 'native-exit'));
  };

  function apply(next) {
    const was = st;
    st = next;
    const full = st === 'native' || st === 'overlay';
    const overlay = st === 'overlay';
    frame.classList.toggle('is-full', full);
    frame.classList.toggle('slides-full', overlay);
    closeBtn.hidden = !full;
    if (overlay) {
      frame.setAttribute('role', 'dialog');
      frame.setAttribute('aria-modal', 'true');
      frame.setAttribute('aria-label', it.title);
    } else {
      frame.removeAttribute('role');
      frame.removeAttribute('aria-modal');
      frame.removeAttribute('aria-label');
    }
    if (overlay && was !== 'overlay') {
      document.body.classList.add('slides-lock');
      document.addEventListener('keydown', onKey);
      document.addEventListener('focusin', keepFocusInside);
      closeBtn.focus();
    } else if (!overlay && was === 'overlay') {
      document.body.classList.remove('slides-lock');
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', keepFocusInside);
    }
  }

  async function enterFull() {
    if (!slidesCanEnter({ pending, destroyed, state: st })) return;
    pending = true;
    try {
      ensureFrame();
      let native = false;
      const req = frame.requestFullscreen || frame.webkitRequestFullscreen;
      if (req) {
        try {
          const r = req.call(frame);
          const isPromise = !!r && typeof r.then === 'function';
          // Some embedded browsers never settle the promise nor fire fullscreenerror, and old webkit returns nothing:
          // wait for the promise or a fullscreenchange, give up after a moment, then verify what really happened.
          const changed = new Promise((res) => {
            frame.addEventListener('fullscreenchange', res, { once: true });
            frame.addEventListener('webkitfullscreenchange', res, { once: true });
          });
          await Promise.race([isPromise ? r : changed, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 1200))]);
          native = nativeEl() === frame;
        } catch { native = false; }
      }
      if (!slidesCanApply({ destroyed, connected: frame.isConnected })) {
        if (nativeEl() === frame) closeFull(false); // late success on a card that is gone: leave fullscreen
        return;
      }
      apply(slidesCardState(st, 'fullscreen', { native }));
    } finally {
      pending = false;
    }
  }

  function closeFull(refocus = true) {
    // Leave native fullscreen whatever the card state says (a late request may succeed while the overlay is open).
    if (nativeEl() === frame) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      try { const r = exit && exit.call(document); if (r && r.catch) r.catch(() => {}); } catch { /* already out */ }
    }
    apply(slidesCardState(st, 'close'));
    if (refocus && !destroyed) fsBtn.focus();
  }

  const destroy = () => { destroyed = true; pending = false; closeFull(false); };
  liveSlides.add({ frame, destroy });

  frame.addEventListener('fullscreenchange', onFullChange);
  frame.addEventListener('webkitfullscreenchange', onFullChange);
  frame.addEventListener('fullscreenerror', () => { if (st === 'native' && !destroyed) apply(slidesCardState('loaded', 'fullscreen', { native: false })); });
  closeBtn.addEventListener('click', () => closeFull());
  fsBtn.addEventListener('click', enterFull);
  extBtn.addEventListener('click', () => openUrl(info.openUrl));

  let fileBtn = null;
  if (it.hasFile) {
    fileBtn = h('button', { class: 'btn small', type: 'button' }, icon('file', 'ico sm'), 'เปิดไฟล์');
    fileBtn.addEventListener('click', () => openFile(it, fileBtn));
  }
  return h('article', { class: 'card item slides-card' },
    h('h3', { text: it.title }),
    it.category ? h('div', { class: 'meta' }, h('span', { class: 'chip', text: it.category })) : null,
    it.body ? h('p', { text: it.body }) : null,
    frame,
    h('div', { class: 'row' }, fsBtn, extBtn, fileBtn));
}
// ---------- end Google Slides viewer ----------

function wsCard(w) {
  const meta = [w.eventDate, w.counts ? `Slide ${w.counts.slide} · Prompt ${w.counts.prompt} · Bonus ${w.counts.bonus}` : ''].filter(Boolean).join(' · ');
  return h('button', { class: 'card ws', type: 'button', onclick: () => go({ name: 'workshop', id: w.id }) },
    h('span', { class: 'badge', 'aria-hidden': 'true', text: Array.from(w.title || 'W')[0].toUpperCase() }),
    h('span', { class: 'grow' }, h('span', { class: 't', text: w.title }), meta ? h('span', { class: 'm', text: meta }) : null),
    icon('chevron', 'arrow'));
}


// ---------- Contact: choices + quote wizard ----------

const OA_CHAT_TEXT = 'สอบถามบทเรียนที่เรียนไปแล้ว';
const DRAFT_KEY = 'innow.inquiry';

// The draft (answers + current step + whether the wizard was open) lives in sessionStorage until a successful send.
function readDraft(prefill) {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    const d = raw ? parseDraft(raw, prefill) : null;
    return d ? { ...d, open: JSON.parse(raw).open === true } : null;
  } catch { return null; }
}
function writeDraft(w) {
  try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ step: w.step, answers: w.answers, open: w.open })); } catch { /* storage blocked */ }
}
function clearDraft() { try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } }

function draftHasContent(w, prefill) {
  const a = w.answers;
  return !!(a.organization || a.expectation || a.learners || a.details || a.course !== COURSE_DEFAULT || (a.email && a.email !== prefill));
}

function choiceCard(iconName, title, sub, props) {
  const tag = props.href ? 'a' : 'button';
  return h(tag, { class: 'choice', ...(tag === 'button' ? { type: 'button' } : {}), ...props },
    icon(iconName, 'ico'),
    h('span', { class: 'grow' }, h('b', { text: title }), h('em', { text: sub })),
    icon('chevron', 'ico sm chev'));
}

function wzProgress(n, label, total = STEPS.length) {
  const bar = h('span');
  bar.style.width = Math.round((n / total) * 100) + '%';
  return h('div', { class: 'wz-top' },
    h('p', { class: 'wz-count', text: label }),
    h('div', { class: 'wz-bar', role: 'progressbar', 'aria-label': 'ความคืบหน้า', 'aria-valuemin': '1', 'aria-valuemax': String(total), 'aria-valuenow': String(n) }, bar));
}

function wizardStep(w) {
  const id = w.step;
  if (id === 'summary') return wizardSummary(w);
  const step = STEPS.find((x) => x.id === id);
  const errBox = h('div', { class: 'e', id: 'wz-err', role: 'alert', text: w.errors[id] || '' });
  const qid = 'wz-q';
  let field; let focusEl; let read;
  const clearErr = () => { errBox.textContent = ''; focusEl.removeAttribute('aria-invalid'); delete w.errors[id]; };
  const save = (v) => { w.answers[id] = v; writeDraft(w); };

  if (id === 'course' || id === 'expectation') {
    const radio = (value) => {
      const input = h('input', { type: 'radio', name: id, value, checked: w.answers[id] === value, 'aria-describedby': 'wz-err' });
      input.addEventListener('change', () => { save(value); clearErr(); });
      return h('label', { class: 'wz-choice' }, input, h('span', { text: value }));
    };
    const list = id === 'course'
      ? [radio(COURSE_DEFAULT), ...COURSE_GROUPS.flatMap((g, i) => [h('p', { class: 'wz-group', id: 'wz-g' + i, text: g.label }), ...g.items.map(radio)])]
      : EXPECTATIONS.map(radio);
    field = h('div', { class: 'wz-choices', role: 'radiogroup', 'aria-labelledby': qid }, list);
    focusEl = field.querySelector('input:checked') || field.querySelector('input');
    read = () => field.querySelector('input:checked')?.value ?? '';
  } else if (id === 'details') {
    field = h('textarea', { id: 'wz-f', rows: '6', 'aria-labelledby': qid, 'aria-describedby': 'wz-hint wz-err', placeholder: 'เช่น หัวข้อที่อยากเรียน หรือโจทย์ของทีม', value: w.answers.details });
    focusEl = field;
    read = () => field.value;
  } else {
    const attrs = {
      organization: { type: 'text', autocomplete: 'organization', enterkeyhint: 'next' },
      learners: { type: 'text', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', enterkeyhint: 'next' },
      email: { type: 'email', inputmode: 'email', autocomplete: 'email', enterkeyhint: 'next' },
    }[id];
    field = h('input', { id: 'wz-f', 'aria-labelledby': qid, 'aria-describedby': 'wz-hint wz-err', value: w.answers[id], ...attrs });
    focusEl = field;
    read = () => field.value;
  }
  if (field.tagName === 'INPUT' || field.tagName === 'TEXTAREA') field.addEventListener('input', () => { save(read()); clearErr(); });
  if (w.errors[id]) focusEl.setAttribute('aria-invalid', 'true');

  const hints = {
    organization: 'ชื่อบริษัทหรือหน่วยงานที่ต้องการให้เราไปอบรม',
    learners: 'ใช้ประเมินรูปแบบห้องและจำนวนผู้ช่วยสอน',
    email: 'เราจะใช้อีเมลนี้ติดต่อกลับเพื่อจัดทำใบเสนอราคา',
    details: 'ไม่บังคับ ข้ามได้ถ้ายังไม่มี',
    course: 'ยังเลือกไม่ได้ก็ไม่เป็นไร ให้เราช่วยแนะนำ',
    expectation: 'เลือกรูปแบบที่ใกล้เคียงที่สุด',
  };
  const goNext = () => {
    w.errors = {};
    w.step = w.editing ? 'summary' : nextStep(id);
    w.editing = false;
    writeDraft(w);
    renderWizard(w);
  };
  const onSubmit = (ev) => {
    ev.preventDefault();
    const v = read();
    w.answers[id] = id === 'details' || id === 'course' || id === 'expectation' ? v : v.trim();
    const r = validateStep(id, w.answers);
    if (!r.ok) {
      errBox.textContent = r.error;
      focusEl.setAttribute('aria-invalid', 'true');
      focusEl.focus();
      return;
    }
    goNext();
  };
  const goBack = () => {
    const p = w.editing ? 'summary' : prevStep(id);
    if (!p) { w.open = false; writeDraft(w); return go({ name: 'contact' }, { replace: true }); }
    w.editing = false;
    w.step = p;
    writeDraft(w);
    renderWizard(w);
  };
  const skip = () => { w.answers[id] = ''; goNext(); };

  const form = h('form', { class: 'card wz', novalidate: true, onsubmit: onSubmit },
    wzProgress(stepNumber(id), `ข้อ ${stepNumber(id)} จาก ${STEPS.length}`),
    h('h1', { id: qid, text: step.question + (step.required ? '' : ' (ไม่บังคับ)') }),
    h('p', { class: 'lead', id: 'wz-hint', text: hints[id] }),
    field, errBox,
    h('div', { class: 'wz-actions' },
      h('button', { class: 'btn ghost', type: 'button', onclick: goBack, text: 'ย้อนกลับ' }),
      step.required ? null : h('button', { class: 'btn ghost', type: 'button', onclick: skip, text: 'ข้าม' }),
      h('button', { class: 'btn', type: 'submit', text: 'ถัดไป' })));
  return { focus: focusEl, title: 'ขอใบเสนอราคา', nodes: [form] };
}

function wizardSummary(w) {
  const formErr = h('div', { class: 'err', id: 'wz-form-err', role: 'alert', text: w.formError || '' });
  const submit = h('button', { class: 'btn wide', type: 'submit', text: w.retry ? 'ลองส่งอีกครั้ง' : 'ส่งคำขอใบเสนอราคา', 'aria-describedby': 'wz-form-err' });
  const rows = summaryRows(w.answers).map((r) => h('div', { class: 'wz-row' },
    h('div', { class: 'grow' }, h('div', { class: 'wz-k', text: r.label }), h('div', { class: 'wz-v', text: r.value })),
    h('button', { class: 'linkbtn', type: 'button', 'aria-label': `แก้ไข ${r.label}`, onclick: () => { w.step = r.step; w.editing = true; writeDraft(w); renderWizard(w); }, text: 'แก้ไข' })));
  const onSubmit = async (ev) => {
    ev.preventDefault();
    if (w.busy) return; // no double submit: set synchronously, before the first await
    w.busy = true;
    setBusy(submit, true);
    formErr.textContent = '';
    try {
      const r = await api('/api/inquiry', { method: 'POST', body: buildPayload(w.answers) });
      clearDraft();
      if (renderSeq !== w.seq) return;
      return mountWizardDone(w, r.forwarded === true);
    } catch (e) {
      if (renderSeq !== w.seq) return;
      if (e.notFriend) return renderGate();
      if (e.status === 422 && e.errors) {
        const first = firstFailingStep(e.errors);
        if (first) { w.errors = e.errors; w.step = first; w.editing = true; w.formError = ''; writeDraft(w); return renderWizard(w); }
      }
      w.retry = !!e.offline;
      formErr.textContent = e.message || MSG.generic;
      submit.textContent = w.retry ? 'ลองส่งอีกครั้ง' : 'ส่งคำขอใบเสนอราคา';
      submit.focus();
    } finally {
      w.busy = false;
      setBusy(submit, false);
    }
  };
  const form = h('form', { class: 'card wz', novalidate: true, onsubmit: onSubmit },
    wzProgress(STEPS.length, 'ตรวจสอบข้อมูลก่อนส่ง'),
    h('h1', { text: 'ตรวจสอบข้อมูลของคุณ' }),
    h('p', { class: 'lead', text: 'ถ้าต้องการแก้ข้อมูล แตะ “แก้ไข” ที่ข้อนั้น' }),
    h('div', { class: 'wz-rows' }, rows),
    formErr,
    h('div', { class: 'wz-actions' },
      h('button', { class: 'btn ghost', type: 'button', onclick: () => { w.step = prevStep('summary'); w.editing = false; w.formError = ''; writeDraft(w); renderWizard(w); }, text: 'ย้อนกลับ' }),
      submit));
  return { focus: null, title: 'ตรวจสอบข้อมูล', nodes: [form] };
}

function mountWizardDone(w, forwarded) {
  mount('ส่งคำขอแล้ว', h('div', { class: 'success' },
    icon('check', 'ico big'),
    h('h1', { text: 'ส่งคำขอแล้ว' }),
    h('p', { class: 'lead', text: forwarded ? 'ทีมงานจะติดต่อกลับทางอีเมลที่คุณระบุ' : 'เราบันทึกคำขอของคุณไว้แล้ว ทีมงานจะติดต่อกลับทางอีเมลที่คุณระบุ' }),
    h('p', { class: 'lead', text: w.answers.email }),
    h('div', { class: 'stack' }, h('button', { class: 'btn', type: 'button', onclick: () => go('home'), text: 'กลับหน้าหลัก' }))));
}

function renderWizard(w) {
  const s = wizardStep(w);
  mountWith(s.focus, s.title, ...s.nodes);
}

// ---------- Contact: AI automation consultation wizard ----------
// Same conventions as the quote wizard, own draft key (consult.DRAFT_KEY), own pure logic (lib-consult.js).

function readConsultDraft(prefill) {
  try {
    const raw = sessionStorage.getItem(consult.DRAFT_KEY);
    const d = raw ? consult.parseDraft(raw, prefill) : null;
    return d ? { ...d, open: JSON.parse(raw).open === true } : null;
  } catch { return null; }
}
function writeConsultDraft(w) {
  try { sessionStorage.setItem(consult.DRAFT_KEY, JSON.stringify({ step: w.step, answers: w.answers, open: w.open })); } catch { /* storage blocked */ }
}
function clearConsultDraft() { try { sessionStorage.removeItem(consult.DRAFT_KEY); } catch { /* ignore */ } }

function consultDraftHasContent(w, prefill) {
  const a = w.answers;
  return !!(a.organization || a.systems || a.goals || a.teamSize || (a.email && a.email !== prefill));
}

const CONSULT_HINTS = {
  organization: 'ชื่อบริษัทหรือหน่วยงานของคุณ',
  systems: 'เช่น Excel, Google Workspace, LINE OA, ระบบบัญชี/ERP, เว็บไซต์ เล่าคร่าวๆ ได้เลย',
  goals: 'เช่น สรุปรายงานประจำวัน ตอบแชตลูกค้าเบื้องต้น คัดแยกเอกสาร เล่าคร่าวๆ ได้เลย',
  teamSize: 'ไม่บังคับ ข้ามได้ถ้ายังไม่แน่ใจ',
  email: 'เราจะใช้อีเมลนี้ติดต่อกลับเรื่องการปรึกษา',
};

function consultStep(w) {
  const id = w.step;
  if (id === 'summary') return consultSummary(w);
  const step = consult.STEPS.find((x) => x.id === id);
  const errBox = h('div', { class: 'e', id: 'wz-err', role: 'alert', text: w.errors[id] || '' });
  const qid = 'wz-q';
  const common = { id: 'wz-f', 'aria-labelledby': qid, 'aria-describedby': 'wz-hint wz-err', value: w.answers[id] };
  const multiline = id === 'systems' || id === 'goals';
  const field = multiline
    ? h('textarea', { ...common, rows: '6' })
    : h('input', { ...common, ...({
      organization: { type: 'text', autocomplete: 'organization', enterkeyhint: 'next' },
      teamSize: { type: 'text', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', enterkeyhint: 'next' },
      email: { type: 'email', inputmode: 'email', autocomplete: 'email', enterkeyhint: 'next' },
    }[id]) });
  const clearErr = () => { errBox.textContent = ''; field.removeAttribute('aria-invalid'); delete w.errors[id]; };
  field.addEventListener('input', () => { w.answers[id] = field.value; writeConsultDraft(w); clearErr(); });
  if (w.errors[id]) field.setAttribute('aria-invalid', 'true');

  const goNext = () => {
    w.errors = {};
    w.step = w.editing ? 'summary' : consult.nextStep(id);
    w.editing = false;
    writeConsultDraft(w);
    renderConsult(w);
  };
  const onSubmit = (ev) => {
    ev.preventDefault();
    w.answers[id] = multiline ? field.value : field.value.trim();
    const r = consult.validateStep(id, w.answers);
    if (!r.ok) {
      errBox.textContent = r.error;
      field.setAttribute('aria-invalid', 'true');
      field.focus();
      return;
    }
    goNext();
  };
  const goBack = () => {
    const p = w.editing ? 'summary' : consult.prevStep(id);
    if (!p) { w.open = false; writeConsultDraft(w); return go({ name: 'contact' }, { replace: true }); }
    w.editing = false;
    w.step = p;
    writeConsultDraft(w);
    renderConsult(w);
  };
  const skip = () => { w.answers[id] = ''; goNext(); };

  const total = consult.STEPS.length;
  const form = h('form', { class: 'card wz', novalidate: true, onsubmit: onSubmit },
    wzProgress(consult.stepNumber(id), `ข้อ ${consult.stepNumber(id)} จาก ${total}`, total),
    h('h1', { id: qid, text: step.question + (step.required ? '' : ' (ไม่บังคับ)') }),
    h('p', { class: 'lead', id: 'wz-hint', text: CONSULT_HINTS[id] }),
    field, errBox,
    h('div', { class: 'wz-actions' },
      h('button', { class: 'btn ghost', type: 'button', onclick: goBack, text: 'ย้อนกลับ' }),
      step.required ? null : h('button', { class: 'btn ghost', type: 'button', onclick: skip, text: 'ข้าม' }),
      h('button', { class: 'btn', type: 'submit', text: 'ถัดไป' })));
  return { focus: field, title: 'ปรึกษา AI Automation', nodes: [form] };
}

function consultSummary(w) {
  const SEND = 'ส่งเรื่องปรึกษา';
  const formErr = h('div', { class: 'err', id: 'wz-form-err', role: 'alert', text: w.formError || '' });
  const submit = h('button', { class: 'btn wide', type: 'submit', text: w.retry ? 'ลองส่งอีกครั้ง' : SEND, 'aria-describedby': 'wz-form-err' });
  const rows = consult.summaryRows(w.answers).map((r) => h('div', { class: 'wz-row' },
    h('div', { class: 'grow' }, h('div', { class: 'wz-k', text: r.label }), h('div', { class: 'wz-v', text: r.value })),
    h('button', { class: 'linkbtn', type: 'button', 'aria-label': `แก้ไข ${r.label}`, onclick: () => { w.step = r.step; w.editing = true; writeConsultDraft(w); renderConsult(w); }, text: 'แก้ไข' })));
  const onSubmit = async (ev) => {
    ev.preventDefault();
    if (w.busy) return; // no double submit: set synchronously, before the first await
    w.busy = true;
    setBusy(submit, true);
    formErr.textContent = '';
    try {
      await api('/api/consultation', { method: 'POST', body: consult.buildPayload(w.answers) });
      clearConsultDraft();
      if (renderSeq !== w.seq) return;
      return mountConsultDone();
    } catch (e) {
      if (renderSeq !== w.seq) return;
      if (e.notFriend) return renderGate();
      if (e.status === 422 && e.errors) {
        const first = consult.firstFailingStep(e.errors);
        if (first) { w.errors = e.errors; w.step = first; w.editing = true; w.formError = ''; writeConsultDraft(w); return renderConsult(w); }
      }
      w.retry = !!e.offline;
      formErr.textContent = e.message || MSG.generic; // 429 shows the server's message
      submit.textContent = w.retry ? 'ลองส่งอีกครั้ง' : SEND;
      submit.focus();
    } finally {
      w.busy = false;
      setBusy(submit, false);
    }
  };
  const total = consult.STEPS.length;
  const form = h('form', { class: 'card wz', novalidate: true, onsubmit: onSubmit },
    wzProgress(total, 'ตรวจสอบข้อมูลก่อนส่ง', total),
    h('h1', { text: 'ตรวจสอบข้อมูลของคุณ' }),
    h('p', { class: 'lead', text: 'ถ้าต้องการแก้ข้อมูล แตะ “แก้ไข” ที่ข้อนั้น' }),
    h('div', { class: 'wz-rows' }, rows),
    formErr,
    h('div', { class: 'wz-actions' },
      h('button', { class: 'btn ghost', type: 'button', onclick: () => { w.step = consult.prevStep('summary'); w.editing = false; w.formError = ''; writeConsultDraft(w); renderConsult(w); }, text: 'ย้อนกลับ' }),
      submit));
  return { focus: null, title: 'ตรวจสอบข้อมูล', nodes: [form] };
}

function mountConsultDone() {
  mount('ส่งเรื่องปรึกษาแล้ว', h('div', { class: 'success' },
    icon('check', 'ico big'),
    h('h1', { text: 'ส่งเรื่องปรึกษาแล้ว' }),
    h('p', { class: 'lead', text: 'ทีมงานจะตรวจสอบข้อมูลของคุณและติดต่อกลับ' }),
    h('div', { class: 'stack' }, h('button', { class: 'btn', type: 'button', onclick: () => go('home'), text: 'กลับหน้าหลัก' }))));
}

function renderConsult(w) {
  const s = consultStep(w);
  mountWith(s.focus, s.title, ...s.nodes);
}

function openOaChat(ev, url) {
  if (state.inClient && window.liff) { ev.preventDefault(); openUrl(url, null, { external: false }); }
  // outside LINE the anchor (target=_blank, noopener) is followed normally
}

const screens = {
  async home() {
    const me = await getMe();
    state.member = me.member || state.member;
    const name = me.member?.firstName || me.profile?.displayName || '';
    const recent = me.workshops.slice(0, 3);
    return {
      title: 'หน้าหลัก',
      nodes: [
        h('div', { class: 'card hero-card' },
          h('h1', { text: name ? `สวัสดี ${name}` : 'ยินดีต้อนรับ' }),
          h('p', { class: 'lead', text: 'Workshop Library: เข้าถึงเอกสารและเครื่องมือจาก Workshop ที่คุณเข้าร่วม' })),
        h('div', { class: 'tiles gap-top' },
          tile('library', 'Workshop', 'คลังบทเรียน', () => go('workshops')),
          tile('hash', 'รับสิทธิ์', 'กรอกรหัส 4 หลัก', () => go('redeem')),
          tile('prompt', 'Prompt Library', 'รวม Prompt', () => go('prompts')),
          tile('gift', 'Bonus', 'Workshop เสริม', () => go('bonus'))),
        h('h2', { text: 'Workshop ของคุณ' }),
        recent.length
          ? h('div', { class: 'list' }, recent.map(wsCard))
          : emptyBox('คุณยังไม่มี Workshop กรอกรหัส 4 หลักจากผู้สอนเพื่อรับสิทธิ์', navBtn('กรอกรหัสรับสิทธิ์', 'redeem')),
        isHttps(state.config?.facebookUrl) ? h('p', { class: 'lead gap-top' }, 'ติดตามข่าวสารได้ที่ ', h('a', { class: 'news-link', href: state.config.facebookUrl, target: '_blank', rel: 'noopener noreferrer', text: 'Facebook Innow' })) : null,
      ],
    };
  },

  async workshops() {
    const me = await getMe();
    return {
      title: 'Workshop',
      nodes: [
        h('h1', { text: 'Workshop Library' }),
        h('p', { class: 'lead', text: 'เลือก Workshop ที่คุณมีสิทธิ์เข้าถึง' }),
        me.workshops.length
          ? h('div', { class: 'list' }, me.workshops.map(wsCard))
          : emptyBox('ยังไม่มี Workshop ในคลังของคุณ กรอกรหัส 4 หลักที่ผู้สอนแจ้งเพื่อรับสิทธิ์', navBtn('กรอกรหัสรับสิทธิ์', 'redeem')),
      ],
    };
  },

  async workshop(route) {
    let data;
    try { data = await api('/api/workshops/' + encodeURIComponent(route.id)); } catch (e) {
      if (isNotFriendError(e)) throw e;
      if (e.status === 403 || e.status === 404) {
        return { title: 'Workshop', nodes: [backBtn('Workshop ทั้งหมด', 'workshops'), h('h1', { text: 'เปิด Workshop ไม่ได้' }),
          emptyBox(e.status === 404 ? 'ไม่พบ Workshop นี้' : 'คุณยังไม่มีสิทธิ์ใน Workshop นี้ กรอกรหัส 4 หลักเพื่อรับสิทธิ์', navBtn('กรอกรหัสรับสิทธิ์', 'redeem'))] };
      }
      throw e;
    }
    const { workshop, items } = data;
    const byKind = (k) => items.filter((i) => i.kind === k);
    let section = 'slide';
    const list = h('div', { class: 'list', id: 'section-list' });
    const tiles = h('div', { class: 'tiles', role: 'group', 'aria-label': 'หมวดเนื้อหา' });
    const paint = () => {
      for (const b of tiles.querySelectorAll('button[data-kind]')) {
        const on = b.dataset.kind === section;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      }
      const rows = byKind(section);
      releaseSlides();
      list.replaceChildren(...(rows.length
        ? rows.map((i) => (i.kind === 'slide' && googleSlidesInfo(i.url) ? slidesCard(i) : itemCard(i)))
        : [emptyBox(`ยังไม่มี${KIND[section].label}ใน Workshop นี้`)]));
    };
    for (const k of ['slide', 'prompt', 'bonus']) {
      const t = tile(KIND[k].icon, KIND[k].label, `${byKind(k).length} รายการ`, () => { section = k; paint(); });
      t.dataset.kind = k;
      tiles.append(t);
    }
    const cert = tile('award', 'Certificate', 'Coming Soon', null);
    cert.disabled = true;
    cert.classList.add('soon');
    tiles.append(cert);
    paint();
    return {
      title: workshop.title,
      nodes: [
        backBtn('Workshop ทั้งหมด', 'workshops'),
        h('h1', { text: workshop.title }),
        workshop.description ? h('p', { class: 'lead', text: workshop.description }) : h('p', { class: 'lead', text: workshop.eventDate || '' }),
        tiles, list,
      ],
    };
  },

  async prompts() { return kindPage('prompt', 'Prompt Library', '/api/prompts'); },
  async bonus() { return kindPage('bonus', 'Workshop Bonus', '/api/bonus'); },

  async redeem() {
    const values = ['', '', '', ''];
    const err = h('div', { class: 'err', id: 'code-err', role: 'alert' });
    const boxes = [0, 1, 2, 3].map((i) => h('input', {
      type: 'text', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: i === 0 ? 'one-time-code' : 'off',
      'aria-label': `รหัส หลักที่ ${i + 1} จาก 4`, 'aria-describedby': 'code-err', enterkeyhint: i === 3 ? 'done' : 'next',
    }));
    const submit = h('button', { class: 'btn', type: 'submit', disabled: true, text: 'ยืนยันรหัส' });
    const sync = () => { boxes.forEach((b, i) => { b.value = values[i]; }); submit.disabled = !codeComplete(values); };
    const apply = (idx, text) => {
      const r = spreadDigits(values, idx, text);
      r.values.forEach((v, i) => { values[i] = v; });
      sync();
      if (text && String(text).replace(/\D/g, '')) boxes[r.focus].focus();
      else boxes[idx].focus();
      err.textContent = '';
      boxes.forEach((b) => b.removeAttribute('aria-invalid'));
    };
    boxes.forEach((b, i) => {
      b.addEventListener('input', (e) => apply(i, e.inputType === 'insertText' && e.data ? e.data : b.value));
      b.addEventListener('paste', (e) => { e.preventDefault(); apply(i, (e.clipboardData || window.clipboardData)?.getData('text') || ''); });
      b.addEventListener('focus', () => b.select());
      b.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !b.value && i > 0) { e.preventDefault(); values[i - 1] = ''; sync(); boxes[i - 1].focus(); }
        else if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); boxes[i - 1].focus(); }
        else if (e.key === 'ArrowRight' && i < 3) { e.preventDefault(); boxes[i + 1].focus(); }
      });
    });
    const form = h('form', { class: 'card', novalidate: true },
      h('div', { class: 'code-inputs', role: 'group', 'aria-labelledby': 'code-label' }, boxes),
      err, submit);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!codeComplete(values) || submit.disabled) return;
      setBusy(submit, true);
      err.textContent = '';
      try {
        // The code is always a STRING: "0042" must not become 42.
        const r = await api('/api/redeem', { method: 'POST', body: { code: codeString(values) } });
        if (r.status === 'register') {
          state.pending = { workshop: r.workshop, redeemToken: r.redeemToken };
          return go('register');
        }
        state.success = { status: r.status, workshop: r.workshop };
        return go('success');
      } catch (e2) {
        if (e2.notFriend) return renderGate();
        err.textContent = e2.message || MSG.generic;
        boxes.forEach((b) => b.setAttribute('aria-invalid', 'true'));
        submit.disabled = !codeComplete(values);
        boxes[3].focus();
      }
    });
    return {
      focus: boxes[0],
      title: 'รับสิทธิ์',
      nodes: [
        h('h1', { id: 'code-label', text: 'กรอกรหัส 4 หลัก' }),
        h('p', { class: 'lead', text: 'ผู้สอนจะแจ้งรหัสของ Workshop ให้ในห้องเรียน รหัสมีอายุจำกัด' }),
        form,
      ],
    };
  },

  async register() {
    if (!state.pending) { return screens.redeem(); }
    const { workshop, redeemToken } = state.pending;
    const fields = {};
    const mk = (name, label, attrs) => {
      const input = h('input', { id: 'f-' + name, name, 'aria-describedby': 'e-' + name, ...attrs });
      const e = h('div', { class: 'e', id: 'e-' + name, role: 'alert' });
      fields[name] = { input, e };
      return h('div', { class: 'field' }, h('label', { for: 'f-' + name }, label, ' ', h('span', { class: 'req', 'aria-hidden': 'true', text: '*' })), input, e);
    };
    const accept = h('input', { type: 'checkbox', id: 'f-acceptTerms', 'aria-describedby': 'e-acceptTerms' });
    const acceptErr = h('div', { class: 'e', id: 'e-acceptTerms', role: 'alert' });
    const marketing = h('input', { type: 'checkbox', id: 'f-marketing' });
    const formErr = h('div', { class: 'err', role: 'alert' });
    const submit = h('button', { class: 'btn', type: 'submit', text: 'บันทึกข้อมูลและรับสิทธิ์' });
    let busy = false;

    const showErrors = (errors) => {
      let first = null;
      for (const [name, f] of Object.entries(fields)) {
        f.e.textContent = errors[name] || '';
        if (errors[name]) { f.input.setAttribute('aria-invalid', 'true'); first ||= f.input; } else f.input.removeAttribute('aria-invalid');
      }
      acceptErr.textContent = errors.acceptTerms || '';
      if (errors.acceptTerms) { accept.setAttribute('aria-invalid', 'true'); first ||= accept; } else accept.removeAttribute('aria-invalid');
      first?.focus();
    };

    const form = h('form', { class: 'card', novalidate: true },
      mk('firstName', 'ชื่อจริง', { type: 'text', autocomplete: 'given-name', placeholder: 'กรอกชื่อจริง', maxlength: '100' }),
      mk('lastName', 'นามสกุลจริง', { type: 'text', autocomplete: 'family-name', placeholder: 'กรอกนามสกุล', maxlength: '100' }),
      mk('email', 'อีเมล', { type: 'email', inputmode: 'email', autocomplete: 'email', placeholder: 'name@example.com', maxlength: '200' }),
      h('div', { class: 'check' }, accept, h('label', { for: 'f-acceptTerms' }, 'รับทราบนโยบายความเป็นส่วนตัวและยอมรับข้อกำหนดการใช้บริการ ', h('span', { class: 'req', 'aria-hidden': 'true', text: '*' }))),
      h('button', { class: 'linkbtn', type: 'button', onclick: () => $('privacy').showModal(), text: 'อ่านนโยบายความเป็นส่วนตัว' }),
      acceptErr,
      h('div', { class: 'check' }, marketing, h('label', { for: 'f-marketing', text: 'ฉันยินยอมรับข่าวสารและโปรโมชันจาก Innow (ไม่บังคับ)' })),
      formErr, submit);

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (busy) return;
      busy = true;
      setBusy(submit, true);
      formErr.textContent = '';
      showErrors({});
      try {
        const r = await api('/api/register', {
          method: 'POST',
          body: {
            redeemToken,
            firstName: fields.firstName.input.value, lastName: fields.lastName.input.value, email: fields.email.input.value,
            acceptTerms: accept.checked, marketing: marketing.checked,
          },
        });
        state.pending = null;
        state.success = { status: r.status, workshop: r.workshop };
        return go('success');
      } catch (e) {
        if (e.notFriend) return renderGate();
        if (e.status === 422 && e.errors) showErrors(e.errors);
        else {
          formErr.textContent = e.message || MSG.generic;
          if (e.status === 400) { // redeem token expired or invalid: the code must be entered again
            state.pending = null;
            formErr.append(' ', h('button', { class: 'linkbtn', type: 'button', onclick: () => go('redeem'), text: 'กรอกรหัสใหม่' }));
          }
        }
      } finally {
        busy = false;
        setBusy(submit, false);
      }
    });
    return {
      title: 'สมัครสมาชิก',
      nodes: [
        h('h1', { text: 'สมัครสมาชิก Innow' }),
        h('p', { class: 'lead', text: 'กรอกข้อมูลสำหรับใช้จัดการสิทธิ์ Workshop และติดต่อเกี่ยวกับการเรียน' }),
        workshop?.title ? h('p', { class: 'chip-line' }, 'Workshop: ', h('span', { class: 'chip', text: workshop.title })) : null,
        form,
      ],
    };
  },

  async success() {
    const s = state.success;
    if (!s) return screens.home();
    const already = s.status === 'already';
    const w = s.workshop || {};
    return {
      title: 'รับสิทธิ์สำเร็จ',
      nodes: [h('div', { class: 'success' },
        icon('check', 'ico big'),
        h('h1', { text: already ? 'คุณมี Workshop นี้อยู่แล้ว' : 'รับสิทธิ์สำเร็จ' }),
        w.title ? h('p', { class: 'lead', text: w.title }) : null,
        h('div', { class: 'stack' },
          w.id ? h('button', { class: 'btn', type: 'button', onclick: () => { state.success = null; go({ name: 'workshop', id: w.id }); }, text: 'เปิด Workshop' }) : null,
          h('button', { class: 'btn ghost', type: 'button', onclick: () => go('workshops'), text: 'ดู Workshop ทั้งหมด' })))],
    };
  },


  async contact(route, seq) {
    const me = await getMe().catch((e) => { if (e.notFriend) throw e; return null; });
    const prefill = me?.member?.email || '';
    const saved = readDraft(prefill);
    const w = { step: saved?.step || 'organization', answers: saved?.answers || emptyAnswers(prefill), errors: {}, editing: false, busy: false, formError: '', retry: false, open: false, seq };
    if (saved?.open) { // refresh or return mid-wizard: pick up where the learner stopped
      w.open = true;
      const s = wizardStep(w);
      return s;
    }
    const csaved = readConsultDraft(prefill);
    const cw = { step: csaved?.step || 'organization', answers: csaved?.answers || consult.emptyAnswers(prefill), errors: {}, editing: false, busy: false, formError: '', retry: false, open: false, seq };
    if (csaved?.open) {
      cw.open = true;
      return consultStep(cw);
    }
    const chatUrl = oaMessageUrl(state.config?.oaBasicId, OA_CHAT_TEXT);
    const resume = saved && draftHasContent(w, prefill);
    const cresume = csaved && consultDraftHasContent(cw, prefill);
    return {
      title: 'ติดต่อเรา',
      nodes: [
        h('h1', { text: 'ติดต่อเรา' }),
        h('p', { class: 'lead', text: 'เลือกเรื่องที่ต้องการสอบถาม ทีมงาน Innow ยินดีช่วยเหลือ' }),
        h('div', { class: 'choices' },
          choiceCard('doc', 'สอบถามคอร์สอบรม', resume ? 'มีข้อมูลที่กรอกค้างไว้ แตะเพื่อกรอกต่อ' : 'ขอใบเสนอราคาอบรมสำหรับทีมของคุณ ตอบทีละข้อ', {
            onclick: () => { w.open = true; writeDraft(w); renderWizard(w); },
          }),
          chatUrl
            ? choiceCard('chat', 'สอบถามบทเรียนที่เรียนไปแล้ว', 'เปิดแชตกับทีมงาน Innow ใน LINE', { href: chatUrl, target: '_blank', rel: 'noopener noreferrer', onclick: (ev) => openOaChat(ev, chatUrl) })
            : choiceCard('chat', 'สอบถามบทเรียนที่เรียนไปแล้ว', 'ยังไม่สามารถเปิดแชตได้', { disabled: true, 'aria-disabled': 'true' }),
          choiceCard('spark', 'ปรึกษาการ Setup AI ทำ Automation ให้ระบบของคุณ', cresume ? 'มีข้อมูลที่กรอกค้างไว้ แตะเพื่อกรอกต่อ' : 'เล่าระบบที่ใช้อยู่ แล้วทีมงานจะช่วยดูว่า AI ทำงานแทนส่วนไหนได้', {
            onclick: () => { cw.open = true; writeConsultDraft(cw); renderConsult(cw); },
          })),
      ],
    };
  },

  async profile() {
    const me = await getMe();
    const pic = isHttps(me.profile?.pictureUrl) ? me.profile.pictureUrl : '';
    const m = me.member;
    return {
      title: 'โปรไฟล์',
      nodes: [
        h('h1', { text: 'โปรไฟล์' }),
        h('div', { class: 'card stack' },
          h('div', { class: 'profile-head' },
            pic ? h('img', { class: 'avatar', src: pic, alt: '', referrerpolicy: 'no-referrer' }) : h('span', { class: 'avatar ph', 'aria-hidden': 'true', text: Array.from(me.profile?.displayName || 'L')[0].toUpperCase() }),
            h('div', null, h('div', { class: 'name', text: me.profile?.displayName || '' }), h('div', { class: 'meta', text: 'บัญชี LINE' }))),
          m
            ? h('dl', null, h('dt', { text: 'ชื่อ' }), h('dd', { text: `${m.firstName} ${m.lastName}` }), h('dt', { text: 'อีเมล' }), h('dd', { text: m.email }),
              h('dt', { text: 'Workshop' }), h('dd', { text: `${me.workshops.length} รายการ` }))
            : h('p', { class: 'lead', text: 'ยังไม่ได้สมัครสมาชิก ระบบจะขอข้อมูลเมื่อคุณรับสิทธิ์ Workshop แรก' })),
        navBtn('กรอกรหัสรับสิทธิ์', 'redeem', 'btn ghost gap-top'),
      ],
    };
  },
};

function tile(iconName, title, sub, onclick) {
  return h('button', { class: 'tile', type: 'button', onclick }, icon(iconName, 'ico'), h('b', { text: title }), h('em', { text: sub }));
}

async function kindPage(kind, title, path) {
  const { items } = await api(path);
  const groups = groupByWorkshop(items);
  return {
    title,
    nodes: [
      h('h1', { text: title }),
      h('p', { class: 'lead', text: kind === 'prompt' ? 'Prompt จาก Workshop ที่คุณมีสิทธิ์ แตะ “คัดลอก” เพื่อนำไปใช้' : 'สื่อและไฟล์เสริมจาก Workshop ที่คุณมีสิทธิ์' }),
      groups.length
        ? groups.map((g) => h('section', { 'aria-label': g.title }, h('h2', { text: g.title }), h('div', { class: 'list' }, g.items.map((i) => itemCard(i)))))
        : emptyBox(`ยังไม่มี${title}จาก Workshop ของคุณ`, navBtn('กรอกรหัสรับสิทธิ์', 'redeem')),
    ],
  };
}

// ---------- boot ----------

function renderDevPicker() {
  tabbar.hidden = true;
  const input = h('input', { type: 'text', id: 'dev-id', placeholder: 'เช่น u1', autocapitalize: 'off', autocomplete: 'off' });
  const open = (id) => { const q = new URLSearchParams(location.search); q.set('dev', id); location.search = q.toString(); };
  mount('โหมดทดสอบ',
    h('div', { class: 'card stack' },
      h('h1', { text: 'โหมดทดสอบ (dev)' }),
      h('p', { class: 'lead', text: 'ไม่ได้เปิดจาก LINE เลือกผู้ใช้จำลอง ระบบนี้ใช้ได้เฉพาะเครื่องทดสอบ' }),
      ...['u1', 'u2', 'nofriend1'].map((id) => h('button', { class: 'btn ghost', type: 'button', onclick: () => open(id), text: id })),
      h('div', { class: 'field' }, h('label', { for: 'dev-id', text: 'หรือพิมพ์ user id' }), input),
      h('button', { class: 'btn', type: 'button', onclick: () => { const v = input.value.trim(); if (/^[\w-]{1,40}$/.test(v)) open(v); else input.focus(); }, text: 'เข้าใช้งาน' })));
}

async function boot() {
  loading();
  try {
    state.config = await request('/api/config', { auth: false });
  } catch (e) {
    return errorScreen(e.message, boot);
  }
  if (state.config.dev) window.__app = { go, state, parseRoute }; // debugging handle, local dev only
  try { state.session = sessionStorage.getItem('innow.session'); } catch { /* ignore */ }
  const dev = new URLSearchParams(location.search).get('dev');
  state.devId = state.config.dev && dev && /^[\w-]{1,40}$/.test(dev) ? dev : null;

  if (!state.devId) {
    if (!state.config.liffId || !window.liff) {
      if (state.config.dev) return renderDevPicker();
      return errorScreen('ยังไม่พร้อมใช้งาน กรุณาเปิดแอปจาก LINE');
    }
    try {
      await liff.init({ liffId: state.config.liffId });
    } catch {
      if (state.config.dev) return renderDevPicker();
      return errorScreen('ไม่สามารถเชื่อมต่อ LINE ได้ กรุณาเปิดแอปจาก LINE อีกครั้ง', boot);
    }
    state.inClient = liff.isInClient();
    if (state.config.dev && !state.inClient && !liff.isLoggedIn()) return renderDevPicker();
  }

  try {
    await authenticate();
  } catch (e) {
    return errorScreen(e.status === 401 ? MSG.session : e.message, boot);
  }
  if (state.devId) $('devtag').textContent = 'dev: ' + state.devId;
  render(parseRoute(location.search));
}

tabbar.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-go]');
  if (b) go(b.dataset.go);
});
for (const s of tabbar.querySelectorAll('[data-icon]')) s.replaceWith(icon(s.dataset.icon, 'ico'));
$('privacy-close').addEventListener('click', () => $('privacy').close());
window.addEventListener('popstate', () => render(parseRoute(location.search)));

boot();
