// Local API harness: runs the Worker under `wrangler dev --local` on a dedicated port/state dir.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync, openSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WR = path.join(ROOT, '.wrangler');
const STATE = path.join(WR, 'test-state');
const LOG = path.join(WR, 'test-dev.log');
const VARS = path.join(ROOT, '.dev.vars');
const PORT = 8799;
export const BASE = `http://127.0.0.1:${PORT}`;
const BIN = path.join(ROOT, 'node_modules', '.bin', 'wrangler');

let child = null;
let adminPassword = null;

function ensureVars() {
  if (!existsSync(VARS)) {
    const v = [
      `SESSION_SECRET=${randomBytes(36).toString('hex')}`,
      `ADMIN_PASSWORD=${randomBytes(12).toString('hex')}`,
      'DEV_FAKE_LINE=1',
      'LINE_LOGIN_CHANNEL_ID=test',
      '',
    ].join('\n');
    writeFileSync(VARS, v, { mode: 0o600 });
  }
  const m = readFileSync(VARS, 'utf8').match(/^ADMIN_PASSWORD=(.*)$/m);
  adminPassword = m?.[1]?.trim();
  if (!adminPassword) throw new Error('.dev.vars has no ADMIN_PASSWORD');
}

function wrangler(args, opts = {}) {
  return execFileSync(BIN, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' }, ...opts });
}

export function d1(sql) {
  return wrangler(['d1', 'execute', 'innow-line', '--local', '--persist-to', STATE, '--command', sql]).toString();
}

export async function start() {
  ensureVars();
  mkdirSync(WR, { recursive: true });
  rmSync(STATE, { recursive: true, force: true });
  wrangler(['d1', 'migrations', 'apply', 'innow-line', '--local', '--persist-to', STATE]);
  const out = openSync(LOG, 'w');
  child = spawn(BIN, ['dev', '--local', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', STATE], {
    cwd: ROOT, detached: true, stdio: ['ignore', out, out],
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' },
  });
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('wrangler dev exited early; see ' + LOG);
    try { if ((await fetch(BASE + '/api/config')).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  await stop();
  throw new Error('wrangler dev did not become ready; see ' + LOG);
}

export async function stop() {
  if (!child) return;
  const c = child; child = null;
  try { process.kill(-c.pid, 'SIGTERM'); } catch { /* already gone */ }
  await new Promise((r) => { if (c.exitCode !== null) return r(); c.once('exit', r); setTimeout(r, 5000); });
  try { process.kill(-c.pid, 'SIGKILL'); } catch { /* gone */ }
}

export async function call(method, p, { token, json, headers } = {}) {
  const h = { ...(headers || {}) };
  if (token) h.authorization = 'Bearer ' + token;
  if (json !== undefined) h['content-type'] = 'application/json';
  const res = await fetch(BASE + p, { method, headers: h, body: json !== undefined ? JSON.stringify(json) : undefined });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

export async function adminLogin() {
  const r = await call('POST', '/api/admin/login', { json: { password: adminPassword } });
  if (r.status !== 200) throw new Error('admin login failed: ' + r.status);
  return r.data.token;
}

// Creates a workshop via the admin API and issues a code. Returns {id, code}.
export async function seedWorkshop(title, { minutes = 30 } = {}) {
  const t = await adminLogin();
  const w = await call('POST', '/api/admin/workshops', { token: t, json: { title } });
  if (w.status !== 200) throw new Error('seed workshop failed ' + w.status);
  const c = await call('POST', `/api/admin/workshops/${w.data.id}/codes`, { token: t, json: { minutes } });
  if (c.status !== 200) throw new Error('seed code failed ' + c.status);
  return { id: w.data.id, code: c.data.code };
}

export async function addItem(workshopId, item) {
  const t = await adminLogin();
  const r = await call('POST', `/api/admin/workshops/${workshopId}/items`, { token: t, json: item });
  if (r.status !== 200) throw new Error('add item failed ' + r.status);
  return r.data.id;
}

export async function login(userId) {
  const r = await call('POST', '/api/auth', { json: { accessToken: 'dev:' + userId } });
  return { token: r.data.session, res: r };
}
