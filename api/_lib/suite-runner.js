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
 * function and this route cannot work there. Rather than failing with a confusing
 * spawn error, it checks for the directory first and reports that the suite is
 * not available in this deployment. In practice it is useful on a long-running
 * host (the same kind that runs the bot) and in local development, which is where
 * an operator would actually want to re-run the suite.
 *
 * One run at a time: a module-level promise refuses a second concurrent run, so a
 * held-down button cannot start a process per click.
 */
import express from 'express';
import { spawn } from 'node:child_process';
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

/** The one command this endpoint can run. Fixed, never assembled from input. */
function testArgs(target = TESTS_DIR) {
  return ['--test', '--test-force-exit', '--test-reporter=tap', target];
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
 * Runs the suite and resolves a result, or throws with a readable reason.
 *
 * `target` is a test-side seam with a default only: the HTTP route never passes
 * it, so a request cannot choose what runs. It exists so a test can point the
 * runner at a single short-lived file instead of re-spawning the whole suite.
 */
export function runTestSuite({ timeoutMs = TIMEOUT_MS, target = TESTS_DIR } = {}) {
  if (!existsSync(target)) {
    const error = new Error(
      'The tests/ directory is not present in this deployment, so the suite cannot be run here. ' +
        'It is excluded from the serverless build; run this from a long-lived host or locally.',
    );
    error.code = 'tests_not_deployed';
    return Promise.reject(error);
  }

  return new Promise((resolveRun, rejectRun) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, testArgs(target), {
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

  /** What the page shows before a run: is the suite even present? */
  router.get('/api/admin/tests/status', requireAuth, requireOwner, (_req, res) => {
    res.json({
      available: existsSync(TESTS_DIR),
      running: Boolean(inFlight),
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
