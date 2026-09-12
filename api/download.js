'use strict';
const { createHash } = require('node:crypto');
// The browser never receives the email service credential or recipient configuration.
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ message: 'Method not allowed' }); }
  const origin = req.headers.origin;
  if (origin) {
    try { if (new URL(origin).host !== req.headers.host) return res.status(403).json({ message: 'Invalid origin' }); }
    catch { return res.status(403).json({ message: 'Invalid origin' }); }
  }
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) return res.status(415).json({ message: 'Expected JSON' });
  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ message: 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ message: 'ข้อมูลไม่ถูกต้อง' });
  if (JSON.stringify(body).length > 8000) return res.status(413).json({ message: 'ข้อมูลยาวเกินไป' });
  if (body.website) return res.status(400).json({ message: 'ไม่สามารถส่งข้อมูลได้' });
  const limits = { name: 150, email: 254, phone: 30, position: 150, organization: 150 };
  const lead = {};
  for (const [key, limit] of Object.entries(limits)) {
    if (typeof body[key] !== 'string' || !body[key].trim() || body[key].length > limit || /[\r\n\x00-\x1f]/.test(body[key])) return res.status(400).json({ message: 'กรุณากรอกข้อมูลติดต่อทั้ง 5 ช่องให้ครบถ้วน' });
    lead[key] = body[key].trim();
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email) || !/^[+\d() .-]{8,30}$/.test(lead.phone) || lead.phone.replace(/\D/g, '').length < 8) return res.status(400).json({ message: 'กรุณาตรวจสอบอีเมลและเบอร์โทร' });
  const interest = ['Company Profile', 'ChatGPT & AI Mastery', 'Secure Coding'].includes(body.interest) ? body.interest : 'Company Profile';
  const { RESEND_API_KEY, LEAD_RECIPIENT_EMAIL, LEAD_FROM_EMAIL } = process.env;
  if (!RESEND_API_KEY || !LEAD_RECIPIENT_EMAIL || !LEAD_FROM_EMAIL) return res.status(503).json({ message: 'ระบบรับข้อมูลยังไม่พร้อมให้บริการ กรุณาลองใหม่ภายหลัง' });
  const key = String(req.headers['idempotency-key'] || '');
  if (!/^[a-f0-9-]{36}$/i.test(key)) return res.status(400).json({ message: 'กรุณาโหลดหน้าเว็บใหม่แล้วลองอีกครั้ง' });
  const digest = createHash('sha256').update(JSON.stringify({ ...lead, interest })).digest('hex').slice(0, 24);
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `innow-${key}-${digest}` },
      body: JSON.stringify({ from: LEAD_FROM_EMAIL, to: [LEAD_RECIPIENT_EMAIL], reply_to: lead.email, subject: 'Innow — มีผู้ขอดาวน์โหลดรายละเอียดเพิ่มเติม', text: `ชื่อ: ${lead.name}\nอีเมล: ${lead.email}\nเบอร์โทร: ${lead.phone}\nตำแหน่งงาน: ${lead.position}\nชื่อองค์กร: ${lead.organization}\nความสนใจ: ${interest}\n\nแหล่งที่มา: แบบฟอร์มดาวน์โหลดรายละเอียดเพิ่มเติมบนเว็บไซต์ Innow` }),
      signal: AbortSignal.timeout(10000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.id) return res.status(502).json({ message: 'ยังส่งข้อมูลไม่ได้ กรุณาลองใหม่อีกครั้ง' });
    return res.status(200).json({ ok: true });
  } catch { return res.status(502).json({ message: 'การเชื่อมต่อระบบส่งอีเมลขัดข้อง กรุณาลองใหม่อีกครั้ง' }); }
};
