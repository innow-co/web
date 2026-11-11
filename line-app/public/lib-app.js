// Pure helpers for the learner app. No DOM access, so Node can import and test them.

export const ROUTES = ['home', 'workshops', 'workshop', 'prompts', 'bonus', 'redeem', 'register', 'success', 'profile', 'contact'];

const SAFE_ID = /^[\w-]{1,80}$/;

// Accepts "?p=workshops&id=x" or a full location.search. Handles LIFF's `liff.state` wrapper
// (rich menu deep links arrive as ?liff.state=%3Fp%3Dworkshops on first open).
export function parseRoute(search) {
  let q = new URLSearchParams(search || '');
  const state = q.get('liff.state');
  if (state) {
    const i = state.indexOf('?');
    const inner = i >= 0 ? state.slice(i + 1) : state.includes('=') ? state : '';
    if (inner) q = new URLSearchParams(inner);
  }
  const name = q.get('p') || 'home';
  if (!ROUTES.includes(name)) return { name: 'home' };
  if (name === 'workshop') {
    const id = q.get('id');
    return id && SAFE_ID.test(id) ? { name, id } : { name: 'workshops' };
  }
  return { name };
}

export function routeUrl(route, { dev } = {}) {
  const q = new URLSearchParams();
  if (route.name && route.name !== 'home') q.set('p', route.name);
  if (route.name === 'workshop' && route.id) q.set('id', route.id);
  if (dev) q.set('dev', dev);
  const s = q.toString();
  return s ? '?' + s : '?';
}

// OA basic ids are shown with a leading @ ("@innow"); the add-friend URL wants exactly one.
export function addFriendUrl(basicId) {
  const id = String(basicId ?? '').trim().replace(/^@+/, '');
  if (!id) return '';
  return 'https://line.me/R/ti/p/@' + encodeURIComponent(id);
}

// Opens the OA chat with `text` prefilled. LINE documents https://line.me/R/oaMessage/{URL-encoded basic ID}/?{text};
// the basic id includes "@" (encoded %40), given here with or without it. '' when there is no basic id.
export function oaMessageUrl(basicId, text) {
  const id = String(basicId ?? '').trim().replace(/^@+/, '');
  if (!id) return '';
  return 'https://line.me/R/oaMessage/' + encodeURIComponent('@' + id) + '/?' + encodeURIComponent(String(text ?? ''));
}

export const isNotFriendError = (e) => !!e && e.notFriend === true;

export const isHttps = (u) => /^https:\/\/[^\s]+$/i.test(String(u ?? ''));

// Code boxes: `values` is the 4 current digits ('' when empty). `text` is what was typed, pasted or autofilled.
export function spreadDigits(values, index, text) {
  const digits = String(text ?? '').replace(/\D/g, '');
  const next = values.slice(0, 4);
  while (next.length < 4) next.push('');
  if (!digits) {
    next[index] = '';
    return { values: next, focus: index };
  }
  let i = digits.length >= 4 ? 0 : index;
  for (const d of digits) {
    if (i > 3) break;
    next[i] = d;
    i++;
  }
  return { values: next, focus: Math.min(i, 3) };
}

export const codeString = (values) => values.join('');
export const codeComplete = (values) => /^\d{4}$/.test(codeString(values));

export function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

// Items from /api/prompts or /api/bonus, grouped by workshop in first-seen order.
export function groupByWorkshop(items) {
  const groups = [];
  const index = new Map();
  for (const it of items) {
    let g = index.get(it.workshopId);
    if (!g) {
      g = { workshopId: it.workshopId, title: it.workshopTitle || '', items: [] };
      index.set(it.workshopId, g);
      groups.push(g);
    }
    g.items.push(it);
  }
  return groups;
}

export function tabFor(name) {
  if (name === 'workshops' || name === 'workshop' || name === 'prompts' || name === 'bonus') return 'workshops';
  if (name === 'redeem' || name === 'register' || name === 'success') return 'redeem';
  return name === 'profile' ? 'profile' : 'home';
}
