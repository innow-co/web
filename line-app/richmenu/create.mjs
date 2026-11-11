// Builds and (only with --confirm) creates the Innow LINE OA rich menu.
//
//   node richmenu/create.mjs --dry-run
//   node richmenu/create.mjs --confirm
//
// Env: LINE_CHANNEL_ACCESS_TOKEN, LIFF_ID, OA_BASIC_ID. The token is only ever
// sent in the Authorization header; it is never printed or written to disk.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const W = 2500;
const H = 1686;
const COL_W = [833, 833, 834];
const ROW_H = 843;
const API = 'https://api.line.me';
const API_DATA = 'https://api-data.line.me';
const FACEBOOK_URL = 'https://www.facebook.com/innow.co.th';
const PNG_URL = new URL('./richmenu.png', import.meta.url);

function req(name, v) {
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`${name} is required`);
  return v.trim();
}

export function buildRichMenu(liffId, oaBasicId) {
  const liff = req('liffId', liffId);
  const bare = req('oaBasicId', oaBasicId).replace(/^@+/, '');
  if (!bare) throw new Error('oaBasicId is required');
  const liffUrl = (p) => `https://liff.line.me/${liff}?p=${p}`;
  // LINE documents https://line.me/R/oaMessage/{URL-encoded basic ID}/ ; the
  // basic id includes "@", encoded as %40. Same result with or without "@".
  const oaUrl = `https://line.me/R/oaMessage/${encodeURIComponent('@' + bare)}/`;
  const uris = [
    liffUrl('workshops'), liffUrl('redeem'), liffUrl('prompts'), liffUrl('bonus'),
    FACEBOOK_URL, oaUrl,
  ];
  const labels = ['Workshop', 'รับสิทธิ์', 'Prompt Library', 'Bonus', 'ข่าวสาร', 'ติดต่อเรา'];
  const areas = uris.map((uri, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = COL_W.slice(0, col).reduce((a, b) => a + b, 0);
    return {
      bounds: { x, y: row * ROW_H, width: COL_W[col], height: ROW_H },
      action: { type: 'uri', label: labels[i], uri },
    };
  });
  return {
    size: { width: W, height: H },
    selected: true,
    name: 'Innow rich menu',
    chatBarText: 'เมนู Innow', // LINE limit: 14 characters
    areas,
  };
}

async function lineError(res) {
  let msg = '';
  try { msg = (await res.text()).slice(0, 500); } catch { /* ignore */ }
  try { msg = JSON.parse(msg).message || msg; } catch { /* keep raw */ }
  return `HTTP ${res.status}${msg ? ': ' + msg : ''}`;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const out = (s) => process.stdout.write(s + '\n');
  const err = (s) => process.stderr.write(s + '\n');
  const dry = argv.includes('--dry-run');
  const confirm = argv.includes('--confirm');

  const token = env.LINE_CHANNEL_ACCESS_TOKEN;
  const missing = ['LINE_CHANNEL_ACCESS_TOKEN', 'LIFF_ID', 'OA_BASIC_ID'].filter((k) => !env[k] || !env[k].trim());
  if (missing.length) { err(`Missing required env: ${missing.join(', ')}`); return 1; }

  let body;
  try { body = buildRichMenu(env.LIFF_ID, env.OA_BASIC_ID); } catch (e) { err(e.message); return 1; }

  if (dry) {
    out(JSON.stringify(body, null, 2));
    err('Planned steps (no network call made):');
    err(`1. POST ${API}/v2/bot/richmenu`);
    err(`2. POST ${API_DATA}/v2/bot/richmenu/{id}/content  (richmenu.png, image/png)`);
    err(`3. POST ${API}/v2/bot/user/all/richmenu/{id}  (set as default for ALL friends)`);
    return 0;
  }
  if (!confirm) {
    err('Refusing to run: this changes the live menu for every friend of the OA. Re-run with --confirm (or use --dry-run to preview).');
    return 2;
  }

  const auth = { Authorization: `Bearer ${token}` };
  let id = null;
  try {
    const png = await readFile(PNG_URL);
    let res = await fetch(`${API}/v2/bot/richmenu`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`create failed, ${await lineError(res)}`);
    id = (await res.json()).richMenuId;
    if (!id) throw new Error('create failed, no richMenuId in response');

    res = await fetch(`${API_DATA}/v2/bot/richmenu/${id}/content`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'image/png' }, body: png,
    });
    if (!res.ok) throw new Error(`image upload failed, ${await lineError(res)}`);

    res = await fetch(`${API}/v2/bot/user/all/richmenu/${id}`, { method: 'POST', headers: auth });
    if (!res.ok) throw new Error(`set default failed, ${await lineError(res)}`);
  } catch (e) {
    err(String(e.message || e).split(token).join('[redacted]'));
    if (id) {
      try {
        const d = await fetch(`${API}/v2/bot/richmenu/${id}`, { method: 'DELETE', headers: auth });
        err(d.ok ? `Rolled back: deleted menu ${id}` : `Rollback failed for ${id}: ${await lineError(d)}`);
      } catch { err(`Rollback request failed for ${id}`); }
    }
    return 1;
  }
  out(id);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main();
}
