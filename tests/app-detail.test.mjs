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
} from '../client/src/lib/project-display.ts';
import {
  validateMegaDownloadUrl,
  redactDownloadUrl,
  isTrustedMegaHost,
} from '../client/src/lib/download-links.ts';

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
});

test('a per-platform installer link counts as app metadata', () => {
  // An app whose only metadata is "here is the Android build" is exactly the
  // case the store layout exists for, so a link alone must select it.
  const linkOnly = {
    category: 'utilities',
    appVersion: null,
    appSize: null,
    platforms: [],
    requirements: [],
    releaseNotes: null,
    screenshots: [],
    androidDownloadUrl: 'https://mega.nz/file/AbCdEf12#keykeykeykeykeykeykeykey',
  };
  assert.equal(hasAppMetadata(linkOnly), true);
  assert.equal(isInstallableApp(linkOnly), true);
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

test('the app detail page renders store sections and per-platform downloads', () => {
  const detail = source('client/src/components/app-detail.tsx');
  assert.match(detail, /data-testid="app-facts"/, 'install facts (version/size/platforms) must be shown');
  assert.match(detail, /data-testid="app-screenshots"/);
  assert.match(detail, /data-testid="app-release-notes"/);
  assert.match(detail, /data-testid="app-requirements"/);
  assert.match(detail, /ProjectInteractions/, 'ratings and likes must survive the layout change');

  // One button per configured platform, generated from the shared list. The
  // test id is parameterised, so a hardcoded single button cannot pass.
  assert.match(detail, /data-testid=\{`button-download-\$\{card\.platform\}`\}/);
  assert.match(detail, /data-testid=\{`card-download-\$\{card\.platform\}`\}/);
  assert.match(detail, /downloadCards\(project\)/, 'the page must build its buttons from the shared helper');

  // Optional fields are guarded, so a project missing one renders nothing
  // rather than the literal text "undefined". Type annotations are the only
  // legitimate occurrence of the word, so it is matched in output positions.
  for (const pattern of [/\{undefined\}/, />undefined</, /\$\{undefined\}/, /undefined\}<\//]) {
    assert.ok(!pattern.test(detail), `the app page must not print undefined (${pattern})`);
  }
});

test('the download dialog never renders the link itself', () => {
  // A MEGA share link carries its decryption key in the fragment, so putting it
  // on screen would leak the credential. The dialog shows package facts only.
  const detail = source('client/src/components/app-detail.tsx');
  const dialog = detail.slice(detail.indexOf('app-download-dialog'));
  assert.ok(dialog.length > 0, 'the download dialog must exist');
  assert.ok(!/\{pending\.url\}/.test(dialog), 'the raw download URL must not be rendered');
  assert.ok(!/\{card\.url\}/.test(detail), 'the raw download URL must not be rendered anywhere');
  assert.match(dialog, /Continue to MEGA/, 'the action must say where it goes');
});

test('external download links are opened with noopener', () => {
  const detail = source('client/src/components/app-detail.tsx');
  const opens = [...detail.matchAll(/window\.open\(([^;]*)\)/g)].map((m) => m[1]);
  assert.ok(opens.length > 0, 'the page must open external links');
  for (const call of opens) {
    assert.match(call, /noopener/, `every window.open must pass noopener: ${call}`);
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

test('the app detail page derives its install label from the shared card list', () => {
  const detail = source('client/src/components/app-detail.tsx');
  assert.match(detail, /card\.label/, 'the label must come from the download card, not a literal');
  assert.ok(!/Download for Android"/.test(detail), 'a hardcoded Android label would mislabel other builds');
});

test('the projects list Download action uses the installer link, not liveUrl', () => {
  const list = source('client/src/pages/projects.tsx');
  assert.match(
    list,
    /isInstallableApp\(project\)\s*\?\s*primaryInstallUrl\(project\)\s*:\s*project\.liveUrl/,
    'a utility installs from its own package; only other categories use the live URL',
  );
  assert.ok(
    !/githubLatestReleaseUrl/.test(list),
    'GitHub Releases is an opt-in fallback now, not an implicit one',
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

test('the admin form has a separate field per platform download', () => {
  const page = source('client/src/pages/verified-projects-page.tsx');

  for (const platform of ['android', 'windows']) {
    assert.match(
      page,
      new RegExp(`data-testid={\`input-project-\\$\\{platform\\}-download-url\`}`),
      'both platforms share one field component, so the URL input is parameterised',
    );
  }

  // The two platforms must not share a field name; that is the whole bug this
  // change fixes.
  assert.match(page, /androidDownloadUrl: f\.androidDownloadUrl\.trim\(\) \|\| null/);
  assert.match(page, /windowsDownloadUrl: f\.windowsDownloadUrl\.trim\(\) \|\| null/);
  assert.match(page, /platform="android"/);
  assert.match(page, /platform="windows"/);

  // Both the form and the API validate the link, and the form checks the
  // checksum too. The API is the boundary; the form is the fast feedback.
  assert.match(page, /downloadUrlProblem\(value\)/);
  assert.match(page, /sha256Problem\(value\)/);
});

test('the admin form does not put a download link into an error message', () => {
  const page = source('client/src/pages/verified-projects-page.tsx');
  // The toast descriptions are built from the validator's constant reasons and
  // the API's message, never from the field value. If one interpolated the URL,
  // the MEGA decryption key would end up in a toast and a log line.
  const toastDescriptions = [...page.matchAll(/description:\s*([^\n]*)/g)].map((m) => m[1]);
  assert.ok(toastDescriptions.length > 0, 'the page is expected to raise toasts');

  for (const description of toastDescriptions) {
    assert.ok(
      !/DownloadUrl|Download link is not valid/.test(description),
      `a toast description must not carry the download link: ${description}`,
    );
  }

  // And the reason strings themselves are constants, so there is nothing to
  // interpolate in the first place.
  for (const file of ['client/src/lib/download-links.ts', 'api/_lib/download-links.js']) {
    const mod = source(file);
    for (const reason of mod.matchAll(/reason:\s*([^\n,}]*)/g)) {
      assert.ok(
        !/\$\{|`\s*\+|value|url\b/.test(reason[1].replace(/"(Download links?[^"]*)"/g, '')),
        `${file} must build its reasons from literals, not from the input: ${reason[1]}`,
      );
    }
  }
});

test('a rejected link never echoes the link back', () => {
  // The strongest form of the rule above: feed the validator a link whose key
  // is a recognisable marker and assert the marker appears in no reason.
  const marker = 'ZzQqSecretKeyMarker1234567890';
  const cases = [
    `https://mega.nz/file/AbCdEf12#${marker}`,
    `https://mega.nz/file/AbCdEf12`,
    `http://mega.nz/file/AbCdEf12#${marker}`,
    `https://evil.example/file/AbCdEf12#${marker}`,
    `https://mega.nz.evil.example/file/AbCdEf12#${marker}`,
    `not a url ${marker}`,
    `https://mega.nz/channel/AbCdEf12#${marker}`,
  ];

  for (const value of cases) {
    const result = validateMegaDownloadUrl(value);
    if (result.valid) continue;
    assert.ok(
      !result.reason.includes(marker),
      `the reason leaked the link: ${result.reason}`,
    );
  }

  // A bare "https://mega.nz/file/<id>" with no fragment must be refused as
  // incomplete rather than stored — it cannot be decrypted by anyone.
  const noKey = validateMegaDownloadUrl('https://mega.nz/file/AbCdEf12');
  assert.equal(noKey.valid, false);
  assert.match(noKey.reason, /decryption key/);

  // And the redaction helper drops the fragment.
  const redacted = redactDownloadUrl(`https://mega.nz/file/AbCdEf12#${marker}`);
  assert.ok(!redacted.includes(marker), 'redactDownloadUrl must drop the key');
  assert.ok(redacted.startsWith('https://mega.nz/'));
});

test('the database layers know the app-metadata columns', () => {
  for (const file of ['api/_lib/storage.js', 'server/run-migration.ts', 'drizzle/schema.ts']) {
    const contents = source(file);
    assert.match(contents, /app_version/, `${file} must define app_version`);
    assert.match(contents, /screenshots/, `${file} must define screenshots`);
    assert.match(contents, /android_download_url/, `${file} must define android_download_url`);
    assert.match(contents, /windows_download_url/, `${file} must define windows_download_url`);
    assert.match(contents, /download_details/, `${file} must define download_details`);
    assert.match(contents, /github_releases_fallback/, `${file} must define github_releases_fallback`);
  }
  const admin = source('api/admin/index.js');
  assert.match(admin, /ensureVerifiedProjectSchema/, 'the dashboard must add the columns on an existing database');
  assert.match(admin, /ADD COLUMN IF NOT EXISTS app_version text/);
  assert.match(admin, /ADD COLUMN IF NOT EXISTS android_download_url text/);
  assert.match(admin, /ADD COLUMN IF NOT EXISTS windows_download_url text/);
});

test('the migration only adds columns, never rewrites existing rows', () => {
  // The task is additive: existing projects must keep every value they have.
  const migration = source('drizzle/migrations/0010_platform_downloads.sql');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS android_download_url/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS windows_download_url/);
  assert.ok(!/DROP COLUMN/i.test(migration), 'a migration must not drop a column');
  assert.ok(!/UPDATE verified_projects/i.test(migration), 'a migration must not rewrite existing rows');
  assert.ok(!/NOT NULL(?!\s*;)/i.test(migration.replace(/github_releases_fallback boolean DEFAULT false NOT NULL/, '')), 'a new NOT NULL column without a default would fail on existing rows');
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

  for (const column of [
    'app_version', 'app_size', 'platforms', 'requirements', 'release_notes', 'screenshots',
    'android_download_url', 'windows_download_url',
  ]) {
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
