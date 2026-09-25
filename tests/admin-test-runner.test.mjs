/**
 * The admin test-runner console.
 *
 * The security-relevant claim is that the endpoint can run exactly one command
 * and that no request data reaches it. That is asserted against the module's
 * source, because it is a property of how the argument list is built rather than
 * of a value the route returns.
 *
 * The process handling itself is exercised for real: `runTestSuite` is called
 * against the actual `tests/` folder, so the parse of a real TAP summary is
 * checked rather than a stub.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const source = (relative) => readFileSync(resolve(root, relative), 'utf8');

const { parseTap, capOutput, runTestSuite, buildTestRouter } = await import('../api/_lib/suite-runner.js');

/* ------------------------------------------------------------------ TAP parse */

test('the TAP summary is read from the reporter output', () => {
  const summary = parseTap(
    ['TAP version 13', 'ok 1 - a test', '# tests 12', '# pass 10', '# fail 1', '# skipped 1', '# duration_ms 42.5'].join('\n'),
  );
  assert.deepEqual(summary, {
    tests: 12,
    pass: 10,
    fail: 1,
    skipped: 1,
    durationMs: 42.5,
    failures: [],
  });
});

test('failing test names are collected', () => {
  const summary = parseTap(['not ok 3 - the thing works', '  ---', '  ...'].join('\n'));
  assert.deepEqual(summary.failures, ['the thing works']);
});

test('output that does not match the pattern reports null, never a guess', () => {
  const summary = parseTap('Segmentation fault');
  assert.equal(summary.tests, null);
  assert.equal(summary.pass, null);
  assert.equal(summary.fail, null);
});

test('long output is capped from the middle so both ends stay readable', () => {
  const text = `START${'x'.repeat(200)}END`;
  const capped = capOutput(text, 50);
  assert.ok(capped.length < text.length);
  assert.match(capped, /START/);
  assert.match(capped, /END/);
  assert.match(capped, /characters omitted/);
});

test('short output is returned untouched', () => {
  assert.equal(capOutput('hello', 100), 'hello');
});

/* --------------------------------------------------------- running the suite */

test('the suite runs for real and reports a TAP summary', async () => {
  // Point at a small sibling suite. Running the whole folder, or this file
  // itself, would re-enter this test and recurse — the pass/fail mechanics are
  // the same, only the set of files differs.
  const target = resolve(here, 'deployment-limits.test.mjs');
  const result = await runTestSuite({ timeoutMs: 60_000, target });
  assert.equal(result.ok, true, `expected a clean run, got exit ${result.exitCode}`);
  assert.equal(result.timedOut, false);
  assert.ok(result.summary.tests > 0, 'some tests ran');
  assert.equal(result.summary.tests, result.summary.pass + result.summary.fail);
  assert.match(result.output, /TAP version|# tests/);
});

/* ------------------------------------------------------------- the guardrails */

test('the command is a fixed argument list built from a literal', () => {
  const routes = source('api/_lib/suite-runner.js');
  // The args are a literal, and the only variable part defaults to the tests dir.
  assert.match(routes, /function testArgs\(target = TESTS_DIR\)/);
  assert.match(routes, /return \['--test', '--test-force-exit', '--test-reporter=tap', target\]/);
  // No request field is read in the run handler.
  assert.doesNotMatch(routes, /req\.body/);
  assert.doesNotMatch(routes, /req\.query/);
  assert.doesNotMatch(routes, /req\.params/);
});

test('the child process is spawned without a shell', () => {
  const routes = source('api/_lib/suite-runner.js');
  assert.match(routes, /shell: false/);
  // Spawning through process.execPath avoids PATH resolution for the binary.
  assert.match(routes, /spawn\(process\.execPath, testArgs\(target\)/);
});

test('the executable is the running node binary, not a path from input', () => {
  const routes = source('api/_lib/suite-runner.js');
  assert.doesNotMatch(routes, /spawn\([^)]*req\./);
  assert.doesNotMatch(routes, /exec\(|execSync|spawnSync/);
});

test('the routes are owner-only', () => {
  const routes = source('api/_lib/suite-runner.js');
  const guards = routes.match(/requireRole\('owner'\)/g) || [];
  assert.equal(guards.length, 2, 'both routes are owner-only');
});

test('a second concurrent run is refused rather than spawned', () => {
  const routes = source('api/_lib/suite-runner.js');
  assert.match(routes, /if \(inFlight\)/);
  assert.match(routes, /409/);
});

test('a missing tests/ folder is reported as unavailable, not a crash', () => {
  const routes = source('api/_lib/suite-runner.js');
  assert.match(routes, /tests_not_deployed/);
  assert.match(routes, /503/);
  const status = source('api/_lib/suite-runner.js');
  assert.match(status, /available: existsSync\(TESTS_DIR\)/);
});

test('the child does not inherit the parent test runner context', () => {
  // Inheriting NODE_TEST_CONTEXT makes a nested runner attach to the parent's
  // protocol instead of emitting TAP; the spawned suite must be independent.
  const routes = source('api/_lib/suite-runner.js');
  assert.match(routes, /delete env\.NODE_TEST_CONTEXT/);
  assert.match(routes, /delete env\.NODE_TEST_WORKER_ID/);
  assert.match(routes, /env: childEnv\(\)/);
});

test('the router exposes exactly a status read and a run', () => {
  const router = buildTestRouter({
    requireAuth: [],
    requireRole: () => [],
  });
  const paths = router.stack.filter((layer) => layer.route).map((layer) => layer.route.path);
  assert.deepEqual(paths.sort(), ['/api/admin/tests/run', '/api/admin/tests/status']);
});

/* --------------------------------------------------------------- the wiring */

test('the serverless and dev backends both mount the test router', () => {
  assert.match(source('api/admin/index.js'), /buildTestRouter/);
  assert.match(source('server/admin-routes.ts'), /buildTestRouter/);
});

test('the admin app routes /tests behind the owner permission', () => {
  const app = source('client/src/AdminApp.tsx');
  assert.match(app, /path="\/tests"/);
  assert.match(app, /permission === "tests" && !canRunTests/);
});

test('the sidebar hides Tests from a non-owner, as the email item is hidden', () => {
  const sidebar = source('client/src/components/admin/admin-sidebar.tsx');
  assert.match(sidebar, /canRunTests &&/);
  assert.match(sidebar, /href="\/tests"/);
});

test('canRunTests is owner only, while the bot console allows admin too', () => {
  const hook = source('client/src/hooks/useAdminAuth.ts');
  assert.match(hook, /const canRunTests = adminRole === 'owner';/);
  assert.match(hook, /const canManageBot = adminRole === 'owner' \|\| adminRole === 'admin';/);
});

test('the page shows the exact command it will run', () => {
  const page = source('client/src/pages/admin-tests.tsx');
  assert.match(page, /tests-command/);
  assert.match(page, /data-testid="button-run-tests"/);
});
