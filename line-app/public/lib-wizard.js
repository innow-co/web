// Pure logic of the quote-request wizard (Contact > สอบถามคอร์สอบรม). No DOM access, so Node can import and test it.
// Rules and messages mirror validateInquiry in src/lib.js; tests/wizard.test.mjs compares the two on boundary inputs.

export const COURSE_DEFAULT = 'ยังไม่แน่ใจ อยากให้ช่วยแนะนำ';

// Copied from the website's #course <select> (index.html); a test compares them.
export const COURSE_GROUPS = [
  { label: 'สายธุรกิจและผู้บริหาร', items: ['ChatGPT & AI Mastery', "ChatGPT Astra at Work: Standardize Your Team's Workflow", 'Claude Cowork: Connect, Automate, and Collaborate with AI', 'AI Decision System for Leaders'] },
  { label: 'สายนักพัฒนา', items: ['AI-Powered Software Development Mastery', 'Claude Code for Software Dev Process', 'Secure Coding'] },
];

export const EXPECTATIONS = [
  'บรรยาย ครึ่งวัน–1 วัน มี Workshop เล็กน้อย',
  'Workshop ระยะสั้น 2 วัน เน้นลงมือทำจริงและขอหัวข้อที่ต้องการได้',
  'Bootcamp มุ่งสร้างผลงานที่จับต้องได้หลังเรียนจบ',
  'หลักสูตรขั้นสูงสำหรับผู้บริหาร เช่น Governance / Policy Control 1 วัน',
  'อื่นๆ',
];

export const LIMITS = { organization: 160, email: 254, course: 200, expectation: 300, details: 2000, learnersMin: 1, learnersMax: 100000 };

const MSG = {
  organization: 'กรอกชื่อองค์กร',
  email: 'กรอกอีเมลติดต่อให้ถูกต้อง',
  course: 'เลือกหลักสูตรที่สนใจ',
  expectation: 'เลือกรูปแบบที่ต้องการ',
  details: 'รายละเอียดเพิ่มเติมต้องไม่เกิน 2,000 ตัวอักษร',
  learners: 'กรอกจำนวนผู้เรียนเป็นจำนวนเต็มตั้งแต่ 1 ถึง 100,000 คน',
};

export const STEPS = [
  { id: 'organization', required: true, label: 'ชื่อองค์กร', question: 'องค์กรของคุณชื่ออะไร' },
  { id: 'course', required: true, label: 'หลักสูตรที่สนใจ', question: 'หลักสูตรที่สนใจ' },
  { id: 'expectation', required: true, label: 'รูปแบบและความคาดหวัง', question: 'รูปแบบและความคาดหวัง' },
  { id: 'learners', required: true, label: 'จำนวนผู้เรียนโดยประมาณ', question: 'จำนวนผู้เรียนโดยประมาณ' },
  { id: 'email', required: true, label: 'อีเมลติดต่อ', question: 'อีเมลติดต่อ' },
  { id: 'details', required: false, label: 'รายละเอียดเพิ่มเติม', question: 'รายละเอียดเพิ่มเติมหรือหัวข้อ Workshop ที่ต้องการ' },
];

const IDS = STEPS.map((s) => s.id);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v) => (typeof v === 'string' ? v.trim() : '');

export function emptyAnswers(prefillEmail) {
  return { organization: '', course: COURSE_DEFAULT, expectation: '', learners: '', email: typeof prefillEmail === 'string' ? prefillEmail : '', details: '' };
}

// 'summary' follows the last question. Unknown ids have no neighbours.
export function nextStep(id) {
  if (id === 'summary') return null;
  const i = IDS.indexOf(id);
  if (i < 0) return null;
  return i === IDS.length - 1 ? 'summary' : IDS[i + 1];
}

export function prevStep(id) {
  if (id === 'summary') return IDS[IDS.length - 1];
  const i = IDS.indexOf(id);
  return i > 0 ? IDS[i - 1] : null;
}

// "ข้อ n จาก 6": the summary screen counts as the last step.
export function stepNumber(id) {
  if (id === 'summary') return IDS.length;
  const i = IDS.indexOf(id);
  return i < 0 ? 0 : i + 1;
}

const noLineBreak = (s) => !/[\r\n]/.test(s);

export function validateStep(id, answers) {
  const a = answers && typeof answers === 'object' ? answers : {};
  const fail = (error) => ({ ok: false, error });
  const pass = { ok: true, error: '' };
  switch (id) {
    case 'organization': {
      const v = str(a.organization);
      return v && v.length <= LIMITS.organization && noLineBreak(v) ? pass : fail(MSG.organization);
    }
    case 'course': {
      const v = str(a.course);
      return v && v.length <= LIMITS.course && noLineBreak(v) ? pass : fail(MSG.course);
    }
    case 'expectation': {
      const v = str(a.expectation);
      return v && v.length <= LIMITS.expectation && noLineBreak(v) ? pass : fail(MSG.expectation);
    }
    case 'learners': {
      const v = str(a.learners);
      const n = /^\d+$/.test(v) ? Number(v) : NaN;
      return Number.isSafeInteger(n) && n >= LIMITS.learnersMin && n <= LIMITS.learnersMax ? pass : fail(MSG.learners);
    }
    case 'email': {
      const v = str(a.email);
      return v.length <= LIMITS.email && EMAIL_RE.test(v) ? pass : fail(MSG.email);
    }
    case 'details':
      return str(a.details).length <= LIMITS.details ? pass : fail(MSG.details);
    default:
      return fail('ไม่พบขั้นตอนนี้');
  }
}

// Rows for the summary screen: `step` is the step to jump to for "แก้ไข".
export function summaryRows(answers) {
  const a = answers || {};
  return STEPS.map((s) => {
    let value = str(a[s.id]);
    if (s.id === 'learners' && value) value += ' คน';
    if (s.id === 'details' && !value) value = 'ไม่ได้ระบุ';
    return { step: s.id, label: s.label, value };
  });
}

// Body for POST /api/inquiry. learners stays a string; the server accepts digit strings.
export function buildPayload(answers) {
  const a = answers || {};
  return { organization: str(a.organization), email: str(a.email), course: str(a.course), expectation: str(a.expectation), details: str(a.details), learners: str(a.learners) };
}

// 422 {errors:{field:msg}}: the earliest step that has an error.
export function firstFailingStep(errors) {
  if (!errors || typeof errors !== 'object') return null;
  return IDS.find((id) => typeof errors[id] === 'string' && errors[id]) || null;
}

// sessionStorage draft: { step, answers }. Only known string fields survive; anything else is dropped.
export function parseDraft(raw, prefillEmail) {
  let d;
  try { d = JSON.parse(raw); } catch { return null; }
  if (!d || typeof d !== 'object' || !d.answers || typeof d.answers !== 'object') return null;
  const answers = emptyAnswers(prefillEmail);
  for (const id of IDS) if (typeof d.answers[id] === 'string') answers[id] = d.answers[id];
  if (!answers.email && typeof prefillEmail === 'string') answers.email = prefillEmail;
  const step = IDS.includes(d.step) || d.step === 'summary' ? d.step : IDS[0];
  return { step, answers };
}
