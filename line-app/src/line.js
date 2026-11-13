import { HttpError } from './lib.js';

// The dev identity bypass (DEV_FAKE_LINE) is only ever honoured for requests that arrive on a loopback host.
export function isLocalHost(hostname) {
  return typeof hostname === 'string' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname.toLowerCase());
}

export const devFakeLineActive = (env, hostname) => env.DEV_FAKE_LINE === '1' && isLocalHost(hostname);

// LINE_LOGIN_CHANNEL_ID is a comma-separated allowlist (a MINI App has separate developing/review/published channels).
export const channelIds = (v) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);

// Production LINE Login verification; fetchImpl is injected so it can be unit-tested.
export async function verifyLineWithFetch(accessToken, env, fetchImpl) {
  if (typeof accessToken !== 'string' || accessToken.length < 10) throw new HttpError(401, 'กรุณาเข้าสู่ระบบด้วย LINE');
  const allowed = channelIds(env.LINE_LOGIN_CHANNEL_ID);
  if (!allowed.length) throw new HttpError(503, 'LINE channel not configured');

  const v = await fetchImpl('https://api.line.me/oauth2/v2.1/verify?access_token=' + encodeURIComponent(accessToken));
  if (!v.ok) throw new HttpError(401, 'LINE token ไม่ถูกต้องหรือหมดอายุ');
  const info = await v.json();
  if (!allowed.includes(String(info.client_id)) || !(info.expires_in > 0)) throw new HttpError(401, 'LINE token ไม่ถูกต้อง');

  const auth = { Authorization: 'Bearer ' + accessToken };
  const [p, f] = await Promise.all([
    fetchImpl('https://api.line.me/v2/profile', { headers: auth }),
    fetchImpl('https://api.line.me/friendship/v1/status', { headers: auth }),
  ]);
  if (!p.ok) throw new HttpError(401, 'ไม่สามารถอ่านข้อมูลบัญชี LINE');
  const profile = await p.json();
  let isFriend = false;
  if (f.ok) isFriend = (await f.json()).friendFlag === true;
  else console.warn('friendship check failed', f.status, await f.text());
  return { userId: profile.userId, displayName: profile.displayName || '', pictureUrl: profile.pictureUrl || '', isFriend };
}
