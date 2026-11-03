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
import { inflateRawSync } from 'node:zlib';
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

/** How much raw TAP output is kept for the dashboard's "Raw output" panel. */
const MAX_OUTPUT_CHARS = 60_000;

/** How many times a completed run's artifact/log is read before giving up. */
const MAX_RESULT_ATTEMPTS = 3;

/* ------------------------------------------------------------ result parsing */

/**
 * Parses the test summary out of the suite's output.
 *
 * The compose `tests` service runs `node --test`, whose default spec reporter
 * prints `ℹ tests 10`, `ℹ pass 9`, `ℹ fail 1`, `ℹ skipped 1` (U+2139). The TAP
 * reporter prints the older `# tests 10` form, and `--test-reporter=tap` is what
 * the workflow's artifact carries, so both are accepted — a reporter switch must
 * not silently blank the summary.
 *
 * Anything the pattern does not match stays `null` rather than being guessed at,
 * so a reporter change reads as "unknown" instead of a wrong number. Failures
 * are collected from the spec reporter's `✖ name` lines and the TAP reporter's
 * `not ok N - name` lines.
 */
export function parseTap(output) {
  if (typeof output !== 'string' || !output) {
    return { tests: null, pass: null, fail: null, skipped: null, durationMs: null, failures: [] };
  }

  const summary = {};
  const counters = /^(?:#|ℹ|\u2139)\s*(tests|pass|fail|skipped|todo|cancelled|duration_ms)\s+([\d.]+)/gm;
  for (const [, key, value] of output.matchAll(counters)) {
    summary[key] = Number(value);
  }

  const failures = [];
  const seen = new Set();
  const addFailure = (name) => {
    const trimmed = String(name).trim();
    if (!trimmed || seen.has(trimmed)) return;
    // The spec reporter prints a `✖ failing tests:` section header before it
    // lists them, and the header is not a test. Only that header is skipped: a
    // test whose name ends in a colon is still reported.
    if (/^failing tests?:?$/i.test(trimmed)) return;
    seen.add(trimmed);
    failures.push(trimmed);
  };

  // TAP reporter: `not ok 3 - the thing works`.
  for (const [, name] of output.matchAll(/^\s*not ok \d+ - (.*)$/gm)) addFailure(name);
  // Spec reporter: `✖ failing one (0.82ms)`. Only the leading summary block and
  // the trailing "failing tests" list carry this; both name the same tests, and
  // the dedupe above keeps one entry per name.
  for (const [, name] of output.matchAll(/^\s*✖\s+(.*?)(?:\s+\(\d[\d.]*ms\))?$/gm)) addFailure(name);

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
  if (typeof text !== 'string') return '';
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.6);
  const tail = max - head;
  return `${text.slice(0, head)}\n\n… ${text.length - max} characters omitted …\n\n${text.slice(-tail)}`;
}

/**
 * Reads one entry out of a ZIP archive, in memory.
 *
 * The workflow uploads the TAP stream as a build artifact, and an artifact is
 * always a ZIP. Only the two things this needs are implemented: the central
 * directory is scanned for the entry by name, and that entry's local header is
 * used to locate and inflate the bytes. Stored (method 0) and deflated (method
 * 8) entries are both handled, because GitHub re-zips an already-compressed file
 * as stored.
 *
 * No dependency is added for this: the artifact is one small text file, the
 * archive is fully in memory, and `zlib` already ships with Node. A malformed or
 * truncated archive returns null rather than throwing, so a broken artifact
 * degrades to "no results" instead of a 500.
 */
export function readZipEntry(buffer, entryName) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) return null;
  const matches = typeof entryName === 'function' ? entryName : (name) => name === entryName;
  if (buffer.readUInt32LE(0) !== 0x04034b50 && !buffer.includes(Buffer.from('PK\x05\x06', 'binary'))) {
    return null;
  }

  const EOCD = 0x06054b50;
  const MAX_COMMENT = 0xffff;
  let eocd = -1;
  const scanFrom = Math.max(0, buffer.length - (MAX_COMMENT + 22));
  for (let i = buffer.length - 22; i >= scanFrom; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const CENTRAL = 0x02014b50;

  for (let n = 0; n < entryCount; n += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL) return null;

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

    if (matches(name)) {
      if (localOffset + 30 > buffer.length) return null;
      if (buffer.readUInt32LE(localOffset) !== 0x04034b50) return null;
      // The local header repeats the name and extra fields, and its lengths can
      // differ from the central directory's, so the data offset is computed from
      // the local header rather than reused.
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const data = buffer.subarray(dataStart, dataStart + compressedSize);
      try {
        if (method === 0) return Buffer.from(data);
        if (method === 8) return inflateRawSync(data);
      } catch {
        return null;
      }
      return null;
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return null;
}

/**
 * Fetches the TAP artifact of a finished run and parses the summary from it.
 *
 * This is the step that was missing: a completed GitHub run carries its result
 * only in its artifact and its job log, so a run that adopted the GitHub
 * metadata alone reported "Passed" with every tile reading "—". The workflow
 * uploads `tap-output.tap` (see `.github/workflows/docker-tests.yml`), so that
 * artifact is listed, downloaded as a ZIP and read in memory.
 *
 * Best effort by design: a missing or expired artifact, or a GitHub error, must
 * not fail the status route. The caller falls back to the job log.
 */
async function fetchArtifactResults(runId, { signal } = {}) {
  const { repository } = getConfig();
  const listUrl = `https://api.github.com/repos/${repository}/actions/runs/${runId}/artifacts`;

  const listResponse = await githubFetch(listUrl, { headers: apiHeaders(), signal });
  if (!listResponse.ok) return null;
  const list = await listResponse.json();
  const artifacts = Array.isArray(list?.artifacts) ? list.artifacts : [];
  // Newest first, so a rerun's artifact wins over an earlier one. Anything not
  // expired is still downloadable.
  const artifact = artifacts
    .filter((entry) => !entry.expired)
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0];
  if (!artifact) return null;

  const zipResponse = await githubFetch(
    `https://api.github.com/repos/${repository}/actions/artifacts/${artifact.id}/zip`,
    { headers: apiHeaders(), signal },
  );
  if (!zipResponse.ok) return null;
  const buffer = Buffer.from(await zipResponse.arrayBuffer());
  // GitHub nests the upload path, so the entry name carries directories. Match
  // on the basename rather than the full path.
  const tap = readZipEntry(buffer, (name) => name.endsWith('tap-output.tap') || name.endsWith('.tap'));
  if (!tap) return null;
  return tap.toString('utf8');
}

/**
 * Fetches the raw job log of a finished run, as a fallback for the artifact.
 *
 * Artifacts expire (90 days by default) and are absent when the upload step
 * found no file, but the log is retained with the run. It is the same TAP
 * stream, prefixed by the runner's step banners, which `parseTap` ignores.
 */
async function fetchJobLogResults(runId, { signal } = {}) {
  const { repository } = getConfig();
  const jobsResponse = await githubFetch(
    `https://api.github.com/repos/${repository}/actions/runs/${runId}/jobs`,
    { headers: apiHeaders(), signal },
  );
  if (!jobsResponse.ok) return null;
  const body = await jobsResponse.json();
  const jobs = Array.isArray(body?.jobs) ? body.jobs : [];
  const job = jobs.find((entry) => entry.conclusion || entry.status === 'completed') || jobs[0];
  if (!job?.id) return null;

  const logResponse = await githubFetch(
    `https://api.github.com/repos/${repository}/actions/jobs/${job.id}/logs`,
    { headers: { ...apiHeaders(), Accept: 'application/vnd.github+json' }, signal },
  );
  if (!logResponse.ok) return null;
  // The endpoint answers 302 to a short-lived signed URL, which fetch follows.
  const text = await logResponse.text();
  return stripLogTimestamps(text);
}

/**
 * Removes the timestamp GitHub puts in front of every job-log line.
 *
 * A job log reads `2026-11-02T17:06:56.3444299Z <the real line>`, so a summary
 * line that is `ℹ tests 456` in the artifact arrives as
 * `2026-11-02T17:06:56.3444299Z ℹ tests 456` here. `parseTap` anchors its
 * patterns at the start of a line, so the prefix is removed before parsing
 * rather than loosening every pattern. Only a leading ISO timestamp is touched;
 * the rest of the line is preserved byte-for-byte.
 */
export function stripLogTimestamps(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z ?/gm, '');
}

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

    // A run can reach `completed` a moment before its artifact is downloadable,
    // and the page stops polling once the run is terminal. Retrying the read here
    // closes that window on the next status request; the run's own attempt cap
    // bounds it, so a suite that never uploads an artifact is asked about a fixed
    // number of times and no more.
    const last = store.last;
    if (!store.current && last && last.completed && !last.resultsLoaded) {
      try {
        await withTimeout(last.loadResults(), 8_000);
      } catch {
        // Same contract as the poll above: a GitHub hiccup must not fail status.
      }
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

  /**
   * Whether the artifact/log read has been attempted for a terminal run.
   *
   * The read is the only expensive part of a poll (three GitHub calls plus a ZIP
   * download), and a terminal run never changes its results, so it happens once
   * per completed run. Without this a page refresh would re-download the
   * artifact on every status request.
   */
  resultsLoaded = false;

  /**
   * How many times the result read has been tried.
   *
   * GitHub marks a run `completed` a moment before its artifact is downloadable,
   * so the first attempt can legitimately find nothing. Bounded retries across
   * later polls close that window; the cap stops a run whose artifact never
   * appears (a failed suite uploads none) from re-asking GitHub forever.
   */
  resultsAttempts = 0;

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
    if (this.completed && !this.resultsLoaded) {
      // Read the results *before* releasing the slot, so the run that lands in
      // `lastRun` already carries its summary. A failure here is swallowed: the
      // conclusion is still reported, and a later poll retries while the attempt
      // cap lasts.
      await this.loadResults();
    }
    if (this.completed && store.current === this) {
      store.current = null;
      store.last = this;
    }
  }

  /**
   * Reads the suite's own numbers for a terminal run.
   *
   * The GitHub run carries a conclusion but not a test count, so the summary has
   * to come from the artifact the workflow uploads, or from the job log when the
   * artifact is gone. Without this the page showed "Passed" above four tiles
   * reading "—", which is what made a successful run look like it had no result.
   */
  async loadResults() {
    if (this.resultsLoaded || !this.id) return;
    if (this.resultsAttempts >= MAX_RESULT_ATTEMPTS) return;
    this.resultsAttempts += 1;

    let text = null;
    try {
      text = await withTimeout(fetchArtifactResults(this.id, {}), 8_000);
    } catch {
      text = null;
    }
    if (!text) {
      try {
        text = await withTimeout(fetchJobLogResults(this.id, {}), 8_000);
      } catch {
        text = null;
      }
    }

    if (!text) return;

    const parsed = parseTap(text);
    // A log without a summary line (a job that died before the suite reported)
    // is not a result. Leaving `resultsLoaded` false lets a later poll retry
    // while the attempt cap still bounds the work.
    if (parsed.tests == null && parsed.failures.length === 0) return;

    this.resultsLoaded = true;
    this.summary = {
      tests: parsed.tests,
      pass: parsed.pass,
      fail: parsed.fail,
      skipped: parsed.skipped,
    };
    this.failures = parsed.failures;
    this.output = capOutput(text);
    // The suite's own duration is more useful than the runner's wall clock,
    // which includes image build and checkout time. Only used when GitHub did
    // not supply start/finish timestamps.
    if (this.durationMs == null && parsed.durationMs != null) this.durationMs = parsed.durationMs;
  }

  /**
   * Whether the run finished but its numbers could not be read.
   *
   * The page uses this to say "results unavailable" instead of showing a
   * success headline over empty tiles.
   */
  get resultsUnavailable() {
    return this.completed && this.summary.tests == null;
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
      resultsUnavailable: this.resultsUnavailable,
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
