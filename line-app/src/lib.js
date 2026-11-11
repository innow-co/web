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
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64urlDecode(sig), enc.encode(body));
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
