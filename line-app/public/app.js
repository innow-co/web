// Innow learner app (LINE MINI App / LIFF). Plain ES module, no build step.
// All server-provided text is rendered with textContent (never innerHTML) to avoid stored XSS.
import {
  parseRoute, routeUrl, addFriendUrl, isHttps, spreadDigits, codeString, codeComplete,
  formatSize, groupByWorkshop, tabFor, isNotFriendError,
} from './lib-app.js';

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
  session: 'กรุณาเปิดแอปจาก LINE อีกครั้ง',
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
  if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return null; }
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
    if (e.status === 401 && !state.devId && window.liff) {
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
function openUrl(url, preOpened, { deferred = false } = {}) {
  if (state.inClient && window.liff) { preOpened?.close(); liff.openWindow({ url, external: true }); return; }
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

function wsCard(w) {
  const meta = [w.eventDate, w.counts ? `Slide ${w.counts.slide} · Prompt ${w.counts.prompt} · Bonus ${w.counts.bonus}` : ''].filter(Boolean).join(' · ');
  return h('button', { class: 'card ws', type: 'button', onclick: () => go({ name: 'workshop', id: w.id }) },
    h('span', { class: 'badge', 'aria-hidden': 'true', text: Array.from(w.title || 'W')[0].toUpperCase() }),
    h('span', { class: 'grow' }, h('span', { class: 't', text: w.title }), meta ? h('span', { class: 'm', text: meta }) : null),
    icon('chevron', 'arrow'));
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
      list.replaceChildren(...(rows.length
        ? rows.map((i) => itemCard(i))
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
