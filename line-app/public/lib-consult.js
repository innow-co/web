// Pure logic of the AI automation consultation wizard (Contact > ปรึกษาการ Setup AI ทำ Automation). No DOM access.
// Shares the state machine with the quote wizard (createMachine in lib-wizard.js); rules and messages mirror
// validateConsultation in src/lib.js, and tests/wizard.test.mjs compares the two on boundary inputs.
import { createMachine } from './lib-wizard.js';

export const DRAFT_KEY = 'innow.consult'; // its own key: never mixed with the quote draft ('innow.inquiry')

export const LIMITS = { organization: 160, email: 254, systems: 2000, goals: 2000, teamSizeMin: 1, teamSizeMax: 100000 };

const MSG = {
  organization: 'กรอกชื่อองค์กร',
  email: 'กรอกอีเมลติดต่อให้ถูกต้อง',
  systems: 'เล่าระบบที่ใช้อยู่ตอนนี้ (ไม่เกิน 2,000 ตัวอักษร)',
  goals: 'เล่างานที่อยากให้ AI ช่วย (ไม่เกิน 2,000 ตัวอักษร)',
  teamSize: 'กรอกขนาดทีมเป็นจำนวนเต็มตั้งแต่ 1 ถึง 100,000 คน',
};

export const STEPS = [
  { id: 'organization', required: true, label: 'ชื่อองค์กร', question: 'องค์กรของคุณชื่ออะไร' },
  { id: 'systems', required: true, label: 'ระบบที่ใช้อยู่ตอนนี้', question: 'ตอนนี้ใช้ระบบอะไรอยู่บ้าง' },
  { id: 'goals', required: true, label: 'งานที่อยากให้ AI ช่วยทำอัตโนมัติ', question: 'งานอะไรที่อยากให้ AI ช่วยทำอัตโนมัติ' },
  { id: 'teamSize', required: false, label: 'ขนาดทีมที่ใช้ระบบ', question: 'ขนาดทีมที่ใช้ระบบ' },
  { id: 'email', required: true, label: 'อีเมลติดต่อ', question: 'อีเมลติดต่อ' },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v) => (typeof v === 'string' ? v.trim() : '');

export function emptyAnswers(prefillEmail) {
  return { organization: '', systems: '', goals: '', teamSize: '', email: typeof prefillEmail === 'string' ? prefillEmail : '' };
}

export const { nextStep, prevStep, stepNumber, firstFailingStep, parseDraft } = createMachine(STEPS, emptyAnswers);

export function validateStep(id, answers) {
  const a = answers && typeof answers === 'object' ? answers : {};
  const fail = (error) => ({ ok: false, error });
  const pass = { ok: true, error: '' };
  switch (id) {
    case 'organization': {
      const v = str(a.organization);
      return v && v.length <= LIMITS.organization && !/[\r\n]/.test(v) ? pass : fail(MSG.organization);
    }
    case 'systems': {
      const v = str(a.systems);
      return v && v.length <= LIMITS.systems ? pass : fail(MSG.systems);
    }
    case 'goals': {
      const v = str(a.goals);
      return v && v.length <= LIMITS.goals ? pass : fail(MSG.goals);
    }
    case 'teamSize': {
      // Skipped (absent or exactly '') is fine; a blank ' ' is not, same as the server.
      if (a.teamSize === undefined || a.teamSize === null || a.teamSize === '') return pass;
      const v = str(a.teamSize);
      const n = /^\d+$/.test(v) ? Number(v) : NaN;
      return Number.isSafeInteger(n) && n >= LIMITS.teamSizeMin && n <= LIMITS.teamSizeMax ? pass : fail(MSG.teamSize);
    }
    case 'email': {
      const v = str(a.email);
      return v.length <= LIMITS.email && EMAIL_RE.test(v) ? pass : fail(MSG.email);
    }
    default:
      return fail('ไม่พบขั้นตอนนี้');
  }
}

// Rows for the summary screen: `step` is the step to jump to for "แก้ไข".
export function summaryRows(answers) {
  const a = answers || {};
  return STEPS.map((s) => {
    let value = str(a[s.id]);
    if (s.id === 'teamSize') value = value ? value + ' คน' : 'ไม่ได้ระบุ';
    return { step: s.id, label: s.label, value };
  });
}

// Body for POST /api/consultation. A skipped team size is left out.
export function buildPayload(answers) {
  const a = answers || {};
  const team = str(a.teamSize);
  return { organization: str(a.organization), systems: str(a.systems), goals: str(a.goals), ...(team ? { teamSize: team } : {}), email: str(a.email) };
}
