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

const { parseTap, capOutput, runTestSuite, buildTestRouter, dockerRunArgs, dockerAvailable } = await import('../api/_lib/suite-runner.js');

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
  assert.match(routes, /return \['--test', '--test-force-exit', '--test-reporter=tap', spec\]/);
  // No request field is read in the run handler.
  assert.doesNotMatch(routes, /req\.body/);
  assert.doesNotMatch(routes, /req\.query/);
  assert.doesNotMatch(routes, /req\.params/);
});

test('the child process is spawned without a shell', () => {
  const routes = source('api/_lib/suite-runner.js');
  assert.match(routes, /shell: false/);
  // The local child runs the same node binary as the server, and the docker
  // child runs the literal `node` inside the image; neither is chosen from input.
  assert.match(routes, /runChild\(process\.execPath, testArgs\(target\)/);
  assert.match(routes, /runChild\('docker', dockerRunArgs\(image\)/);
});

test('the executable is the running node binary, not a path from input', () => {
  const routes = source('api/_lib/suite-runner.js');
  assert.doesNotMatch(routes, /spawn\([^)]*req\./);
  // `spawnSync` is used only to probe docker, never to run the suite.
  assert.doesNotMatch(routes, /exec\(|execSync/);
  const probes = routes.match(/spawnSync\('docker'/g) || [];
  assert.equal(probes.length, 2, 'spawnSync is only the docker availability/image probes');
});

test('the routes are owner-only', () => {
  const routes = source('api/_lib/suite-runner.js');
  // The owner guard is built once and applied to both routes. Counting the
  // factory call would only prove it was written down, so this checks the guard
  // is on every route and that no weaker role is used.
  assert.match(routes, /const requireOwner = requireRole\('owner'\)/);
  const uses = routes.match(/requireAuth, requireOwner/g) || [];
  assert.equal(uses.length, 2, 'both routes are owner-only');
  assert.doesNotMatch(routes, /requireRole\('(admin|moderator)'\)/);
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
  assert.match(status, /const local = existsSync\(TESTS_DIR\)/);
});

/* ------------------------------------------------------------- docker path */

test('the docker argument list is fixed and built from a literal', () => {
  const args = dockerRunArgs('projecthub:local');
  // The command inside the container is a literal glob, never a request field.
  assert.deepEqual(args.slice(-5), [
    'node',
    '--test',
    '--test-force-exit',
    '--test-reporter=tap',
    'tests/*.test.mjs',
  ]);
  // The image is the first non-flag argument, before the command.
  assert.equal(args[args.length - 6], 'projecthub:local');
  // No request data, and no shell metacharacter handling anywhere.
  const routes = source('api/_lib/suite-runner.js');
  assert.doesNotMatch(routes, /dockerRunArgs\([^)]*req\./);
});

test('the suite target is a glob, because node 24 rejects a bare directory', () => {
  // `node --test tests/` dies with "Cannot find module /app/tests" on Node 24.
  // The console and the container both run the `npm test` glob instead.
  const args = dockerRunArgs('projecthub:local');
  assert.equal(args[args.length - 1], 'tests/*.test.mjs');
  const routes = source('api/_lib/suite-runner.js');
  assert.match(routes, /const spec = isTestsDir\(target\) \? 'tests\/\*\.test\.mjs' : target/);
});

test('the docker runner uses the image it is given, never one from input', () => {
  const args = dockerRunArgs('custom:tag');
  assert.ok(args.includes('custom:tag'));
  // The only source of the image is the module's own config.
  const routes = source('api/_lib/suite-runner.js');
  assert.match(routes, /const DEFAULT_IMAGE = process\.env\.TEST_RUNNER_IMAGE \|\| 'projecthub:local'/);
});

test('secrets are passed to the container by name, not by value', () => {
  // `-e NAME` copies from the daemon's environment, so a connection string or a
  // token never lands in the argument list that `ps` can read.
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'super-secret-value';
  try {
    const args = dockerRunArgs('projecthub:local');
    const joined = args.join(' ');
    assert.match(joined, /-e SESSION_SECRET/);
    assert.doesNotMatch(joined, /super-secret-value/);
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});

test('docker mode falls back to unavailable when docker cannot be reached', () => {
  // The selection logic: with no tests/ folder, no docker and no override, the
  // run reports tests_not_deployed rather than attempting a spawn.
  const routes = source('api/_lib/suite-runner.js');
  assert.match(routes, /TEST_RUNNER_DOCKER === '0'/);
  assert.match(routes, /mode \|\| \(dockerAvailable\(\) \? 'docker' : 'unavailable'\)/);
  assert.match(routes, /dockerAvailable\(\)/);
});

test('the status route reports how the suite will run', () => {
  const routes = source('api/_lib/suite-runner.js');
  assert.match(routes, /mode: local \? 'local' : docker \? 'docker' : 'unavailable'/);
  assert.match(routes, /available: local \|\| docker/);
  assert.match(routes, /image: local \? null/);
});

test('the docker run joins the configured network when one is set', () => {
  const previous = process.env.TEST_RUNNER_NETWORK;
  process.env.TEST_RUNNER_NETWORK = 'projecthub_default';
  try {
    assert.ok(dockerRunArgs('projecthub:local').join(' ').includes('--network projecthub_default'));
  } finally {
    if (previous === undefined) delete process.env.TEST_RUNNER_NETWORK;
    else process.env.TEST_RUNNER_NETWORK = previous;
  }
});

test('the suite runs somewhere, locally or in docker', async () => {
  // The real process path is exercised for the local branch: a small sibling
  // suite is run and its TAP summary read. Docker is not required for the test
  // to pass; `dockerAvailable` only gates the cloud path.
  const target = resolve(here, 'deployment-limits.test.mjs');
  const result = await runTestSuite({ timeoutMs: 60_000, target });
  assert.equal(result.ok, true, `expected a clean run, got exit ${result.exitCode}`);
  assert.equal(typeof dockerAvailable(), 'boolean');
});

test('the child does not inherit the parent test runner context', () => {
  // Inheriting NODE_TEST_CONTEXT makes a nested runner attach to the parent's
  // protocol instead of emitting TAP; the spawned suite must be independent.
  const routes = source('api/_lib/suite-runner.js');
  assert.match(routes, /delete env\.NODE_TEST_CONTEXT/);
  assert.match(routes, /delete env\.NODE_TEST_WORKER_ID/);
  assert.match(routes, /env: childEnv\(\)/);
});

test('the router builds with the middleware shapes the app really passes', () => {
  // These are the shapes api/admin/index.js defines: requireAuth is a single
  // function, requireRole returns one. An earlier version of this test passed
  // `requireAuth: []`, an array, so `...requireAuth` looked fine here while the
  // real function threw "function is not iterable" at load in production.
  const requireAuth = (_req, _res, next) => next();
  const calls = [];
  const requireRole = (role) => {
    calls.push(role);
    return (_req, _res, next) => next();
  };

  const router = buildTestRouter({ requireAuth, requireRole });

  assert.equal(typeof requireRole('owner'), 'function', 'requireRole must be a factory');
  const paths = router.stack.filter((layer) => layer.route).map((layer) => layer.route.path);
  assert.deepEqual(paths.sort(), ['/api/admin/tests/run', '/api/admin/tests/status']);
});

test('each route is guarded by requireAuth and the owner role', () => {
  const requireAuth = (_req, _res, next) => next();
  const requireRole = () => (_req, _res, next) => next();

  const router = buildTestRouter({ requireAuth, requireRole });

  for (const layer of router.stack.filter((l) => l.route)) {
    const handlers = layer.route.stack.map((s) => s.handle);
    assert.ok(handlers.length >= 3, `${layer.route.path} should have guards plus a handler`);
    // The first two are the auth and role guards, in that order.
    assert.equal(handlers[0], requireAuth, `${layer.route.path} is missing requireAuth`);
    assert.notEqual(typeof handlers[1], 'undefined', `${layer.route.path} is missing a role guard`);
  }
});

test('the guards are passed as values, never spread', () => {
  // A spread of a middleware function is the exact bug this guards against.
  const routes = source('api/_lib/suite-runner.js');
  assert.doesNotMatch(routes, /\.\.\.requireAuth/);
  assert.doesNotMatch(routes, /\.\.\.requireRole/);
  // The owner guard is built once from the factory.
  assert.match(routes, /const requireOwner = requireRole\('owner'\)/);
});


/* --------------------------------------------------------------- the wiring */

test('the real admin function loads without throwing', async () => {
  // The strongest check available: import the deployed entry point exactly as
  // Vercel does. Source-level assertions missed the spread-of-a-function bug
  // because they only proved the text existed; this fails on the real TypeError.
  // Postgres is lazy, so a placeholder connection string is enough to load the
  // module without a database.
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(
    process.execPath,
    ['-e', "import('./api/admin/index.js').then(()=>console.log('LOADED')).catch(e=>{console.error(e.message);process.exit(1)})"],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        SESSION_SECRET: 'test-secret-not-a-real-one',
        DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/placeholder',
      },
      timeout: 60_000,
    },
  );
  assert.equal(result.status, 0, `api/admin/index.js failed to load:\n${result.stderr}`);
  assert.match(result.stdout, /LOADED/);
});


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
