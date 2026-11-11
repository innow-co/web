// Innow Workshop admin page. Plain ES modules, no build step.
// All server-provided text goes through h() / textContent; nothing is ever put into innerHTML.
import {
  clockOffset, remainingMs, formatCountdown, formatCode, formatSize, isHttps, MAX_UPLOAD_BYTES, exceedsUpload, tooBigMessage, canPreviewType, baseType,
  actionLabel, csvFilename, prettyDetail, kindLabel,
} from './lib-admin.js';

const TOKEN_KEY = 'innow_admin_token';
const $ = (sel) => document.querySelector(sel);
const app = $('#app');

// ---------- tiny DOM builder ----------
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// An <a> that only ever gets an https:// href; anything else is shown as plain text.
function safeLink(url, text, attrs = {}) {
  if (!isHttps(url)) return h('span', {}, text ?? url);
  return h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', ...attrs }, text ?? url);
}

const fmtDate = (t) => (t ? new Date(t).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const fmtDay = (s) => {
  if (!s) return '';
  const d = new Date(s + 'T00:00:00');
  return isNaN(d) ? s : d.toLocaleDateString('th-TH', { dateStyle: 'long' });
};

// ---------- session & API ----------
let token = null;
try { token = sessionStorage.getItem(TOKEN_KEY); } catch { /* storage blocked: stay in memory */ }

function setToken(t) {
  token = t;
  try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function logout(message) {
  setToken(null);
  stopTimers();
  showLogin(message);
}

async function api(path, { method = 'GET', json, raw } = {}) {
  const headers = { authorization: 'Bearer ' + token };
  let body;
  if (json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); }
  let res;
  try { res = await fetch('/api/admin' + path, { method, headers, body }); }
  catch { throw new ApiError(0, 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่'); }
  if (res.status === 401) { logout('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง'); throw new ApiError(401, 'เซสชันหมดอายุ'); }
  if (raw) {
    if (!res.ok) throw new ApiError(res.status, await errText(res));
    return res;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || 'เกิดข้อผิดพลาด กรุณาลองใหม่');
  return data;
}

async function errText(res) {
  const d = await res.json().catch(() => null);
  return (d && d.error) || 'เกิดข้อผิดพลาด กรุณาลองใหม่';
}

// ---------- UI helpers ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

const dlg = $('#dlg');
let dlgOpener = null;
let dlgId = 0; // identifies the dialog currently shown, so late async results can tell if it is still theirs
function openDialog(content, { wide = false, onClose } = {}) {
  dlgId++;
  dlgOpener = document.activeElement;
  dlg.className = wide ? 'wide' : '';
  dlg.replaceChildren(content);
  dlg.onclose = () => {
    dlg.replaceChildren();
    if (dlgOpener && dlgOpener.isConnected) dlgOpener.focus();
    if (onClose) onClose();
  };
  dlg.showModal();
}
const closeDialog = () => { if (dlg.open) dlg.close(); };

// Resolves true when the admin confirms, false on cancel / Esc.
function confirmDialog({ title, message, confirmText = 'ยืนยัน', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    const cancel = h('button', { type: 'button', class: 'btn ghost', onclick: () => closeDialog() }, 'ยกเลิก');
    const ok = h('button', { type: 'button', class: 'btn' + (danger ? ' danger solid' : ''), onclick: () => { answer = true; closeDialog(); } }, confirmText);
    openDialog(h('div', { class: 'dlg' },
      h('h2', { id: 'dlg-title' }, title),
      h('p', {}, message),
      h('div', { class: 'row' }, cancel, ok)), { onClose: () => resolve(answer) });
    cancel.focus();
  });
}

function setBusy(btn, busy, label) {
  btn.disabled = busy;
  if (label !== undefined) btn.textContent = label;
}

// ---------- timers (cleared on every route change) ----------
const timers = new Set();
function every(fn, ms) { const id = setInterval(fn, ms); timers.add(id); return id; }
function stopTimers() { for (const id of timers) clearInterval(id); timers.clear(); }

// ---------- routing ----------
const TABS = [['code', 'รหัสเข้าร่วม'], ['slide', 'Slide'], ['prompt', 'Prompt Library'], ['bonus', 'Bonus'], ['members', 'ผู้เรียน']];

function parseHash() {
  const p = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (p[0] === 'w' && /^[\w-]+$/.test(p[1] || '')) return { name: 'workshop', id: p[1], tab: TABS.some(([k]) => k === p[2]) ? p[2] : 'code' };
  if (p[0] === 'members') return { name: 'members' };
  if (p[0] === 'audit') return { name: 'audit' };
  return { name: 'home' };
}

let renderSeq = 0;
async function route() {
  if (!token) return showLogin();
  stopTimers();
  closeDialog();
  const seq = ++renderSeq;
  const r = parseHash();
  const main = h('main', { id: 'main' }, h('div', { class: 'spinner', role: 'status', 'aria-label': 'กำลังโหลด' }));
  app.replaceChildren(shell(r), main);
  try {
    let view;
    if (r.name === 'home') view = await homeView();
    else if (r.name === 'workshop') view = await workshopView(r);
    else if (r.name === 'members') view = await membersView(null);
    else view = await auditView();
    if (seq !== renderSeq) return;
    main.replaceChildren(...view.nodes.filter(Boolean));
    if (view.after) view.after();
    const h1 = main.querySelector('h1');
    if (h1) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
  } catch (e) {
    if (seq !== renderSeq || e.status === 401) return;
    main.replaceChildren(h('div', { class: 'card' }, h('p', { class: 'e', role: 'alert' }, e.message), h('button', { type: 'button', class: 'btn', onclick: route }, 'ลองใหม่')));
  }
}

function shell(r) {
  const cur = (name) => (r.name === name ? 'page' : null);
  return h('header', { class: 'top' }, h('div', { class: 'top-in' },
    h('div', { class: 'brand' }, 'innow', h('small', {}, 'ผู้ดูแล Workshop')),
    h('nav', { class: 'nav', 'aria-label': 'เมนูผู้ดูแล' },
      h('a', { href: '#/', 'aria-current': r.name === 'home' || r.name === 'workshop' ? 'page' : null }, 'Workshop'),
      h('a', { href: '#/members', 'aria-current': cur('members') }, 'ผู้เรียนทั้งหมด'),
      h('a', { href: '#/audit', 'aria-current': cur('audit') }, 'บันทึกกิจกรรม'),
      h('button', { type: 'button', onclick: () => logout() }, 'ออกจากระบบ'))));
}

window.addEventListener('hashchange', route);

// ---------- login ----------
function showLogin(message) {
  stopTimers();
  renderSeq++;
  const err = h('p', { class: 'e', id: 'login-err', role: 'alert' }, message || '');
  const pw = h('input', { type: 'password', id: 'pw', autocomplete: 'current-password', required: true, 'aria-describedby': 'login-err' });
  const btn = h('button', { type: 'submit', class: 'btn block' }, 'เข้าสู่ระบบ');
  const form = h('form', { novalidate: true },
    h('div', { class: 'field' }, h('label', { for: 'pw' }, 'รหัสผ่านผู้ดูแล'), pw), err, btn);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.textContent = '';
    pw.removeAttribute('aria-invalid');
    if (!pw.value) { err.textContent = 'กรุณาใส่รหัสผ่าน'; pw.setAttribute('aria-invalid', 'true'); pw.focus(); return; }
    setBusy(btn, true, 'กำลังตรวจสอบ...');
    try {
      const res = await fetch('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw.value }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(res.status, data.error || 'เข้าสู่ระบบไม่สำเร็จ');
      pw.value = '';
      setToken(data.token);
      route();
    } catch (e) {
      err.textContent = e instanceof ApiError ? e.message : 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่';
      pw.setAttribute('aria-invalid', 'true');
      setBusy(btn, false, 'เข้าสู่ระบบ');
      pw.focus();
    }
  });
  const title = h('h1', { tabindex: '-1' }, 'ผู้ดูแล Innow Workshop');
  app.replaceChildren(h('main', { class: 'login' },
    h('div', { class: 'brand', style: 'color:var(--navy);margin-bottom:12px' }, 'innow'),
    title, h('p', { class: 'lead' }, 'กรอกรหัสผ่านเพื่อจัดการ Workshop รหัสเข้าร่วม และเนื้อหา'),
    h('div', { class: 'card' }, form)));
  (message ? title : pw).focus();
}

// ---------- home: stats + workshops ----------
async function homeView() {
  const [stats, ws] = await Promise.all([api('/stats'), api('/workshops')]);
  const stat = (n, label) => h('div', { class: 'stat' }, h('b', {}, n), h('span', {}, label));
  const addBtn = h('button', { type: 'button', class: 'btn', onclick: () => editWorkshopDialog(null) }, '+ สร้าง Workshop');
  const list = ws.workshops.length
    ? ws.workshops.map(workshopCard)
    : [h('div', { class: 'empty' }, 'ยังไม่มี Workshop กด "สร้าง Workshop" เพื่อเริ่มต้น')];
  return {
    nodes: [
      h('h1', {}, 'ภาพรวม'),
      h('p', { class: 'lead' }, 'สรุปจำนวนผู้เรียนและ Workshop ทั้งหมด'),
      h('div', { class: 'stats' },
        stat(stats.members, 'ผู้เรียนที่ลงทะเบียน'), stat(stats.workshops, 'Workshop'),
        stat(stats.enrollments, 'การรับสิทธิ์'), stat(stats.failedCodes24h, 'ใส่รหัสผิดใน 24 ชม.')),
      h('div', { class: 'toolbar', style: 'margin-top:24px' }, h('h2', { style: 'margin:0' }, 'Workshop'), addBtn),
      h('div', { class: 'list' }, ...list),
    ],
  };
}

function workshopCard(w) {
  return h('div', { class: 'card ws-card' },
    h('div', { class: 'info' },
      h('h3', {}, h('a', { href: '#/w/' + encodeURIComponent(w.id) + '/code' }, w.title)),
      h('div', { class: 'meta' }, [w.eventDate ? fmtDay(w.eventDate) : 'ยังไม่ระบุวันที่', ` · ${w.members} ผู้เรียน · ${w.items} รายการ `].join('')),
      w.description ? h('div', { class: 'meta' }, w.description) : null,
      h('span', { class: 'chip' + (w.active ? ' ok' : ' off') }, w.active ? 'เปิดใช้งาน' : 'ปิดอยู่')),
    h('div', { class: 'row' },
      h('a', { class: 'btn', href: '#/w/' + encodeURIComponent(w.id) + '/code' }, 'จัดการ'),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => editWorkshopDialog(w) }, 'แก้ไข'),
      h('button', { type: 'button', class: 'btn danger', onclick: () => deleteWorkshop(w) }, 'ลบ')));
}

function editWorkshopDialog(w) {
  const err = h('p', { class: 'e', role: 'alert' });
  const title = h('input', { type: 'text', id: 'wf-title', required: true, value: w?.title || '' });
  const date = h('input', { type: 'date', id: 'wf-date', value: w?.eventDate || '' });
  const desc = h('textarea', { id: 'wf-desc' }, w?.description || '');
  desc.style.minHeight = '90px';
  const active = h('input', { type: 'checkbox', id: 'wf-active' });
  active.checked = w ? w.active : true;
  const save = h('button', { type: 'submit', class: 'btn' }, 'บันทึก');
  const form = h('form', { class: 'dlg', novalidate: true },
    h('h2', { id: 'dlg-title' }, w ? 'แก้ไข Workshop' : 'สร้าง Workshop'),
    h('div', { class: 'field' }, h('label', { for: 'wf-title' }, 'ชื่อ Workshop ', h('span', { class: 'req', 'aria-hidden': 'true' }, '*')), title),
    h('div', { class: 'field' }, h('label', { for: 'wf-date' }, 'วันที่จัด'), date),
    h('div', { class: 'field' }, h('label', { for: 'wf-desc' }, 'รายละเอียด'), desc),
    h('div', { class: 'check' }, active, h('label', { for: 'wf-active' }, 'เปิดใช้งาน (ผู้เรียนเห็น Workshop นี้)')),
    err,
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn ghost', onclick: closeDialog }, 'ยกเลิก'), save));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.textContent = '';
    title.removeAttribute('aria-invalid');
    if (!title.value.trim()) { err.textContent = 'กรุณาใส่ชื่อ Workshop'; title.setAttribute('aria-invalid', 'true'); title.focus(); return; }
    setBusy(save, true, 'กำลังบันทึก...');
    try {
      const out = await api(w ? '/workshops/' + encodeURIComponent(w.id) : '/workshops', {
        method: w ? 'PUT' : 'POST',
        json: { title: title.value, description: desc.value, eventDate: date.value, active: active.checked },
      });
      closeDialog();
      toast(w ? 'บันทึกแล้ว' : 'สร้าง Workshop แล้ว');
      if (w) route(); else location.hash = '#/w/' + encodeURIComponent(out.id) + '/code';
    } catch (e) {
      if (e.status === 401) return;
      err.textContent = /UNIQUE|constraint/i.test(e.message) ? 'มี Workshop ชื่อนี้อยู่แล้ว' : e.message;
      setBusy(save, false, 'บันทึก');
    }
  });
  openDialog(form);
  title.focus();
}

async function deleteWorkshop(w) {
  const ok = await confirmDialog({
    title: `ลบ Workshop "${w.title}"?`,
    message: 'การลบจะลบรหัสเข้าร่วม เนื้อหา (Slide, Prompt, Bonus) ไฟล์ที่อัปโหลด และสิทธิ์เข้าถึงของผู้เรียนทั้งหมดใน Workshop นี้ ไม่สามารถกู้คืนได้',
    confirmText: 'ลบ Workshop', danger: true,
  });
  if (!ok) return;
  try {
    await api('/workshops/' + encodeURIComponent(w.id), { method: 'DELETE' });
    toast('ลบ Workshop แล้ว');
    if (parseHash().name === 'workshop') location.hash = '#/'; else route();
  } catch (e) { if (e.status !== 401) toast(e.message); }
}

// ---------- workshop page ----------
async function workshopView(r) {
  const { workshops } = await api('/workshops');
  const w = workshops.find((x) => x.id === r.id);
  if (!w) return { nodes: [h('h1', {}, 'ไม่พบ Workshop'), h('p', {}, h('a', { href: '#/' }, 'กลับไปหน้า Workshop'))] };
  const others = workshops.filter((x) => x.id !== w.id);
  const head = [
    h('a', { href: '#/', class: 'linkbtn' }, '< Workshop ทั้งหมด'),
    h('div', { class: 'toolbar' },
      h('div', {}, h('h1', {}, w.title), h('div', { class: 'meta' }, [w.eventDate ? fmtDay(w.eventDate) : '', w.active ? 'เปิดใช้งาน' : 'ปิดอยู่'].filter(Boolean).join(' · '))),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn ghost', onclick: () => editWorkshopDialog(w) }, 'แก้ไข Workshop'),
        h('button', { type: 'button', class: 'btn danger', onclick: () => deleteWorkshop(w) }, 'ลบ'))),
    h('nav', { class: 'tabs', 'aria-label': 'ส่วนของ Workshop' },
      TABS.map(([k, label]) => h('a', { href: `#/w/${encodeURIComponent(w.id)}/${k}`, 'aria-current': r.tab === k ? 'page' : null }, label))),
  ];
  let body;
  if (r.tab === 'code') body = await codeView(w);
  else if (r.tab === 'members') body = await membersView(w);
  else body = await itemsView(w, r.tab, others);
  return { nodes: [...head, ...body.nodes], after: body.after };
}

// ---------- code screen ----------
async function codeView(w) {
  const wid = encodeURIComponent(w.id);
  let offset = 0;
  let codes = [];
  let expiredHandled = false;

  const label = h('div', { class: 'label' }, 'รหัสเข้าร่วมตอนนี้');
  const big = h('div', { class: 'bigcode', 'aria-live': 'polite' });
  const cd = h('div', { class: 'countdown' });
  const redeemed = h('div', { class: 'redeemed' });
  const box = h('section', { class: 'codebox', 'aria-label': 'รหัสเข้าร่วม' }, label, big, cd, redeemed);

  const minutes = h('select', { id: 'mins' },
    [[1, '1 นาที'], [5, '5 นาที'], [10, '10 นาที'], [15, '15 นาที'], [30, '30 นาที'], [60, '1 ชั่วโมง'], [120, '2 ชั่วโมง'], [240, '4 ชั่วโมง'], [1440, '24 ชั่วโมง']]
      .map(([v, t]) => { const o = h('option', { value: v }, t); if (v === 5) o.selected = true; return o; }));
  const newBtn = h('button', { type: 'button', class: 'btn', onclick: issue }, 'สร้างรหัสใหม่');
  const revBtn = h('button', { type: 'button', class: 'btn danger', onclick: revoke }, 'ยกเลิกรหัส');
  const msg = h('p', { class: 'e', role: 'alert', style: 'text-align:center' });
  const actions = h('div', { class: 'code-actions' },
    h('label', { for: 'mins' }, 'อายุรหัส'), minutes, newBtn, revBtn);

  const histBody = h('tbody');
  const hist = h('div', { class: 'tablewrap' }, h('table', {},
    h('caption', { class: 'meta', style: 'text-align:left;padding:8px 12px;caption-side:top' }, 'รหัสล่าสุดของ Workshop นี้'),
    h('thead', {}, h('tr', {}, h('th', {}, 'รหัส'), h('th', {}, 'สร้างเมื่อ'), h('th', {}, 'หมดอายุ'), h('th', {}, 'สถานะ'), h('th', { class: 'num' }, 'ผู้ใช้รหัสนี้'))),
    histBody));

  const active = () => codes.find((c) => c.active && remainingMs(c.expiresAt, offset) > 0);

  function paint() {
    const a = active();
    if (a) {
      const left = remainingMs(a.expiresAt, offset);
      big.className = 'bigcode';
      big.textContent = formatCode(a.code);
      cd.className = 'countdown' + (left < 60000 ? ' low' : '');
      cd.replaceChildren(h('small', {}, 'หมดอายุใน'), formatCountdown(left));
      redeemed.textContent = `มีผู้ใช้รหัสนี้แล้ว ${a.redeemed} คน`;
      label.textContent = 'รหัสเข้าร่วมตอนนี้';
      revBtn.disabled = false;
    } else {
      big.className = 'bigcode none';
      big.textContent = 'ยังไม่มีรหัสที่ใช้งานได้';
      cd.className = 'countdown';
      cd.replaceChildren();
      redeemed.textContent = 'กด "สร้างรหัสใหม่" เพื่อให้ผู้เรียนเข้าร่วม';
      revBtn.disabled = true;
    }
  }

  function paintHistory() {
    histBody.replaceChildren(...(codes.length ? codes.map((c) => {
      const live = c.active && remainingMs(c.expiresAt, offset) > 0;
      const status = c.revoked ? ['ยกเลิกแล้ว', 'off'] : live ? ['ใช้งานอยู่', 'ok'] : ['หมดอายุ', 'warn'];
      return h('tr', {}, h('td', { class: 'mono' }, formatCode(c.code)), h('td', {}, fmtDate(c.createdAt)), h('td', {}, fmtDate(c.expiresAt)),
        h('td', {}, h('span', { class: 'chip ' + status[1] }, status[0])), h('td', { class: 'num' }, c.redeemed));
    }) : [h('tr', {}, h('td', { colspan: '5', class: 'empty' }, 'ยังไม่เคยสร้างรหัส'))]));
  }

  async function load() {
    const t0 = Date.now();
    const d = await api(`/workshops/${wid}/codes`);
    offset = clockOffset(d.serverNow, (t0 + Date.now()) / 2); // server clock vs the browser clock, mid-request
    codes = d.codes;
    expiredHandled = false;
    paint(); paintHistory();
  }

  async function issue() {
    msg.textContent = '';
    setBusy(newBtn, true, 'กำลังสร้าง...');
    try {
      await api(`/workshops/${wid}/codes`, { method: 'POST', json: { minutes: Number(minutes.value) } });
      await load();
      toast('สร้างรหัสใหม่แล้ว รหัสเดิมถูกยกเลิก');
    } catch (e) { if (e.status !== 401) msg.textContent = e.message; }
    setBusy(newBtn, false, 'สร้างรหัสใหม่');
  }

  async function revoke() {
    const a = active();
    if (!a) return;
    const ok = await confirmDialog({ title: 'ยกเลิกรหัสนี้?', message: `รหัส ${formatCode(a.code)} จะใช้เข้าร่วมไม่ได้ทันที ผู้ที่รับสิทธิ์ไปแล้วยังคงมีสิทธิ์`, confirmText: 'ยกเลิกรหัส', danger: true });
    if (!ok) return;
    msg.textContent = '';
    try { await api(`/workshops/${wid}/codes`, { method: 'DELETE' }); await load(); toast('ยกเลิกรหัสแล้ว'); }
    catch (e) { if (e.status !== 401) msg.textContent = e.message; }
  }

  await load();
  return {
    nodes: [box, actions, msg, h('h2', {}, 'ประวัติรหัส'), hist],
    after() {
      // tick every second from the server-clock offset; reload the list the moment a code expires
      every(() => {
        paint();
        const shown = codes.find((c) => c.active);
        if (shown && remainingMs(shown.expiresAt, offset) <= 0 && !expiredHandled) {
          expiredHandled = true;
          load().catch(() => {});
        }
      }, 1000);
      // refresh redeem counts and re-sync the clock offset
      every(() => { load().catch(() => {}); }, 10000);
    },
  };
}

// ---------- items (slide / prompt / bonus) ----------
async function itemsView(w, kind, others) {
  const wid = encodeURIComponent(w.id);
  const { items } = await api(`/workshops/${wid}/items`);
  const mine = items.filter((i) => i.kind === kind).sort((a, b) => a.sort - b.sort || a.id - b.id);

  const sel = h('select', { id: 'copy-src', class: 'sel' },
    h('option', { value: '' }, '-- เลือก Workshop รอบก่อน --'),
    others.map((o) => h('option', { value: o.id }, o.title)));
  const copyBtn = h('button', { type: 'button', class: 'btn ghost', onclick: copyFrom }, 'คัดลอกเนื้อหาจากรอบก่อน');
  const copyMsg = h('span', { class: 'e', role: 'alert' });

  async function copyFrom() {
    copyMsg.textContent = '';
    if (!sel.value) { copyMsg.textContent = 'กรุณาเลือก Workshop ที่จะคัดลอกจาก'; sel.focus(); return; }
    const src = others.find((o) => o.id === sel.value);
    const ok = await confirmDialog({
      title: 'คัดลอกเนื้อหาจากรอบก่อน?',
      message: `จะคัดลอกรายการทั้งหมด (Slide, Prompt, Bonus พร้อมไฟล์) จาก "${src.title}" มาเพิ่มใน "${w.title}" รายการที่มีอยู่เดิมจะไม่ถูกลบ`,
      confirmText: 'คัดลอก',
    });
    if (!ok) return;
    setBusy(copyBtn, true, 'กำลังคัดลอก...');
    try {
      const out = await api(`/workshops/${wid}/copy-from/${encodeURIComponent(sel.value)}`, { method: 'POST' });
      toast(`คัดลอกแล้ว ${out.copied} รายการ`);
      route();
    } catch (e) { if (e.status !== 401) copyMsg.textContent = e.message; setBusy(copyBtn, false, 'คัดลอกเนื้อหาจากรอบก่อน'); }
  }

  const copybar = h('div', { class: 'copybar' }, h('div', { class: 'row' },
    h('label', { for: 'copy-src', class: 'meta' }, 'เริ่มจากรอบก่อน:'), sel, copyBtn, copyMsg));
  const add = h('button', { type: 'button', class: 'btn', onclick: () => itemDialog(w, kind, null) }, '+ เพิ่ม ' + kindLabel(kind));
  const list = mine.length ? mine.map((it) => itemCard(w, it)) : [h('div', { class: 'empty' }, `ยังไม่มี ${kindLabel(kind)} ใน Workshop นี้`)];
  return {
    nodes: [
      copybar,
      h('div', { class: 'toolbar' }, h('h2', { style: 'margin:0' }, kindLabel(kind) + ` (${mine.length})`), add),
      h('div', { class: 'list' }, ...list),
    ],
  };
}

function itemCard(w, it) {
  const meta = [it.category ? 'หมวด: ' + it.category : '', 'ลำดับ ' + (it.sort || 0)].filter(Boolean).join(' · ');
  const fileRow = it.hasFile ? h('div', { class: 'row', style: 'margin-top:8px' },
    h('span', { class: 'chip' }, 'ไฟล์'), h('span', { class: 'meta' }, `${it.fileName} (${formatSize(it.size)})`),
    canPreview(it.contentType) ? h('button', { type: 'button', class: 'btn ghost sm', onclick: (ev) => previewFile(it, ev.currentTarget) }, 'เปิดดู') : null,
    h('button', { type: 'button', class: 'btn ghost sm', onclick: () => downloadFile(it) }, 'ดาวน์โหลด')) : null;
  return h('div', { class: 'card item' },
    h('div', { class: 'info' },
      h('h3', {}, it.title), h('div', { class: 'meta' }, meta),
      it.body ? h('p', {}, it.body) : null,
      it.url ? h('div', { style: 'margin-top:6px;font-size:14px' }, 'ลิงก์: ', safeLink(it.url, it.url)) : null,
      fileRow),
    h('div', { class: 'acts' },
      h('button', { type: 'button', class: 'btn ghost', onclick: () => itemDialog(w, it.kind, it) }, 'แก้ไข'),
      h('button', { type: 'button', class: 'btn danger', onclick: () => deleteItem(w, it) }, 'ลบ')));
}

async function deleteItem(w, it) {
  const ok = await confirmDialog({ title: `ลบ "${it.title}"?`, message: it.hasFile ? 'รายการนี้และไฟล์ที่แนบจะถูกลบถาวร' : 'รายการนี้จะถูกลบถาวร', confirmText: 'ลบ', danger: true });
  if (!ok) return;
  try { await api(`/workshops/${encodeURIComponent(w.id)}/items/${it.id}`, { method: 'DELETE' }); toast('ลบแล้ว'); route(); }
  catch (e) { if (e.status !== 401) toast(e.message); }
}

// Anchors cannot send Authorization headers: fetch the file, then hand the browser a blob URL.
const canPreview = canPreviewType;

async function fetchFileBlob(it) {
  const res = await api(`/items/${it.id}/file`, { raw: true });
  return res.blob();
}

async function downloadFile(it) {
  try {
    const blob = await fetchFileBlob(it);
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: it.fileName || 'file' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (e) { if (e.status !== 401) toast(e.message); }
}

async function previewFile(it, btn) {
  if (btn) { if (btn.disabled) return; btn.disabled = true; }
  try {
    const blob = await fetchFileBlob(it);
    const ct = baseType(it.contentType);
    // the iframe branch is always typed as a PDF, whatever the stored type string looked like
    const url = URL.createObjectURL(new Blob([blob], { type: ct === 'application/pdf' ? 'application/pdf' : ct }));
    const view = ct.startsWith('image/') ? h('img', { class: 'preview', src: url, alt: it.title })
      : ct.startsWith('video/') ? h('video', { class: 'preview', src: url, controls: true })
        : h('iframe', { class: 'preview', src: url, title: it.title });
    openDialog(h('div', { class: 'dlg' },
      h('h2', { id: 'dlg-title' }, it.title), view,
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: closeDialog }, 'ปิด'))), { wide: true, onClose: () => URL.revokeObjectURL(url) });
  } catch (e) { if (e.status !== 401) toast(e.message); }
  finally { if (btn) btn.disabled = false; }
}

function itemDialog(w, kind, it) {
  const isPrompt = kind === 'prompt';
  const err = h('p', { class: 'e', role: 'alert', id: 'if-err' });
  const title = h('input', { type: 'text', id: 'if-title', required: true, value: it?.title || '' });
  const category = h('input', { type: 'text', id: 'if-cat', value: it?.category || '' });
  const body = h('textarea', { id: 'if-body' }, it?.body || '');
  const url = h('input', { type: 'url', id: 'if-url', placeholder: 'https://', value: it?.url || '', 'aria-describedby': 'if-url-e' });
  const urlErr = h('div', { class: 'e', id: 'if-url-e' });
  const sort = h('input', { type: 'number', id: 'if-sort', value: it?.sort ?? 0, step: '1' });
  const file = h('input', { type: 'file', id: 'if-file', 'aria-describedby': 'if-file-hint' });
  const fileHint = h('div', { class: 'hint', id: 'if-file-hint' }, `ขนาดไม่เกิน ${formatSize(MAX_UPLOAD_BYTES)} ไฟล์ใหญ่กว่านี้ให้แนบเป็นลิงก์ https แทน`);
  const removeFile = h('input', { type: 'checkbox', id: 'if-rm' });
  const progress = h('progress', { max: '100', value: '0', hidden: true, 'aria-label': 'ความคืบหน้าการอัปโหลด' });
  const progressText = h('div', { class: 'meta', role: 'status', hidden: true });
  const save = h('button', { type: 'submit', class: 'btn' }, 'บันทึก');
  const cancel = h('button', { type: 'button', class: 'btn ghost', onclick: () => { if (xhr) xhr.abort(); closeDialog(); } }, 'ยกเลิก');
  let xhr = null;

  file.addEventListener('change', () => {
    const f = file.files[0];
    fileHint.textContent = f && exceedsUpload(f.size)
      ? tooBigMessage(f.size)
      : `ขนาดไม่เกิน ${formatSize(MAX_UPLOAD_BYTES)} ไฟล์ใหญ่กว่านี้ให้แนบเป็นลิงก์ https แทน`;
  });

  const form = h('form', { class: 'dlg', novalidate: true },
    h('h2', { id: 'dlg-title' }, (it ? 'แก้ไข ' : 'เพิ่ม ') + kindLabel(kind)),
    h('div', { class: 'field' }, h('label', { for: 'if-title' }, 'ชื่อ ', h('span', { class: 'req', 'aria-hidden': 'true' }, '*')), title),
    h('div', { class: 'field' }, h('label', { for: 'if-cat' }, 'หมวดหมู่'), category),
    h('div', { class: 'field' }, h('label', { for: 'if-body' }, isPrompt ? 'ข้อความ Prompt' : 'คำอธิบาย'), body),
    h('div', { class: 'field' }, h('label', { for: 'if-url' }, 'ลิงก์ (ต้องขึ้นต้นด้วย https://)'), url, urlErr),
    h('div', { class: 'field' }, h('label', { for: 'if-sort' }, 'ลำดับการแสดง (เลขน้อยแสดงก่อน)'), sort),
    h('div', { class: 'field' }, h('label', { for: 'if-file' }, it?.hasFile ? 'อัปโหลดไฟล์ใหม่ (แทนที่ไฟล์เดิม)' : 'แนบไฟล์'), file, fileHint,
      it?.hasFile ? h('div', { class: 'meta', style: 'margin-top:6px' }, `ไฟล์ปัจจุบัน: ${it.fileName} (${formatSize(it.size)})`) : null,
      it?.hasFile ? h('div', { class: 'check' }, removeFile, h('label', { for: 'if-rm' }, 'ลบไฟล์เดิมออก')) : null),
    progress, progressText, err,
    h('div', { class: 'row' }, cancel, save));

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    err.textContent = ''; urlErr.textContent = '';
    title.removeAttribute('aria-invalid'); url.removeAttribute('aria-invalid');
    if (!title.value.trim()) { err.textContent = 'กรุณาใส่ชื่อรายการ'; title.setAttribute('aria-invalid', 'true'); title.focus(); return; }
    const link = url.value.trim();
    if (link && !isHttps(link)) { urlErr.textContent = 'ลิงก์ต้องขึ้นต้นด้วย https:// และไม่มีช่องว่าง'; url.setAttribute('aria-invalid', 'true'); url.focus(); return; }

    // Client-side limit: never start an upload the server will refuse.
    const picked = file.files[0];
    if (picked && exceedsUpload(picked.size)) { err.textContent = tooBigMessage(picked.size); file.focus(); return; }

    const fd = new FormData();
    fd.set('kind', kind); fd.set('title', title.value.trim()); fd.set('category', category.value.trim());
    fd.set('body', body.value); fd.set('url', link); fd.set('sort', String(Number(sort.value) || 0));
    if (it && removeFile.checked && !file.files[0]) fd.set('removeFile', '1');
    if (file.files[0]) fd.set('file', file.files[0]);

    const wid = encodeURIComponent(w.id);
    const myDlg = dlgId;
    const mine = () => myDlg === dlgId && dlg.open; // false once Esc/cancel closed this dialog or another opened
    xhr = new XMLHttpRequest();
    xhr.open(it ? 'PUT' : 'POST', `/api/admin/workshops/${wid}/items${it ? '/' + it.id : ''}`);
    xhr.setRequestHeader('authorization', 'Bearer ' + token);
    const hasFile = !!file.files[0];
    if (hasFile) {
      progress.hidden = false; progressText.hidden = false; progress.value = 0; progressText.textContent = 'กำลังอัปโหลด 0%';
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const pct = Math.round((e.loaded / e.total) * 100);
        progress.value = pct;
        progressText.textContent = `กำลังอัปโหลด ${pct}% (${formatSize(e.loaded)} จาก ${formatSize(e.total)})`;
      };
    }
    const fail = (m) => { err.textContent = m; setBusy(save, false, 'บันทึก'); progress.hidden = true; progressText.hidden = true; xhr = null; };
    xhr.onload = () => {
      if (!mine()) { xhr = null; return; }
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status === 401) { closeDialog(); logout('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง'); return; }
      if (xhr.status >= 200 && xhr.status < 300) { xhr = null; closeDialog(); toast('บันทึกแล้ว'); route(); return; }
      let m = data.error || 'เกิดข้อผิดพลาด กรุณาลองใหม่';
      // the server already says "attach a link instead" for 411/413; keep its text verbatim
      fail(m);
    };
    xhr.onerror = () => mine() && fail(hasFile ? 'อัปโหลดไม่สำเร็จ (ไฟล์อาจใหญ่เกินไปหรือการเชื่อมต่อขัดข้อง) ไฟล์ใหญ่กรุณาแนบเป็นลิงก์แทน' : 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่');
    xhr.onabort = () => { xhr = null; };
    setBusy(save, true, hasFile ? 'กำลังอัปโหลด...' : 'กำลังบันทึก...');
    xhr.send(fd);
  });

  openDialog(form, { wide: true, onClose: () => { if (xhr) { const x = xhr; xhr = null; x.abort(); } } });
  title.focus();
}

// ---------- members ----------
async function membersView(w) {
  const q = w ? '?workshop=' + encodeURIComponent(w.id) : '';
  const { members } = await api('/members' + q);
  const csvBtn = h('button', { type: 'button', class: 'btn ghost', onclick: downloadCsv }, 'ดาวน์โหลด CSV');
  const csvMsg = h('span', { class: 'e', role: 'alert' });

  async function downloadCsv() {
    csvMsg.textContent = '';
    setBusy(csvBtn, true);
    try {
      const res = await api('/members.csv' + q, { raw: true });
      const url = URL.createObjectURL(await res.blob());
      const a = h('a', { href: url, download: csvFilename(new Date(), w?.id) });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) { if (e.status !== 401) csvMsg.textContent = e.message; }
    setBusy(csvBtn, false);
  }

  const cols = ['ชื่อ-นามสกุล', 'อีเมล', 'ชื่อใน LINE', 'รับข่าวสาร', 'Workshop', 'ลงทะเบียนเมื่อ'];
  const rows = members.map((m) => h('tr', {},
    h('td', {}, `${m.firstName} ${m.lastName}`.trim()),
    h('td', {}, m.email),
    h('td', {}, m.displayName),
    h('td', {}, h('span', { class: 'chip ' + (m.marketing ? 'ok' : 'off') }, m.marketing ? 'ยินยอม' : 'ไม่ยินยอม')),
    h('td', {}, (m.workshops || '').split(' | ').filter(Boolean).join(', ')),
    h('td', {}, fmtDate(m.createdAt)),
    w ? h('td', {}, h('button', { type: 'button', class: 'btn danger sm', 'aria-label': `ลบสิทธิ์ของ ${m.firstName} ${m.lastName}`, onclick: () => removeEnrollment(w, m) }, 'ลบสิทธิ์')) : null));

  const table = members.length
    ? h('div', { class: 'tablewrap' }, h('table', {},
      h('thead', {}, h('tr', {}, cols.map((c) => h('th', {}, c)), w ? h('th', {}, 'จัดการ') : null)),
      h('tbody', {}, rows)))
    : h('div', { class: 'empty card' }, w ? 'ยังไม่มีผู้เรียนใน Workshop นี้' : 'ยังไม่มีผู้เรียนที่ลงทะเบียน');
  return {
    nodes: [
      h('div', { class: 'toolbar' },
        w ? h('h2', { style: 'margin:0' }, `ผู้เรียนใน Workshop นี้ (${members.length})`) : h('h1', {}, `ผู้เรียนทั้งหมด (${members.length})`),
        h('div', { class: 'row' }, csvMsg, csvBtn)),
      w ? null : h('p', { class: 'lead' }, 'หากต้องการลบสิทธิ์ ให้เปิดแท็บ "ผู้เรียน" ของ Workshop นั้น'),
      table,
    ],
  };
}

async function removeEnrollment(w, m) {
  const name = `${m.firstName} ${m.lastName}`.trim();
  const ok = await confirmDialog({
    title: `ลบสิทธิ์ของ ${name}?`,
    message: `${name} จะเข้าถึงเนื้อหาของ "${w.title}" ไม่ได้อีก (ข้อมูลการลงทะเบียนยังอยู่ และรับสิทธิ์ใหม่ได้ด้วยรหัส)`,
    confirmText: 'ลบสิทธิ์', danger: true,
  });
  if (!ok) return;
  try { await api(`/workshops/${encodeURIComponent(w.id)}/members/${encodeURIComponent(m.lineUserId)}`, { method: 'DELETE' }); toast('ลบสิทธิ์แล้ว'); route(); }
  catch (e) { if (e.status !== 401) toast(e.message); }
}

// ---------- audit log ----------
async function auditView() {
  const { log } = await api('/audit');
  const rows = log.map((r) => h('tr', {},
    h('td', { style: 'white-space:nowrap' }, fmtDate(r.createdAt)),
    h('td', {}, r.actor === 'admin' ? 'ผู้ดูแล' : (r.name || r.actor)),
    h('td', {}, actionLabel(r.action)),
    h('td', {}, h('details', {}, h('summary', {}, 'รายละเอียด'), h('pre', { class: 'detail' }, prettyDetail(r.detail))))));
  return {
    nodes: [
      h('h1', {}, 'บันทึกกิจกรรม'),
      h('p', { class: 'lead' }, 'แสดง 300 รายการล่าสุด'),
      log.length
        ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['เวลา', 'ผู้ทำ', 'การกระทำ', ''].map((c) => h('th', {}, c)))), h('tbody', {}, rows)))
        : h('div', { class: 'empty card' }, 'ยังไม่มีบันทึกกิจกรรม'),
    ],
  };
}

// ---------- start ----------
route();
