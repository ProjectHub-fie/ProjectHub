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

test('the hero typing effect cycles through one shared list of phrases', () => {
  const hero = source('client/src/components/hero-section.tsx');

  // The list used to be an array literal rebuilt every render and listed in the
  // effect's dependencies, so each render re-ran the effect and the timer chain
  // never finished a cycle: the text froze on the completed first phrase.
  const componentBody = hero.slice(hero.indexOf('export default function'));
  assert.ok(
    !/const\s+typingTexts\s*=/.test(componentBody),
    'the phrase list must not be rebuilt inside the component',
  );
  assert.match(
    hero,
    /^const TYPING_TEXTS = \[/m,
    'the phrase list must be a module-scope constant so its identity is stable',
  );

  // The old render-scoped list was named `typingTexts`; its presence would mean
  // the unstable array is back.
  assert.ok(
    !/typingTexts/.test(hero),
    'the effect must reference the module-scope list, not a render-scoped one',
  );
  assert.match(
    hero,
    /^  \}, \[currentTextIndex, currentCharIndex, isDeleting\]\);$/m,
    'only the typing state may be an effect dependency; a per-render array would restart the timer',
  );

  // Mobile and desktop used to render different sentences, so the hero read
  // differently depending on screen width.
  assert.ok(
    !/isMobile/.test(hero),
    'the hero must not swap its phrases by viewport',
  );
  assert.match(
    hero,
    /text-sm md:text-lg/,
    'the typed line must stay responsive now that both viewports share one list',
  );
});

test('tapping a sidebar nav item closes the mobile sidebar', () => {
  // On mobile the sidebar is a Sheet and nothing closed it on navigation, so a
  // tap left the panel open over the content it had just navigated to. The
  // close must be attached to the links, not driven off a pathname effect:
  // tapping the link for the current route does not change the path, so an
  // effect would not fire.
  const sidebar = source('client/src/components/ui/sidebar.tsx');
  assert.match(
    sidebar,
    /setOpenMobile\(false\)/,
    'a hook that closes the mobile sidebar must exist',
  );

  for (const rel of [
    'client/src/components/app-sidebar.tsx',
    'client/src/components/admin/admin-sidebar.tsx',
  ]) {
    const component = source(rel);
    assert.match(
      component,
      /const closeMobileSidebar = useMobileSidebarClose\(\)/,
      `${rel} must get the mobile-close handler`,
    );
    assert.ok(
      !/<Link (?![^>]*onClick=\{closeMobileSidebar\})/.test(component),
      `every nav Link in ${rel} must call closeMobileSidebar on click`,
    );
  }
});
