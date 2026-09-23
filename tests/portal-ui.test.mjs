/**
 * Portal UI fixes.
 *
 * Like client-auth.test.mjs, there is no DOM renderer here, so these pin the
 * invariants that real, observed defects violated. Each reads the source and
 * asserts the fix is present so a regression fails loudly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = (rel) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

test('the profile dropdown is not painted over by the page hero', () => {
  const app = source('client/src/App.tsx');
  const header = app.slice(app.indexOf('<header'), app.indexOf('</header>'));
  assert.match(
    header,
    /className="relative z-\d+ /,
    'the header must establish a stacking context above the page, otherwise the hero overlay covers the profile dropdown',
  );
});

test('profile picture uploads persist through the profile endpoint', () => {
  const page = source('client/src/pages/project-request.tsx');
  const withoutComments = page.replace(/\/\/[^\n]*/g, '');

  assert.ok(
    !/upload-profile-pic/.test(withoutComments),
    'the upload must not POST to /api/auth/upload-profile-pic; no backend route implements it',
  );
  assert.match(
    page,
    /await updateProfile\(\{\s*profileImageUrl: dataUrl\s*\}\)/,
    'the uploaded image must be saved through updateProfile so the avatar updates',
  );
});

test('the Discord handshake only navigates once the token resolves', () => {
  const page = source('client/src/pages/login.tsx');
  const block = page.slice(
    page.indexOf('if (token) {'),
    page.indexOf('No session was returned'),
  );

  assert.match(block, /refreshAuth\(\)\.then\(\(resolved\) => \{/,
    'navigation must wait for the token to resolve');
  assert.match(block, /if \(resolved\) \{\s*setLocation\("\/dashboard"\)/,
    'the dashboard redirect must be conditional on a resolved session');
});

test('the Discord button sits above the login and register form', () => {
  const page = source('client/src/pages/login.tsx');
  const discord = page.indexOf('data-testid="button-discord-login"');
  const tabs = page.indexOf('<Tabs value={activeTab}');

  assert.ok(discord !== -1 && tabs !== -1, 'both the Discord button and the tabs must exist');
  assert.ok(
    discord < tabs,
    'Continue with Discord must be rendered above the login/registration form',
  );
});

test('the client dashboard keeps logout in the sidebar, not the page header', () => {
  const page = source('client/src/pages/project-request.tsx');
  assert.ok(
    !/data-testid="button-logout"/.test(page),
    'the per-page logout button must be gone from the client dashboard',
  );
});
