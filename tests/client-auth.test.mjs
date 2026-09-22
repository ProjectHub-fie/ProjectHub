/**
 * Client-side auth logic.
 *
 * The client has no DOM test environment installed, so instead of rendering
 * React these tests pin the invariants that the two real client bugs violated.
 * Each one reads the source and asserts the fix is present, which fails loudly
 * if the behaviour is regressed without a renderer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = (rel) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

test('register stores the session token the server returns', () => {
  const hook = source('client/src/hooks/useAuth.ts');
  const registerBlock = hook.slice(
    hook.indexOf('const registerMutation'),
    hook.indexOf('const logoutMutation'),
  );

  assert.match(
    registerBlock,
    /localStorage\.setItem\(SESSION_TOKEN_KEY,\s*data\.sessionToken\)/,
    'register must persist data.sessionToken; without it the user is signed out on reload',
  );
});

test('register clears a stale token on failure', () => {
  const hook = source('client/src/hooks/useAuth.ts');
  const registerBlock = hook.slice(
    hook.indexOf('const registerMutation'),
    hook.indexOf('const logoutMutation'),
  );

  assert.match(registerBlock, /removeItem\(SESSION_TOKEN_KEY\)/, 'a failed register must not leave a token');
});

test('login persists the session token', () => {
  const hook = source('client/src/hooks/useAuth.ts');
  const loginBlock = hook.slice(hook.indexOf('const loginMutation'), hook.indexOf('const registerMutation'));
  assert.match(loginBlock, /localStorage\.setItem\(SESSION_TOKEN_KEY,\s*data\.sessionToken\)/);
});

test('captcha is optional when no Turnstile site key is configured', () => {
  const page = source('client/src/pages/login.tsx');

  assert.match(page, /const captchaRequired = Boolean\(siteKey\)/,
    'captchaRequired must be derived from the configured site key');
  assert.ok(
    !/VITE_TURNSTILE_SITE_KEY \|\| "1x000/.test(page),
    'the Cloudflare test site key fallback must be gone; it left the submit buttons permanently disabled',
  );
  assert.ok(
    !/if \(!captchaToken\) \{/.test(page),
    'submit guards must honour captchaRequired instead of blocking on a missing token',
  );

  const guards = page.match(/if \(captchaRequired && !captchaToken\) \{/g) || [];
  assert.ok(guards.length >= 3, `expected login/register/reset guards, found ${guards.length}`);
});

test('submit buttons are only disabled by captcha when captcha is enabled', () => {
  const page = source('client/src/pages/login.tsx');
  assert.match(page, /disabled=\{isLoggingIn \|\| \(captchaRequired && !captchaToken\)\}/);
  assert.match(page, /disabled=\{isRegistering \|\| \(captchaRequired && !captchaToken\)\}/);
});

test('the Turnstile widget renders only when a site key exists', () => {
  const page = source('client/src/pages/login.tsx');
  const widgets = page.match(/\{siteKey && <Turnstile/g) || [];
  assert.equal(widgets.length, 2, 'login and register widgets must both be conditional');
});

test('the Discord callback token is stored and the fragment is cleared', () => {
  const page = source('client/src/pages/login.tsx');
  assert.match(page, /localStorage\.setItem\(SESSION_TOKEN_KEY, token\)/,
    'the Discord handshake must persist the returned token');
  assert.match(page, /history\.replaceState\(null, "", "\/login"\)/,
    'the token must be scrubbed from the URL after it is stored');
});

test('no debug logging of session tokens remains in the auth hook', () => {
  const hook = source('client/src/hooks/useAuth.ts');
  assert.ok(
    !/console\.log\([^)]*sessionToken/i.test(hook),
    'the hook must not log session tokens',
  );
});
