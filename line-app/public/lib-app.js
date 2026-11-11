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

// liff.login()/liff.logout() must never run inside the LINE client (liff.init logs in there automatically).
export const canCallLiffLogin = ({ inClient } = {}) => !inClient;

// ---------- Google Slides embed ----------

// Strict allow-list on the RAW string (no URL parser, so no normalisation can widen what passes): https, host exactly
// docs.google.com (lowercase, no port, no userinfo, no trailing dot), path /presentation/d/<id> and then nothing, or one of
// / ? #. The rest of the URL (path suffix, query, fragment) is discarded, so the deck always starts at slide 1 and the
// viewer link is never the editor. Published links (/d/e/<id>/pub) are not supported yet (their id is "e" and fails).
const SLIDES_RE = /^https:\/\/docs\.google\.com\/presentation\/d\/([A-Za-z0-9_-]{20,100})(?:[/?#][^\s\\\p{Cc}\p{Cf}]*)?$/u;

export function googleSlidesInfo(url) {
  if (typeof url !== 'string' || url.length > 2048) return null;
  const m = SLIDES_RE.exec(url);
  if (!m) return null;
  const base = 'https://docs.google.com/presentation/d/' + m[1];
  return { id: m[1], embedUrl: base + '/embed?start=false&loop=false&delayms=3000', openUrl: base + '/preview' };
}

// State machine of one slide card (kept DOM free so it can be unit tested):
//   poster -> loaded (tap) -> native | overlay (full screen) -> loaded (close). Loaded is never lost.
// ctx.native: whether the Fullscreen API actually entered fullscreen; anything else means the in-app overlay.
const SLIDES_STATES = new Set(['poster', 'loaded', 'native', 'overlay']);
export function slidesCardState(state, event, { native = false } = {}) {
  const s = SLIDES_STATES.has(state) ? state : 'poster';
  if (event === 'load') return s === 'poster' ? 'loaded' : s;
  if (event === 'fullscreen') return native === true ? 'native' : 'overlay';
  if (event === 'close') return s === 'native' || s === 'overlay' ? 'loaded' : s;
  // Native fullscreen really started (possibly late, after the overlay fallback): never keep both modes.
  if (event === 'native-entered') return s === 'poster' ? s : 'native';
  // Native fullscreen ended (Esc, system gesture): back to the inline card, still loaded.
  if (event === 'native-exit') return s === 'native' || s === 'overlay' ? 'loaded' : s;
  return s;
}

// Guards for the async fullscreen request. A second tap while one is pending, a released card (screen changed) and an
// already open full view are ignored; a late timeout or promise must not touch a released or detached card.
export const slidesCanEnter = ({ pending = false, destroyed = false, state = 'poster' } = {}) =>
  !pending && !destroyed && state !== 'native' && state !== 'overlay';
export const slidesCanApply = ({ destroyed = false, connected = false } = {}) => !destroyed && connected === true;
