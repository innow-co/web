// Pure helpers (no bindings) — unit tested in tests/lib.test.mjs

const enc = new TextEncoder();

export function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function hmac(secret, data) {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data));
  return b64url(new Uint8Array(sig));
}

// Signed, expiring token: base64url(json).signature. `typ` separates token purposes.
export async function signToken(secret, typ, payload, ttlSeconds, now = Date.now()) {
  const body = b64url(enc.encode(JSON.stringify({ ...payload, typ, exp: Math.floor(now / 1000) + ttlSeconds })));
  return `${body}.${await hmac(secret, body)}`;
}

export async function verifyToken(secret, typ, token, now = Date.now()) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  let ok;
  try { ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64urlDecode(sig), enc.encode(body)); } catch { return null; }
  if (!ok) return null;
  let data;
  try { data = JSON.parse(new TextDecoder().decode(b64urlDecode(body))); } catch { return null; }
  if (data.typ !== typ || typeof data.exp !== 'number' || data.exp < Math.floor(now / 1000)) return null;
  return data;
}

export function timingSafeEqualStr(a, b) {
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function randomCode(taken = new Set()) {
  for (let i = 0; i < 200; i++) {
    const n = crypto.getRandomValues(new Uint32Array(1))[0] % 10000;
    const code = String(n).padStart(4, '0');
    if (!taken.has(code)) return code;
  }
  // Crowded space: random probing is unlikely to hit the remaining codes, so scan from a random start.
  const start = crypto.getRandomValues(new Uint32Array(1))[0] % 10000;
  for (let i = 0; i < 10000; i++) {
    const code = String((start + i) % 10000).padStart(4, '0');
    if (!taken.has(code)) return code;
  }
  throw new Error('No free code');
}

export function isFourDigits(v) {
  return typeof v === 'string' && /^\d{4}$/.test(v);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateRegistration(input) {
  const firstName = String(input?.firstName ?? '').trim();
  const lastName = String(input?.lastName ?? '').trim();
  const email = String(input?.email ?? '').trim().toLowerCase();
  const errors = {};
  if (!firstName || firstName.length > 100) errors.firstName = 'กรุณากรอกชื่อจริง';
  if (!lastName || lastName.length > 100) errors.lastName = 'กรุณากรอกนามสกุลจริง';
  if (!EMAIL_RE.test(email) || email.length > 200) errors.email = 'กรุณากรอกอีเมลให้ถูกต้อง';
  if (input?.acceptTerms !== true) errors.acceptTerms = 'กรุณารับทราบนโยบายความเป็นส่วนตัว';
  return { ok: Object.keys(errors).length === 0, errors, value: { firstName, lastName, email, marketing: input?.marketing === true } };
}

export function slugify(s) {
  const base = String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const rand = b64url(crypto.getRandomValues(new Uint8Array(4))).toLowerCase().replace(/[^a-z0-9]/g, '');
  return (base ? base + '-' : 'ws-') + rand;
}

export function safeFileName(name) {
  return String(name || 'file').replace(/[\\/\r\n"]/g, '_').slice(0, 150);
}

// CSV cell: neutralise spreadsheet formula injection, quote when needed.
export function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

// Quote-request form ("ขอใบเสนอราคาอบรม"): same rules as lib/contact-message.mjs on the website.
const INQUIRY_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const strOf = (v) => (typeof v === 'string' ? v.trim() : '');

export function validateInquiry(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const organization = strOf(src.organization);
  const email = strOf(src.email);
  const course = strOf(src.course);
  const expectation = strOf(src.expectation);
  const details = strOf(src.details);
  // Numbers or plain digit strings only: "20.5", "1e3", "", "0x10" are not whole-number answers.
  const raw = typeof src.learners === 'string' ? src.learners.trim() : src.learners;
  const learners = typeof raw === 'number' || /^\d+$/.test(raw ?? '') ? Number(raw) : NaN;
  const errors = {};
  if (!organization || organization.length > 160 || /[\r\n]/.test(organization)) errors.organization = 'กรอกชื่อองค์กร';
  if (email.length > 254 || !INQUIRY_EMAIL_RE.test(email)) errors.email = 'กรอกอีเมลติดต่อให้ถูกต้อง';
  if (!course || course.length > 200 || /[\r\n]/.test(course)) errors.course = 'เลือกหลักสูตรที่สนใจ';
  if (!expectation || expectation.length > 300 || /[\r\n]/.test(expectation)) errors.expectation = 'เลือกรูปแบบที่ต้องการ';
  if (details.length > 2000) errors.details = 'รายละเอียดเพิ่มเติมต้องไม่เกิน 2,000 ตัวอักษร';
  if (!Number.isSafeInteger(learners) || learners < 1 || learners > 100000) errors.learners = 'กรอกจำนวนผู้เรียนเป็นจำนวนเต็มตั้งแต่ 1 ถึง 100,000 คน';
  return { ok: Object.keys(errors).length === 0, errors, value: { organization, email, course, expectation, details, learners } };
}
