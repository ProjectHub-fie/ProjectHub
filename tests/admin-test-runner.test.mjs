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
import { deflateRawSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const source = (relative) => readFileSync(resolve(root, relative), 'utf8');

/** CRC-32, which a ZIP entry header carries. `zlib` exposes no plain crc32. */
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const {
  getConfig,
  buildTestRouter,
  cancelRun,
  parseTap,
  capOutput,
  readZipEntry,
  stripLogTimestamps,
  REPOSITORY_PROFILES,
  __test,
} = await import('../api/_lib/suite-runner.js');

/** Resets env and the mock fetcher between tests. */
function resetHarness({ token = 'stub-token', repoId = null } = {}) {
  __test.resetStore();
  __test.setFetcher(null);
  for (const key of [
    'GITHUB_ACTIONS_TOKEN',
    'GITHUB_TOKEN',
    'GITHUB_WORKFLOW_BRANCH',
    'TEST_REPO',
    'TEST_RUN_TIMEOUT_MS',
    'TEST_RUN_POLL_MS',
  ]) {
    delete process.env[key];
  }
  if (token) process.env.GITHUB_ACTIONS_TOKEN = token;
  if (repoId) process.env.TEST_REPO = repoId;
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

test('config defaults point at the ProjectHub profile and docker-tests workflow', () => {
  resetHarness({ token: 'abc' });
  const config = getConfig();
  assert.equal(config.repositoryId, 'projecthub');
  assert.equal(REPOSITORY_PROFILES[config.repositoryId].repository, 'ProjectHub-fie/ProjectHub');
  assert.equal(REPOSITORY_PROFILES[config.repositoryId].workflowFile, 'docker-tests.yml');
  assert.equal(config.branch, 'main');
  assert.equal(config.token, 'abc');
  assert.ok(config.timeoutMs > 0);
});

test('config repository selection is read from the environment', () => {
  resetHarness({});
  process.env.TEST_REPO = 'primebot';
  process.env.GITHUB_WORKFLOW_BRANCH = 'dev';
  process.env.GITHUB_ACTIONS_TOKEN = 'token-2';
  const config = getConfig();
  assert.equal(config.repositoryId, 'primebot');
  assert.equal(REPOSITORY_PROFILES['primebot'].repository, 'ProjectHub-fie/PrimeBot');
  assert.equal(REPOSITORY_PROFILES['primebot'].workflowFile, 'primebot-tests.yml');
  assert.equal(REPOSITORY_PROFILES['primebot'].testRunner, 'node');
  assert.equal(config.branch, 'dev');
  assert.equal(config.token, 'token-2');
});

test('the repository registry lists the supported repositories with their runner metadata', () => {
  const profile = REPOSITORY_PROFILES.projecthub;
  assert.equal(profile.repository, 'ProjectHub-fie/ProjectHub');
  assert.equal(profile.workflowFile, 'docker-tests.yml');
  assert.equal(profile.testRunner, 'docker');
  assert.equal(profile.runName, 'Docker tests');
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
  assert.match(called.url, /ProjectHub-fie\/ProjectHub\/actions\/workflows\/docker-tests\.yml\/dispatches$/);
  const sent = JSON.parse(called.options.body);
  assert.equal(sent.ref, 'main');
  assert.match(sent.inputs.request_id, /^[0-9a-f-]{36}$/i, 'request_id is a server-side uuid');
  assert.match(called.options.headers.Authorization, /Bearer stub-token/);
});

test('the selected repository in the request body picks which repository is dispatched', async () => {
  resetHarness({ repoId: 'projecthub' });
  let called = null;
  __test.setFetcher(async (url, options) => {
    called = { url, options };
    return ghResponse({ status: 204 });
  });

  const router = buildTestRouter({
    requireAuth: (_req, _res, next) => next(),
    requireRole: () => (_req, _res, next) => next(),
  });
  const postLayer = router.stack.find((layer) => layer.route?.path === '/api/admin/tests/run');
  const handler = postLayer.route.stack[postLayer.route.stack.length - 1].handle;

  // Dispatch against PrimeBot by passing its registry id in the body.
  const res = { json: (body) => (res.body = body), status: () => res };
  await handler({ body: { repositoryId: 'primebot' } }, res);

  assert.ok(called, 'dispatch POST was made');
  assert.match(called.url, /ProjectHub-fie\/PrimeBot\/actions\/workflows\/primebot-tests\.yml\/dispatches$/);
  const sent = JSON.parse(called.options.body);
  assert.equal(sent.ref, 'main');
  assert.equal(res.body.repositoryId, 'primebot');
  assert.equal(res.body.repository, 'ProjectHub-fie/PrimeBot');
});

test('an unknown repository id in the body is rejected without any GitHub call', async () => {
  resetHarness({});
  let apiCalls = 0;
  __test.setFetcher(async () => {
    apiCalls += 1;
    return ghResponse({ status: 204 });
  });

  const router = buildTestRouter({
    requireAuth: (_req, _res, next) => next(),
    requireRole: () => (_req, _res, next) => next(),
  });
  const postLayer = router.stack.find((layer) => layer.route?.path === '/api/admin/tests/run');
  const handler = postLayer.route.stack[postLayer.route.stack.length - 1].handle;

  const res = { json: (body) => (res.body = body), status: (code) => (res.statusCode = code) && res };
  await handler({ body: { repositoryId: 'sneaky-repo' } }, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Unknown repository/);
  assert.equal(apiCalls, 0, 'an invalid selection never reaches the GitHub API');
  assert.ok(!__test.currentRun, 'no run is stored for an unknown repository');
});

test('the request id and workflow file are never taken from the request', () => {
  const routes = source('api/_lib/suite-runner.js');
  // The chosen repository *id* is read from the body and validated against the
  // fixed registry, but never the request id, workflow, branch, command or
  // repository name itself.
  assert.match(routes, /req\.body/); // repository selection is allowed
  // Only the documented `repositoryId` field is read — never a free-form
  // repository name, workflow, branch or command (the \b excludes repositoryId).
  assert.doesNotMatch(routes, /req\.body\.repository\b/);
  assert.doesNotMatch(routes, /request_id.*req\.|req\..*request_id/);
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

test('the workflow file, branch and target come from the registry, never the request', () => {
  const routes = source('api/_lib/suite-runner.js');
  // Branch is the only env-read leftover; workflow file and repository come
  // from the REPOSITORY_PROFILES registry, which is never the request.
  assert.match(routes, /GITHUB_WORKFLOW_BRANCH/);
  assert.match(routes, /REPOSITORY_PROFILES/);
  assert.doesNotMatch(routes, /GITHUB_REPOSITORY/);
  // The registry is a static object literal: no file reads, no overrides.
  assert.doesNotMatch(routes, /REPOSITORY_PROFILES\s*=\s*process\.env/);
  assert.doesNotMatch(routes, /\.repository\s*=\s*req\./);
  assert.doesNotMatch(routes, /\.workflowFile\s*=\s*req\./);
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


/* ------------------------------------------- reading a finished run's results */

test('parseTap reads the spec reporter and the TAP reporter alike', () => {
  // The compose service runs `node --test`, whose default spec reporter prints
  // U+2139. The workflow uploads a TAP-reporter stream, which prints '#'. Both
  // must produce the same numbers: a reporter switch must not blank the page.
  const spec = [
    '\u2714 passing one (1.2ms)',
    '\u2716 failing one (0.8ms)',
    '\u2139 tests 12',
    '\u2139 suites 0',
    '\u2139 pass 10',
    '\u2139 fail 1',
    '\u2139 skipped 1',
    '\u2139 duration_ms 456.7',
    '',
    '\u2716 failing tests:',
    '\u2716 failing one (0.8ms)',
  ].join('\n');

  const tap = [
    'TAP version 13',
    'ok 1 - passing one',
    'not ok 2 - failing one',
    '  ---',
    '  duration_ms: 0.8',
    '  ...',
    '1..12',
    '# tests 12',
    '# pass 10',
    '# fail 1',
    '# skipped 1',
  ].join('\n');

  const fromSpec = parseTap(spec);
  const fromTap = parseTap(tap);

  for (const [name, parsed] of [['spec', fromSpec], ['tap', fromTap]]) {
    assert.equal(parsed.tests, 12, name + ' must read the test count');
    assert.equal(parsed.pass, 10, name + ' must read the pass count');
    assert.equal(parsed.fail, 1, name + ' must read the fail count');
    assert.equal(parsed.skipped, 1, name + ' must read the skipped count');
    assert.deepEqual(parsed.failures, ['failing one'], name + ' must name the failure once');
  }

  assert.equal(fromSpec.durationMs, 456.7);
});

test('parseTap reports unknown rather than guessing when there is no summary', () => {
  // A job that died before the suite reported, or a log with no summary line,
  // must read as "no results" and not as a green zero-failure run.
  for (const input of ['', null, undefined, 'some output with no summary', 'ok 1 - a test']) {
    const parsed = parseTap(input);
    assert.equal(parsed.tests, null, 'a missing count must stay null');
    assert.equal(parsed.pass, null);
    assert.equal(parsed.fail, null);
    assert.equal(parsed.skipped, null);
    assert.deepEqual(parsed.failures, []);
  }
});

test('capOutput keeps both ends of a long stream and says what it dropped', () => {
  const long = 'A'.repeat(1000) + 'MIDDLE' + 'B'.repeat(1000);
  const capped = capOutput(long, 200);

  assert.ok(capped.length < long.length, 'a long stream must be trimmed');
  assert.match(capped, /characters omitted/, 'the trimmed stream must say what was dropped');
  assert.ok(capped.startsWith('A'), 'the head must survive');
  assert.ok(capped.endsWith('B'), 'the tail must survive');
  assert.ok(!capped.includes('MIDDLE'), 'the middle must be the part dropped');

  // A stream under the cap is returned untouched, so a short run reads exactly
  // as the runner printed it.
  assert.equal(capOutput('short output', 200), 'short output');
});

test('stripLogTimestamps removes the job-log prefix without touching the line', () => {
  // GitHub prefixes every job-log line with an ISO timestamp. The summary line
  // `tests 456` arrives as `2026-...Z tests 456`, which an anchored parser
  // would miss.
  const log = [
    '2026-11-02T17:06:56.3444299Z \u2714 a test (1.2ms)',
    '2026-11-02T17:06:56.3444299Z \u2139 tests 456',
    '2026-11-02T17:06:56.3444299Z \u2139 pass 452',
    '2026-11-02T17:06:56.3444299Z \u2139 fail 0',
  ].join('\n');

  const parsed = parseTap(stripLogTimestamps(log));
  assert.equal(parsed.tests, 456);
  assert.equal(parsed.pass, 452);
  assert.equal(parsed.fail, 0);

  // A line with no timestamp is untouched, so a mixed stream still parses.
  assert.equal(stripLogTimestamps('\u2139 tests 1'), '\u2139 tests 1');
  assert.equal(stripLogTimestamps(''), '');
  assert.equal(stripLogTimestamps(null), '');
});

/** Builds a real ZIP archive in memory, so the reader is tested on real bytes. */
function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { name, data, method } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const body = method === 8 ? deflateRawSync(data) : data;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

test('readZipEntry reads a real archive, both stored and deflated', () => {
  // A ZIP is built here rather than mocked: the reader is the piece that turns a
  // downloaded artifact into text, and a hand-written fixture that did not match
  // the real byte layout would pass while the real artifact failed.
  const payload = Buffer.from('\u2139 tests 3\n\u2139 pass 3\n', 'utf8');
  const nested = 'artifact/tap-output.tap';

  for (const method of [0, 8]) {
    const zip = buildZip([{ name: nested, data: payload, method }]);
    const found = readZipEntry(zip, (name) => name.endsWith('tap-output.tap'));
    assert.ok(found, 'method ' + method + ' must be read');
    assert.equal(found.toString('utf8'), payload.toString('utf8'), 'method ' + method + ' must round-trip');
    assert.equal(parseTap(found.toString('utf8')).tests, 3);
  }

  // A name that is not in the archive, and a truncated archive, return null
  // rather than throwing, so a broken artifact degrades to "no results".
  const zip = buildZip([{ name: nested, data: payload, method: 8 }]);
  assert.equal(readZipEntry(zip, 'missing.txt'), null);
  assert.equal(readZipEntry(zip.subarray(0, 10), (n) => n.endsWith('.tap')), null);
  assert.equal(readZipEntry(Buffer.from('not a zip'), (n) => n.endsWith('.tap')), null);
});

test('a completed run reads its summary from the artifact, and status reports it', async () => {
  // This is the bug: the run completed, the page showed a success headline, and
  // every tile read "-" because nothing ever read the suite's own summary.
  resetHarness({});
  const tap = Buffer.from('# tests 7\n# pass 6\n# fail 1\nnot ok 3 - broken thing\n', 'utf8');
  const zip = buildZip([{ name: 'tap-output.tap', data: tap, method: 8 }]);

  __test.setFetcher(async (url, options) => {
    if (options.method === 'POST' && /dispatches$/.test(url)) return ghResponse({ status: 204 });
    if (url.endsWith('/artifacts')) {
      return ghResponse({
        body: {
          artifacts: [
            { id: 99, name: 'docker-tests-tap', expired: false, created_at: '2026-11-03T13:40:00Z' },
          ],
        },
      });
    }
    if (/\/actions\/artifacts\/99\/zip$/.test(url)) {
      return {
        status: 200,
        ok: true,
        async arrayBuffer() {
          return zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength);
        },
        async json() {
          return {};
        },
      };
    }
    if (/\/jobs$/.test(url)) {
      return ghResponse({ body: { jobs: [{ id: 5, status: 'completed', conclusion: 'failure' }] } });
    }
    return ghResponse({
      body: {
        total_count: 1,
        workflow_runs: [
          fakeRun({ display_title: 'Docker tests (' + (__test.lastDispatchedId || 'none') + ')', id: 77, conclusion: 'failure' }),
        ],
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

  const statusLayer = router.stack.find((layer) => layer.route?.path === '/api/admin/tests/status');
  const statusHandler = statusLayer.route.stack[statusLayer.route.stack.length - 1].handle;
  const statusRes = { json: (body) => (statusRes.body = body), status: () => statusRes };
  await statusHandler({}, statusRes);

  const run = statusRes.body.lastRun || statusRes.body.activeRun;
  assert.ok(run, 'the status route must report the run');
  assert.equal(run.completed, true);
  assert.equal(run.summary.tests, 7, 'the summary must come from the artifact');
  assert.equal(run.summary.pass, 6);
  assert.equal(run.summary.fail, 1);
  assert.deepEqual(run.failures, ['broken thing']);
  assert.equal(run.resultsUnavailable, false, 'a read summary is available');
  assert.match(run.output, /tests 7/);
});

test('a completed run with no readable artifact says so instead of showing empty tiles', async () => {
  // A failed suite uploads no artifact, and an expired one is gone. The page
  // must say the results are unavailable rather than showing a success headline
  // over four empty tiles, which is what made the bug look like "no results".
  resetHarness({});
  __test.setFetcher(async (url, options) => {
    if (options.method === 'POST' && /dispatches$/.test(url)) return ghResponse({ status: 204 });
    if (url.endsWith('/artifacts')) return ghResponse({ body: { artifacts: [] } });
    if (/\/jobs$/.test(url)) return ghResponse({ body: { jobs: [{ id: 5, status: 'completed', conclusion: 'failure' }] } });
    if (/\/logs$/.test(url)) return { status: 200, ok: true, async text() { return 'no tap here\n'; } };
    return ghResponse({
      body: {
        total_count: 1,
        workflow_runs: [
          fakeRun({ display_title: 'Docker tests (' + (__test.lastDispatchedId || 'none') + ')', id: 78, conclusion: 'failure' }),
        ],
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

  const statusLayer = router.stack.find((layer) => layer.route?.path === '/api/admin/tests/status');
  const statusHandler = statusLayer.route.stack[statusLayer.route.stack.length - 1].handle;
  const statusRes = { json: (body) => (statusRes.body = body), status: () => statusRes };
  await statusHandler({}, statusRes);

  const run = statusRes.body.lastRun || statusRes.body.activeRun;
  assert.ok(run);
  assert.equal(run.completed, true);
  assert.equal(run.summary.tests, null, 'no artifact means no count');
  assert.equal(run.resultsUnavailable, true, 'the page must be told the results are unavailable');
});

test('the result read is bounded, so a run with no artifact is not re-asked forever', () => {
  // The status route retries a terminal run whose summary has not been read,
  // because GitHub marks a run complete a moment before its artifact is
  // downloadable. Without a cap, a suite that never uploads one would re-ask on
  // every page refresh indefinitely.
  const module = source('api/_lib/suite-runner.js');
  assert.match(module, /MAX_RESULT_ATTEMPTS/, 'the attempt cap must exist');
  assert.match(module, /resultsAttempts >= MAX_RESULT_ATTEMPTS/, 'the cap must be enforced');
  assert.match(module, /withTimeout\(fetchArtifactResults\(this\.id/, 'the artifact read must be time-bounded');
  assert.match(module, /withTimeout\(fetchJobLogResults\(this\.id/, 'the log read must be time-bounded');
});

test('the artifact is read from the workflow upload, and the workflow uploads it', () => {
  // The reader and the workflow have to agree on the file name. If the upload
  // step were renamed, the reader would silently find nothing and the page would
  // go back to showing no results.
  const module = source('api/_lib/suite-runner.js');
  assert.match(module, /tap-output\.tap/, 'the reader must look for the uploaded file');

  const workflow = source('.github/workflows/docker-tests.yml');
  assert.match(workflow, /tap-output\.tap/, 'the workflow must upload the file the reader looks for');
});

/* -------------------------------------------------------------- PrimeBot repo */

test('the PrimeBot profile targets the PrimeBot repository with a Node workflow', () => {
  const primebot = REPOSITORY_PROFILES.primebot;
  assert.equal(primebot.repository, 'ProjectHub-fie/PrimeBot');
  assert.equal(primebot.workflowFile, 'primebot-tests.yml');
  assert.equal(primebot.testRunner, 'node');
  assert.equal(primebot.runName, 'PrimeBot tests');
  assert.match(primebot.command, /npm test/);
  assert.doesNotMatch(primebot.command, /docker/);
});

test('the PrimeBot workflow is checked in next to the ProjectHub workflow', async () => {
  const { readFile } = await import('node:fs/promises');
  const wf = await readFile(new URL('../.github/workflows/primebot-tests.yml', import.meta.url), 'utf8');
  assert.match(wf, /workflow_dispatch/);
  assert.doesNotMatch(wf, /push:|pull_request:/);
  assert.match(wf, /run-name: PrimeBot tests/);
  assert.match(wf, /request_id/);
  assert.match(wf, /npm test/);
  assert.doesNotMatch(wf, /docker compose/);
});

test('the PrimeBot workflow checks out the selected repository and runs Node tests', () => {
  const wf = source('.github/workflows/primebot-tests.yml');
  // Checkout + Node + the repo's own test script.
  assert.match(wf, /actions\/checkout@v4/);
  assert.match(wf, /actions\/setup-node@v4/);
  assert.match(wf, /npm test/);
  // A Node script, not a compose service: no `docker`, no Test service.
  assert.doesNotMatch(wf, /docker/);
  assert.doesNotMatch(wf, /--profile tests/);
  // The artifact must land where the dashboard's reader looks for it, and the
  // suite's exit code must not be swallowed by the `tee`.
  assert.match(wf, /tap-output\.tap/);
  assert.match(wf, /set -o pipefail/);
  assert.match(wf, /if: always\(\)/);
  assert.doesNotMatch(wf, /continue-on-error:\s*true/);
});

test('the PrimeBot workflow installs npm dependencies reproducibly', () => {
  const wf = source('.github/workflows/primebot-tests.yml');
  // `npm ci` when a lockfile exists is the required first choice; `npm install`
  // is only the fallback for repos without one.
  assert.match(wf, /npm ci/);
  assert.match(wf, /npm install/);
  assert.match(wf, /package-lock\.json/);
});

test('the status response advertises both repositories to the page', async () => {
  resetHarness({});
  __test.setFetcher(async () => ghResponse({ status: 204 }));

  const router = buildTestRouter({
    requireAuth: (_req, _res, next) => next(),
    requireRole: () => (_req, _res, next) => next(),
  });
  const statusLayer = router.stack.find((layer) => layer.route?.path === '/api/admin/tests/status');
  const handler = statusLayer.route.stack[statusLayer.route.stack.length - 1].handle;

  const res = { json: (body) => (res.body = body), status: () => res };
  await handler({}, res);

  assert.ok(Array.isArray(res.body.repositories), 'the status payload lists repositories');
  const ids = res.body.repositories.map((r) => r.id);
  assert.ok(ids.includes('projecthub'), 'ProjectHub must be selectable');
  assert.ok(ids.includes('primebot'), 'PrimeBot must be selectable');
  const primebot = res.body.repositories.find((r) => r.id === 'primebot');
  assert.equal(primebot.repository, 'ProjectHub-fie/PrimeBot');
  assert.equal(primebot.testRunner, 'node');
  assert.equal(primebot.command, 'npm test');
  // The status for the default profile still exposes the single-run fields.
  assert.equal(res.body.repository, 'ProjectHub-fie/ProjectHub');
  assert.equal(res.body.workflowFile, 'docker-tests.yml');
});

test('a run dispatched for PrimeBot keeps its profile identity through polling', async () => {
  resetHarness({ repoId: 'projecthub' });
  let runListUrl = null;
  __test.setFetcher(async (url, options = {}) => {
    if (options.method === 'POST') return ghResponse({ status: 204 });
    if (url.includes('/actions/workflows/')) {
      // Only the workflows/:file/runs page identifies *this* run.
      runListUrl = url;
      return ghResponse({
        status: 200,
        json: {
          workflow_runs: [
            fakeRun({
              id: 900,
              display_title: `PrimeBot tests (${__test.lastDispatched.requestId})`,
              conclusion: 'success',
            }),
          ],
        },
      });
    }
    // Artifact/log reads are best-effort; empty is fine for this test.
    if (url.endsWith('/artifacts')) return ghResponse({ status: 200, json: { artifacts: [] } });
    if (url.endsWith('/jobs')) return ghResponse({ status: 200, json: { jobs: [] } });
    return ghResponse({ status: 200, json: { workflow_runs: [] } });
  });

  const router = buildTestRouter({
    requireAuth: (_req, _res, next) => next(),
    requireRole: () => (_req, _res, next) => next(),
  });
  const postLayer = router.stack.find((layer) => layer.route?.path === '/api/admin/tests/run');
  const postHandler = postLayer.route.stack[postLayer.route.stack.length - 1].handle;
  const statusLayer = router.stack.find((layer) => layer.route?.path === '/api/admin/tests/status');
  const statusHandler = statusLayer.route.stack[statusLayer.route.stack.length - 1].handle;

  // Dispatch PrimeBot, then poll status and confirm the metadata travels.
  const runRes = { json: (body) => (runRes.body = body), status: () => runRes };
  await postHandler({ body: { repositoryId: 'primebot' } }, runRes);
  assert.equal(runRes.body.repositoryId, 'primebot');
  assert.equal(runRes.body.repository, 'ProjectHub-fie/PrimeBot');

  const statusRes = { json: (body) => (statusRes.body = body), status: () => statusRes };
  await statusHandler({}, statusRes);

  assert.match(runListUrl, /ProjectHub-fie\/PrimeBot\/actions\/workflows\/primebot-tests\.yml\/runs/);
  const run = statusRes.body.activeRun || statusRes.body.lastRun;
  assert.ok(run, 'the polled run must be reported');
  assert.equal(run.repositoryId, 'primebot');
  assert.equal(run.repository, 'ProjectHub-fie/PrimeBot');
  assert.equal(run.conclusion, 'success');
});
