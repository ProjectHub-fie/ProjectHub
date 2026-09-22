/**
 * Routing and validation for the recovery and Discord sign-in endpoints.
 *
 * These are the routes the UI posts to; two of them were dead ends. The sign-in
 * page posts to /api/auth/forgot-password and /api/auth/reset-password, which
 * the handler never authorised, so both answered 404 "Auth endpoint not found".
 * They now resolve to the same handler as /api/auth/recovery?action=... .
 *
 * No database is needed: the assertions stop at the point where a route exists
 * and validates its input, before any query runs.
 */
import './helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { callHandler } from './helpers/client-handler.mjs';
import handler from '../api/index.js';

const post = (url, body) => callHandler(handler, 'POST', url, { body });

test('the flat forgot-password route exists', async () => {
  const { status, body } = await post('/api/auth/forgot-password', { email: 'someone@example.test' });
  assert.notEqual(status, 404, '/api/auth/forgot-password must be routed, not "endpoint not found"');
  assert.notEqual(body?.message, 'Auth endpoint not found');
});

test('the flat reset-password route exists', async () => {
  const { status, body } = await post('/api/auth/reset-password', { token: 'x', newPassword: 'long-enough-1' });
  assert.notEqual(status, 404, '/api/auth/reset-password must be routed, not "endpoint not found"');
  assert.notEqual(body?.message, 'Auth endpoint not found');
});

test('both spellings agree that a missing email is a 400', async () => {
  const flat = await post('/api/auth/forgot-password', {});
  const query = await post('/api/auth/recovery?action=forgot', {});
  assert.equal(flat.status, 400);
  assert.equal(query.status, 400);
});

test('reset rejects a password shorter than the client minimum', async () => {
  const { status, body } = await post('/api/auth/reset-password', { token: 'x', newPassword: 'short' });
  assert.equal(status, 400);
  assert.match(body.message, /8 characters|Token and new password/);
});

test('reset rejects a missing token before touching the database', async () => {
  const { status } = await post('/api/auth/reset-password', { newPassword: 'long-enough-1' });
  assert.equal(status, 400);
});

test('discord start refuses to build a handshake without an absolute callback URL', async () => {
  // No DISCORD_CALLBACK_URL / APP_ORIGIN in the test environment, so the
  // callback cannot be allow-listed and the flow must not be started.
  const hadId = process.env.DISCORD_CLIENT_ID;
  process.env.DISCORD_CLIENT_ID = 'test-client-id';
  delete process.env.DISCORD_CALLBACK_URL;
  delete process.env.APP_ORIGIN;

  try {
    const { redirectTo } = await callHandler(handler, 'GET', '/api/auth/discord');
    assert.match(redirectTo || '', /reason=redirect_not_configured/);
  } finally {
    if (hadId === undefined) delete process.env.DISCORD_CLIENT_ID;
    else process.env.DISCORD_CLIENT_ID = hadId;
  }
});

test('discord start sends a PKCE challenge when the callback is configured', async () => {
  const hadId = process.env.DISCORD_CLIENT_ID;
  const hadUrl = process.env.DISCORD_CALLBACK_URL;
  process.env.DISCORD_CLIENT_ID = 'test-client-id';
  process.env.DISCORD_CALLBACK_URL = 'https://example.test/api/auth/discord/callback';

  try {
    const { redirectTo } = await callHandler(handler, 'GET', '/api/auth/discord');
    const url = new URL(redirectTo);
    assert.equal(url.hostname, 'discord.com');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(url.searchParams.get('code_challenge'), 'PKCE challenge is required by Discord');
    assert.equal(
      url.searchParams.get('redirect_uri'),
      'https://example.test/api/auth/discord/callback',
    );
  } finally {
    if (hadId === undefined) delete process.env.DISCORD_CLIENT_ID;
    else process.env.DISCORD_CLIENT_ID = hadId;
    if (hadUrl === undefined) delete process.env.DISCORD_CALLBACK_URL;
    else process.env.DISCORD_CALLBACK_URL = hadUrl;
  }
});
