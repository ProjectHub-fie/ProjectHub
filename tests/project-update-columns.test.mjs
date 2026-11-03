/**
 * Clearing an optional column from the dashboard.
 *
 * A project's GitHub URL could not be removed: the edit form sent `githubUrl:
 * null`, but `toColumns` resolved the value with `??`, so null fell through to
 * the snake_case fallback (undefined), the undefined entry was filtered out,
 * and the UPDATE omitted the column — leaving the old value in place.
 *
 * The helper is not exported from api/admin/index.js (that module opens a
 * database pool and an Express app at import time), so the behaviour is pinned
 * by evaluating the function source in isolation, exactly as the dashboard
 * would call it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const admin = readFileSync(
  fileURLToPath(new URL('../api/admin/index.js', import.meta.url)),
  'utf8',
);

/** Extracts the `pick` and `toColumns` definitions and evaluates them. */
function loadToColumns() {
  const start = admin.indexOf('const pick = (data, ...keys) => {');
  const endMarker = 'return Object.fromEntries(';
  const end = admin.indexOf(endMarker, start);
  assert.ok(start !== -1 && end !== -1, 'pick/toColumns must be present in api/admin/index.js');
  const closing = admin.indexOf('};', admin.indexOf(');', end)) + 2;
  const body = admin.slice(start, closing);
  // eslint-disable-next-line no-new-func
  return new Function(`${body}; return toColumns;`)();
}

const toColumns = loadToColumns();

test('an explicit null clears the column instead of being dropped', () => {
  const cols = toColumns({ githubUrl: null });
  assert.ok(
    Object.prototype.hasOwnProperty.call(cols, 'github_url'),
    'a null githubUrl must produce a github_url entry so the UPDATE writes NULL',
  );
  assert.equal(cols.github_url, null);
});

test('an empty string also clears the column', () => {
  const cols = toColumns({ githubUrl: '' });
  assert.equal(cols.github_url, '');
});

test('a snake_case null clears too', () => {
  const cols = toColumns({ github_url: null });
  assert.equal(cols.github_url, null);
});

test('an absent field is left out so a partial update does not wipe it', () => {
  const cols = toColumns({ title: 'Renamed' });
  assert.equal(
    Object.prototype.hasOwnProperty.call(cols, 'github_url'),
    false,
    'not sending githubUrl must not clear it',
  );
  assert.equal(cols.title, 'Renamed');
});

test('an explicit value still wins over the snake_case fallback', () => {
  const cols = toColumns({ githubUrl: 'https://github.com/a/b', github_url: 'https://github.com/old/old' });
  assert.equal(cols.github_url, 'https://github.com/a/b');
});

test('a null never falls back to a stale snake_case value', () => {
  const cols = toColumns({ githubUrl: null, github_url: 'https://github.com/old/old' });
  assert.equal(cols.github_url, null, 'the camelCase field is authoritative when present');
});

test('the app-metadata columns are mapped as well', () => {
  const cols = toColumns({
    appVersion: '1.1.0',
    appSize: '3.3 MB',
    platforms: ['Android 8.0+'],
    requirements: ['Android 8.0 (API 26) or newer'],
    releaseNotes: 'Notes',
    screenshots: ['https://example.test/a.png'],
  });
  assert.equal(cols.app_version, '1.1.0');
  assert.equal(cols.app_size, '3.3 MB');
  assert.deepEqual(cols.platforms, ['Android 8.0+']);
  assert.deepEqual(cols.requirements, ['Android 8.0 (API 26) or newer']);
  assert.equal(cols.release_notes, 'Notes');
  assert.deepEqual(cols.screenshots, ['https://example.test/a.png']);
});
