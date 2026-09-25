/**
 * The deploy contract with Vercel.
 *
 * Vercel turns *every* file under `api/` into a Serverless Function. The Hobby
 * plan allows 12, so a helper module dropped into `api/` silently consumes a
 * function slot and eventually fails the build with "exceeded the limit" — which
 * is exactly what happened here.
 *
 * The rule (verified in `node_modules/vercel/dist/index.js`, in
 * `detectBuilders`): a path under `api/` is skipped when it contains `/_`, `/.`,
 * `/node_modules/`, or ends with `.d.ts`. So helpers live in `api/_lib`.
 *
 * This test pins both the rule and the current count, so adding a helper without
 * the underscore is caught here rather than in a deploy.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { minimatch } = require('minimatch');

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const MAX_FUNCTIONS = 12;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Vercel's own detection rule, transcribed from the CLI. */
function isFunction(relPath) {
  const middleware = relPath === 'middleware.js' || relPath === 'middleware.ts';
  if (!(relPath.startsWith('api/') || middleware)) return false;
  if (relPath.includes('/.')) return false;
  if (relPath.includes('/_')) return false;
  if (relPath.includes('/node_modules/')) return false;
  if (relPath.endsWith('.d.ts')) return false;
  return true;
}

const apiFiles = walk(resolve(root, 'api'))
  .map((f) => f.slice(root.length + 1).split('\\').join('/'))
  .sort();

const functions = apiFiles.filter(isFunction);

test('the deployment stays under the 12-function plan limit', () => {
  assert.ok(
    functions.length <= MAX_FUNCTIONS,
    `api/ would deploy ${functions.length} functions (limit ${MAX_FUNCTIONS}):\n` +
      functions.join('\n') +
      '\nA helper file under api/ consumes a function slot. Move it under api/_lib.',
  );
});

test('only the two real endpoints are functions', () => {
  assert.deepEqual(functions, ['api/admin/index.js', 'api/index.js']);
});

test('the underscore rule is what keeps helpers out of the count', () => {
  // Directly encode the rule so a future Vercel change is a visible failure.
  assert.equal(isFunction('api/lib/db.js'), true, 'api/lib would be a function');
  assert.equal(isFunction('api/_lib/db.js'), false, 'api/_lib is skipped');
  assert.equal(isFunction('api/_lib/bot-logic.js'), false, 'api/_lib is skipped');
  assert.equal(isFunction('api/.hidden.js'), false, 'a dotfile is skipped');
  assert.equal(isFunction('api/types.d.ts'), false, 'a .d.ts is skipped');
  assert.equal(isFunction('api/admin/index.js'), true);
});

test('the helpers still exist, just under _lib', () => {
  const lib = apiFiles.filter((f) => f.startsWith('api/_lib/'));
  assert.ok(lib.length >= 13, `expected the shared helpers under api/_lib, found ${lib.length}`);
  for (const name of [
    'db.js',
    'db-url.js',
    'storage.js',
    'session-token.js',
    'email.js',
    'mail-routes.js',
    'mail-store.js',
    'mail-sanitize.js',
    'push.js',
    'bot-logic.js',
    'bot-routes.js',
    'bot-store.js',
    'neon-usage.js',
    'suite-runner.js',
  ]) {
    assert.ok(lib.includes(`api/_lib/${name}`), `api/_lib/${name} is missing`);
  }
});

/* --------------------------------------------------- .vercelignore stripping */

/**
 * `.vercelignore` uses gitignore semantics, which is what makes it dangerous: a
 * pattern with no slash in it matches at *any* depth, not just the root. A bare
 * `test*` therefore deleted `api/_lib/test-routes.js` from the deployed bundle
 * while `api/admin/index.js` still imported it, and the function died at load
 * with ERR_MODULE_NOT_FOUND. Nothing in the local test run could see it, because
 * the file is present on disk.
 *
 * These tests read the real file and match the real patterns against the real
 * tree, so the same mistake fails here instead of in a deploy.
 */
const vercelIgnore = readFileSync(resolve(root, '.vercelignore'), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));

/** gitignore-ish match, using minimatch for the glob itself. */
function isIgnored(relPath, patterns = vercelIgnore) {
  
  for (const raw of patterns) {
    const negated = raw.startsWith('!');
    const pattern = negated ? raw.slice(1) : raw;
    // A slash anywhere but the very end anchors the pattern to the root.
    const anchored = pattern.replace(/\/+$/, '').includes('/') || pattern.startsWith('/');
    const dirOnly = pattern.endsWith('/');
    const body = pattern.replace(/^\//, '').replace(/\/+$/, '');

    let hit;
    if (anchored) {
      hit = minimatch(relPath, body) || (dirOnly && relPath.startsWith(`${body}/`));
    } else {
      // Unanchored: matches a segment at any depth. This is the footgun.
      hit = minimatch(relPath, body, { matchBase: true }) ||
        relPath.split('/').some((seg) => minimatch(seg, body));
    }
    if (hit) return !negated;
  }
  return false;
}

test('no unanchored glob can strip a file under api/', () => {
  // An unanchored pattern matches at any depth, so it is only a problem when it
  // can match something that actually ships. Cosmetic patterns like `*.log` are
  // harmless; a `test*` is not, because api/_lib/test-routes.js was a module.
  const dangerous = vercelIgnore.filter((p) => {
    const raw = p.replace(/^!/, '');
    const anchored = raw.startsWith('/') || raw.replace(/\/+$/, '').includes('/');
    if (anchored) return false;
    const body = raw.replace(/\/+$/, '');
    return apiFiles.some((f) => f.split('/').some((seg) => minimatch(seg, body, { matchBase: true })));
  });
  assert.deepEqual(
    dangerous,
    [],
    'these unanchored patterns match a segment under api/ and would strip a shipped module:\n' +
      dangerous.join('\n'),
  );
});

test('every shipped api/ file survives .vercelignore', () => {
  const stripped = apiFiles.filter((f) => isIgnored(f));
  assert.deepEqual(
    stripped,
    [],
    'these files are imported by the deployed functions but .vercelignore drops them:\n' +
      stripped.join('\n'),
  );
});

test('every helper the functions import is actually present after ignoring', () => {
  // Walk each entry point's relative imports and prove the target is not ignored.
  for (const entry of ['api/index.js', 'api/admin/index.js']) {
    const src = readFileSync(resolve(root, entry), 'utf8');
    const dir = dirname(entry);
    for (const match of src.matchAll(/from\s+'(\.[^']+)'/g)) {
      const target = resolve(root, dir, match[1]).slice(root.length + 1).split('\\').join('/');
      assert.ok(!isIgnored(target), `${entry} imports ${target}, which .vercelignore drops`);
    }
  }
});

test('the old footgun patterns are gone', () => {
  assert.ok(!vercelIgnore.includes('test*'), 'the bare `test*` pattern is back');
  assert.ok(!vercelIgnore.includes('*-test.js'), 'the bare `*-test.js` pattern is back');
  assert.ok(!vercelIgnore.includes('*.test.*'), 'the bare `*.test.*` pattern is back');
  // And the anchoring that replaced them is present.
  assert.ok(vercelIgnore.includes('/tests/'), '/tests/ should be root-anchored');
  assert.ok(vercelIgnore.includes('/test*.js'), '/test*.js should be root-anchored');
});

test('the ignore matcher reproduces the bug it guards against', () => {
  // If this ever stops failing on the old pattern, the guard above is worthless.
  assert.equal(isIgnored('api/_lib/test-routes.js', ['test*']), true, 'bare test* must match at depth');
  assert.equal(isIgnored('api/_lib/test-routes.js', ['/test*.js']), false, 'anchored must not match at depth');
  assert.equal(isIgnored('api/_lib/suite-runner.js', vercelIgnore), false, 'the renamed module ships');
  assert.equal(isIgnored('tests/foo.test.mjs', vercelIgnore), true, 'the suite itself stays out');
  assert.equal(isIgnored('test-api.js', vercelIgnore), true, 'root test scripts stay out');
});


test('no stale api/lib directory is left behind', () => {
  assert.ok(!apiFiles.some((f) => f.startsWith('api/lib/')), 'api/lib still contains files');
});

test('every import of the helpers points at _lib', () => {
  // The two function entries plus the Express dev server and the bot process.
  for (const file of [
    'api/index.js',
    'api/admin/index.js',
    'server/routes.ts',
    'server/db.ts',
    'server/admin-routes.ts',
    'bot/index.js',
  ]) {
    const src = readFileSync(resolve(root, file), 'utf8');
    assert.ok(!/['"][^'"]*\blib\/(?!_)/.test(src) || !/api\/lib\/|\.\/lib\/|\.\.\/lib\//.test(src),
      `${file} still imports from a bare lib/ path`);
  }

  // The function entries must resolve the helpers through _lib specifically.
  assert.match(readFileSync(resolve(root, 'api/index.js'), 'utf8'), /'\.\/_lib\/storage\.js'/);
  assert.match(readFileSync(resolve(root, 'api/admin/index.js'), 'utf8'), /'\.\.\/_lib\/bot-routes\.js'/);
  assert.match(readFileSync(resolve(root, 'bot/index.js'), 'utf8'), /'\.\.\/api\/_lib\/bot-store\.js'/);
});

test('the Node test runner can still load the helper modules', async () => {
  // Import resolution is the thing a rename breaks, so prove it works.
  const { parseCommand } = await import('../api/_lib/bot-logic.js');
  assert.equal(parseCommand('&dev').command, 'dev');
});
