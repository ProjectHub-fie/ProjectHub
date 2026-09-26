/**
 * Admin route that runs the repository's test folder.
 *
 * ## Why this is locked down
 *
 * This is the only endpoint in the codebase that starts a process on the server,
 * so it is deliberately incapable of running anything but one fixed command:
 *
 *   - The binary is `process.execPath` and the argument list is a literal built
 *     here. No request field reaches the command — there is no path, no glob, no
 *     argument and no filter accepted from the client.
 *   - `spawn` is called with `shell: false`, so even a crafted value could not
 *     introduce a pipeline or a redirect. Shell metacharacters have no meaning
 *     when there is no shell.
 *   - Access is owner-only. An admin can already configure the bot and mail, but
 *     executing code on the host is a different class of action, so it is held to
 *     the tighter role the admin-management routes use.
 *
 * ## Where it works
 *
 * `tests/` is listed in `.vercelignore`, so it is not deployed to the serverless
 * function and spawning `node --test tests/` there cannot work. Rather than
 * failing with a confusing spawn error, the runner has two ways to reach the
 * suite:
 *
 *   - **Local** — the folder is present (an ordinary long-lived host, a Docker
 *     deployment, or local development) and the child runs in this process's
 *     own image.
 *   - **Docker** — the folder is absent, but a Docker image built from this
 *     repository carries it. The suite is run with `docker run` against that
 *     image, so a host that only runs the serverless function can still exercise
 *     the real tests. The image is built from the repository on first use, or is
 *     the one `docker compose` already made (`projecthub:local`).
 *
 * One run at a time: a module-level promise refuses a second concurrent run, so a
 * held-down button cannot start a process per click.
 */
import express from 'express';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
/** Repo root: this file lives at <root>/api/_lib/. */
const ROOT = resolve(here, '..', '..');
const TESTS_DIR = resolve(ROOT, 'tests');

/** A runaway suite must not hold a worker forever. */
const TIMEOUT_MS = Number(process.env.TEST_RUN_TIMEOUT_MS || 120_000);
/** Output is returned to the browser, so it is capped rather than buffered whole. */
const MAX_OUTPUT_CHARS = 60_000;

/**
 * The image the Docker path runs, and how it is reached.
 *
 * `TEST_RUNNER_IMAGE` names an image that already carries the repository (the
 * one `docker compose` builds is `projecthub:local`). When it is unset, `docker
 * compose`'s image is used; if that is not present either, the runner builds a
 * dedicated `projecthub-tests:local` from the checked-out repository.
 *
 * `TEST_RUNNER_NETWORK` is the Docker network the suite container joins. On a
 * `docker compose` host that is the compose network, so a `db` service is
 * reachable by name — the same place `DATABASE_URL` already points from the app.
 */
const DEFAULT_IMAGE = process.env.TEST_RUNNER_IMAGE || 'projecthub:local';
const BUILD_IMAGE = 'projecthub-tests:local';

/**
 * Environment variables passed through to the suite container.
 *
 * `-e NAME` (no value) copies the variable from the daemon process's own
 * environment, so a secret such as `DATABASE_URL` reaches the container without
 * ever appearing in the argument list that `ps` can read.
 */
const PASSTHROUGH_ENV = [
  'DATABASE_URL',
  'MAIL_DATABASE_URL',
  'SESSION_SECRET',
  'ADMIN_PIN',
  'ADMIN_PASSWORD',
  'VITE_TURNSTILE_SITE_KEY',
  'TURNSTILE_SECRET_KEY',
];

/** Whether a target names the whole suite folder rather than one file. */
function isTestsDir(target) {
  return target === TESTS_DIR || /(^|[\\/])tests[\\/]?$/.test(target);
}

/**
 * The one command this endpoint can run. Fixed, never assembled from input.
 *
 * Node 24 rejects a bare directory as a test target — it tries to import it as a
 * module and dies with "Cannot find module /app/tests". It wants files or a
 * glob, so the folder becomes `tests/*.test.mjs`, the same set `npm test` runs.
 * A single-file target is the test-side seam and passes through untouched.
 */
function testArgs(target = TESTS_DIR) {
  const spec = isTestsDir(target) ? 'tests/*.test.mjs' : target;
  return ['--test', '--test-force-exit', '--test-reporter=tap', spec];
}


/** A single in-flight run, so repeated clicks do not spawn concurrent suites. */
let inFlight = null;

/**
 * Parses the TAP summary the Node test runner emits.
 *
 * The reporter prints `# tests N`, `# pass N`, `# fail N`, `# skipped N` and
 * `# duration_ms N`, plus one `not ok N - name` line per failure. Anything the
 * pattern does not match is treated as unavailable rather than guessed at, so a
 * reporter change shows up as "unknown" instead of a wrong number.
 */
export function parseTap(output) {
  const summary = {};
  for (const [, key, value] of output.matchAll(/^# (tests|pass|fail|skipped|todo|cancelled|duration_ms)\s+([\d.]+)/gm)) {
    summary[key] = Number(value);
  }

  const failures = [];
  for (const [, name] of output.matchAll(/^\s*not ok \d+ - (.*)$/gm)) {
    failures.push(name.trim());
  }

  return {
    tests: summary.tests ?? null,
    pass: summary.pass ?? null,
    fail: summary.fail ?? null,
    skipped: summary.skipped ?? null,
    durationMs: summary.duration_ms ?? null,
    failures,
  };
}

/** Trims the middle out of over-long output, keeping both ends readable. */
export function capOutput(text, max = MAX_OUTPUT_CHARS) {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.6);
  const tail = max - head;
  return `${text.slice(0, head)}\n\n… ${text.length - max} characters omitted …\n\n${text.slice(-tail)}`;
}

/**
 * The environment for the child process.
 *
 * The Node test runner sets `NODE_TEST_CONTEXT`/`NODE_TEST_WORKER_ID` in the
 * process it runs tests in. Those are inherited by a spawned child, and a nested
 * runner that sees them attaches to the *parent's* test protocol instead of
 * reporting its own TAP — which is what happens when this endpoint is exercised
 * from a test. They are dropped so the child is always an independent run.
 */
function childEnv() {
  const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_TEST_WORKER_ID;
  return env;
}

/**
 * Whether a usable Docker daemon is reachable.
 *
 * Probed once and cached: the answer cannot change while the function instance
 * is warm, and `docker version` costs a process spawn. `TEST_RUNNER_DOCKER=0`
 * disables the path outright, which is how an operator says "this host has no
 * Docker, do not even try".
 */
let dockerChecked = null;
export function dockerAvailable() {
  if (process.env.TEST_RUNNER_DOCKER === '0') return false;
  if (dockerChecked !== null) return dockerChecked;
  try {
    const probe = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
      encoding: 'utf8',
      timeout: 5_000,
    });
    dockerChecked = probe.status === 0;
  } catch {
    dockerChecked = false;
  }
  return dockerChecked;
}

/** Whether an image already exists locally, so a build can be skipped. */
function imagePresent(image) {
  const probe = spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore', timeout: 15_000 });
  return probe.status === 0;
}

/**
 * `docker run` arguments for the suite.
 *
 * The command inside the container is the same literal the local path uses, and
 * the image is chosen from the environment or the known local tags — never from
 * a request. Secrets are passed as `-e NAME` with no value, which copies them
 * from this process's environment so they do not appear in the argument list.
 */
export function dockerRunArgs(image, target = 'tests/') {
  const args = ['run', '--rm'];
  const network = process.env.TEST_RUNNER_NETWORK;
  if (network) args.push('--network', network);
  for (const name of PASSTHROUGH_ENV) {
    if (process.env[name] != null) args.push('-e', name);
  }
  const spec = isTestsDir(target) ? 'tests/*.test.mjs' : target;
  args.push(image, 'node', '--test', '--test-force-exit', '--test-reporter=tap', spec);
  return args;
}

/**
 * Finds an image that carries the repository, building one if needed.
 *
 * Preference order: `TEST_RUNNER_IMAGE`, then the compose image
 * (`projecthub:local`), then a build of the dedicated `projecthub-tests:local`.
 * A build shells out to `docker build` against the checked-out repository, so it
 * only makes sense where the Dockerfile and `tests/` are both on disk; elsewhere
 * an operator sets `TEST_RUNNER_IMAGE` to an image that already has them.
 */
async function ensureDockerImage() {
  const candidates = [DEFAULT_IMAGE, BUILD_IMAGE];
  for (const image of candidates) {
    if (image && imagePresent(image)) return image;
  }

  const dockerfile = resolve(ROOT, 'Dockerfile');
  if (!existsSync(dockerfile)) {
    return null;
  }

  const built = await new Promise((resolveBuild) => {
    const child = spawn('docker', ['build', '-t', BUILD_IMAGE, ROOT], {
      cwd: ROOT,
      shell: false,
      env: childEnv(),
    });
    // A build's chatter is not the suite's output; drop it and let a failure show
    // up as "could not prepare the image" with the exit code.
    child.stdout.resume();
    child.stderr.resume();
    child.on('error', () => resolveBuild(false));
    child.on('close', (code) => resolveBuild(code === 0));
  });

  return built ? BUILD_IMAGE : null;
}

function testsNotDeployedError() {
  const error = new Error(
    'The tests/ directory is not present in this deployment and Docker is not available to run it. ' +
      'Deploy with the provided Dockerfile / docker-compose.yml (which include tests/), ' +
      'or set TEST_RUNNER_IMAGE to an image built from this repository.',
  );
  error.code = 'tests_not_deployed';
  return error;
}

/**
 * Spawns one process and resolves a result, or throws with a readable reason.
 *
 * `binary`/`args` come from this module only. `shell: false` means even a
 * crafted argument could not be reinterpreted as a command line.
 */
function runChild(binary, args, { timeoutMs }) {
  return new Promise((resolveRun, rejectRun) => {
    const startedAt = Date.now();
    const child = spawn(binary, args, {
      cwd: ROOT,
      // No shell: the argument list cannot be reinterpreted as a command line.
      shell: false,
      env: childEnv(),
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout.on('data', (chunk) => {
      if (stdout.length < MAX_OUTPUT_CHARS * 2) stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < MAX_OUTPUT_CHARS * 2) stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      rejectRun(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const parsed = parseTap(stdout);
      resolveRun({
        ok: code === 0 && !timedOut,
        exitCode: code,
        timedOut,
        durationMs: parsed.durationMs ?? Date.now() - startedAt,
        summary: {
          tests: parsed.tests,
          pass: parsed.pass,
          fail: parsed.fail,
          skipped: parsed.skipped,
        },
        failures: parsed.failures,
        output: capOutput(timedOut ? `${stdout}\n\n[timed out after ${timeoutMs}ms]` : stdout),
        stderr: capOutput(stderr, 8_000),
      });
    });
  });
}

/**
 * Runs the suite and resolves a result, or throws with a readable reason.
 *
 * The folder is present in the common case (a Docker deployment, a long-lived
 * host, local development) and the child runs with this process's own Node. When
 * it is absent — the serverless build strips `tests/` — the suite is run in a
 * Docker image built from the repository instead, which is what makes the console
 * work from a deployment that otherwise could not host it.
 *
 * `target` is a test-side seam with a default only: the HTTP route never passes
 * it, so a request cannot choose what runs. It exists so a test can point the
 * runner at a single short-lived file instead of re-spawning the whole suite.
 * Docker always runs the whole `tests/` folder; the seam is local-only.
 */
export async function runTestSuite({ timeoutMs = TIMEOUT_MS, target = TESTS_DIR, mode } = {}) {
  if (existsSync(target)) {
    return runChild(process.execPath, testArgs(target), { timeoutMs });
  }

  const requested = mode || (dockerAvailable() ? 'docker' : 'unavailable');
  if (requested === 'unavailable') {
    throw testsNotDeployedError();
  }

  const image = await ensureDockerImage();
  if (!image) {
    throw new Error(
      'Could not find or build a Docker image carrying the test suite. ' +
        'Run `docker compose build` first, or set TEST_RUNNER_IMAGE to one that exists.',
    );
  }

  return runChild('docker', dockerRunArgs(image), { timeoutMs });
}

/**
 * Builds the router.
 *
 * `requireAuth`/`requireRole` come from the caller, so the serverless function
 * and the Express dev server share one definition, the same way the mail and bot
 * routers do.
 */
export function buildTestRouter({ requireAuth, requireRole }) {
  const router = express.Router();

  // requireAuth is a single middleware function and requireRole a factory, the
  // same shape the mail and bot routers consume. Building the role guard once
  // keeps both routes reading like the rest of the dashboard.
  const requireOwner = requireRole('owner');

  /** What the page shows before a run: is the suite reachable, and how? */
  router.get('/api/admin/tests/status', requireAuth, requireOwner, (_req, res) => {
    const local = existsSync(TESTS_DIR);
    const docker = !local && dockerAvailable();
    res.json({
      available: local || docker,
      running: Boolean(inFlight),
      mode: local ? 'local' : docker ? 'docker' : 'unavailable',
      image: local ? null : process.env.TEST_RUNNER_IMAGE || DEFAULT_IMAGE,
      command: `node ${testArgs('tests/').join(' ')}`,
      timeoutMs: TIMEOUT_MS,
    });
  });

  router.post('/api/admin/tests/run', requireAuth, requireOwner, async (_req, res) => {
    if (inFlight) {
      return res.status(409).json({ message: 'A test run is already in progress.' });
    }

    try {
      inFlight = runTestSuite();
      const result = await inFlight;
      res.json(result);
    } catch (error) {
      if (error.code === 'tests_not_deployed') {
        return res.status(503).json({ message: error.message, available: false });
      }
      res.status(500).json({ message: error.message || 'The test run failed to start.' });
    } finally {
      inFlight = null;
    }
  });

  return router;
}
