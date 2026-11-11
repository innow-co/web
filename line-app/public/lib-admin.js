// Pure helpers for the admin page. No DOM access, so Node can import and test them.

// Offset to add to the browser clock to get the server clock. Uses the server's `serverNow`
// from the latest API response so a wrong laptop clock cannot show a wrong countdown.
export const clockOffset = (serverNow, clientNow = Date.now()) => Number(serverNow) - Number(clientNow);

export const serverTime = (offset, clientNow = Date.now()) => clientNow + (Number(offset) || 0);

export const remainingMs = (expiresAt, offset, clientNow = Date.now()) => Math.max(0, Number(expiresAt) - serverTime(offset, clientNow));

// 0 -> "00:00", 65000 -> "01:05", 3 h 2 m 1 s -> "3:02:01". Rounds up so "00:00" only shows at real expiry.
export function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
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
export const mailtoHref = (email) => {
  const e = String(email ?? '');
  return e.length <= 254 && EMAIL_RE.test(e) ? 'mailto:' + e : null;
};

export const forwardBadge = (q) => (q?.forwarded
  ? { text: 'ส่งอีเมลแล้ว', ok: true }
  : { text: 'ส่งอีเมลไม่สำเร็จ' + (q?.forwardError ? ': ' + q.forwardError : ''), ok: false });
