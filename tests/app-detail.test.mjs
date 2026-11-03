/**
 * Installable-utility detail page and the app-metadata columns.
 *
 * Two things are covered without a DOM: the pure display rules that decide
 * which layout a project gets (loaded straight from the .ts module, which
 * imports nothing from React or the DOM), and the source invariants of the
 * application-style component and the admin form that feeds it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  isInstallableApp,
  hasAppMetadata,
  nonEmpty,
  parseVersion,
  compareVersions,
  repoUrl,
  githubLatestReleaseUrl,
  installLabel,
} from '../client/src/lib/project-display.ts';

const source = (rel) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

const clearcut = {
  category: 'utilities',
  githubUrl: 'https://github.com/ProjectHub-fie/Clearcut',
  appVersion: '1.1.0',
  appSize: '3.3 MB',
  platforms: ['Android 8.0+'],
  requirements: ['Android 8.0 (API 26) or newer'],
  releaseNotes: 'Adds a built-in update channel.',
  screenshots: ['https://example.test/shot.png'],
};

test('a utility with app metadata uses the application layout', () => {
  assert.equal(isInstallableApp(clearcut), true);
});

test('a utility with no app metadata keeps the ordinary layout', () => {
  const bare = { category: 'utilities', appVersion: null, appSize: null, platforms: [], requirements: [], releaseNotes: null, screenshots: [] };
  assert.equal(hasAppMetadata(bare), false);
  assert.equal(isInstallableApp(bare), false, 'an empty utility must not render an empty app page');
});

test('websites and bots never use the application layout', () => {
  for (const category of ['websites', 'bots']) {
    assert.equal(
      isInstallableApp({ ...clearcut, category }),
      false,
      `${category} must keep its own layout even with app metadata present`,
    );
  }
});

test('a null project is not an installable app', () => {
  assert.equal(isInstallableApp(null), false);
  assert.equal(isInstallableApp(undefined), false);
  assert.equal(hasAppMetadata(null), false);
});

test('nonEmpty drops blank entries so no empty heading renders', () => {
  assert.deepEqual(nonEmpty(['a', '', '  ', 'b']), ['a', 'b']);
  assert.deepEqual(nonEmpty(null), []);
  assert.deepEqual(nonEmpty(undefined), []);
});

test('version comparison orders 1.10 above 1.9, unlike a string compare', () => {
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
  assert.equal(compareVersions('1.9.0', '1.10.0'), -1);
  assert.equal(compareVersions('1.1.0', '1.1.0'), 0);
  assert.equal(compareVersions('v1.2.0', '1.2'), 0, 'a leading v and a short form must not change the order');
  assert.equal(compareVersions('1.1.0-beta', '1.1.0'), 0, 'a prerelease suffix is ignored for ordering');
  assert.deepEqual(parseVersion('v2.3.4+build.9'), [2, 3, 4]);
});

test('the release link is derived from a normalised repo URL', () => {
  assert.equal(repoUrl('https://github.com/ProjectHub-fie/Clearcut'), 'https://github.com/ProjectHub-fie/Clearcut');
  assert.equal(repoUrl('https://github.com/ProjectHub-fie/Clearcut.git'), 'https://github.com/ProjectHub-fie/Clearcut');
  assert.equal(repoUrl('https://github.com/ProjectHub-fie/Clearcut/releases'), 'https://github.com/ProjectHub-fie/Clearcut');
  assert.equal(repoUrl('https://gitlab.com/foo/bar'), null);
  assert.equal(repoUrl(null), null);
  assert.equal(githubLatestReleaseUrl('https://github.com/ProjectHub-fie/Clearcut'), 'https://github.com/ProjectHub-fie/Clearcut/releases/latest');
  assert.equal(githubLatestReleaseUrl(null), null);
});

test('the project page selects the app layout through the shared helper', () => {
  const page = source('client/src/pages/project.tsx');
  assert.match(page, /import AppDetail from "@\/components\/app-detail"/);
  assert.match(page, /import \{ isInstallableApp \} from "@\/lib\/project-display"/);
  assert.match(
    page,
    /if \(isInstallableApp\(project\)\) \{\s*return <AppDetail project=\{project\} \/>;/,
    'the app layout must be selected by the helper, not by an inline category check',
  );
});

test('the app detail page renders store sections and a real download link', () => {
  const detail = source('client/src/components/app-detail.tsx');
  assert.match(detail, /data-testid="button-app-install"/, 'an install/download action must exist');
  assert.match(detail, /data-testid="app-facts"/, 'install facts (version/size/platforms) must be shown');
  assert.match(detail, /data-testid="app-screenshots"/);
  assert.match(detail, /data-testid="app-release-notes"/);
  assert.match(detail, /data-testid="app-requirements"/);
  assert.match(detail, /ProjectInteractions/, 'ratings and likes must survive the layout change');

  // Optional fields are guarded, so a project missing one renders nothing
  // rather than the literal text "undefined". Type annotations are the only
  // legitimate occurrence of the word, so it is matched in output positions.
  for (const pattern of [/\{undefined\}/, />undefined</, /\$\{undefined\}/, /undefined\}<\//]) {
    assert.ok(!pattern.test(detail), `the app page must not print undefined (${pattern})`);
  }
});

test('the app skeleton mirrors the store layout', () => {
  const skeletons = source('client/src/components/project-skeletons.tsx');
  assert.match(skeletons, /export function AppDetailSkeleton\(\)/);
  assert.match(skeletons, /data-testid="app-detail-loading-skeleton"/);
  const body = skeletons.slice(skeletons.indexOf('export function AppDetailSkeleton'));
  assert.match(body, /rounded-3xl/, 'the app skeleton must include the rounded app icon block');
});

test('the app skeleton is actually reachable while the app page loads', () => {
  const page = source('client/src/pages/project.tsx');
  assert.match(
    page,
    /const showAppSkeleton = isInstallableApp\(cachedProject\)/,
    'the cached projects list must decide which skeleton to show',
  );
  assert.match(page, /<AppDetailSkeleton \/>/, 'an unused skeleton would never appear');
  assert.match(
    page,
    /queryClient\.getQueryData<Project\[\]>\(\["\/api\/projects"\]\)/,
    'the cached list must be read from the same key the projects page writes',
  );
});

test('the install label names the real target platform', () => {
  assert.equal(installLabel({ category: 'utilities', platforms: ['Android 8.0+'] }), 'Download for Android');
  assert.equal(installLabel({ category: 'utilities', platforms: ['Windows 11', 'x64'] }), 'Download for Windows');
  assert.equal(installLabel({ category: 'utilities', platforms: ['macOS 14'] }), 'Download for macOS');
  assert.equal(installLabel({ category: 'utilities', platforms: ['Ubuntu 24.04'] }), 'Download for Linux');
  assert.equal(
    installLabel({ category: 'utilities', platforms: [] }),
    'Download',
    'an unknown platform must not claim to be Android',
  );
  assert.equal(installLabel(null), 'Download');
});

test('the app detail page derives its install label from the platform', () => {
  const detail = source('client/src/components/app-detail.tsx');
  assert.match(detail, /appInstallLabel\(project\)/, 'the label must not be hardcoded to Android');
  assert.ok(!/Download for Android"/.test(detail), 'a hardcoded Android label would mislabel other builds');
});

test('the projects list Download action falls back to the release feed', () => {
  const list = source('client/src/pages/projects.tsx');
  assert.match(
    list,
    /isInstallableApp\(project\) \? githubLatestReleaseUrl\(project\.githubUrl\) : null/,
    'a utility with no live URL must still be downloadable from its release',
  );
  assert.match(list, /disabled=\{!actionUrl\}/, 'the action must disable only when no URL exists');
});

test('the admin form carries the app-metadata fields through to the payload', () => {
  const page = source('client/src/pages/verified-projects-page.tsx');
  for (const field of ['appVersion', 'appSize', 'platforms', 'requirements', 'releaseNotes', 'screenshots']) {
    assert.match(page, new RegExp(`${field}:`), `${field} must be part of the form state`);
  }
  assert.match(page, /data-testid="input-project-app-version"/);
  assert.match(page, /data-testid="input-project-screenshots"/);
  assert.match(
    page,
    /platforms: toArrayField\(f\.platforms\)/,
    'comma-separated platforms must be sent as an array',
  );
});

test('the database layers know the app-metadata columns', () => {
  for (const file of ['api/_lib/storage.js', 'server/run-migration.ts', 'drizzle/schema.ts']) {
    const contents = source(file);
    assert.match(contents, /app_version/, `${file} must define app_version`);
    assert.match(contents, /screenshots/, `${file} must define screenshots`);
  }
  const admin = source('api/admin/index.js');
  assert.match(admin, /ensureVerifiedProjectSchema/, 'the dashboard must add the columns on an existing database');
  assert.match(admin, /ADD COLUMN IF NOT EXISTS app_version text/);
});

test('both drizzle schemas carry the same verified_projects columns', () => {
  // The JS API imports drizzle/schema.js and the Express server imports
  // drizzle/schema.ts. A column added to only one of them is invisible to half
  // the app, which is exactly how the two drifted apart before.
  const columnOf = (file) => {
    const contents = source(file);
    const start = contents.indexOf('export const verifiedProjects');
    assert.ok(start !== -1, `${file} must define verifiedProjects`);
    const end = contents.indexOf('});', start);
    return new Set(
      [...contents.slice(start, end).matchAll(/text\('([a-z_]+)'\)/g)].map((m) => m[1]),
    );
  };

  const jsColumns = columnOf('drizzle/schema.js');
  const tsColumns = columnOf('drizzle/schema.ts');

  for (const column of ['app_version', 'app_size', 'platforms', 'requirements', 'release_notes', 'screenshots']) {
    assert.ok(jsColumns.has(column), `drizzle/schema.js is missing ${column}`);
    assert.ok(tsColumns.has(column), `drizzle/schema.ts is missing ${column}`);
  }

  for (const column of jsColumns) {
    assert.ok(tsColumns.has(column), `drizzle/schema.ts is missing ${column}, which schema.js defines`);
  }
  for (const column of tsColumns) {
    assert.ok(jsColumns.has(column), `drizzle/schema.js is missing ${column}, which schema.ts defines`);
  }
});
