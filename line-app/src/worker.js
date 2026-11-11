import {
  signToken, verifyToken, timingSafeEqualStr, randomCode, isFourDigits,
  validateRegistration, validateInquiry, slugify, safeFileName, csvCell, HttpError,
} from './lib.js';
import { verifyLineWithFetch, devFakeLineActive, isLocalHost } from './line.js';

const SESSION_TTL = 60 * 60 * 24 * 7;      // member session: 7 days
const ADMIN_TTL = 60 * 60 * 12;            // admin session: 12 hours
const REDEEM_TTL = 60 * 30;                // time to finish registration after a valid code
const FILE_LINK_TTL = 60 * 5;              // signed file URL: 5 minutes
// Sentinel expiry of a never-expiring code: 9999-12-31T23:59:59.999Z, so `expires_at > now` stays true.
const NEVER_EXPIRES = 253402300799000;
const MAX_CODE_MINUTES = 90 * 24 * 60;   // longest timed code: 90 days
const FAIL_WINDOW = 10 * 60 * 1000;        // 10 minutes
const INQUIRY_WINDOW = 60 * 60 * 1000;     // 1 hour
const INQUIRY_MAX = 3;                     // quote requests per member / hour (every submission counts)
const DEFAULT_FORWARD_TIMEOUT = 8000;
const MAX_FAILS = 5;                       // 5 wrong codes / 10 min
const ADMIN_MAX_FAILS = 10;                // per IP / 10 min
const ADMIN_GLOBAL = 'admin:*';
const ADMIN_GLOBAL_MAX_FAILS = 50;         // all IPs together / 10 min
const MAX_UPLOAD = 40 * 1024 * 1024;      // req.formData() buffers ~2x the body; 128 MB isolate. Keep in sync with MAX_UPLOAD_BYTES in public/lib-admin.js

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

const now = () => Date.now();

async function body(request) {
  try { return await request.json(); } catch { throw new HttpError(400, 'รูปแบบข้อมูลไม่ถูกต้อง'); }
}

function secret(env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new HttpError(503, 'Server not configured');
  return env.SESSION_SECRET;
}

async function audit(env, actor, action, detail = {}) {
  await env.DB.prepare('INSERT INTO audit_log (actor, action, detail, created_at) VALUES (?, ?, ?, ?)')
    .bind(actor, action, JSON.stringify(detail), now()).run();
}

// Atomic check-and-record: one INSERT ... SELECT that only inserts while the recent failure count is under the
// limit, so parallel requests cannot all read the old count. The row is recorded as a failure (ok = 0) up front;
// callers flip it to ok = 1 with releaseAttempt() when the credential turns out to be correct (inquiries never release).
// Returns the new row id, or null when the subject is locked out.
async function reserveAttempt(env, subject, max, window = FAIL_WINDOW) {
  const t = now();
  const r = await env.DB.prepare(
    `INSERT INTO attempts (subject, ok, created_at)
     SELECT ?, 0, ? WHERE (SELECT COUNT(*) FROM attempts WHERE subject = ? AND ok = 0 AND created_at > ?) < ?`)
    .bind(subject, t, subject, t - window, max).run();
  return r.meta.changes ? r.meta.last_row_id : null;
}

// Admin login: per-IP cap and a global cap (subject 'admin:*') in one D1 batch (a transaction), so neither can be overrun.
async function reserveAdminAttempt(env, ip) {
  const t = now();
  const since = t - FAIL_WINDOW;
  const subject = 'admin:' + ip;
  const [a, g] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO attempts (subject, ok, created_at)
       SELECT ?, 0, ? WHERE (SELECT COUNT(*) FROM attempts WHERE subject = ? AND ok = 0 AND created_at > ?) < ?
         AND (SELECT COUNT(*) FROM attempts WHERE subject = ? AND ok = 0 AND created_at > ?) < ?`)
      .bind(subject, t, subject, since, ADMIN_MAX_FAILS, ADMIN_GLOBAL, since, ADMIN_GLOBAL_MAX_FAILS),
    env.DB.prepare(`INSERT INTO attempts (subject, ok, created_at) SELECT ?, 0, ? WHERE changes() > 0`).bind(ADMIN_GLOBAL, t),
  ]);
  return a.meta.changes ? [a.meta.last_row_id, g.meta.last_row_id] : null;
}

async function releaseAttempt(env, ...ids) {
  const list = ids.flat();
  await env.DB.prepare(`UPDATE attempts SET ok = 1 WHERE id IN (${list.map(() => '?').join(',')})`).bind(...list).run();
}

async function recentFails(env, subject) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM attempts WHERE subject = ? AND ok = 0 AND created_at > ?')
    .bind(subject, now() - FAIL_WINDOW).first();
  return row?.n ?? 0;
}

// ---------- LINE verification ----------

async function verifyLine(accessToken, env, hostname) {
  if (devFakeLineActive(env, hostname) && typeof accessToken === 'string' && accessToken.startsWith('dev:')) {
    const userId = accessToken.slice(4);
    return { userId, displayName: 'Dev ' + userId.slice(-4), pictureUrl: '', isFriend: !userId.includes('nofriend') };
  }
  return verifyLineWithFetch(accessToken, env, fetch);
}

let warnedDevOnPublicHost = false;
function warnIfDevFlagOnPublicHost(env, hostname) {
  if (env.DEV_FAKE_LINE && !isLocalHost(hostname) && !warnedDevOnPublicHost) {
    warnedDevOnPublicHost = true;
    console.warn('DEV_FAKE_LINE is set but the request host is not local; the dev login bypass is disabled. Remove the variable from this deployment.');
  }
}

async function memberSession(request, env) {
  const h = request.headers.get('authorization') || '';
  const data = await verifyToken(secret(env), 'member', h.replace(/^Bearer\s+/i, ''));
  if (!data) throw new HttpError(401, 'กรุณาเปิดแอปจาก LINE อีกครั้ง', { reauth: true });
  if (env.REQUIRE_FRIEND !== 'false' && !data.friend) throw new HttpError(403, 'กรุณาเพิ่มเพื่อน Innow LINE OA ก่อน', { notFriend: true });
  return data;
}

async function adminSession(request, env) {
  const h = request.headers.get('authorization') || '';
  const data = await verifyToken(secret(env), 'admin', h.replace(/^Bearer\s+/i, ''));
  if (!data) throw new HttpError(401, 'กรุณาเข้าสู่ระบบผู้ดูแล');
  return data;
}

async function enrolled(env, uid, workshopId) {
  return !!(await env.DB.prepare('SELECT 1 FROM enrollments WHERE line_user_id = ? AND workshop_id = ?').bind(uid, workshopId).first());
}

const publicItem = (it) => ({
  id: it.id, workshopId: it.workshop_id, kind: it.kind, title: it.title, category: it.category, body: it.body,
  url: it.url, hasFile: !!it.r2_key, fileName: it.file_name, contentType: it.content_type, size: it.size,
});

async function enrollWorkshop(env, uid, workshopId, codeId) {
  await env.DB.prepare('INSERT OR IGNORE INTO enrollments (line_user_id, workshop_id, code_id, created_at) VALUES (?, ?, ?, ?)')
    .bind(uid, workshopId, codeId, now()).run();
  await audit(env, uid, 'enroll', { workshopId, codeId });
}

const workshopSummary = (w) => ({ id: w.id, title: w.title, description: w.description, eventDate: w.event_date });

// ---------- Member API ----------

const member = {
  async config(req, env) {
    warnIfDevFlagOnPublicHost(env, new URL(req.url).hostname);
    return json({ liffId: env.LIFF_ID || '', oaBasicId: env.OA_BASIC_ID || '', facebookUrl: env.FACEBOOK_URL || '', requireFriend: env.REQUIRE_FRIEND !== 'false', dev: devFakeLineActive(env, new URL(req.url).hostname) });
  },

  async auth(req, env) {
    const { accessToken } = await body(req);
    const hostname = new URL(req.url).hostname;
    warnIfDevFlagOnPublicHost(env, hostname);
    const line = await verifyLine(accessToken, env, hostname);
    const m = await env.DB.prepare('SELECT * FROM members WHERE line_user_id = ?').bind(line.userId).first();
    if (m) {
      await env.DB.prepare('UPDATE members SET display_name = ?, picture_url = ?, is_friend = ?, last_seen_at = ? WHERE line_user_id = ?')
        .bind(line.displayName, line.pictureUrl, line.isFriend ? 1 : 0, now(), line.userId).run();
    }
    const session = await signToken(secret(env), 'member', { uid: line.userId, friend: line.isFriend, dn: line.displayName, pic: line.pictureUrl }, SESSION_TTL);
    return json({
      session, isFriend: line.isFriend,
      profile: { displayName: line.displayName, pictureUrl: line.pictureUrl },
      member: m ? { firstName: m.first_name, lastName: m.last_name, email: m.email } : null,
    });
  },

  async me(req, env) {
    const s = await memberSession(req, env);
    const m = await env.DB.prepare('SELECT * FROM members WHERE line_user_id = ?').bind(s.uid).first();
    const { results } = await env.DB.prepare(
      `SELECT w.*, e.created_at AS enrolled_at,
        (SELECT COUNT(*) FROM items i WHERE i.workshop_id = w.id AND i.kind='slide') AS slides,
        (SELECT COUNT(*) FROM items i WHERE i.workshop_id = w.id AND i.kind='prompt') AS prompts,
        (SELECT COUNT(*) FROM items i WHERE i.workshop_id = w.id AND i.kind='bonus') AS bonus
       FROM enrollments e JOIN workshops w ON w.id = e.workshop_id
       WHERE e.line_user_id = ? ORDER BY e.created_at DESC`).bind(s.uid).all();
    return json({
      profile: { displayName: s.dn, pictureUrl: s.pic },
      member: m ? { firstName: m.first_name, lastName: m.last_name, email: m.email, emailVerified: !!m.email_verified, marketing: !!m.marketing_consent, since: m.created_at } : null,
      workshops: results.map((w) => ({ ...workshopSummary(w), enrolledAt: w.enrolled_at, counts: { slide: w.slides, prompt: w.prompts, bonus: w.bonus } })),
    });
  },

  async redeem(req, env) {
    const s = await memberSession(req, env);
    const { code } = await body(req);
    const subject = 'user:' + s.uid;
    const attemptId = await reserveAttempt(env, subject, MAX_FAILS);
    if (attemptId === null) {
      await audit(env, s.uid, 'redeem_blocked', {});
      throw new HttpError(429, 'กรอกรหัสผิดหลายครั้ง กรุณารอ 10 นาทีแล้วลองใหม่');
    }
    const row = isFourDigits(code)
      ? await env.DB.prepare(
          `SELECT c.id, c.workshop_id, w.title, w.description, w.event_date FROM codes c JOIN workshops w ON w.id = c.workshop_id
           WHERE c.code = ? AND c.revoked = 0 AND c.expires_at > ? AND w.active = 1 ORDER BY c.created_at DESC LIMIT 1`).bind(code, now()).first()
      : null;
    if (!row) {
      await audit(env, s.uid, 'redeem_fail', { code: isFourDigits(code) ? code : 'invalid' });
      const left = MAX_FAILS - (await recentFails(env, subject));
      throw new HttpError(400, left > 0 ? `รหัสไม่ถูกต้องหรือหมดอายุ (ลองได้อีก ${left} ครั้ง)` : 'กรอกรหัสผิดหลายครั้ง กรุณารอ 10 นาทีแล้วลองใหม่');
    }
    await releaseAttempt(env, attemptId);
    const workshop = { id: row.workshop_id, title: row.title, description: row.description, eventDate: row.event_date };

    if (await enrolled(env, s.uid, row.workshop_id)) return json({ status: 'already', workshop });

    const m = await env.DB.prepare('SELECT 1 FROM members WHERE line_user_id = ?').bind(s.uid).first();
    if (m) {
      await enrollWorkshop(env, s.uid, row.workshop_id, row.id);
      return json({ status: 'enrolled', workshop });
    }
    const redeemToken = await signToken(secret(env), 'redeem', { uid: s.uid, wid: row.workshop_id, cid: row.id }, REDEEM_TTL);
    await audit(env, s.uid, 'redeem_pending_register', { workshopId: row.workshop_id });
    return json({ status: 'register', workshop, redeemToken });
  },

  async register(req, env) {
    const s = await memberSession(req, env);
    const input = await body(req);
    const r = await verifyToken(secret(env), 'redeem', input.redeemToken);
    if (!r || r.uid !== s.uid) throw new HttpError(400, 'สิทธิ์หมดเวลา กรุณากรอกรหัส Workshop ใหม่อีกครั้ง');
    const v = validateRegistration(input);
    if (!v.ok) throw new HttpError(422, 'กรุณาตรวจสอบข้อมูล', { errors: v.errors });
    const gone = new HttpError(410, 'Workshop นี้ไม่พร้อมใช้งานแล้ว กรุณากรอกรหัส Workshop ใหม่อีกครั้ง');
    const w = await env.DB.prepare('SELECT * FROM workshops WHERE id = ?').bind(r.wid).first();
    if (!w) throw gone;
    const t = now();
    await env.DB.prepare(
      `INSERT INTO members (line_user_id, first_name, last_name, email, display_name, picture_url, terms_accepted_at, marketing_consent, is_friend, last_seen_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(line_user_id) DO NOTHING`)
      .bind(s.uid, v.value.firstName, v.value.lastName, v.value.email, s.dn || '', s.pic || '', t, v.value.marketing ? 1 : 0, s.friend ? 1 : 0, t, t).run();
    await audit(env, s.uid, 'register', { marketing: v.value.marketing });
    // The workshop can still vanish between the check above and this insert (foreign key failure).
    try { await enrollWorkshop(env, s.uid, r.wid, r.cid); } catch (e) { if (/FOREIGN KEY/i.test(String(e?.message))) throw gone; throw e; }
    return json({ status: 'enrolled', workshop: workshopSummary(w) });
  },

  async workshop(req, env, id) {
    const s = await memberSession(req, env);
    if (!(await enrolled(env, s.uid, id))) throw new HttpError(403, 'คุณยังไม่มีสิทธิ์ใน Workshop นี้');
    const w = await env.DB.prepare('SELECT * FROM workshops WHERE id = ?').bind(id).first();
    if (!w) throw new HttpError(404, 'ไม่พบ Workshop');
    const { results } = await env.DB.prepare('SELECT * FROM items WHERE workshop_id = ? ORDER BY kind, sort, id').bind(id).all();
    return json({ workshop: workshopSummary(w), items: results.map(publicItem) });
  },

  // All prompts / bonus across the member's workshops (rich menu shortcuts)
  async byKind(req, env, kind) {
    const s = await memberSession(req, env);
    const { results } = await env.DB.prepare(
      `SELECT i.*, w.title AS workshop_title FROM items i
       JOIN enrollments e ON e.workshop_id = i.workshop_id AND e.line_user_id = ?
       JOIN workshops w ON w.id = i.workshop_id
       WHERE i.kind = ? ORDER BY e.created_at DESC, i.sort, i.id`).bind(s.uid, kind).all();
    return json({ items: results.map((it) => ({ ...publicItem(it), workshopTitle: it.workshop_title })) });
  },

  async fileLink(req, env, itemId) {
    const s = await memberSession(req, env);
    const it = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(itemId).first();
    if (!it || !it.r2_key) throw new HttpError(404, 'ไม่พบไฟล์');
    if (!(await enrolled(env, s.uid, it.workshop_id))) throw new HttpError(403, 'คุณยังไม่มีสิทธิ์ในไฟล์นี้');
    const t = await signToken(secret(env), 'file', { iid: it.id, uid: s.uid }, FILE_LINK_TTL);
    await audit(env, s.uid, 'file_link', { itemId: it.id });
    return json({ url: new URL('/f/' + it.id + '?t=' + encodeURIComponent(t), req.url).toString(), expiresIn: FILE_LINK_TTL });
  },

  async inquiry(req, env) {
    const s = await memberSession(req, env);
    const v = validateInquiry(await body(req));
    if (!v.ok) throw new HttpError(422, 'กรุณาตรวจสอบข้อมูล', { errors: v.errors });
    // Every submission uses a slot (never released), so a failing forward cannot be used to bypass the limit.
    if ((await reserveAttempt(env, 'inquiry:' + s.uid, INQUIRY_MAX, INQUIRY_WINDOW)) === null) {
      throw new HttpError(429, 'ส่งคำขอบ่อยเกินไป กรุณาลองใหม่ภายหลัง');
    }
    const q = v.value;
    const ins = await env.DB.prepare(
      `INSERT INTO inquiries (line_user_id, organization, email, course, expectation, details, learners, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(s.uid, q.organization, q.email, q.course, q.expectation, q.details, q.learners, now()).run();
    const result = await forwardInquiry(env, new URL(req.url).hostname, q);
    // The request is stored and already forwarded: a failure to record that must not become a 500
    // (the learner would retry and send the lead twice).
    try {
      await env.DB.prepare('UPDATE inquiries SET forwarded = ?, forward_error = ? WHERE id = ?')
        .bind(result.ok ? 1 : 0, result.error, ins.meta.last_row_id).run();
    } catch {
      // Keep the answer truthful: the forward itself happened. Log the id only, never the learner's data.
      console.error('inquiry status update failed', ins.meta.last_row_id);
    }
    return json({ ok: true, forwarded: result.ok });
  },
};

// Server-to-server copy to the website's contact endpoint (it emails ask@innow.co.th). Never throws; the error is a
// short safe code ('disabled', 'timeout', 'network' or the HTTP status), never a response body or secret.
async function forwardInquiry(env, hostname, q) {
  const raw = String(env.INQUIRY_FORWARD_URL ?? '').trim();
  let url = null;
  try { url = raw ? new URL(raw) : null; } catch { /* invalid URL: disabled */ }
  // Plain http is only ever allowed to a loopback host in dev, so production can never forward unencrypted.
  const allowed = url && (url.protocol === 'https:' || (url.protocol === 'http:' && isLocalHost(url.hostname) && devFakeLineActive(env, hostname)));
  if (!allowed) return { ok: false, error: 'disabled' };
  const ms = Number(env.INQUIRY_FORWARD_TIMEOUT_MS);
  const timeout = Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_FORWARD_TIMEOUT;
  try {
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'innow-line-worker' },
      body: JSON.stringify({ organization: q.organization, email: q.email, course: q.course, expectation: q.expectation, details: q.details, learners: q.learners, website: '' }),
      signal: AbortSignal.timeout(timeout),
      redirect: 'manual', // never re-POST the lead body to a host the redirect names
    });
    res.body?.cancel().catch(() => {});
    // Any 3xx (or an opaque redirect) is a failure; only a real 2xx counts as forwarded.
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) return { ok: false, error: String(res.status || 302) };
    return res.ok ? { ok: true, error: '' } : { ok: false, error: String(res.status) };
  } catch (e) {
    return { ok: false, error: e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : 'network' };
  }
}

// RFC 5987 attr-char: encodeURIComponent also leaves ' ( ) * unescaped, which are not allowed.
const encodeRfc5987 = (s) => encodeURIComponent(s).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

async function serveFile(req, env, itemId, { token, admin = false } = {}) {
  if (!admin) {
    const t = await verifyToken(secret(env), 'file', token);
    if (!t || String(t.iid) !== String(itemId)) return new Response('ลิงก์หมดอายุ กรุณาเปิดไฟล์จากแอป Innow อีกครั้ง', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  const it = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(itemId).first();
  if (!it || !it.r2_key) return new Response('Not found', { status: 404 });
  const obj = await env.FILES.get(it.r2_key);
  if (!obj) return new Response('Not found', { status: 404 });
  // Only allow-listed types are echoed (and shown inline); anything else, including values with CR/LF, is a plain download.
  const baseType = String(it.content_type || '').split(';')[0].trim().toLowerCase();
  const inline = /^(application\/pdf|image\/(png|jpeg|gif|webp|avif)|video\/(mp4|webm))$/.test(baseType);
  return new Response(obj.body, {
    headers: {
      'content-type': inline ? baseType : 'application/octet-stream',
      'content-length': String(obj.size),
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeRfc5987(safeFileName(it.file_name))}`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    },
  });
}

// ---------- Admin API ----------

const admin = {
  async login(req, env) {
    const ip = req.headers.get('cf-connecting-ip') || 'unknown';
    const { password } = await body(req);
    const ids = await reserveAdminAttempt(env, ip);
    if (!ids) throw new HttpError(429, 'ลองผิดหลายครั้ง กรุณารอ 10 นาที');
    if (!env.ADMIN_PASSWORD || !timingSafeEqualStr(password ?? '', env.ADMIN_PASSWORD)) {
      await audit(env, 'admin', 'admin_login_fail', { ip });
      throw new HttpError(401, 'รหัสผ่านไม่ถูกต้อง');
    }
    await releaseAttempt(env, ids);
    await audit(env, 'admin', 'admin_login', { ip });
    return json({ token: await signToken(secret(env), 'admin', { ip }, ADMIN_TTL) });
  },

  async listWorkshops(req, env) {
    const { results } = await env.DB.prepare(
      `SELECT w.*,
        (SELECT COUNT(*) FROM enrollments e WHERE e.workshop_id = w.id) AS members,
        (SELECT COUNT(*) FROM items i WHERE i.workshop_id = w.id) AS items
       FROM workshops w ORDER BY w.created_at DESC`).all();
    return json({ workshops: results.map((w) => ({ ...workshopSummary(w), active: !!w.active, members: w.members, items: w.items, createdAt: w.created_at })) });
  },

  async saveWorkshop(req, env, id) {
    const b = await body(req);
    const title = String(b.title ?? '').trim();
    if (!title) throw new HttpError(422, 'กรุณาใส่ชื่อ Workshop');
    const description = String(b.description ?? '').trim();
    const eventDate = String(b.eventDate ?? '').trim();
    const active = b.active === false ? 0 : 1;
    if (id) {
      const r = await env.DB.prepare('UPDATE workshops SET title = ?, description = ?, event_date = ?, active = ? WHERE id = ?').bind(title, description, eventDate, active, id).run();
      if (!r.meta.changes) throw new HttpError(404, 'ไม่พบ Workshop');
    } else {
      id = slugify(title);
      await env.DB.prepare('INSERT INTO workshops (id, title, description, event_date, active, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, title, description, eventDate, active, now()).run();
    }
    await audit(env, 'admin', 'workshop_save', { id, title });
    return json({ id });
  },

  async deleteWorkshop(req, env, id) {
    const { results } = await env.DB.prepare("SELECT r2_key FROM items WHERE workshop_id = ? AND r2_key != ''").bind(id).all();
    if (results.length) await env.FILES.delete(results.map((r) => r.r2_key));
    await env.DB.batch([
      env.DB.prepare('DELETE FROM items WHERE workshop_id = ?').bind(id),
      env.DB.prepare('DELETE FROM codes WHERE workshop_id = ?').bind(id),
      env.DB.prepare('DELETE FROM enrollments WHERE workshop_id = ?').bind(id),
      env.DB.prepare('DELETE FROM workshops WHERE id = ?').bind(id),
    ]);
    await audit(env, 'admin', 'workshop_delete', { id });
    return json({ ok: true });
  },

  async codes(req, env, wid) {
    const { results } = await env.DB.prepare('SELECT * FROM codes WHERE workshop_id = ? ORDER BY created_at DESC LIMIT 20').bind(wid).all();
    const t = now();
    const redeemed = await env.DB.prepare('SELECT code_id, COUNT(*) AS n FROM enrollments WHERE workshop_id = ? GROUP BY code_id').bind(wid).all();
    const counts = Object.fromEntries(redeemed.results.map((r) => [r.code_id, r.n]));
    return json({
      serverNow: t,
      codes: results.map((c) => ({ id: c.id, code: c.code, expiresAt: c.expires_at >= NEVER_EXPIRES ? null : c.expires_at, neverExpires: c.expires_at >= NEVER_EXPIRES, createdAt: c.created_at, active: !c.revoked && c.expires_at > t, revoked: !!c.revoked, redeemed: counts[c.id] || 0 })),
    });
  },

  // Issue a new code; previous active codes for this workshop are revoked (rotate).
  async newCode(req, env, wid) {
    const b = await body(req).catch(() => ({}));
    const never = b.never === true;
    const minutes = Math.min(Math.max(Number(b.minutes) || 5, 1), MAX_CODE_MINUTES);
    const w = await env.DB.prepare('SELECT id FROM workshops WHERE id = ?').bind(wid).first();
    if (!w) throw new HttpError(404, 'ไม่พบ Workshop');
    const t = now();
    const { results } = await env.DB.prepare('SELECT code FROM codes WHERE revoked = 0 AND expires_at > ?').bind(t).all();
    const code = randomCode(new Set(results.map((r) => r.code)));
    await env.DB.batch([
      env.DB.prepare('UPDATE codes SET revoked = 1 WHERE workshop_id = ? AND revoked = 0 AND expires_at > ?').bind(wid, t),
      env.DB.prepare('INSERT INTO codes (workshop_id, code, expires_at, created_at) VALUES (?, ?, ?, ?)').bind(wid, code, never ? NEVER_EXPIRES : t + minutes * 60000, t),
    ]);
    if (never) {
      await audit(env, 'admin', 'code_new', { workshopId: wid, never: true });
      return json({ code, expiresAt: null, neverExpires: true, serverNow: t });
    }
    await audit(env, 'admin', 'code_new', { workshopId: wid, minutes });
    return json({ code, expiresAt: t + minutes * 60000, serverNow: t });
  },

  async revokeCodes(req, env, wid) {
    await env.DB.prepare('UPDATE codes SET revoked = 1 WHERE workshop_id = ? AND revoked = 0').bind(wid).run();
    await audit(env, 'admin', 'code_revoke', { workshopId: wid });
    return json({ ok: true });
  },

  async items(req, env, wid) {
    const { results } = await env.DB.prepare('SELECT * FROM items WHERE workshop_id = ? ORDER BY kind, sort, id').bind(wid).all();
    return json({ items: results.map((it) => ({ ...publicItem(it), sort: it.sort })) });
  },

  // multipart/form-data: kind, title, category, body, url, sort, file?
  async saveItem(req, env, wid, itemId) {
    const ct = req.headers.get('content-type') || '';
    let f;
    // Refuse oversized bodies before buffering them (Workers have 128 MB of memory).
    if (ct.includes('multipart/form-data')) {
      const len = req.headers.get('content-length');
      if (!len || !/^\d+$/.test(len)) throw new HttpError(411, 'ไม่สามารถอัปโหลดแบบไม่ระบุขนาดได้ ไฟล์ใหญ่กรุณาแนบเป็นลิงก์แทน');
      if (Number(len) > MAX_UPLOAD + 1024 * 1024) throw new HttpError(413, 'ไฟล์ใหญ่เกิน 40MB กรุณาแนบเป็นลิงก์แทน');
    }
    if (ct.includes('multipart/form-data')) f = await req.formData();
    else { const b = await body(req); f = new Map(Object.entries(b)); }
    const get = (k) => String(f.get(k) ?? '').trim();
    const kind = get('kind');
    if (!['slide', 'prompt', 'bonus'].includes(kind)) throw new HttpError(422, 'ประเภทไม่ถูกต้อง');
    const title = get('title');
    if (!title) throw new HttpError(422, 'กรุณาใส่ชื่อรายการ');
    const url = get('url');
    if (url && !/^https:\/\//i.test(url)) throw new HttpError(422, 'ลิงก์ต้องขึ้นต้นด้วย https://');
    const fields = { kind, title, category: get('category'), body: get('body'), url, sort: Number(get('sort')) || 0 };

    // Everything that can fail is checked before anything is written to R2 (no orphan objects).
    let old = null;
    if (itemId) {
      old = await env.DB.prepare('SELECT * FROM items WHERE id = ? AND workshop_id = ?').bind(itemId, wid).first();
      if (!old) throw new HttpError(404, 'ไม่พบรายการ');
    }
    const file = f.get('file');
    let fileFields = null;
    if (file && typeof file === 'object' && file.size > 0) {
      if (file.size > MAX_UPLOAD) throw new HttpError(413, 'ไฟล์ใหญ่เกิน 40MB กรุณาแนบเป็นลิงก์แทน');
      const key = `workshops/${wid}/${crypto.randomUUID()}`;
      await env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type || 'application/octet-stream' } });
      fileFields = { r2_key: key, file_name: safeFileName(file.name), content_type: file.type || 'application/octet-stream', size: file.size };
    }

    if (itemId) {
      const removeFile = get('removeFile') === '1';
      const ff = fileFields || (removeFile ? { r2_key: '', file_name: '', content_type: '', size: 0 } : null);
      const merged = { ...fields, ...(ff || { r2_key: old.r2_key, file_name: old.file_name, content_type: old.content_type, size: old.size }) };
      await env.DB.prepare('UPDATE items SET kind=?, title=?, category=?, body=?, url=?, sort=?, r2_key=?, file_name=?, content_type=?, size=? WHERE id=?')
        .bind(merged.kind, merged.title, merged.category, merged.body, merged.url, merged.sort, merged.r2_key, merged.file_name, merged.content_type, merged.size, itemId).run();
      // Delete the replaced object only after the row points at the new one.
      if (ff && old.r2_key) await env.FILES.delete(old.r2_key);
    } else {
      const ff = fileFields || { r2_key: '', file_name: '', content_type: '', size: 0 };
      const r = await env.DB.prepare('INSERT INTO items (workshop_id, kind, title, category, body, url, sort, r2_key, file_name, content_type, size, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(wid, kind, title, fields.category, fields.body, url, fields.sort, ff.r2_key, ff.file_name, ff.content_type, ff.size, now()).run();
      itemId = r.meta.last_row_id;
    }
    await audit(env, 'admin', 'item_save', { workshopId: wid, itemId, kind, file: !!fileFields });
    return json({ id: itemId });
  },

  async deleteItem(req, env, wid, itemId) {
    const it = await env.DB.prepare('SELECT * FROM items WHERE id = ? AND workshop_id = ?').bind(itemId, wid).first();
    if (!it) throw new HttpError(404, 'ไม่พบรายการ');
    if (it.r2_key) await env.FILES.delete(it.r2_key);
    await env.DB.prepare('DELETE FROM items WHERE id = ?').bind(itemId).run();
    await audit(env, 'admin', 'item_delete', { workshopId: wid, itemId });
    return json({ ok: true });
  },

  async members(req, env) {
    const wid = new URL(req.url).searchParams.get('workshop');
    const sql = wid
      ? `SELECT m.*, (SELECT GROUP_CONCAT(w.title, ' | ') FROM enrollments e2 JOIN workshops w ON w.id = e2.workshop_id WHERE e2.line_user_id = m.line_user_id) AS workshops
         FROM members m JOIN enrollments e ON e.line_user_id = m.line_user_id AND e.workshop_id = ? ORDER BY e.created_at DESC`
      : `SELECT m.*, (SELECT GROUP_CONCAT(w.title, ' | ') FROM enrollments e2 JOIN workshops w ON w.id = e2.workshop_id WHERE e2.line_user_id = m.line_user_id) AS workshops
         FROM members m ORDER BY m.created_at DESC`;
    const { results } = await (wid ? env.DB.prepare(sql).bind(wid) : env.DB.prepare(sql)).all();
    return json({
      members: results.map((m) => ({
        lineUserId: m.line_user_id, firstName: m.first_name, lastName: m.last_name, email: m.email, displayName: m.display_name,
        marketing: !!m.marketing_consent, isFriend: !!m.is_friend, createdAt: m.created_at, lastSeenAt: m.last_seen_at, workshops: m.workshops || '',
      })),
    });
  },

  async membersCsv(req, env) {
    const res = await admin.members(req, env);
    const { members } = await res.json();
    const iso = (t) => (t ? new Date(t).toISOString() : '');
    const head = ['first_name', 'last_name', 'email', 'line_display_name', 'marketing_consent', 'is_friend', 'workshops', 'registered_at', 'last_seen_at'];
    const rows = members.map((m) => [m.firstName, m.lastName, m.email, m.displayName, m.marketing ? 'yes' : 'no', m.isFriend ? 'yes' : 'no', m.workshops, iso(m.createdAt), iso(m.lastSeenAt)]);
    const csv = '\uFEFF' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
    return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="members.csv"', 'cache-control': 'no-store' } });
  },

  async copyFrom(req, env, wid, sourceId) {
    if (wid === sourceId) throw new HttpError(400, 'ไม่สามารถคัดลอกจาก Workshop เดียวกัน');
    const [dst, src] = await Promise.all([
      env.DB.prepare('SELECT id FROM workshops WHERE id = ?').bind(wid).first(),
      env.DB.prepare('SELECT id FROM workshops WHERE id = ?').bind(sourceId).first(),
    ]);
    if (!dst || !src) throw new HttpError(404, 'ไม่พบ Workshop');
    const { results } = await env.DB.prepare('SELECT * FROM items WHERE workshop_id = ? ORDER BY id').bind(sourceId).all();
    const t = now();
    let copied = 0;
    for (const it of results) {
      let ff = { r2_key: '', file_name: it.file_name, content_type: it.content_type, size: it.size };
      if (it.r2_key) {
        const obj = await env.FILES.get(it.r2_key);
        if (!obj) continue; // source file missing: skip rather than create a broken item
        ff.r2_key = `workshops/${wid}/${crypto.randomUUID()}`;
        await env.FILES.put(ff.r2_key, obj.body, { httpMetadata: { contentType: it.content_type || 'application/octet-stream' } });
      } else {
        ff = { r2_key: '', file_name: '', content_type: '', size: 0 };
      }
      await env.DB.prepare('INSERT INTO items (workshop_id, kind, title, category, body, url, sort, r2_key, file_name, content_type, size, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(wid, it.kind, it.title, it.category, it.body, it.url, it.sort, ff.r2_key, ff.file_name, ff.content_type, ff.size, t).run();
      copied++;
    }
    await audit(env, 'admin', 'items_copy', { workshopId: wid, sourceId, copied });
    return json({ copied });
  },

  async removeEnrollment(req, env, wid, uid) {
    await env.DB.prepare('DELETE FROM enrollments WHERE workshop_id = ? AND line_user_id = ?').bind(wid, uid).run();
    await audit(env, 'admin', 'enroll_remove', { workshopId: wid, uid });
    return json({ ok: true });
  },

  async audit(req, env) {
    const { results } = await env.DB.prepare(
      `SELECT a.*, m.first_name, m.last_name FROM audit_log a LEFT JOIN members m ON m.line_user_id = a.actor ORDER BY a.id DESC LIMIT 300`).all();
    return json({ log: results.map((r) => ({ id: r.id, actor: r.actor, name: r.first_name ? `${r.first_name} ${r.last_name}` : '', action: r.action, detail: r.detail, createdAt: r.created_at })) });
  },

  async inquiries(req, env) {
    const { results } = await env.DB.prepare(
      `SELECT q.*, m.first_name, m.last_name FROM inquiries q LEFT JOIN members m ON m.line_user_id = q.line_user_id
       ORDER BY q.id DESC LIMIT 200`).all();
    return json({ inquiries: results.map((q) => ({
      id: q.id, createdAt: q.created_at, organization: q.organization, email: q.email, course: q.course, expectation: q.expectation,
      details: q.details, learners: q.learners, memberName: q.first_name ? `${q.first_name} ${q.last_name}`.trim() : '',
      forwarded: !!q.forwarded, forwardError: q.forward_error,
    })) });
  },

  async stats(req, env) {
    const [m, w, e, f] = await env.DB.batch([
      env.DB.prepare('SELECT COUNT(*) AS n FROM members'),
      env.DB.prepare('SELECT COUNT(*) AS n FROM workshops'),
      env.DB.prepare('SELECT COUNT(*) AS n FROM enrollments'),
      env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'redeem_fail' AND created_at > ?").bind(now() - 86400000),
    ]);
    return json({ members: m.results[0].n, workshops: w.results[0].n, enrollments: e.results[0].n, failedCodes24h: f.results[0].n });
  },
};

// ---------- Router ----------

async function route(req, env) {
  const url = new URL(req.url);
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const M = req.method;
  let m;

  if ((m = p.match(/^\/f\/(\d+)$/)) && M === 'GET') return serveFile(req, env, Number(m[1]), { token: url.searchParams.get('t') });

  if (p === '/api/config' && M === 'GET') return member.config(req, env);
  if (p === '/api/auth' && M === 'POST') return member.auth(req, env);
  if (p === '/api/me' && M === 'GET') return member.me(req, env);
  if (p === '/api/inquiry' && M === 'POST') return member.inquiry(req, env);
  if (p === '/api/redeem' && M === 'POST') return member.redeem(req, env);
  if (p === '/api/register' && M === 'POST') return member.register(req, env);
  if (p === '/api/prompts' && M === 'GET') return member.byKind(req, env, 'prompt');
  if (p === '/api/bonus' && M === 'GET') return member.byKind(req, env, 'bonus');
  if ((m = p.match(/^\/api\/workshops\/([\w-]+)$/)) && M === 'GET') return member.workshop(req, env, m[1]);
  if ((m = p.match(/^\/api\/items\/(\d+)\/link$/)) && M === 'POST') return member.fileLink(req, env, Number(m[1]));

  if (p === '/api/admin/login' && M === 'POST') return admin.login(req, env);
  if (p.startsWith('/api/admin/')) {
    await adminSession(req, env);
    if (p === '/api/admin/stats' && M === 'GET') return admin.stats(req, env);
    if (p === '/api/admin/workshops' && M === 'GET') return admin.listWorkshops(req, env);
    if (p === '/api/admin/workshops' && M === 'POST') return admin.saveWorkshop(req, env, null);
    if ((m = p.match(/^\/api\/admin\/workshops\/([\w-]+)$/))) {
      if (M === 'PUT') return admin.saveWorkshop(req, env, m[1]);
      if (M === 'DELETE') return admin.deleteWorkshop(req, env, m[1]);
    }
    if ((m = p.match(/^\/api\/admin\/workshops\/([\w-]+)\/codes$/))) {
      if (M === 'GET') return admin.codes(req, env, m[1]);
      if (M === 'POST') return admin.newCode(req, env, m[1]);
      if (M === 'DELETE') return admin.revokeCodes(req, env, m[1]);
    }
    if ((m = p.match(/^\/api\/admin\/workshops\/([\w-]+)\/items$/))) {
      if (M === 'GET') return admin.items(req, env, m[1]);
      if (M === 'POST') return admin.saveItem(req, env, m[1], null);
    }
    if ((m = p.match(/^\/api\/admin\/workshops\/([\w-]+)\/items\/(\d+)$/))) {
      if (M === 'POST' || M === 'PUT') return admin.saveItem(req, env, m[1], Number(m[2]));
      if (M === 'DELETE') return admin.deleteItem(req, env, m[1], Number(m[2]));
    }
    if ((m = p.match(/^\/api\/admin\/workshops\/([\w-]+)\/members\/([\w-]+)$/)) && M === 'DELETE') return admin.removeEnrollment(req, env, m[1], m[2]);
    if ((m = p.match(/^\/api\/admin\/items\/(\d+)\/file$/)) && M === 'GET') return serveFile(req, env, Number(m[1]), { admin: true });
    if (p === '/api/admin/members' && M === 'GET') return admin.members(req, env);
    if (p === '/api/admin/members.csv' && M === 'GET') return admin.membersCsv(req, env);
    if ((m = p.match(/^\/api\/admin\/workshops\/([\w-]+)\/copy-from\/([\w-]+)$/)) && M === 'POST') return admin.copyFrom(req, env, m[1], m[2]);
    if (p === '/api/admin/inquiries' && M === 'GET') return admin.inquiries(req, env);
    if (p === '/api/admin/audit' && M === 'GET') return admin.audit(req, env);
  }
  if (p.startsWith('/api/')) throw new HttpError(404, 'Not found');
  return env.ASSETS.fetch(req);
}

export default {
  async fetch(req, env) {
    try {
      return await route(req, env);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...e.extra }, e.status);
      console.error(e);
      return json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' }, 500);
    }
  },
};
