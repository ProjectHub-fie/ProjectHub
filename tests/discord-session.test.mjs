/**
 * The Discord handshake and the cookie transport that carries its session.
 *
 * The bug these pin: Discord's authorization succeeded and the token exchange
 * succeeded, but the visitor arrived at ProjectHub with no session. The callback
 * was handing the token back in a URL fragment on `/login`, which never matched
 * what the SPA and `/api/auth/me` actually read. The callback now writes the
 * same signed token a password login issues into an HttpOnly cookie and
 * redirects straight to `/dashboard`.
 *
 * The token exchange is stubbed: these tests must not depend on Discord being
 * reachable or on real credentials.
 */
import { hasDatabase } from './helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { callHandler } from './helpers/client-handler.mjs';
import handler from '../api/index.js';

const DISCORD_ENV = [
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'DISCORD_CALLBACK_URL',
  'APP_ORIGIN',
];

/** Runs `body` with the Discord environment set, then restores it. */
async function withDiscordEnv(values, body) {
  const originals = DISCORD_ENV.map((name) => [name, process.env[name]]);
  for (const name of DISCORD_ENV) {
    if (values[name] === undefined) delete process.env[name];
    else process.env[name] = values[name];
  }
  try {
    return await body();
  } finally {
    for (const [name, value] of originals) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const CONFIGURED = {
  DISCORD_CLIENT_ID: 'client-id',
  DISCORD_CLIENT_SECRET: 'client-secret',
  DISCORD_CALLBACK_URL: 'https://projecthub.test/api/auth/discord/callback',
};

/** A `Set-Cookie` list normalised to an array. */
function cookieList(headers) {
  const value = headers['set-cookie'];
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function cookieNamed(headers, name) {
  return cookieList(headers).find((cookie) => cookie.startsWith(`${name}=`));
}

/** The `name=value` half of the named cookies, as a request would send them. */
function cookieHeaderFrom(startHeaders, names) {
  return names
    .map((name) => cookieNamed(startHeaders, name))
    .filter(Boolean)
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

/** Starts a handshake and returns the cookies the callback must present back. */
async function startHandshake() {
  const start = await callHandler(handler, 'GET', '/api/auth/discord');
  return cookieHeaderFrom(start.headers, ['discord_code_verifier', 'discord_oauth_state']);
}

/**
 * Stubs both Discord calls and runs the callback.
 *
 * Captures what was sent so a test can assert the exchange was server-side and
 * complete. Nothing here needs real Discord credentials.
 */
async function runCallback({
  profile = {},
  tokenStatus = 200,
  tokenBody,
  cookieHeader,
  state,
  code = 'auth-code',
}) {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });

    if (String(url).includes('/oauth2/token')) {
      if (tokenStatus !== 200) {
        return new Response(JSON.stringify(tokenBody || { error: 'invalid_client' }), {
          status: tokenStatus,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ access_token: 'access-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(profile), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const url = `/api/auth/discord/callback?code=${encodeURIComponent(code)}${
      state ? `&state=${encodeURIComponent(state)}` : ''
    }`;
    const result = await callHandler(handler, 'GET', url, {
      headers: cookieHeader ? { cookie: cookieHeader } : {},
    });
    return { state: result, calls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('the callback sets the session cookie and redirects to the dashboard', { skip: !hasDatabase }, async () => {
  await withDiscordEnv(CONFIGURED, async () => {
    const cookieHeader = await startHandshake();
    assert.ok(cookieHeader.includes('discord_code_verifier'), 'a PKCE verifier cookie must be set');
    assert.ok(cookieHeader.includes('discord_oauth_state'), 'a state cookie must be set');

    const { state } = await runCallback({
      cookieHeader,
      profile: {
        id: '987654321',
        username: 'ada',
        global_name: 'Ada L',
        email: 'ada@example.test',
        avatar: 'abc123',
      },
    });

    assert.equal(state.redirectTo, '/dashboard', 'the callback must land on the dashboard route');

    const session = cookieNamed(state.headers, 'projecthub_session');
    assert.ok(session, 'the callback must set the session cookie');
    assert.match(session, /HttpOnly/, 'the session cookie must not be readable by scripts');
    assert.match(session, /SameSite=Lax/, 'a top-level callback navigation needs SameSite=Lax');
    assert.match(session, /Path=\//);
    assert.ok(session.split('=')[1]?.length > 0, 'the session cookie must carry a token');
  });
});

test('the PKCE and state cookies are cleared once the session is established', { skip: !hasDatabase }, async () => {
  await withDiscordEnv(CONFIGURED, async () => {
    const { state } = await runCallback({
      cookieHeader: await startHandshake(),
      profile: { id: '1', username: 'ada', email: 'ada@example.test' },
    });

    for (const name of ['discord_code_verifier', 'discord_oauth_state']) {
      const cookie = cookieNamed(state.headers, name);
      assert.ok(cookie, `${name} must be cleared`);
      assert.match(cookie, /Max-Age=0/, `${name} must expire immediately`);
    }
  });
});

test('the token exchange is performed server-side and never reaches the client', async () => {
  await withDiscordEnv(CONFIGURED, async () => {
    const { state, calls } = await runCallback({
      cookieHeader: await startHandshake(),
      profile: { id: '1', username: 'ada', email: 'ada@example.test' },
    });

    const exchange = calls.find((call) => call.url.includes('/oauth2/token'));
    assert.ok(exchange, 'the callback must exchange the code for a token');
    assert.equal(exchange.init.method, 'POST');

    const params = new URLSearchParams(exchange.init.body);
    assert.equal(params.get('grant_type'), 'authorization_code');
    assert.equal(params.get('code'), 'auth-code');
    assert.equal(params.get('client_id'), 'client-id');
    assert.equal(params.get('client_secret'), 'client-secret');
    assert.ok(params.get('code_verifier')?.length > 0, 'the PKCE verifier must be sent');

    assert.ok(!JSON.stringify(state.body ?? '').includes('client-secret'));
    assert.ok(!state.redirectTo.includes('client-secret'));
  });
});

test('a 401 invalid_client is reported safely and logs the reason', async () => {
  // The callback reports failures through logAuth(), which writes to stdout.
  const originalLog = console.log;
  const logged = [];
  console.log = (...args) => logged.push(args.join(' '));

  try {
    await withDiscordEnv(CONFIGURED, async () => {
      const { state } = await runCallback({
        cookieHeader: await startHandshake(),
        tokenStatus: 401,
        tokenBody: { error: 'invalid_client', error_description: 'client secret invalid' },
      });

      assert.match(state.redirectTo, /discord=error/);
      assert.match(state.redirectTo, /reason=token_exchange/);
      assert.equal(
        cookieNamed(state.headers, 'projecthub_session'),
        undefined,
        'no session is created on failure',
      );

      const line = logged.find((entry) => entry.includes('token_exchange'));
      assert.ok(line, 'the failure must be logged for diagnosis');
      assert.match(line, /status=401/);
      assert.ok(!line.includes('client-secret'), 'the secret must never be logged');
      assert.ok(!line.includes('auth-code'), 'the authorization code must never be logged');
    });
  } finally {
    console.log = originalLog;
  }
});

test('a callback without the PKCE cookie is refused', async () => {
  await withDiscordEnv(CONFIGURED, async () => {
    const start = await callHandler(handler, 'GET', '/api/auth/discord');
    const stateOnly = cookieNamed(start.headers, 'discord_oauth_state').split(';')[0];

    const { state } = await runCallback({ cookieHeader: stateOnly, profile: { id: '1' } });
    assert.match(state.redirectTo, /reason=missing_verifier/);
  });
});

test('a handshake with an unsigned state is refused', async () => {
  await withDiscordEnv(CONFIGURED, async () => {
    const start = await callHandler(handler, 'GET', '/api/auth/discord');
    const verifier = cookieNamed(start.headers, 'discord_code_verifier').split(';')[0];

    const { state } = await runCallback({
      cookieHeader: `${verifier}; discord_oauth_state=not-a-signed-token`,
      state: 'not-a-signed-token',
      profile: { id: '1' },
    });

    assert.match(state.redirectTo, /reason=invalid_state/);
  });
});

test('the callback is routed before the generic auth catch-all', async () => {
  await withDiscordEnv(CONFIGURED, async () => {
    const { state } = await runCallback({
      cookieHeader: await startHandshake(),
      profile: { id: '1', username: 'ada' },
    });

    assert.notEqual(state.body?.message, 'Auth endpoint not found');
    assert.notEqual(state.status, 404);
  });
});
