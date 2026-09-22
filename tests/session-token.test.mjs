/**
 * Session token security, exercised through the real /api/auth/me route.
 *
 * These are the tests that would have caught the real weaknesses in this area:
 * tokens used to be unsigned base64, so anyone could mint the identity of any
 * user; and once signed, they never expired.
 *
 * A rejected token short-circuits before any database read, so this file runs
 * with no database at all.
 */
import { hasDatabase } from './helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { signToken, callHandler } from './helpers/client-handler.mjs';
import handler from '../api/index.js';

const meWith = (token) =>
  callHandler(handler, 'GET', '/api/auth/me', { headers: { 'x-user-session': token } });

test('a token with a tampered signature is rejected', async () => {
  const token = await signToken({ id: 'u1', iat: Date.now(), exp: Date.now() + 60000 });
  const [payload, signature] = token.split('.');
  const flipped = signature.slice(0, -1) + (signature.endsWith('A') ? 'B' : 'A');

  const state = await meWith(`${payload}.${flipped}`);
  assert.equal(state.status, 401, 'a modified signature must not authenticate');
});

test('an unsigned legacy token is rejected', async () => {
  // The pre-fix format: base64(JSON) of the identity, no signature at all.
  const legacy = Buffer.from(JSON.stringify({ id: 'attacker-chosen-id' })).toString('base64url');
  const state = await meWith(legacy);
  assert.equal(state.status, 401, 'an unsigned identity must not authenticate');
});

test('a payload signed with the wrong secret is rejected', async () => {
  const payload = { id: 'u1', iat: Date.now(), exp: Date.now() + 60000 };
  const forged = await signToken(payload, 'a-secret-the-attacker-picked');
  const state = await meWith(forged);
  assert.equal(state.status, 401, 'a signature from another secret must not authenticate');
});

test('an expired token is rejected even though its signature is valid', async () => {
  const expired = await signToken({ id: 'u1', iat: Date.now() - 100000, exp: Date.now() - 1000 });
  const state = await meWith(expired);
  assert.equal(state.status, 401, 'expiry must be enforced, not just the signature');
});

test('a token with no exp claim is rejected', async () => {
  // Tokens issued before expiry existed carry no exp; they must not stay valid
  // forever by omission.
  const noExp = await signToken({ id: 'u1', email: 'a@b.c' });
  const state = await meWith(noExp);
  assert.equal(state.status, 401, 'a token without exp must not authenticate');
});

test('a missing session header is unauthenticated', async () => {
  const state = await callHandler(handler, 'GET', '/api/auth/me');
  assert.equal(state.status, 401);
});

test('login without credentials is rejected before any database work', async () => {
  const state = await callHandler(handler, 'POST', '/api/auth/login', { body: {} });
  assert.equal(state.status, 400);
});

test('register with missing fields is rejected', async () => {
  const state = await callHandler(handler, 'POST', '/api/auth/register', {
    body: { email: 'a@b.c' },
  });
  assert.equal(state.status, 400);
});

test('health endpoint reports database reachability', { skip: !hasDatabase }, async () => {
  const state = await callHandler(handler, 'GET', '/api/health');
  assert.equal(state.status, 200);
  assert.equal(state.body.database, 'connected');
});
