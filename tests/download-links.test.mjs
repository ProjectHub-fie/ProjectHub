/**
 * Installer download links: the MEGA link rules and the client/server mirror.
 *
 * A download link is the one field an administrator can set that makes a
 * visitor's browser leave the site and fetch an executable, so it is validated
 * on the server, not only in the form. It is also a credential in its own right:
 * a MEGA share link carries its decryption key in the URL fragment, which means
 * the link must never be echoed into an error message, a log line or a stored
 * diagnostic. Several tests below exist purely to keep that true.
 *
 * The client module (`client/src/lib/download-links.ts`) and the server mirror
 * (`api/_lib/download-links.js`) cannot share an import — one lives under
 * `client/`, which is not in the serverless bundle, and is TypeScript. They are
 * therefore driven with the same table here so they cannot drift, which is the
 * same approach `email-validation.test.mjs` uses for the contact rules.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const server = require('../api/_lib/download-links.js');

const client = await import('../client/src/lib/download-links.ts');

const source = (rel) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

// A recognisable marker stands in for the decryption key, so a leak is easy to
// spot. Shaped like a real MEGA key (base64url, no dots) but obviously a test.
const KEY = 'ZzQqSecretKeyMarker1234567890';

/** Links both implementations must accept. */
const VALID = [
  `https://mega.nz/file/AbCdEf12#${KEY}`,
  `https://mega.nz/folder/AbCdEf12#${KEY}`,
  `https://mega.nz/embed/AbCdEf12#${KEY}`,
  `https://www.mega.nz/file/AbCdEf12#${KEY}`,
  `https://mega.io/file/AbCdEf12#${KEY}`,
  `https://mega.co.nz/#!AbCdEf12!${KEY}`,
  `  https://mega.nz/file/AbCdEf12#${KEY}  `,
];

/** Links both implementations must refuse. */
const INVALID = [
  'https://mega.nz/file/AbCdEf12',
  'https://mega.nz/',
  'http://mega.nz/file/AbCdEf12#key',
  'https://evil.example/file/AbCdEf12#key',
  'https://mega.nz.evil.example/file/AbCdEf12#key',
  'https://mega.nz-attacker.example/file/AbCdEf12#key',
  'https://notmega.nz/file/AbCdEf12#key',
  'https://mega.nz/channel/AbCdEf12#key',
  'https://mega.nz/file/short#key',
  'not a url',
  'ftp://mega.nz/file/AbCdEf12#key',
];

/** Absent values are not an error; they are how the dashboard clears a link. */
const ABSENT = [null, undefined, '', '   '];

test('both implementations accept a complete MEGA share link', () => {
  for (const url of VALID) {
    for (const [name, mod] of [['client', client], ['server', server]]) {
      const result = mod.validateMegaDownloadUrl(url);
      assert.equal(result.valid, true, `${name} rejected ${url}: ${result.reason}`);
      assert.equal(result.url, url.trim(), `${name} must return the link trimmed, key intact`);
    }
  }
});

test('both implementations refuse a link that is not a usable MEGA share', () => {
  for (const url of INVALID) {
    for (const [name, mod] of [['client', client], ['server', server]]) {
      const result = mod.validateMegaDownloadUrl(url);
      assert.equal(result.valid, false, `${name} accepted ${url}`);
      assert.ok(result.reason, `${name} must give a reason for ${url}`);
    }
  }
});

test('both implementations treat an absent link as "cleared", not an error', () => {
  for (const value of ABSENT) {
    for (const [name, mod] of [['client', client], ['server', server]]) {
      const result = mod.validateMegaDownloadUrl(value);
      assert.equal(result.valid, true, `${name} must accept ${String(value)} as empty`);
      assert.equal(result.url, '');
    }
  }
});

test('the two implementations agree on every case, so they cannot drift', () => {
  // The decisive check: the client is convenience and the server is the
  // boundary, so any disagreement means the form and the API disagree about
  // what is storable. This compares the accept/reject decision and the reason.
  for (const value of [...VALID, ...INVALID, ...ABSENT]) {
    const c = client.validateMegaDownloadUrl(value);
    const s = server.validateMegaDownloadUrl(value);
    assert.equal(c.valid, s.valid, `client/server disagree on ${String(value)}`);
    assert.equal(c.reason, s.reason, `client/server give different reasons for ${String(value)}`);
    assert.equal(c.url, s.url, `client/server return different URLs for ${String(value)}`);
  }
});

test('the trusted host list is identical on both sides', () => {
  assert.deepEqual(
    [...client.MEGA_DOWNLOAD_HOSTS].sort(),
    [...server.MEGA_DOWNLOAD_HOSTS].sort(),
    'a host trusted by the form but not the API (or the reverse) is a live mismatch',
  );
});

test('a lookalike host is not trusted', () => {
  // The classic bypasses: a suffix, a prefix and a userinfo trick. The hostname
  // must be an exact match, so none of them pass.
  for (const host of [
    'mega.nz.evil.example',
    'evil.example',
    'notmega.nz',
    'megan.z',
    'mega.nz-attacker.example',
    '',
    null,
    undefined,
  ]) {
    assert.equal(client.isTrustedMegaHost(host), false, `client trusted ${host}`);
    assert.equal(server.isTrustedMegaHost(host), false, `server trusted ${host}`);
  }

  for (const host of ['mega.nz', 'www.mega.nz', 'MEGA.NZ', 'mega.io', 'mega.co.nz']) {
    assert.equal(client.isTrustedMegaHost(host), true, `client rejected ${host}`);
    assert.equal(server.isTrustedMegaHost(host), true, `server rejected ${host}`);
  }
});

test('a rejected link never appears in its own reason', () => {
  // This is the security property: the fragment is the decryption key, so any
  // message that quotes the input has published the key. Every rejection reason
  // must be built from literals. The reason does contain an *example* link, so
  // the check is for the real share id and key, not for a whole-string match:
  // a short input such as "https://mega.nz/" is a substring of that example.
  for (const value of INVALID) {
    for (const [name, mod] of [['client', client], ['server', server]]) {
      const result = mod.validateMegaDownloadUrl(value);
      assert.ok(!result.reason.includes(KEY), `${name} leaked the key in: ${result.reason}`);
      assert.ok(
        !result.reason.includes('AbCdEf12'),
        `${name} echoed the share id in: ${result.reason}`,
      );
    }
  }
});

test('the reason strings are literals, not interpolations', () => {
  // A source-level backstop: a future reason written as a template literal would
  // silently reintroduce the leak above, and this catches it at review time.
  for (const file of ['client/src/lib/download-links.ts', 'api/_lib/download-links.js']) {
    const mod = source(file);
    const reasons = [...mod.matchAll(/reason:\s*(`[^`]*`|"[^"]*")/g)].map((m) => m[1]);
    assert.ok(reasons.length > 0, `${file} should contain rejection reasons`);
    for (const reason of reasons) {
      assert.ok(
        !reason.includes('${'),
        `${file} builds a reason by interpolation: ${reason}`,
      );
    }
  }
});

test('redactDownloadUrl drops the fragment so a log line cannot leak the key', () => {
  for (const [name, mod] of [['client', client], ['server', server]]) {
    const redacted = mod.redactDownloadUrl(`https://mega.nz/file/AbCdEf12#${KEY}`);
    assert.ok(!redacted.includes(KEY), `${name} kept the key`);
    assert.ok(!redacted.includes('#'), `${name} kept the fragment separator`);
    assert.ok(redacted.startsWith('https://mega.nz/'), `${name} lost the origin`);

    assert.equal(mod.redactDownloadUrl(null), '(none)');
    assert.equal(mod.redactDownloadUrl(''), '(none)');
    assert.equal(mod.redactDownloadUrl('not a url'), '(unparseable)');
  }
});

test('the SHA-256 rule accepts a real digest and nothing else', () => {
  const good = 'a'.repeat(64);
  const goodUpper = 'A'.repeat(64);
  for (const [name, mod] of [['client', client], ['server', server]]) {
    assert.equal(mod.sha256Problem(good), null, `${name} rejected a valid digest`);
    assert.equal(mod.sha256Problem(goodUpper), null, `${name} rejected an upper-case digest`);
    assert.equal(mod.sha256Problem(null), null);
    assert.equal(mod.sha256Problem(''), null);
    assert.equal(mod.sha256Problem(undefined), null);

    assert.match(mod.sha256Problem('abc'), /64 hexadecimal/);
    assert.match(mod.sha256Problem('z'.repeat(64)), /64 hexadecimal/);
    assert.match(mod.sha256Problem('a'.repeat(63)), /64 hexadecimal/);
    assert.match(mod.sha256Problem('a'.repeat(65)), /64 hexadecimal/);
  }
});

test('downloadDetails keeps only the known platforms and fields', () => {
  const input = {
    android: { packageName: '  clearcut.apk  ', version: '1.1.0', size: '3.3 MB', sha256: 'A'.repeat(64) },
    windows: { packageName: 'ClearCut.exe', bogus: 'drop me' },
    linux: { packageName: 'should-be-dropped' },
    __proto__: { packageName: 'prototype pollution attempt' },
  };

  for (const [name, mod] of [['client', client], ['server', server]]) {
    const details = mod.normalizeDownloadDetails(input);
    assert.deepEqual(Object.keys(details).sort(), ['android', 'windows'], `${name} kept an unknown platform`);
    assert.equal(details.android.packageName, 'clearcut.apk', `${name} must trim`);
    assert.equal(details.android.sha256, 'a'.repeat(64), `${name} must normalise the digest to lower case`);
    assert.equal(details.windows.bogus, undefined, `${name} kept an unknown field`);

    // Non-objects and arrays are dropped rather than throwing.
    assert.deepEqual(mod.normalizeDownloadDetails(null), {});
    assert.deepEqual(mod.normalizeDownloadDetails('nope'), {});
    assert.deepEqual(mod.normalizeDownloadDetails([]), {});
    assert.deepEqual(mod.normalizeDownloadDetails({ android: 'nope' }), {});
  }
});

test('the API rejects a bad link and accepts a good one, per field', () => {
  const good = `https://mega.nz/file/AbCdEf12#${KEY}`;

  const badAndroid = server.validateDownloadFields({ androidDownloadUrl: 'https://evil.example/x' });
  assert.match(badAndroid.problem, /^Android download link:/);
  assert.ok(!badAndroid.problem.includes('evil.example'), 'the problem must not echo the link');

  const badWindows = server.validateDownloadFields({ windowsDownloadUrl: 'https://evil.example/x' });
  assert.match(badWindows.problem, /^Windows download link:/);

  const ok = server.validateDownloadFields({
    androidDownloadUrl: good,
    windowsDownloadUrl: good,
    downloadDetails: { android: { packageName: 'a.apk' } },
  });
  assert.equal(ok.problem, undefined);
  assert.equal(ok.androidDownloadUrl, good);
  assert.equal(ok.windowsDownloadUrl, good);
  assert.deepEqual(ok.downloadDetails, { android: { packageName: 'a.apk' } });

  // An absent field is omitted, so a PUT that does not mention the link leaves
  // the stored value alone. That is what keeps an edit from clearing it.
  const untouched = server.validateDownloadFields({ title: 'Renamed' });
  assert.equal(untouched.problem, undefined);
  assert.ok(!('androidDownloadUrl' in untouched));
  assert.ok(!('windowsDownloadUrl' in untouched));
  assert.ok(!('downloadDetails' in untouched));

  // An explicit null is how the dashboard clears a link.
  const cleared = server.validateDownloadFields({ androidDownloadUrl: null });
  assert.equal(cleared.androidDownloadUrl, null);
});

test('the admin API validates the links it is sent', () => {
  // The browser is trivially bypassed, so the check that holds is in the
  // handler. Both entry points — the serverless function and the dev server —
  // must call it, or a link accepted by one is storable through the other.
  const serverless = source('api/admin/index.js');
  assert.match(serverless, /import \{ validateDownloadFields \} from '\.\.\/_lib\/download-links\.js'/);
  assert.match(serverless, /const downloads = validateDownloadFields\(req\.body \|\| \{\}\)/);
  assert.match(serverless, /status\(400\)\.json\(\{ message: downloads\.problem \}\)/);

  const dev = source('server/admin-routes.ts');
  assert.match(dev, /import \{ validateDownloadFields \} from "\.\.\/api\/_lib\/download-links\.js"/);
  assert.match(dev, /validateDownloadFields\(req\.body \|\| \{\}\)/);

  // Both routes, not just create: an update is how a bad link gets in later.
  assert.equal(
    [...serverless.matchAll(/validateDownloadFields\(req\.body/g)].length,
    2,
    'POST and PUT must both validate',
  );
  assert.equal(
    [...dev.matchAll(/validateDownloadFields\(req\.body/g)].length,
    2,
    'the dev server POST and PUT must both validate',
  );
});

test('the installer links survive the storage layers', () => {
  // A column that the API writes but the read path drops is invisible, which is
  // how a link can be saved and never appear.
  for (const file of ['api/admin/index.js', 'server/storage.ts']) {
    const contents = source(file);
    assert.match(contents, /android_download_url/, `${file} must read android_download_url`);
    assert.match(contents, /windows_download_url/, `${file} must read windows_download_url`);
    assert.match(contents, /download_details/, `${file} must read download_details`);
  }

  const storage = source('server/storage.ts');
  assert.match(storage, /androidDownloadUrl: r\.android_download_url/);
  assert.match(storage, /windowsDownloadUrl: r\.windows_download_url/);
  assert.match(storage, /githubReleasesFallback: r\.github_releases_fallback/);

  // The in-memory fallback must carry the fields too, or the dev server drops
  // them when the database is unreachable.
  assert.match(storage, /androidDownloadUrl: projectData\.androidDownloadUrl \|\| null/);
  assert.match(storage, /windowsDownloadUrl: projectData\.windowsDownloadUrl \|\| null/);
});

test('the download-link helper sits under _lib so it is not a function', () => {
  // Vercel turns every file under api/ into a function. api/_lib is skipped.
  assert.ok(source('api/_lib/download-links.js').length > 0);
  const serverless = source('api/admin/index.js');
  assert.match(serverless, /from '\.\.\/_lib\/download-links\.js'/);
});

test('the public read path is untouched by the new fields', () => {
  // GET /api/projects and /api/projects/:slug return whatever the storage layer
  // mapped, so the new fields travel automatically. There must be no second
  // allow-list that would need updating for each new column.
  const api = source('api/index.js');
  const projectRoutes = api.slice(api.indexOf('/api/projects'));
  assert.match(projectRoutes, /storage\.getVerifiedProjectBySlug\(slug\)/);
  assert.ok(
    !/download_url.*pick|pick.*download_url/i.test(api),
    'the public handler must not filter project fields',
  );
});

/* ------------------------------------------------------- previous versions */

/** A complete, valid previous-version row, with the marker key. */
const prevRow = (version, overrides = {}) => ({
  version,
  url: `https://mega.nz/file/Old${version.replace(/\./g, '')}#${KEY}`,
  packageName: `clearcut-${version}.apk`,
  size: '2.1 MB',
  releaseDate: '2025-01-05',
  ...overrides,
});

test('previous versions are kept only when complete, and both mirrors agree', () => {
  const input = {
    android: {
      packageName: 'current.apk',
      previousVersions: [
        prevRow('1.0.0'),
        // No version label: an incomplete row, dropped by both.
        { url: `https://mega.nz/file/NoLabel1#${KEY}` },
        // Bad link: dropped by the normaliser (the API rejects it earlier).
        { version: '0.9.0', url: 'https://evil.example/x' },
        // A valid row with only the required fields.
        { version: '0.8.0', url: `https://mega.nz/file/Minimal1#${KEY}` },
        'not-an-object',
        null,
      ],
    },
  };

  for (const [name, mod] of [['client', client], ['server', server]]) {
    const details = mod.normalizeDownloadDetails(input);
    const versions = details.android.previousVersions;
    assert.equal(versions.length, 2, `${name} kept the wrong number of rows`);
    assert.deepEqual(versions.map((v) => v.version), ['1.0.0', '0.8.0'], `${name} order must be preserved`);
    assert.equal(versions[0].packageName, 'clearcut-1.0.0.apk', `${name} must keep the package name`);
    assert.equal(versions[0].size, '2.1 MB');
    assert.equal(versions[0].releaseDate, '2025-01-05');
    assert.ok(!('packageName' in versions[1]), `${name} must not invent an absent field`);
    // The bad URL never survives into the stored blob.
    assert.ok(
      !JSON.stringify(details).includes('evil.example'),
      `${name} stored an unvalidated link`,
    );
  }
});

test('a previous version must carry a MEGA link, not just a version label', () => {
  for (const [name, mod] of [['client', client], ['server', server]]) {
    const details = mod.normalizeDownloadDetails({
      windows: { previousVersions: [{ version: '1.0.0' }, { version: '2.0.0', url: '   ' }] },
    });
    assert.equal(
      details.windows?.previousVersions,
      undefined,
      `${name} kept a version row with no downloadable link`,
    );
  }
});

test('previous versions are capped, and the cap is the same on both sides', () => {
  assert.equal(client.MAX_PREVIOUS_VERSIONS, server.MAX_PREVIOUS_VERSIONS, 'the caps must not drift');

  const many = Array.from({ length: client.MAX_PREVIOUS_VERSIONS + 5 }, (_, i) =>
    prevRow(`1.0.${i}`, { url: `https://mega.nz/file/Row${i}abcd#${KEY}` }),
  );

  for (const [name, mod] of [['client', client], ['server', server]]) {
    const details = mod.normalizeDownloadDetails({ android: { previousVersions: many } });
    assert.equal(
      details.android.previousVersions.length,
      mod.MAX_PREVIOUS_VERSIONS,
      `${name} must cap the stored list`,
    );
  }
});

test('the API refuses a bad previous-version link rather than dropping it silently', () => {
  const good = `https://mega.nz/file/AbCdEf12#${KEY}`;

  const bad = server.validateDownloadFields({
    downloadDetails: { android: { previousVersions: [{ version: '1.0.0', url: 'https://evil.example/x' }] } },
  });
  assert.match(bad.problem, /^Android previous version 1:/, 'the problem must name the platform and position');
  assert.ok(!bad.problem.includes('evil.example'), 'the problem must never echo the link');
  assert.ok(!bad.problem.includes(KEY), 'the problem must never echo the decryption key');

  const badWindows = server.validateDownloadFields({
    downloadDetails: {
      windows: { previousVersions: [{ version: '1.0.0', url: good }, { version: '0.9.0', url: 'http://mega.nz/file/x#y' }] },
    },
  });
  assert.match(badWindows.problem, /^Windows previous version 2:/, 'the position must be one-based and accurate');

  // A blank row is what the form adds before anything is typed, so it is not an
  // error — otherwise "Add version" would block the save on its own.
  const blank = server.validateDownloadFields({
    downloadDetails: { android: { previousVersions: [{ version: '', url: '' }] } },
  });
  assert.equal(blank.problem, undefined);

  const ok = server.validateDownloadFields({
    downloadDetails: { android: { previousVersions: [prevRow('1.0.0')] } },
  });
  assert.equal(ok.problem, undefined);
  assert.equal(ok.downloadDetails.android.previousVersions[0].url, prevRow('1.0.0').url);
});

test('a previous version survives a round trip through the API and the normaliser', () => {
  // This is the shape the dashboard posts and the detail page reads. If the
  // server dropped `previousVersions` on write, the page would silently show
  // nothing and no test above would notice.
  const row = prevRow('1.0.0');
  const accepted = server.validateDownloadFields({
    androidDownloadUrl: `https://mega.nz/file/Curr1abcd#${KEY}`,
    downloadDetails: { android: { packageName: 'current.apk', previousVersions: [row] } },
  });

  assert.equal(accepted.problem, undefined);
  const stored = accepted.downloadDetails.android;
  assert.equal(stored.previousVersions.length, 1);
  assert.equal(stored.previousVersions[0].version, '1.0.0');
  assert.equal(stored.previousVersions[0].url, row.url);

  // The client reads the stored blob back into the rows the form edits.
  const detail = client.normalizeDownloadDetails(accepted.downloadDetails);
  assert.equal(detail.android.previousVersions[0].version, '1.0.0');
});

test('the detail page shows an archive only for a platform that has a current link', () => {
  const project = {
    androidDownloadUrl: `https://mega.nz/file/Curr1abcd#${KEY}`,
    downloadDetails: {
      android: { previousVersions: [prevRow('1.0.0'), prevRow('0.9.0')] },
      // No windows link, so the windows archive must not be offered.
      windows: { previousVersions: [prevRow('2.0.0', { url: `https://mega.nz/file/Win11111#${KEY}` })] },
    },
  };

  assert.equal(client.previousVersionsFor(project, 'android').length, 2);
  assert.equal(client.previousVersionsFor(project, 'windows').length, 1, 'the helper reads the row itself');

  // The page only renders the archive inside a card, and a card exists only for
  // a platform with a link. `allPlatformVersions` encodes that rule.
  assert.equal(client.allPlatformVersions(project, 'android').length, 3, 'current build plus two archives');
  assert.equal(client.allPlatformVersions(project, 'windows').length, 0, 'no current link, no archive offered');
});

test('the admin form builds only complete previous-version rows', () => {
  // The builder is read from source, the way `client-auth.test.mjs` reads page
  // invariants, because the module is a page and has no DOM to render into.
  const page = source('client/src/pages/verified-projects-page.tsx');

  // A row is filtered on a version label, a non-empty URL and a passing link.
  assert.match(page, /previousVersions: platform === "windows"/, 'the form must key rows by platform');
  assert.match(
    page,
    /row\.version\.trim\(\) && downloadUrlProblem\(row\.url\) === null/,
    'an incomplete row must be dropped before it is posted',
  );
  assert.match(page, /emptyPreviousVersionRow/, 'the Add button must start a blank row');
});

test('the detail page renders previous versions through the validated helper', () => {
  const detail = source('client/src/components/app-detail.tsx');

  // The list comes from the helper, never from the raw blob, so the page cannot
  // show a row the current rules would reject.
  assert.match(detail, /previousVersionsFor\(project, card\.platform\)/);
  assert.match(detail, /data-testid=\{`previous-versions-\$\{platform\}`\}/);
  // The link carries the decryption key, so it must be opened, never rendered.
  assert.ok(
    !/entry\.url\s*</.test(detail) && !/\{entry\.url\}/.test(detail),
    'the archive link must not be rendered as text',
  );
});
