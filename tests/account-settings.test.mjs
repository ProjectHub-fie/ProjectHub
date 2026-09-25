/**
 * Client account pages: profile, settings and the Discord link rule.
 *
 * No DOM renderer is installed, so these read the source and pin the behaviour
 * that a regression would otherwise break silently. The security-relevant
 * claims being pinned:
 *
 *   - a password account and a Discord login sharing an email are two
 *     identities, and only the account itself may link them;
 *   - linking is proved by an OAuth round trip, never by a client-supplied id;
 *   - an account may never be left with no way to sign in;
 *   - every password field is checked with the shared rule module.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = (rel) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

test('the client sidebar shows profile, settings and the signed-in email', () => {
  const sidebar = source('client/src/components/app-sidebar.tsx');

  // The account links must be gated on a session, so an anonymous visitor never
  // sees a link into a page behind the auth guard.
  const accountBlock = sidebar.slice(sidebar.indexOf('accountItems'), sidebar.indexOf('function PortalThemeToggle'));
  assert.match(accountBlock, /url: "\/client_profile"/, 'profile lives under /client_profile');
  assert.match(accountBlock, /url: "\/settings"/, 'settings lives under /settings');

  assert.match(sidebar, /\{isAuthenticated && \(/, 'account links are shown only when signed in');
  // The email is displayed under the name, matching the admin portal.
  assert.match(sidebar, /data-testid="client-sidebar-email"/, 'the email is shown in the sidebar footer');
  assert.match(sidebar, /\{user\.email\}/, 'the email comes from the resolved user');
  assert.match(sidebar, /displayName\(user\)/, 'the display name has a single, shared definition');
});

test('the profile page edits the picture, name and email and re-validates the email', () => {
  const page = source('client/src/pages/client-profile.tsx');

  assert.match(page, /updateProfile\(/, 'the profile form saves through the shared hook');
  assert.match(page, /validateEmail/, 'the email is checked with the same rule the register form uses');
  assert.match(page, /profileImageUrl: dataUrl/, 'the picture is sent as an inline data URL');
  assert.match(page, /email: check\.email/, 'the normalised email is what is saved');

  // The email is embedded in the signed token, so the hook has to persist the
  // replacement the server returns when the address changes.
  const hook = source('client/src/hooks/useAuth.ts');
  const updateBlock = hook.slice(hook.indexOf('const updateProfileMutation'), hook.indexOf('const changePasswordMutation'));
  assert.match(updateBlock, /localStorage\.setItem\(SESSION_TOKEN_KEY, data\.sessionToken\)/,
    'an email change refreshes the stored session token');
});

test('a password account cannot be signed into by Discord until it links', () => {
  const api = source('api/index.js');

  // The account created with email/password and a Discord login that merely
  // shares the address are different identities; matching on email alone would
  // let whoever controls that Discord account take over the password account.
  assert.match(api, /user\.password && !user\.discordId/, 'the conflict is detected');
  assert.match(api, /account_exists_requires_link/, 'and reported as a link requirement, not a sign-in');
  assert.match(api, /sign in and link Discord from settings/, 'the message tells the user what to do');
});

test('the Discord link is proved by OAuth state, not a client-supplied id', () => {
  const api = source('api/index.js');

  // The handshake carries a signed state that names the initiating account, and
  // the callback attaches the Discord identity from Discord's own profile
  // response. Nothing the browser posts is trusted as an id.
  assert.match(api, /mode === 'link'/, 'a link mode exists alongside sign-in');
  assert.match(api, /linkUser\?\.id/, 'the link target comes from the signed state');
  assert.match(api, /profile\.id/, 'the Discord id comes from Discord, never from the client');
  assert.match(api, /discord_already_linked/, 'a Discord account cannot be linked twice');
});

test('a Discord-only account can set a password but cannot unlink Discord first', () => {
  const api = source('api/index.js');
  const settings = source('client/src/pages/settings.tsx');

  // Unlinking without a password would leave the account unreachable.
  assert.match(api, /Set a password before unlinking Discord, or you will be locked out/,
    'the server refuses to strand an account');

  // The set-password prompt must show for a Discord account and stay until it
  // has a password.
  assert.match(settings, /const hasPassword = Boolean\(user\?\.hasPassword\)/, 'the account type drives the form');
  assert.match(settings, /hasPassword \? "Change password" : "Set a password"/, 'the heading reflects the state');
  assert.match(settings, /disabled=\{!hasPassword\}/, 'unlinking is blocked until a password exists');
});

test('every settings password field obeys the shared strength rule', () => {
  const settings = source('client/src/pages/settings.tsx');
  const validation = source('client/src/lib/password-validation.ts');

  assert.match(settings, /passwordProblem\(newPassword\)/, 'the rule is applied before saving');
  assert.match(settings, /<PasswordStrength value=\{newPassword\} \/>/, 'the meter uses the same rule');
  assert.match(settings, /newPassword !== confirmPassword/, 'the confirmation must match');

  // The rule module must stay importable by the server too, so the client and
  // the backend can never disagree about what a valid password is.
  assert.ok(!/@\//.test(validation), 'the rule module must not use path aliases');
});

test('the settings page reports the Discord round trip and scrubs the parameter', () => {
  const settings = source('client/src/pages/settings.tsx');

  assert.match(settings, /get\("discord"\)/, 'the callback result is read from the query string');
  assert.match(settings, /discord_already_linked/, 'each failure reason has a human message');
  assert.match(settings, /replaceState\(null, "", "\/settings"\)/, 'the parameter is removed after reporting it');
});

test('the admin portal exposes its own Discord integrations page', () => {
  const app = source('client/src/AdminApp.tsx');
  const sidebar = source('client/src/components/admin/admin-sidebar.tsx');
  const page = source('client/src/pages/admin-integrations.tsx');

  assert.match(app, /<Route path="\/integrations">/, 'the dashboard routes to integrations');
  assert.match(sidebar, /href="\/integrations"/, 'the admin sidebar links to it');
  assert.match(sidebar, /Integrations/, 'the link is labelled');

  assert.match(page, /\/api\/admin\/me/, 'the page reads the admin account');
  assert.match(page, /\/api\/admin\/auth\/discord"/, 'linking starts the OAuth handshake');
  assert.match(page, /method: "DELETE"/, 'unlinking calls the guarded endpoint');
});

test('the admin login page is PIN and password only — Discord is not a sign-in', () => {
  const page = source('client/src/pages/admin-login-page.tsx');

  // There must be no Discord entry point on the sign-in screen at all.
  assert.ok(!/admin-button-discord-login/.test(page), 'no Discord login button');
  assert.ok(!/\/api\/admin\/auth\/discord/.test(page), 'the login page never starts a Discord handshake');
  assert.ok(!/FaDiscord/.test(page), 'the Discord icon is gone from the login page');
  assert.ok(!/admin_not_linked/.test(page), 'the removed Discord sign-in reason is gone');
  assert.match(page, /\/api\/admin\/login/, 'the PIN/password form is the only way in');
});

test('both backends treat the admin Discord handshake as a link, never a sign-in', () => {
  const serverless = source('api/admin/index.js');
  const express = source('server/admin-routes.ts');

  for (const [label, body] of [['serverless', serverless], ['express', express]]) {
    assert.match(body, /api\/admin\/auth\/discord/, `${label} exposes the admin Discord handshake`);
    assert.ok(!/admin_not_linked/.test(body), `${label} no longer signs an admin in via Discord`);
    assert.match(body, /mode: 'link'/, `${label} signs the state as a link`);
    assert.match(body, /api\/admin\/auth\/discord\/link/, `${label} can unlink`);

    // The callback may only attach an id. Slice it out so the PIN/password
    // login's own session establishment cannot satisfy this.
    const callback = body.slice(
      body.indexOf('/api/admin/auth/discord/callback'),
      body.indexOf('/api/admin/auth/discord/link'),
    );
    assert.ok(callback.length > 0, `${label} has the Discord callback`);
    assert.ok(!/isAdminLoggedIn = true/.test(callback), `${label} creates no session in the Discord callback`);
    assert.ok(!/adminRole = /.test(callback), `${label} sets no dashboard role in the Discord callback`);
  }

  // The two backends store the link differently — raw SQL vs the drizzle
  // helper — but both clear it to null rather than to an empty string.
  assert.match(serverless, /discord_id = NULL/);
  assert.match(express, /setAdminDiscordId\(req\.session!\.adminId, null\)/);
});
