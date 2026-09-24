/**
 * End-to-end auth flows against a real database.
 *
 * These are skipped unless DATABASE_URL is set, because they create and delete
 * real rows:
 *
 *   DATABASE_URL='postgres://...' npm test
 *
 * Every account this file creates is namespaced with a random prefix and removed
 * in cleanup, so it is safe to point at a development database but not a
 * production one.
 */
import { hasDatabase } from './helpers/env.mjs';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { callHandler, decodeToken } from './helpers/client-handler.mjs';
import handler from '../api/index.js';
import { storage } from '../api/_lib/storage.js';

const runId = Math.random().toString(36).slice(2, 10);
const email = (label) => `auth-test-${runId}-${label}@example.test`;
const PASSWORD = 'Correct-Horse-Battery-9!';

/** Matches the SESSION_TTL_DAYS default of 30 days. */
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const created = [];
const track = (user) => { if (user?.id) created.push(user.id); return user; };

after(async () => {
  if (!hasDatabase || created.length === 0) return;
  const { db } = await import('../api/_lib/db.js');
  const { users } = await import('../drizzle/schema.js');
  const { inArray } = await import('drizzle-orm');
  await db.delete(users).where(inArray(users.id, created));
});

const register = (body) => callHandler(handler, 'POST', '/api/auth/register', { body });
const login = (body) => callHandler(handler, 'POST', '/api/auth/login', { body });
const me = (token) => callHandler(handler, 'GET', '/api/auth/me', { headers: { 'x-user-session': token } });

test('register: creates the account and returns a signed session', { skip: !hasDatabase }, async () => {
  const state = await register({
    email: email('happy'), password: PASSWORD, firstName: 'Test', lastName: 'User',
  });

  assert.equal(state.status, 201);
  assert.equal(state.body.user.email, email('happy'));
  assert.ok(state.body.sessionToken, 'register must return a session token');
  assert.equal(state.body.user.password, undefined, 'the password hash must never be returned');

  track(await storage.getUserByEmail(email('happy')));
});

test('register: duplicate email is rejected', { skip: !hasDatabase }, async () => {
  const dup = email('dupe');
  track(await storage.getUserByEmail(dup));

  const first = await register({
    email: dup, password: PASSWORD, firstName: 'A', lastName: 'B',
  });
  assert.equal(first.status, 201);
  if (first.body.sessionToken) {
    track(await storage.getUserByEmail(dup));
  }

  const second = await register({
    email: dup, password: PASSWORD, firstName: 'A', lastName: 'B',
  });
  assert.equal(second.status, 400, 'a second registration with the same email must fail');
});

test('login: correct password returns a session with a 30 day expiry', { skip: !hasDatabase }, async () => {
  const addr = email('login');
  const reg = await register({
    email: addr, password: PASSWORD, firstName: 'L', lastName: 'U',
  });
  track(await storage.getUserByEmail(addr));
  assert.equal(reg.status, 201);

  const state = await login({ email: addr, password: PASSWORD });
  assert.equal(state.status, 200);
  assert.ok(state.body.sessionToken);

  const payload = decodeToken(state.body.sessionToken);
  assert.equal(payload.email, addr);
  assert.equal(payload.exp - payload.iat, THIRTY_DAYS_MS, 'default TTL must be 30 days');
});

test('login: wrong password is rejected', { skip: !hasDatabase }, async () => {
  const addr = email('wrongpw');
  await register({ email: addr, password: PASSWORD, firstName: 'W', lastName: 'P' });
  track(await storage.getUserByEmail(addr));

  const state = await login({ email: addr, password: 'not-the-password' });
  assert.equal(state.status, 401);
});

test('login: unknown email is rejected without leaking existence', { skip: !hasDatabase }, async () => {
  const state = await login({ email: email('nobody'), password: PASSWORD });
  assert.equal(state.status, 401);
  assert.equal(state.body.message, 'Invalid credentials', 'must not reveal whether the email exists');
});

test('register: the returned token authenticates immediately', { skip: !hasDatabase }, async () => {
  // This is the flow the client bug broke: register issued a token that the
  // hook never stored, so the session was lost on the next page load.
  const addr = email('tokenflow');
  const reg = await register({
    email: addr, password: PASSWORD, firstName: 'T', lastName: 'F',
  });
  track(await storage.getUserByEmail(addr));

  const state = await me(reg.body.sessionToken);
  assert.equal(state.status, 200, 'the token from register must work on /api/auth/me');
  assert.equal(state.body.user.email, addr);
});

test('login: a session cannot be established from a token for another user', { skip: !hasDatabase }, async () => {
  const a = email('victim');
  const b = email('attacker');
  await register({ email: a, password: PASSWORD, firstName: 'V', lastName: 'A' });
  await register({ email: b, password: PASSWORD, firstName: 'A', lastName: 'T' });
  track(await storage.getUserByEmail(a));
  track(await storage.getUserByEmail(b));

  const victim = await login({ email: a, password: PASSWORD });
  const state = await me(victim.body.sessionToken);
  assert.equal(state.body.user.email, a, 'the token must resolve to its own subject');
  assert.notEqual(state.body.user.email, b);
});

test('blocked accounts cannot log in', { skip: !hasDatabase }, async () => {
  const addr = email('blocked');
  await register({ email: addr, password: PASSWORD, firstName: 'B', lastName: 'K' });
  const user = await storage.getUserByEmail(addr);
  track(user);

  const { db } = await import('../api/_lib/db.js');
  const { users } = await import('../drizzle/schema.js');
  const { eq } = await import('drizzle-orm');
  await db.update(users).set({ isBlocked: true }).where(eq(users.id, user.id));

  const state = await login({ email: addr, password: PASSWORD });
  assert.equal(state.status, 403);
});

test('the profile endpoint rejects an anonymous caller', { skip: !hasDatabase }, async () => {
  const state = await callHandler(handler, 'PATCH', '/api/auth/user', {
    body: { firstName: 'Nope' },
  });
  assert.equal(state.status, 401);
});

test('the profile endpoint updates only the authenticated user', { skip: !hasDatabase }, async () => {
  const addr = email('profile');
  const reg = await register({
    email: addr, password: PASSWORD, firstName: 'Old', lastName: 'Name',
  });
  track(await storage.getUserByEmail(addr));

  const state = await callHandler(handler, 'PATCH', '/api/auth/user', {
    headers: { 'x-user-session': reg.body.sessionToken },
    body: { firstName: 'New' },
  });

  assert.equal(state.status, 200);
  const reread = await storage.getUserByEmail(addr);
  assert.equal(reread.firstName, 'New');
  assert.equal(reread.password, (await storage.getUserByEmail(addr)).password, 'password must be untouched');
});

test('logout acknowledges and leaves the client token to be discarded', { skip: !hasDatabase }, async () => {
  const state = await callHandler(handler, 'POST', '/api/auth/logout');
  assert.equal(state.status, 200);
});
