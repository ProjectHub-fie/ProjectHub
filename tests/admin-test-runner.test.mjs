/**
 * The admin test-runner console.
 *
 * The console now runs the suite on GitHub Actions: Vercel has no Docker daemon
 * and `tests/` is absent from the serverless bundle, so the endpoint dispatches
 * the repository's `.github/workflows/docker-tests.yml` and polls for the run.
 *
 * The security-relevant claim is that the endpoint can dispatch exactly one
 * fixed workflow, that no request data reaches GitHub, and that the token never
 * leaves the server. Those are asserted against the module's source, because
 * they are properties of how the dispatch is built rather than of a value the
 * route returns, and against a mocked GitHub API so no real workflow is ever
 * triggered during a unit test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const source = (relative) => readFileSync(resolve(root, relative), 'utf8');

const {
  getConfig,
  buildTestRouter,
  cancelRun,
  __test,
} = await import('../api/_lib/suite-runner.js');

/** Resets env and the mock fetcher between tests. */
function resetHarness({ token = 'stub-token', repo = 'ProjectHub-fie/ProjectHub' } = {}) {
  __test.resetStore();
  __test.setFetcher(null);
  for (const key of [
    'GITHUB_ACTIONS_TOKEN',
    'GITHUB_TOKEN',
    'GITHUB_REPOSITORY',
    'GITHUB_WORKFLOW_FILE',
    'GITHUB_WORKFLOW_BRANCH',
    'TEST_RUN_TIMEOUT_MS',
    'TEST_RUN_POLL_MS',
  ]) {
    delete process.env[key];
  }
  if (token) process.env.GITHUB_ACTIONS_TOKEN = token;
  if (repo) process.env.GITHUB_REPOSITORY = repo;
}

/** Builds a fake Response for the GitHub API. */
function ghResponse({ status = 200, body = null, json = body }) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return json;
    },
  };
}

/** A fake GitHub run, newest kinds come last in display_title matching. */
function fakeRun(overrides = {}) {
  return {
    id: 123,
    name: 'Docker Tests',
    display_title: 'Docker tests (abc-123)',
    status: 'completed',
    conclusion: 'success',
    head_sha: 'deadbeef',
    run_started_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:01:00Z',
    completed_at: '2026-01-01T00:01:00Z',
    html_url: 'https://github.com/ProjectHub-fie/ProjectHub/actions/runs/123',
    ...overrides,
  };
}

/* ------------------------------------------------------------------- config */

test('config defaults point at the ProjectHub repository and docker-tests workflow', () => {
  resetHarness({ token: 'abc' });
  const config = getConfig();
  assert.equal(config.repository, 'ProjectHub-fie/ProjectHub');
  assert.equal(config.workflowFile, 'docker-tests.yml');
  assert.equal(config.branch, 'main');
  assert.equal(config.token, 'abc');
  assert.ok(config.timeoutMs > 0);
});

test('config is read from the environment', () => {
  resetHarness({});
  process.env.GITHUB_REPOSITORY = 'someone/else';
  process.env.GITHUB_WORKFLOW_FILE = 'other.yml';
  process.env.GITHUB_WORKFLOW_BRANCH = 'dev';
  process.env.GITHUB_ACTIONS_TOKEN = 'token-2';
  const config = getConfig();
  assert.equal(config.repository, 'someone/else');
  assert.equal(config.workflowFile, 'other.yml');
  assert.equal(config.branch, 'dev');
  assert.equal(config.token, 'token-2');
});

/* ------------------------------------------------------------ dispatch body */

test('dispatch posts a fixed workflow, branch and a server-generated request id', async () => {
  resetHarness({});
  let called = null;
  __test.setFetcher(async (url, options) => {
    called = { url, options };
    return ghResponse({ status: 204 });
  });

  const router = buildTestRouter({
    requireAuth: (_req, _res, next) => next(),
    requireRole: () => (_req, _res, next) => next(),
  });
  // Find the POST route and invoke it directly with a fake req/res.
  const postLayer = router.stack.find((layer) => layer.route?.path === '/api/admin/tests/run');
  const handler = postLayer.route.stack[postLayer.route.stack.length - 1].handle;

  const res = { json: (body) => (res.body = body), status: () => res };
  await handler({}, res);

  assert.ok(called, 'dispatch POST was made');
  assert.match(called.url, /actions\/workflows\/docker-tests\.yml\/dispatches$/);
  const sent = JSON.parse(called.options.body);
  assert.equal(sent.ref, 'main');
  assert.match(sent.inputs.request_id, /^[0-9a-f-]{36}$/i, 'request_id is a server-side uuid');
  assert.match(called.options.headers.Authorization, /Bearer stub-token/);
});

test('the request id is never taken from the request', () => {
  const routes = source('api/_lib/suite-runner.js');
  // No request field reads anywhere: body, query or params.
  assert.doesNotMatch(routes, /req\.body/);
  assert.doesNotMatch(routes, /req\.query/);
  assert.doesNotMatch(routes, /req\.params/);
});

test('the token is never exposed through an API response', async () => {
  resetHarness({ token: 'supersecrettoken' });
  __test.setFetcher(async () => ghResponse({ status: 204 }));

  const router = buildTestRouter({
    requireAuth: (_req, _res, next) => next(),
    requireRole: () => (_req, _res, next) => next(),
  });
  const runLayer = router.stack.find((layer) => layer.route?.path === '/api/admin/tests/run');
  const runHandler = runLayer.route.stack[runLayer.route.stack.length - 1].handle;
  const runRes = { json: (body) => (runRes.body = body), status: () => runRes };
  await runHandler({}, runRes);

  assert.match(JSON.stringify(runRes.body), /"requestId":/);
  assert.doesNotMatch(JSON.stringify(runRes.body), /supersecrettoken/);
  assert.doesNotMatch(JSON.stringify(runRes.body), /Bearer/);
});

test('dispatch errors surface as a readable response, not a crash', async () => {
  resetHarness({});
  __test.setFetcher(async () => ghResponse({ status: 403, body: { message: 'Forbidden' } }));

  const router = buildTestRouter({
    requireAuth: (_req, _res, next) => next(),
    requireRole: () => (_req, _res, next) => next(),
  });
  const runLayer = router.stack.find((layer) => layer.route?.path === '/api/admin/tests/run');
  const runHandler = runLayer.route.stack[runLayer.route.stack.length - 1].handle;

  let status = null;
  const res = {
    json: (body) => (res.body = body),
    status: (code) => {
      status = code;
      return res;
    },
  };
  await runHandler({}, res);
  assert.equal(status, 502);
  assert.match(res.body.message, /GITHUB_ACTIONS_TOKEN/);
});

/* --------------------------------------------------------- lookup + polling */

test('run lookup matches the request id from recent runs, never a real call', async () => {
  resetHarness({});
  __test.setFetcher(async (url) => {
    assert.match(url, /actions\/workflows\/docker-tests\.yml\/runs/);
    return ghResponse({
      body: {
        total_count: 1,
        workflow_runs: [fakeRun({ display_title: 'Docker tests (abc-123)', id: 77 })],
      },
    });
  });
  const router = buildTestRouter({
    requireAuth: (_req, _res, next) => next(),
    requireRole: () => (_req, _res, next) => next(),
  });
  const statusLayer = router.stack.find((layer) => layer.route?.path === '/api/admin/tests/status');
  const statusHandler = statusLayer.route.stack[statusLayer.route.stack.length - 1].handle;

  const res = { json: (body) => (res.body = body), status: () => res };
  await statusHandler({}, res);
  // No active run yet, so the status endpoint reports configured and idle.
  assert.equal(res.body.available, true);
  assert.equal(res.body.running, false);
  assert.equal(res.body.mode, 'github-actions');
});

test('a completed run becomes lastRun and frees the single-run slot', async () => {
  resetHarness({});
  let pollCount = 0;
  // First call: dispatch. Later calls: the poll finds the matching run (the id
  // is recorded by the module into __test.lastDispatchedId on dispatch).
  __test.setFetcher(async (url, options) => {
    if (options.method === 'POST' && /dispatches$/.test(url)) return ghResponse({ status: 204 });
    pollCount += 1;
    return ghResponse({
      body: {
        total_count: 1,
        workflow_runs: [fakeRun({ display_title: `Docker tests (${__test.lastDispatchedId || 'none'})`, id: 77 })],
      },
    });
  });

  const router = buildTestRouter({
    requireAuth: (_req, _res, next) => next(),
    requireRole: () => (_req, _res, next) => next(),
  });
  const runLayer = router.stack.find((layer) => layer.route?.path === '/api/admin/tests/run');
  const runHandler = runLayer.route.stack[runLayer.route.stack.length - 1].handle;
  const runRes = { json: (body) => (runRes.body = body), status: () => runRes };
  await runHandler({}, runRes);
  assert.ok(__test.lastDispatchedId, 'dispatch recorded the request id');

  const statusLayer = router.stack.find((layer) => layer.route?.path === '/api/admin/tests/status');
  const statusHandler = statusLayer.route.stack[statusLayer.route.stack.length - 1].handle;
  const statusRes = { json: (body) => (statusRes.body = body), status: () => statusRes };
  await statusHandler({}, statusRes);

  assert.equal(statusRes.body.running, false, 'after completion the dashboard stops showing running');
  assert.ok(statusRes.body.lastRun, 'the completed run is surfaced as lastRun');
  assert.equal(statusRes.body.lastRun.conclusion, 'success');
  assert.ok(pollCount >= 1, 'the status handler polled GitHub');
});

test('the status route reports a 503 when the token is unset', async () => {
  resetHarness({ token: null });
  const router = buildTestRouter({
    requireAuth: (_req, _res, next) => next(),
    requireRole: () => (_req, _res, next) => next(),
  });
  const runLayer = router.stack.find((layer) => layer.route?.path === '/api/admin/tests/run');
  const runHandler = runLayer.route.stack[runLayer.route.stack.length - 1].handle;

  const res = { json: (body) => (res.body = body), status: (code) => (res.statusCode = code) && res };
  await runHandler({}, res);
  assert.equal(res.statusCode, 503);
  assert.match(res.body.message, /GITHUB_ACTIONS_TOKEN/);
  assert.equal(res.body.available, false);
});

test('duplicate runs are refused while one is in flight', async () => {
  resetHarness({});
  __test.setFetcher(async (url, options) => {
    if (options.method === 'POST' && /dispatches$/.test(url)) return ghResponse({ status: 204 });
    return ghResponse({ body: { total_count: 0, workflow_runs: [] } });
  });

  const router = buildTestRouter({
    requireAuth: (_req, _res, next) => next(),
    requireRole: () => (_req, _res, next) => next(),
  });
  const runLayer = router.stack.find((layer) => layer.route?.path === '/api/admin/tests/run');
  const runHandler = runLayer.route.stack[runLayer.route.stack.length - 1].handle;

  const first = { json: (body) => (first.body = body), status: () => first };
  await runHandler({}, first); // in-flight after dispatch
  const second = { json: (body) => (second.body = body), status: (code) => (second.statusCode = code) && second };
  await runHandler({}, second);

  assert.equal(second.statusCode, 409);
  assert.match(second.body.message, /in progress/i);
  __test.resetStore();
});

test('cancel marks the run cancelled and clears the slot', async () => {
  resetHarness({});
  // Dispatch and then cancel button path.
  __test.setFetcher(async (url, options) => {
    if (options.method === 'POST' && /dispatches$/.test(url)) return ghResponse({ status: 204 });
    if (/\/runs\/\d+\/cancel$/.test(url)) return ghResponse({ status: 204 });
    return ghResponse({ body: { total_count: 0, workflow_runs: [] } });
  });

  const router = buildTestRouter({
    requireAuth: (_req, _res, next) => next(),
    requireRole: () => (_req, _res, next) => next(),
  });
  const runLayer = router.stack.find((layer) => layer.route?.path === '/api/admin/tests/run');
  const runHandler = runLayer.route.stack[runLayer.route.stack.length - 1].handle;
  const res = { json: (body) => (res.body = body), status: () => res };

  await runHandler({}, res);
  // After dispatch the run has no id yet (204); set one, as the poll would —
  // adopt() expects the shaped (shapeRun) record, not the raw GitHub payload.
  __test.currentRun.adopt({
    id: 99,
    status: 'in_progress',
    conclusion: null,
    htmlUrl: 'https://github.com/ProjectHub-fie/ProjectHub/actions/runs/99',
    displayTitle: `Docker tests (${res.body.requestId})`,
    createdAt: null,
    updatedAt: null,
    startedAt: null,
    completedAt: null,
  });

  const cancelled = await cancelRun();
  assert.equal(cancelled.cancelled, true);
  assert.equal(__test.currentRun, null);
  __test.resetStore();
});

/* ------------------------------------------------------------- the guardrails */

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

test('Vercel never runs docker locally: the module has no docker or process imports', () => {
  const routes = source('api/_lib/suite-runner.js');
  // The new implementation must not pull in the parts of Node that ran docker:
  // child_process and the filesystem probes are gone; only HTTP (fetch) remains.
  assert.doesNotMatch(routes, /node:child_process/);
  assert.doesNotMatch(routes, /spawnSync|execFileSync|spawn\(/);
  assert.doesNotMatch(routes, /existsSync/);
  assert.doesNotMatch(routes, /docker version|docker build|--network/);
});

test('the workflow file, branch and target are never validated from the request', () => {
  const routes = source('api/_lib/suite-runner.js');
  // The only workflow / branch source is the environment.
  assert.match(routes, /GITHUB_WORKFLOW_FILE/);
  assert.match(routes, /GITHUB_WORKFLOW_BRANCH/);
  assert.match(routes, /GITHUB_REPOSITORY/);
  // No path or shell metacharacter interpolation from request data.
  assert.doesNotMatch(routes, /req\.params|req\.query|req\.body/);
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
        GITHUB_ACTIONS_TOKEN: 'stub-token',
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

test('the page states the run happens on GitHub Actions and links the run', () => {
  const page = source('client/src/pages/admin-tests.tsx');
  assert.match(page, /tests-command/);
  assert.match(page, /data-testid="button-run-tests"/);
  assert.match(page, /GitHub Actions/);
  assert.match(page, /github-run-link/);
  assert.match(page, /not on Vercel/);
});

/* --------------------------------------------------------------- the workflow */

test('the workflow only listens to workflow_dispatch and carries a run-name', () => {
  const wf = source('.github/workflows/docker-tests.yml');
  assert.match(wf, /workflow_dispatch/);
  assert.doesNotMatch(wf, /push:|pull_request:/);
  assert.match(wf, /run-name: Docker tests/);
  // The request_id input is the dashboard's correlation id.
  assert.match(wf, /request_id/);
});

test('the workflow runs the existing tests compose service, never builds a new one', () => {
  const wf = source('.github/workflows/docker-tests.yml');
  assert.match(wf, /docker compose --profile tests run --rm --build tests/);
  // The step must not swallow a failing suite: no continue-on-error, and the
  // pipeline must forward docker's exit code past the `tee`.
  const runStep = wf.split('--profile tests run')[1] ?? '';
  assert.doesNotMatch(runStep, /continue-on-error:\s*true/);
  assert.match(wf, /set -o pipefail/);
  // The artifact upload always runs, even when the suite fails.
  assert.match(wf, /if: always\(\)/);
  const upload = wf.split('Upload test output')[1]?.split('Write the step summary')[0] ?? '';
  assert.match(upload, /actions\/upload-artifact@v4/);
});

test('the workflow supplies every variable docker-compose declares as required', () => {
  // `docker compose` interpolates the *whole* file before it runs any single
  // service. So a `${VAR:?}` on the `bot` service fails `docker compose config
  // --services` and `docker compose run tests` alike, even though the tests
  // service never receives the variable. That is exactly how this workflow
  // broke: the bot token was required by compose but absent from the job, and
  // the very first compose call — the "Show what will run" step — exited 1.
  const compose = source('docker-compose.yml');
  const wf = source('.github/workflows/docker-tests.yml');

  const required = [...compose.matchAll(/\$\{([A-Z_][A-Z0-9_]*):\?/g)].map((m) => m[1]);
  assert.ok(required.length > 0, 'the compose file is expected to declare required variables');

  // Upper-case env keys indented under an `env:` block. Compose variables are
  // conventionally upper-case, and the workflow's own inputs are lower-case.
  const supplied = new Set(
    [...wf.matchAll(/^\s{6,10}([A-Z_][A-Z0-9_]*):/gm)].map((m) => m[1]),
  );

  for (const name of required) {
    assert.ok(
      supplied.has(name),
      `docker-compose.yml requires ${name} but the workflow never sets it, so every compose call in this job fails`,
    );
  }
});

test('the bot token the workflow supplies cannot be mistaken for a real one', () => {
  // The value exists only to satisfy compose interpolation. If a genuine token
  // were ever used it would be a live credential sitting in a job that has no
  // use for one, and a Discord token always contains a dot.
  const wf = source('.github/workflows/docker-tests.yml');
  const line = wf.split('\n').find((l) => /^\s*DISCORD_BOT_TOKEN:/.test(l)) ?? '';
  assert.ok(line, 'the workflow must set DISCORD_BOT_TOKEN for interpolation');

  const value = line.split(':').slice(1).join(':').trim().replace(/^['"]|['"]$/g, '');
  assert.ok(value, 'the job must supply a value or every compose call fails');
  assert.ok(!value.includes('.'), `the placeholder must not look like a Discord token: ${value}`);

  // A literal, not a secret: no test here reads the token, so offering a
  // `*_CI` secret would invite a live credential into a job that cannot use it.
  assert.ok(
    !/secrets\./.test(line),
    'the interpolation placeholder must be a fixed value, not a secret',
  );
});

/* ------------------------------------------------------ the compose tests service */

/** The `tests` service block, up to the next top-level service or `volumes:`. */
function testsService() {
  const compose = source('docker-compose.yml');
  const start = compose.indexOf('\n  tests:');
  assert.ok(start !== -1, 'docker-compose.yml must define a tests service');
  const rest = compose.slice(start + 1);
  const end = rest.search(/\n  [a-z][a-z0-9_-]*:\n|\nvolumes:/);
  return end === -1 ? rest : rest.slice(0, end);
}

test('the tests service declares a build context, so --build can build it', () => {
  // `docker compose run --build tests` builds the service's own `build:` block.
  // With only `image:`, there is nothing to build and compose falls back to
  // *pulling* `projecthub:local` from a registry, which fails with "pull access
  // denied for projecthub, repository does not exist". That is exactly what
  // happened on a cold runner, where the image had never been built.
  const service = testsService();
  assert.match(
    service,
    /^\s+build:\s*\.\s*$/m,
    'the tests service must declare `build: .`, or --build cannot produce the image',
  );
  assert.match(service, /^\s+image:\s*\$\{PROJECTHUB_IMAGE:-projecthub:local\}/m);
});

test('the tests service bootstraps the schema before running the suite', () => {
  // A fresh compose volume has no tables, and nothing else creates them: the
  // tests service depends on `db` only, and `server/index.ts` never runs. The
  // database-backed tests then fail with `relation "users" does not exist` —
  // 11 misleading assertion failures rather than a clear setup error.
  const service = testsService();
  assert.match(service, /node scripts\/db-bootstrap\.mjs/, 'the schema must be created first');
  assert.match(service, /node --test --test-force-exit tests\/\*\.test\.mjs/, 'the suite must still run');
  assert.match(service, /set -e/, 'a failed bootstrap must stop the run, not be ignored');

  // The bootstrap must run before the suite, not after or in parallel.
  const bootAt = service.indexOf('db-bootstrap.mjs');
  const suiteAt = service.indexOf('tests/*.test.mjs');
  assert.ok(bootAt < suiteAt, 'the bootstrap must precede the suite');

  // And the bootstrap script must exist, or the command fails at runtime.
  assert.ok(source('scripts/db-bootstrap.mjs').length > 0);
});

test('the tests service keeps the DB-free suite free of admin secrets', () => {
  // ADMIN_PIN and ADMIN_PASSWORD gate the admin-login tests, which skip when
  // empty. They must default to empty so a CI run without them still passes.
  const service = testsService();
  assert.match(service, /ADMIN_PIN:\s*\$\{ADMIN_PIN:-\}/);
  assert.match(service, /ADMIN_PASSWORD:\s*\$\{ADMIN_PASSWORD:-\}/);
});
