// Pure helpers for the admin page. No DOM access, so Node can import and test them.

// Offset to add to the browser clock to get the server clock. Uses the server's `serverNow`
// from the latest API response so a wrong laptop clock cannot show a wrong countdown.
export const clockOffset = (serverNow, clientNow = Date.now()) => Number(serverNow) - Number(clientNow);

export const serverTime = (offset, clientNow = Date.now()) => clientNow + (Number(offset) || 0);

// A never-expiring code comes from the API as neverExpires: true with expiresAt: null.
export const isNever = (c) => !!c && (c.neverExpires === true || c.expiresAt == null);

// Warning shown next to the lifetime select ('' = none). Values are minutes, or 'never'.
// Lifetime choices for the admin select: [value, label]. 'never' is the last one. The UI preselects
// DEFAULT_LIFETIME_MINUTES; the API itself still falls back to 5 minutes when `minutes` is missing/garbage.
export const LIFETIME_OPTIONS = [
  [1, '1 นาที'], [5, '5 นาที'], [10, '10 นาที'], [15, '15 นาที'], [30, '30 นาที'], [60, '1 ชั่วโมง'], [120, '2 ชั่วโมง'], [240, '4 ชั่วโมง'],
  [1440, '24 ชั่วโมง'], [43200, 'ภายใน 1 เดือน (30 วัน)'], [129600, 'ภายใน 3 เดือน (90 วัน)'], ['never', 'ไม่หมดอายุ'],
];
export const DEFAULT_LIFETIME_MINUTES = 129600;

export const LONG_CODE_MINUTES = 30 * 24 * 60;
export function lifetimeWarning(value) {
  if (value === 'never') return 'ใครได้รับรหัสสามารถรับสิทธิ์ได้ตลอด ควรยกเลิกเมื่อไม่ใช้แล้ว';
  if (Number(value) >= LONG_CODE_MINUTES) return 'รหัสนี้ใช้ได้นาน ใครได้รับรหัสสามารถรับสิทธิ์ได้จนกว่าจะหมดอายุ ควรยกเลิกเมื่อไม่ใช้แล้ว';
  return '';
}

export const remainingMs = (expiresAt, offset, clientNow = Date.now()) => Math.max(0, Number(expiresAt) - serverTime(offset, clientNow));

// 0 -> "00:00", 65000 -> "01:05", 3 h 2 m 1 s -> "3:02:01". Rounds up so "00:00" only shows at real expiry.
export function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
  if (!Number.isFinite(total)) return '00:00';
  const days = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (days > 0) return `${days} วัน ${pad(h)}:${pad(m)}:${pad(s)}`;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// Codes are 4 digits with leading zeros kept ("0042"), always handled as strings.
export const formatCode = (code) => String(code ?? '').replace(/\D/g, '').padStart(4, '0').slice(-4);

export function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

export const isHttps = (u) => /^https:\/\/[^\s]+$/i.test(String(u ?? ''));

// Keep in sync with MAX_UPLOAD in src/worker.js (public/ and src/ cannot share a module; a test compares them).
export const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

export const exceedsUpload = (size) => Number(size) > MAX_UPLOAD_BYTES;

export const uploadLimitLabel = () => Math.round(MAX_UPLOAD_BYTES / 1024 / 1024) + 'MB';

// Same wording as the Worker's 413 message, with the limit taken from the constant.
export const tooBigMessage = (size) => `ไฟล์นี้ใหญ่ ${formatSize(size)} เกิน ${uploadLimitLabel()} กรุณาแนบเป็นลิงก์ https แทน`;

// Whole media type only (parameters stripped), so "application/pdfX" never passes.
export const baseType = (ct) => String(ct ?? '').split(';')[0].trim().toLowerCase();
export const canPreviewType = (ct) => /^(application\/pdf|image\/(png|jpeg|gif|webp|avif)|video\/(mp4|webm))$/.test(baseType(ct));

export const ACTION_LABELS = {
  admin_login: 'ผู้ดูแลเข้าสู่ระบบ',
  admin_login_fail: 'ผู้ดูแลใส่รหัสผ่านผิด',
  workshop_save: 'บันทึก Workshop',
  workshop_delete: 'ลบ Workshop',
  code_new: 'สร้างรหัสใหม่',
  code_revoke: 'ยกเลิกรหัส',
  item_save: 'บันทึกเนื้อหา',
  item_delete: 'ลบเนื้อหา',
  items_copy: 'คัดลอกเนื้อหาจากรอบก่อน',
  enroll_remove: 'ลบสิทธิ์ผู้เรียน',
  redeem_fail: 'ผู้เรียนใส่รหัสผิด',
  redeem_blocked: 'ผู้เรียนถูกระงับชั่วคราว (ใส่รหัสผิดหลายครั้ง)',
  redeem_pending_register: 'ผู้เรียนใส่รหัสถูกต้อง รอลงทะเบียน',
  register: 'ผู้เรียนลงทะเบียน',
  enroll: 'ผู้เรียนได้รับสิทธิ์ Workshop',
  file_link: 'เปิดไฟล์',
};

export const actionLabel = (action) => ACTION_LABELS[action] || String(action ?? '');

// members-2026-11-11.csv, or members-<workshop>-2026-11-11.csv. Date is the local calendar date.
export function csvFilename(date = new Date(), workshopId = '') {
  const pad = (n) => String(n).padStart(2, '0');
  const d = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const w = String(workshopId || '').replace(/[^\w-]/g, '').slice(0, 60);
  return `members-${w ? w + '-' : ''}${d}.csv`;
}

// Pretty-print audit detail JSON; falls back to the raw text when it is not JSON.
export function prettyDetail(detail) {
  try { return JSON.stringify(JSON.parse(detail), null, 2); } catch { return String(detail ?? ''); }
}

export const kindLabel = (k) => ({ slide: 'Slide', prompt: 'Prompt Library', bonus: 'Bonus' }[k] || k);

// Quote requests: same email shape as the website's form. Only a matching address becomes a mailto: link.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Addresses containing ? & # or % are legal in the loose shape above but could inject mailto headers (cc, bcc,
// body) or odd encodings, so they are shown as plain text. The href is URI-encoded; '@' is kept readable.
export const mailtoHref = (email) => {
  const e = String(email ?? '');
  if (e.length > 254 || !EMAIL_RE.test(e) || /[?&#%]/.test(e)) return null;
  return 'mailto:' + encodeURIComponent(e).replace(/%40/g, '@');
};

export const forwardBadge = (q) => (q?.forwarded
  ? { text: 'ส่งอีเมลแล้ว', ok: true }
  : { text: 'ส่งอีเมลไม่สำเร็จ' + (q?.forwardError ? ': ' + q.forwardError : ''), ok: false });

// AI consultation list (read-only). Team size is optional: anything that is not a positive whole number shows as '-'.
export const teamSizeLabel = (n) => (Number.isSafeInteger(n) && n >= 1 ? String(n) : '-');

// One API row -> display values. `mailto` is null unless the address passes mailtoHref (header-injection safe).
export function consultationRow(c) {
  const x = c && typeof c === 'object' ? c : {};
  const text = (v) => (typeof v === 'string' ? v : '');
  const email = text(x.email);
  return {
    id: x.id, createdAt: x.createdAt, organization: text(x.organization), email, mailto: mailtoHref(email),
    systems: text(x.systems), goals: text(x.goals), teamSize: teamSizeLabel(x.teamSize), memberName: text(x.memberName) || '-',
  };
}
