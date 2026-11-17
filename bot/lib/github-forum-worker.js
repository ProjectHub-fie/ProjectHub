/**
 * The Forum ↔ GitHub synchronization worker.
 *
 * A small, bounded worker that runs inside the bot process — not a second
 * process, and not in a Vercel function. Each tick claims a batch of ready jobs
 * from `github_forum_sync_queue` and runs them, then the tick returns. The
 * gateway event handlers only *enqueue*; they never wait on a GitHub call, so a
 * slow or failing GitHub API cannot stall message handling.
 *
 * ## Why a database queue
 *
 * Idempotency and recovery have to survive a restart, and an in-memory queue
 * cannot. The claim is a single `UPDATE ... FOR UPDATE SKIP LOCKED`, so two
 * overlapping ticks — or two bot processes sharing the database — can never
 * handle the same job twice. A process that dies mid-job leaves a `processing`
 * row, and `recoverStuckJobs` returns it to `pending` on the next start.
 *
 * ## Failure handling
 *
 * A transient failure (5xx, 429, a timeout, a deferred dependency) is recorded
 * and the job returns to `pending` with an exponential backoff until its
 * attempts are exhausted, at which point it is parked as `dead`. A permanent
 * failure (bad credentials, an invalid repository) is parked immediately,
 * because retrying it only delays the operator seeing the reason. A parked job
 * is never discarded: it stays in the dashboard with its last error and can be
 * retried by hand.
 */
import { JOB_TYPE, JOB_STATUS, WORKER_BATCH_SIZE } from './github-forum-logic.js';
import { claimJobs, completeJob, failJob, releaseJob, recoverStuckJobs, recordSyncLog } from './github-forum-store.js';
import {
  performIssueCreate,
  performCommentCreate,
  performDiscordReply,
  performStateNotify,
} from './github-forum-service.js';

/** Runs one claimed job. Returns a small result, or throws. */
export async function runJob(job, { client = null, log = null } = {}) {
  switch (job.eventType) {
    case JOB_TYPE.ISSUE_CREATE:
      return performIssueCreate(job, { client, log });
    case JOB_TYPE.COMMENT_CREATE:
      return performCommentCreate(job, { client, log });
    case JOB_TYPE.DISCORD_REPLY:
      return performDiscordReply(job, { client, log });
    case JOB_TYPE.STATE_NOTIFY:
      return performStateNotify(job, { client, log });
    default: {
      const error = new Error(`unknown job type: ${job.eventType}`);
      error.permanent = true;
      throw error;
    }
  }
}

/**
 * Processes one claimed job and records the outcome.
 *
 * The job's own failure is swallowed here — a failed job is data, not an
 * exception — so one bad job cannot stop the batch. The return value says what
 * happened, which is what the tests assert.
 */
export async function processJob(job, { client = null, log = null } = {}) {
  try {
    const result = await runJob(job, { client, log });
    await completeJob(job.id);
    if (result?.skipped) {
      await recordSyncLog({
        eventId: job.id,
        eventType: job.eventType,
        status: 'skipped',
        errorSummary: result.skipped,
        detail: job.payload,
      });
    }
    return { id: job.id, ok: true, result };
  } catch (error) {
    const permanent = Boolean(error?.permanent);
    // A deferred job (a reply whose issue is still being created) is retried, so
    // it is not treated as a hard failure.
    const maxAttempts = permanent ? 1 : null;
    const failed = await failJob(job.id, { error: error?.message || String(error), maxAttempts }).catch(() => null);

    await recordSyncLog({
      eventId: job.id,
      eventType: job.eventType,
      source: job.eventType === JOB_TYPE.ISSUE_CREATE || job.eventType === JOB_TYPE.COMMENT_CREATE ? 'discord' : 'github',
      destination: job.eventType === JOB_TYPE.ISSUE_CREATE || job.eventType === JOB_TYPE.COMMENT_CREATE ? 'github' : 'discord',
      repository: job.payload?.repository || null,
      issueNumber: job.payload?.issueNumber || null,
      status: 'failure',
      attempts: failed?.attempts ?? job.attempts + 1,
      errorSummary: error?.message || String(error),
      detail: { permanent, status: error?.status || null },
    }).catch(() => {});

    log?.('job %s (%s) failed: %s', job.id, job.eventType, error?.message);
    return { id: job.id, ok: false, error: error?.message || String(error), permanent, attempts: failed?.attempts ?? null };
  }
}

/**
 * One worker tick: recover, claim, process.
 *
 * `recover` is only run on the first tick (and after a restart), so the common
 * case is one cheap claim query. The batch is bounded, and each job is processed
 * in turn — GitHub calls are I/O-bound, so a larger concurrency buys little and
 * a small footprint is what the bot host has.
 */
export async function runWorkerTick({ client = null, log = null, limit = WORKER_BATCH_SIZE, recover = false, now = new Date() } = {}) {
  if (recover) {
    const recovered = await recoverStuckJobs().catch(() => 0);
    if (recovered) log?.('recovered %d stuck job(s)', recovered);
  }

  const jobs = await claimJobs({ limit, now });
  if (!jobs.length) return { claimed: 0, processed: [] };

  const results = [];
  for (const job of jobs) {
    results.push(await processJob(job, { client, log }));
  }
  return { claimed: jobs.length, processed: results };
}

/**
 * Starts the worker on an interval.
 *
 * Returns a `stop` function. The interval is unref'd so it never keeps the
 * process alive on its own, and a tick that overlaps its predecessor is skipped
 * rather than stacked — the database claim would make a stack safe, but skipping
 * keeps the footprint predictable.
 */
export function startWorker({ client = null, log = null, intervalMs = 15_000, limit = WORKER_BATCH_SIZE } = {}) {
  let running = false;
  let first = true;
  let stopped = false;

  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      await runWorkerTick({ client, log, limit, recover: first });
      first = false;
    } catch (error) {
      // A database blip must not kill the worker; the next tick retries.
      console.error('[bot] forum sync tick failed:', error.message);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  // Give the gateway a moment before the first tick, and recover immediately.
  void tick();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

export { JOB_TYPE, JOB_STATUS, releaseJob };
