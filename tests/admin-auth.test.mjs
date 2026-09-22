/**
 * Admin dashboard authentication.
 *
 * The admin function uses express-session cookies, so it is served over a real
 * HTTP listener rather than the lightweight harness. Skipped without
 * DATABASE_URL because the session store is Postgres.
 *
 *   ADMIN_PIN=... ADMIN_PASSWORD=... DATABASE_URL='postgres://...' npm test
 *
 * Without ADMIN_PIN/ADMIN_PASSWORD the credential-dependent tests are skipped,
 * so a bare checkout still gets the unauthenticated-access coverage.
 */
import { hasDatabase } from './helpers/env.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const ADMIN_PIN = process.env.ADMIN_PIN;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const hasCredentials = Boolean(ADMIN_PIN && ADMIN_PASSWORD);

let server;
let base;

before(async () => {
  if (!hasDatabase) return;
  const { default: adminHandler } = await import('../api/admin/index.js');
  server = http.createServer((req, res) => adminHandler(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

// Vercel terminates TLS, so tell express it is behind an https proxy. Without
// this the Secure session cookie is withheld and every login looks broken.
const HTTPS = { 'X-Forwarded-Proto': 'https' };

const post = (path, body, cookie) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...HTTPS, ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
    redirect: 'manual',
  });

const get = (path, cookie) =>
  fetch(base + path, { headers: { ...HTTPS, ...(cookie ? { Cookie: cookie } : {}) }, redirect: 'manual' });

const cookiesFrom = (res) => (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');

test('admin data endpoints reject an anonymous caller', { skip: !hasDatabase }, async () => {
  for (const path of ['/api/admin/stats', '/api/admin/current-role', '/api/admin/list']) {
    const res = await get(path);
    assert.equal(res.status, 401, `${path} must require authentication`);
  }
});

test('login with no credentials is a 400, not a 500', { skip: !hasDatabase }, async () => {
  const res = await post('/api/admin/login', {});
  assert.equal(res.status, 400);
});

test('login with a wrong password is rejected', { skip: !hasDatabase }, async () => {
  const res = await post('/api/admin/login', { pin: '000000', password: 'wrong-password' });
  assert.equal(res.status, 401, 'an invalid PIN or password must be 401');
});

test('login sets a hardened session cookie', { skip: !(hasDatabase && hasCredentials) }, async () => {
  const res = await post('/api/admin/login', { pin: ADMIN_PIN, password: ADMIN_PASSWORD });
  assert.equal(res.status, 200);

  const raw = (res.headers.getSetCookie?.() || []).join(';');
  assert.match(raw, /HttpOnly/i, 'session cookie must be HttpOnly');
  assert.match(raw, /Secure/i, 'session cookie must be Secure');
  assert.match(raw, /SameSite=None/i, 'session cookie must be SameSite=None for the SPA');
});

test('a valid session reaches protected admin data', { skip: !(hasDatabase && hasCredentials) }, async () => {
  const login = await post('/api/admin/login', { pin: ADMIN_PIN, password: ADMIN_PASSWORD });
  const cookie = cookiesFrom(login);
  assert.ok(cookie, 'login must return a session cookie');

  const stats = await get('/api/admin/stats', cookie);
  assert.equal(stats.status, 200, 'an authenticated admin must reach /api/admin/stats');

  const role = await get('/api/admin/current-role', cookie);
  const body = await role.json();
  assert.ok(['owner', 'admin', 'moderator'].includes(body.role), `unexpected role: ${body.role}`);
});

test('an anonymous request cannot read admin data with a forged cookie', { skip: !hasDatabase }, async () => {
  const res = await get('/api/admin/stats', 'projecthub.sid=s%3Aforged.signature');
  assert.equal(res.status, 401, 'an unsigned session id must not authenticate');
});

test('logout invalidates the session', { skip: !(hasDatabase && hasCredentials) }, async () => {
  const login = await post('/api/admin/login', { pin: ADMIN_PIN, password: ADMIN_PASSWORD });
  const cookie = cookiesFrom(login);

  assert.equal((await get('/api/admin/stats', cookie)).status, 200);

  const out = await post('/api/admin/logout', {}, cookie);
  assert.equal(out.status, 200);

  const after = await get('/api/admin/stats', cookie);
  assert.equal(after.status, 401, 'the session must be dead after logout');
});

test('role changes cannot be made anonymously', { skip: !hasDatabase }, async () => {
  const randomId = '00000000-0000-0000-0000-000000000000';
  const res = await fetch(`${base}/api/admin/${randomId}/role`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...HTTPS },
    body: JSON.stringify({ role: 'owner' }),
  });
  assert.equal(res.status, 401, 'privilege changes must require an authenticated owner');
});

test('the admin surface does not expose a password hash', { skip: !(hasDatabase && hasCredentials) }, async () => {
  const login = await post('/api/admin/login', { pin: ADMIN_PIN, password: ADMIN_PASSWORD });
  const cookie = cookiesFrom(login);

  const res = await get('/api/admin/list', cookie);
  if (res.status !== 200) return; // needs owner role
  const text = await res.text();
  assert.ok(!/\$2[aby]\$/.test(text), 'bcrypt hashes must never appear in an API response');
});
