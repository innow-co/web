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

// Output of the running wrangler dev (console.log/error of the Worker). Empty string if there is no log yet.
export function readDevLog() {
  try { return readFileSync(LOG, 'utf8'); } catch { return ''; }
}

// Polls the dev log every 100 ms (up to timeoutMs) until a line containing `needle` appears; returns that line or null.
export async function waitForLogLine(needle, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const line = readDevLog().split('\n').find((l) => l.includes(needle));
    if (line) return line;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, 100));
  }
}

export function d1(sql) {
  return wrangler(['d1', 'execute', 'innow-line', '--local', '--persist-to', STATE, '--command', sql]).toString();
}

// extraVars: per-run Worker vars passed as `wrangler dev --var KEY:VALUE` (never written to .dev.vars).
export async function start(extraVars = {}) {
  ensureVars();
  mkdirSync(WR, { recursive: true });
  rmSync(STATE, { recursive: true, force: true });
  wrangler(['d1', 'migrations', 'apply', 'innow-line', '--local', '--persist-to', STATE]);
  const stale = await fetch(BASE + '/api/config').then(() => true, () => false);
  if (stale) throw new Error(`Port ${PORT} already answers (stale wrangler dev from an aborted run?). Kill it and retry.`);
  const out = openSync(LOG, 'w');
  child = spawn(BIN, ['dev', '--local', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', STATE, ...Object.entries(extraVars).flatMap(([k, v]) => ['--var', `${k}:${v}`])], {
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

// A well-formed 4-digit code that no code row currently uses.
export function unusedCode() {
  const used = d1('SELECT code FROM codes');
  for (let n = 9999; n >= 0; n--) {
    const c = String(n).padStart(4, '0');
    if (!used.includes(`"${c}"`)) return c;
  }
  throw new Error('no free code');
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

// Keys currently stored in the local simulated R2 bucket (reads miniflare's sqlite index, read-only).
// Throws when the index cannot be read, so a 0-count can never be vacuous.
export async function listR2Keys(prefix = '') {
  const { DatabaseSync } = await import('node:sqlite');
  const { readdirSync } = await import('node:fs');
  const dir = path.join(STATE, 'v3', 'r2', 'miniflare-R2BucketObject');
  const files = readdirSync(dir).filter((n) => n.endsWith('.sqlite') && n !== 'metadata.sqlite');
  if (!files.length) throw new Error('R2 object index not found in ' + dir);
  const keys = [];
  for (const f of files) {
    const db = new DatabaseSync(path.join(dir, f), { readOnly: true });
    try { for (const r of db.prepare('SELECT key FROM _mf_objects').all()) if (r.key.startsWith(prefix)) keys.push(r.key); } finally { db.close(); }
  }
  return keys;
}

// Test-only: the signing secret from the git-ignored .dev.vars (never log or copy it).
export function sessionSecret() {
  return readFileSync(VARS, 'utf8').match(/^SESSION_SECRET=(.*)$/m)[1].trim();
}

// Multipart item save. file: {bytes|blob, name, type}. Returns the fetch Response.
export async function saveItemMultipart(wid, fields, file, { itemId, token } = {}) {
  const t = token || (await adminLogin());
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (file) fd.set('file', file.blob || new Blob([file.bytes], { type: file.type }), file.name);
  const p = `/api/admin/workshops/${wid}/items` + (itemId ? '/' + itemId : '');
  return fetch(BASE + p, { method: itemId ? 'PUT' : 'POST', headers: { authorization: 'Bearer ' + t }, body: fd });
}

// Local R2 read: object bytes, or null only when the object does not exist; any other failure throws.
export function r2Get(key) {
  const out = path.join(WR, 'r2-probe-' + randomBytes(4).toString('hex'));
  try {
    wrangler(['r2', 'object', 'get', `innow-line-files/${key}`, '--local', '--persist-to', STATE, '--file', out]);
    return readFileSync(out);
  } catch (e) {
    const msg = String(e.stderr || '') + String(e.stdout || '') + String(e.message || '');
    if (/specified key does not exist/i.test(msg)) return null;
    throw new Error('r2Get failed unexpectedly: ' + msg.slice(0, 300));
  } finally { rmSync(out, { force: true }); }
}

export function r2KeysOf(wid) {
  return [...d1(`SELECT r2_key FROM items WHERE workshop_id='${wid}' AND r2_key != '' ORDER BY id`).matchAll(/"r2_key":\s*"([^"]+)"/g)].map((m) => m[1]);
}
