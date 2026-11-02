/**
 * Admin route that runs the repository's test suite on GitHub Actions instead
 * of on the server that hosts this code.
 *
 * ## Why GitHub Actions
 *
 * This module previously ran the suite with a local child process or with
 * `docker run`. Vercel serverless functions cannot do either reliably:
 * `tests/` is listed in `.vercelignore` so it is absent from the deployed
 * bundle, there is no Docker daemon to use, and the function is capped at 30s by
 * `vercel.json`. The dashboard
 * now delegates the run to a GitHub Actions workflow
 * (`.github/workflows/docker-tests.yml`), which checks out the repository with
 * `tests/` present and runs the existing `docker compose --profile tests run
 * --rm --build tests` service. Vercel never builds images, never runs `docker`,
 * and never touches a Docker daemon.
 *
 * ## What this endpoint can do
 *
 * It can dispatch exactly one workflow file from configuration and poll for the
 * run GitHub associates with it. No request field names a workflow, a branch, a
 * shell command or a test path: everything comes from `process.env` defaults in
 * this module. The `request_id` is generated server-side, sent as the workflow
 * input, and used to pick *this* run out of recent ones (the dispatch endpoint
 * answers 204 with no run id). Access is owner-only — the same class of guard as
 * the admin-management routes.
 *
 * ## Why not a local process
 *
 * A serverless function cannot wait 120 seconds for a suite; `vercel.json` caps
 * `api/admin/index.js` at 30s. Dispatching is a single fast HTTPS call and
 * polling is cheap, so the ceiling never blocks a real suite run. The workflow
 * itself carries `timeout-minutes: 15`.
 */
import express from 'express';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ config */

/**
 * Server-side configuration, read from the environment on every access.
 *
 * Reading lazily instead of snapshotting the object at import makes the module
 * trivial to test (set `process.env` before a call) and keeps the deployed
 * process honest about variables that can change between invocations. Nothing
 * here comes from a request.
 *
 * `GITHUB_ACTIONS_TOKEN` is a GitHub API token that can dispatch workflows and
 * read workflow runs on the repository. It is never returned to the browser,
 * never logged, and never put in a URL.
 */
export function getConfig() {
  return {
    /** The token TTL is outside this module; the failure mode is a clear 403. */
    token: process.env.GITHUB_ACTIONS_TOKEN || process.env.GITHUB_TOKEN || '',
    repository: process.env.GITHUB_REPOSITORY || 'ProjectHub-fie/ProjectHub',
    workflowFile: process.env.GITHUB_WORKFLOW_FILE || 'docker-tests.yml',
    branch: process.env.GITHUB_WORKFLOW_BRANCH || 'main',
    /** How long the dashboard keeps polling before reporting a timeout. */
    timeoutMs: Number(process.env.TEST_RUN_TIMEOUT_MS || 15 * 60 * 1000),
    /** How often the status route is allowed as a poll. */
    pollIntervalMs: Number(process.env.TEST_RUN_POLL_MS || 3_000),
  };
}

/** Rejects if `promise` has not settled within `ms`, without cancelling it. */
function withTimeout(promise, ms) {
  return new Promise((accept, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        accept(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Fields a status response may include, with a safe fallback for partial data. */
const STATUS_COMMON = {
  runner: 'github-actions',
  /** The workflow uses the repo's own compose defaults for its Postgres. */
  usesComposeDb: true,
};

/* ------------------------------------------------------------ GitHub client */

/** Headers for GitHub REST calls. The token never appears in a URL or log. */
function apiHeaders() {
  const { token } = getConfig();
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'projecthub-test-console',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * The GitHub API fetcher.
 *
 * In production this is Node's `fetch`. The test suite swaps it via
 * `__test.setFetcher` so dispatch/poll/lookup are exercised against a stub
 * without ever reaching the real GitHub API. Defaults stay frozen.
 */
function githubFetch(...args) {
  if (typeof globalThis.__testFetcher === 'function') return globalThis.__testFetcher(...args);
  return fetch(...args);
}

/** A single GitHub workflow run, shaped for the dashboard and internal matching. */
function shapeRun(raw) {
  return {
    id: raw.id,
    status: raw.status, // queued | in_progress | completed | ...
    conclusion: raw.conclusion ?? null,
    name: raw.name || null,
    headSha: raw.head_sha || null,
    createdAt: raw.created_at || null,
    updatedAt: raw.updated_at || null,
    startedAt: raw.run_started_at || null,
    completedAt: raw.completed_at || null,
    htmlUrl: raw.html_url || null,
    displayTitle: raw.display_title || raw.name || null,
  };
}

/**
 * Lists recent `workflow_dispatch` runs of the configured workflow and picks
 * the one whose display title carries `requestId`. The dispatch endpoint
 * answers 204 without a body, so this is how the run id is found.
 *
 * `per_page` stays at 20 and the search walks at most five pages; the dashboard
 * is the only trigger, so the matching run is normally the newest. It stops
 * paging as soon as a page no longer contains Docker-tests runs.
 */
async function findRunByRequestId(requestId, { signal }) {
  const { repository, workflowFile } = getConfig();
  const params = new URLSearchParams({
    per_page: '20',
    event: 'workflow_dispatch',
  });
  const workflow = encodeURIComponent(workflowFile);
  const url = `https://api.github.com/repos/${repository}/actions/workflows/${workflow}/runs?${params}`;

  for (let page = 1; page <= 5; page += 1) {
    const response = await githubFetch(`${url}&page=${page}`, { headers: apiHeaders(), signal });
    if (response.status === 403 || response.status === 401) {
      const error = new Error(
        'GitHub API denied access to workflow runs. Check GITHUB_ACTIONS_TOKEN permissions.',
      );
      error.code = 'github_unauthorized';
      throw error;
    }
    if (!response.ok) {
      throw Object.assign(new Error(`GitHub returned ${response.status} reading workflow runs.`), {
        code: 'github_api_error',
        status: 502,
      });
    }
    const body = await response.json();
    const runs = body.workflow_runs || [];
    const match = runs.find((run) => run.display_title && run.display_title.includes(requestId));
    if (match) return shapeRun(match);
    // Stop paginating as soon as a page has no recent candidates left.
    const oldest = runs[runs.length - 1];
    if (runs.length < 20 || (oldest && !oldest.display_title.includes('Docker tests'))) break;
  }
  return null;
}

/* -------------------------------------------------------------- run storage */

/**
 * The known in-flight run and the last completed one.
 *
 * Vercel function instances are request-scoped but their module state survives
 * across warm invocations, which is what makes the "is a run still in flight?"
 * guard possible without a store. The last finished run is kept so a page
 * refresh can show the previous outcome.
 */
const store = {
  current: null,
  last: null,
  /** Monotonic guard against two dispatches racing the same warm instance. */
  dispatching: false,
};

/* ------------------------------------------------------------------ router */

/**
 * Builds the router.
 *
 * `requireAuth`/`requireRole` come from the caller, so the serverless function
 * and the Express dev server share one definition, the same way the mail, bot
 * and roblox routers do.
 */
export function buildTestRouter({ requireAuth, requireRole }) {
  const router = express.Router();

  // requireAuth is a single middleware function and requireRole a factory, the
  // same shape the mail and bot routers consume. Building the role guard once
  // keeps both routes reading like the rest of the dashboard.
  const requireOwner = requireRole('owner');

  /** What the page shows before/during a run, refreshing GitHub state on poll. */
  router.get('/api/admin/tests/status', requireAuth, requireOwner, async (_req, res) => {
    const { token, repository, workflowFile, branch, timeoutMs } = getConfig();
    // Polling path: refresh the active run from GitHub before answering. A
    // status request is cheap anyway, and this is what lets the page track a
    // queued -> in_progress -> completed run without holding a Vercel instance.
    let active = store.current && store.current.running;
    if (store.current && store.current.isAwaitingWorkflow) {
      try {
        // Bounded: never let a status request hang near the 30s function cap.
        await withTimeout(store.current.poll(), 8_000);
      } catch {
        // A GitHub outage must not take the whole dashboard down; report the
        // last known state and let the next poll retry.
      }
      active = store.current ? store.current.running : false;
    }

    res.json({
      ...STATUS_COMMON,
      available: Boolean(token),
      running: Boolean(active),
      configured: Boolean(token),
      mode: 'github-actions',
      repository,
      workflowFile,
      workflowBranch: branch,
      command: `docker compose --profile tests run --rm --build tests`,
      timeoutMs,
      image: null, // this deployment never runs Docker locally
      ...(active ? { activeRun: store.current.toJSON() } : {}),
      ...(store.last ? { lastRun: store.last.toJSON() } : {}),
    });
  });

  router.post('/api/admin/tests/run', requireAuth, requireOwner, async (_req, res) => {
    const { token } = getConfig();
    if (store.current && store.current.running) {
      return res.status(409).json({ message: 'A test run is already in progress.' });
    }
    if (!token) {
      return res.status(503).json({
        ...STATUS_COMMON,
        available: false,
        message: 'GitHub Actions is not configured on this deployment. Set GITHUB_ACTIONS_TOKEN.',
      });
    }
    // The sync guard is only an approximation in a serverless world, but it
    // still stops the common double-click within one warm instance.
    if (store.dispatching) {
      return res.status(409).json({ message: 'A test run is already in progress.' });
    }

    store.dispatching = true;
    const run = new GithubRun();
    store.current = run;
    let started = false;

    try {
      await run.dispatch();
      started = true;
      res.json(run.toJSON());
      // The workflow is now queued on GitHub; the page polls /status until the
      // run reaches a terminal state. Nothing further happens in this request.
    } catch (error) {
      store.current = null;
      console.error('Test dispatch error:', error.message || error);
      const status = error.status || (error.code === 'github_unauthorized' ? 502 : 500);
      res.status(status).json({
        message: error.message || 'Failed to dispatch the GitHub Actions workflow.',
        error: error.code || null,
      });
    } finally {
      store.dispatching = false;
      // A completed dispatch leaves `store.current` live so the page can poll;
      // only a failed dispatch cleared it above.
      if (!started) store.current = null;
    }
  });

  return router;
}

/**
 * A single dispatch-and-poll cycle for the dashboard.
 *
 * Mirrors the fields the old local runner exposed (`ok`, `summary`, `failures`,
 * `output`, …) so the page keeps working, and adds the GitHub run identity and
 * URL the page links out to. It also holds the /status polling state: a stored
 * run can be `running`, `completed`, or left in its queued/in-progress status.
 */
class GithubRun {
  /** Server-side correlation id, also passed to the workflow as its input. */
  requestId = crypto.randomUUID();

  /** GitHub's own run id; null until found by lookup. */
  id = null;
  status = 'queued'; // queued | in_progress | completed
  conclusion = null;
  createdAt = null;
  updatedAt = null;
  startedAt = null;
  completedAt = null;
  htmlUrl = null;
  displayTitle = null;

  /** Client-facing lifecycle. */
  running = false;
  completed = false;
  timedOut = false;
  dispatchAt = null;

  /** Result-shaped fields for the dashboard, mirroring the old local runner. */
  exitCode = null;
  durationMs = null;
  summary = { tests: null, pass: null, fail: null, skipped: null };
  failures = [];
  output = '';

  /** Whether the workflow has been sent to GitHub. */
  get dispatched() {
    return Boolean(this.dispatchAt);
  }

  /** Adopts the fields of a found GitHub run. */
  adopt(raw) {
    this.id = raw.id;
    this.status = raw.status;
    this.conclusion = raw.conclusion;
    this.htmlUrl = raw.htmlUrl;
    this.displayTitle = raw.displayTitle;
    this.createdAt = raw.createdAt;
    this.updatedAt = raw.updatedAt;
    this.startedAt = raw.startedAt;
    this.completedAt = raw.completedAt;
    this.running = raw.status === 'queued' || raw.status === 'in_progress';
    this.completed = raw.status === 'completed';
    this.timedOut = raw.conclusion === 'timed_out';
    if (raw.startedAt && raw.completedAt) {
      this.durationMs = Math.max(0, new Date(raw.completedAt).getTime() - new Date(raw.startedAt).getTime());
      this.exitCode = raw.conclusion === 'success' ? 0 : 1;
    }
  }

  /** Sends the workflow-dispatch request. Returns nothing; the id is found later. */
  async dispatch() {
    const { repository, workflowFile, branch } = getConfig();
    const url = `https://api.github.com/repos/${repository}/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`;
    const response = await githubFetch(url, {
      method: 'POST',
      headers: { ...apiHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: branch, inputs: { request_id: this.requestId } }),
    });
    if (response.status === 403 || response.status === 401) {
      const error = new Error(
        'GitHub rejected the workflow dispatch. GITHUB_ACTIONS_TOKEN needs "Actions" read and write on this repository.',
      );
      error.code = 'github_unauthorized';
      error.status = 502;
      throw error;
    }
    if (!response.ok) {
      // A 422 usually means the workflow file is missing on the branch or the
      // workflow has no workflow_dispatch trigger.
      const body = await response.json().catch(() => null);
      const error = new Error(
        `GitHub rejected the workflow dispatch (${response.status}).` +
          (body?.message ? ` ${body.message}` : ''),
      );
      error.code = 'github_api_error';
      error.status = 502;
      throw error;
    }
    // 204 No Content is the success shape for this endpoint. GitHub assigns the
    // run id asynchronously, so findRunByRequestId picks it up on the first poll.
    this.dispatchAt = new Date();
    this.running = true;
    this.status = 'queued';
    __test.lastDispatchedId = this.requestId;
  }

  /** One poll against the /status route: refreshes GitHub's state if it is done. */
  async poll() {
    if (!this.dispatched) return;
    const run = await findRunByRequestId(this.requestId, {});
    if (run) this.adopt(run);
    // A terminal run becomes the dashboard's last-known result and frees the
    // single-run slot so the next dispatch is allowed.
    if (this.completed && store.current === this) {
      store.current = null;
      store.last = this;
    }
  }

  /** Whether a run is still waiting on GitHub and not yet terminal. */
  get isAwaitingWorkflow() {
    return this.dispatched && !this.completed;
  }

  /** The JSON sent to the dashboard. */
  toJSON() {
    return {
      requestId: this.requestId,
      runId: this.id,
      status: this.status,
      conclusion: this.conclusion,
      running: this.running,
      completed: this.completed,
      timedOut: this.timedOut,
      htmlUrl: this.htmlUrl,
      displayTitle: this.displayTitle,
      createdAt: this.createdAt,
      completedAt: this.completedAt,
      durationMs: this.durationMs,
      exitCode: this.exitCode,
      summary: this.summary,
      failures: this.failures,
      output: this.output,
      poll: { intervalMs: getConfig().pollIntervalMs, timeoutMs: getConfig().timeoutMs },
    };
  }
}

/** Cancels GitHub's run and marks it done locally. Best effort. */
export async function cancelRun() {
  const run = store.current;
  if (!run || !run.id) return { cancelled: false, message: 'No active run to cancel.' };
  try {
    await githubFetch(
      `https://api.github.com/repos/${getConfig().repository}/actions/runs/${run.id}/cancel`,
      { method: 'POST', headers: apiHeaders() },
    );
    run.conclusion = 'cancelled';
    run.completed = true;
    run.running = false;
  } catch (error) {
    return { cancelled: false, message: error.message || 'Cancellation failed.' };
  } finally {
    store.current = null;
    store.last = store.last && store.last.id === run.id ? null : store.last;
  }
  return { cancelled: true };
}

/* --------------------------------------------------------- test only */
/**
 * Test seams. These are exported so the unit tests can stub the GitHub API and
 * reset the single-flight store without refactoring the router; the real routes
 * never touch them.
 */
export const __test = {
  resetStore() {
    store.current = null;
    store.last = null;
    store.dispatching = false;
  },
  /** Swap the fetcher used for GitHub API calls. Returns the previous one. */
  setFetcher(fn) {
    const previous = globalThis.__testFetcher;
    globalThis.__testFetcher = fn;
    return previous;
  },
  /** The request id the last dispatch used, so a mock run list can match it. */
  lastDispatchedId: null,
  get currentRun() {
    return store.current;
  },
  get lastRun() {
    return store.last;
  },
};
