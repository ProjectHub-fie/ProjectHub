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

test('the auth state is an explicit three-way status, never a bare boolean', () => {
  const hook = source('client/src/hooks/useAuth.ts');

  assert.match(hook, /type AuthStatus = "loading" \| "authenticated" \| "unauthenticated"/,
    'auth must distinguish "still loading" from "signed out"');
  assert.match(hook, /isLoading: status === "loading"/,
    'isLoading must be derived from the status, not tracked separately');
  assert.match(hook, /isAuthenticated: status === "authenticated" && Boolean\(user\)/,
    'a user must imply an authenticated status');
  assert.ok(
    !/isAuthenticated:\s*!!user/.test(hook),
    'the old `!!user` form reported "signed out" on the first render and pinned the profile menu there',
  );
});

test('one provider owns the auth state so every consumer agrees', () => {
  const hook = source('client/src/hooks/useAuth.ts');
  const app = source('client/src/App.tsx');

  assert.match(hook, /createContext<AuthContextValue \| null>\(null\)/, 'auth lives in a context');
  assert.match(hook, /export function AuthProvider/, 'the provider is exported');
  assert.match(hook, /useContext\(AuthContext\)/, 'useAuth reads the shared context');

  // The provider must wrap the tree, or useAuth throws instead of silently
  // creating a second, independent copy of the state per consumer.
  assert.match(app, /<AuthProvider>/, 'App must mount the provider');
  assert.ok(
    app.indexOf('<AuthProvider>') < app.indexOf('<UserMenu />'),
    'the provider must be above the profile menu',
  );
});

test('a reload does not flash the logged-out state before /me answers', () => {
  const hook = source('client/src/hooks/useAuth.ts');

  assert.match(hook, /useState<AuthUser \| null>\(\(\) => readStoredUser\(\)\)/,
    'a previously signed-in user must be seeded from storage while /me is in flight');
  assert.match(hook, /credentials: "include"/, 'the session cookie must be sent to /me');
  assert.match(hook, /headers\["X-User-Session"\] = token/,
    'and the stored token as well, for header-based sessions');
});

test('logout clears the token, the user and cached queries', () => {
  const hook = source('client/src/hooks/useAuth.ts');
  const clear = hook.slice(hook.indexOf('const clearSession'), hook.indexOf('const refreshAuth'));
  const finish = hook.slice(
    hook.indexOf('const finishLogout'),
    hook.indexOf('const logoutMutation'),
  );

  assert.match(clear, /localStorage\.removeItem\(SESSION_TOKEN_KEY\)/, 'the session token must be dropped');
  assert.match(clear, /applyUser\(null\)/, 'the user must be cleared');
  assert.match(finish, /queryClient\.clear\(\)/, 'cached user data must not survive a logout');
  assert.match(finish, /generation\.current \+= 1/, 'an in-flight /me must not restore the session after logout');
});

test('the profile menu derives every branch from the shared auth status', () => {
  const menu = source('client/src/components/user-menu.tsx');

  assert.match(menu, /const \{ user, status, isAuthenticated, logout \} = useAuth\(\)/);
  assert.match(menu, /status === "loading" \? \(/, 'loading must render a skeleton, not the logged-out UI');
  assert.match(menu, /isAuthenticated && user \? \(/, 'the signed-in panel is the authenticated branch');
  assert.match(menu, /profile-menu-logout/);
  assert.match(menu, /profile-menu-login/);
  assert.ok(
    !/showLogin|setShowLogin/.test(menu),
    'a separate showLogin flag is exactly the stale state that kept Log in visible',
  );
});

test('the authenticated avatar never falls back to the logged-out glyph', () => {
  const menu = source('client/src/components/user-menu.tsx');
  const trigger = menu.slice(
    menu.indexOf('function ProfileTrigger'),
    menu.indexOf('function ProfileSummary'),
  );

  assert.match(trigger, /status === "authenticated" && user/, 'the avatar is chosen from the status');
  assert.match(trigger, /userAvatarUrl\(user\)/, 'an available avatar image is preferred');
  assert.match(trigger, /userInitials\(user\)/, 'initials are the fallback for a user with no image');
  assert.ok(
    trigger.indexOf('ProfilePlaceholder') > trigger.indexOf('userInitials'),
    'the anonymous glyph must only appear after the signed-in branches',
  );
});
