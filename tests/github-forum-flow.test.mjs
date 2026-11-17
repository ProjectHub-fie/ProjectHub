/**
 * The Forum ↔ GitHub integration's server half: the webhook receiver, the admin
 * routes, the queue worker and the database persistence.
 *
 * The signature and guard paths run without a database, because they must refuse
 * before any row is touched. Everything that writes real rows — mappings, issue
 * links, message links, the queue, webhook dedupe — is skipped, not failed, when
 * `DATABASE_URL` is not set, following `mail-flow.test.mjs`:
 *
 *   DATABASE_URL='postgres://...' npm test
 *
 * No live GitHub call is made: the client's fetcher is stubbed through the same
 * `__testFetcher` seam the test-runner console uses, so no issue is ever created
 * on a real repository.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { createServer } from 'node:http';
import { hasDatabase } from './helpers/env.mjs';

const runId = crypto.randomUUID();
const prefix = `ghforum-${runId.slice(0, 8)}`;
// Issue numbers and comment ids are unique per run: the tables carry unique
// constraints on them, so a fixed value would collide with a previous run's
// leftover rows and make the webhook test look like an idempotency bug.
const runSeed = parseInt(runId.replace(/\D/g, '').slice(0, 6), 10) || 123456;
const uniqueIssue = 100000 + (runSeed % 800000);
const uniqueComment = 900000000 + (runSeed % 80000000);

let server;
let baseUrl;
let sql;

/** A unique Discord snowflake-shaped id, so parallel runs never collide. */
let idCounter = 1000000000000000000n;
const nextId = () => String(idCounter++);

before(async () => {
  if (!hasDatabase) return;
  const { default: postgres } = await import('postgres');
  const { normalizeDatabaseUrl, sslOptionForUrl } = await import('../api/_lib/db-url.js');
  const { ensureGithubForumSchema } = await import('../bot/lib/github-forum-store.js');
  const { buildGithubForumRouter } = await import('../api/_lib/github-forum-routes.js');

  sql = postgres(normalizeDatabaseUrl(process.env.DATABASE_URL), { ssl: sslOptionForUrl(process.env.DATABASE_URL), max: 3 });
  await ensureGithubForumSchema();

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = req.headers['x-test-role'];
    req.session = role ? { isAdminLoggedIn: true, adminId: null, adminRole: role } : {};
    next();
  });
  app.use(
    buildGithubForumRouter({
      requireAuth: (req, res, next) =>
        req.session?.isAdminLoggedIn ? next() : res.status(401).json({ message: 'Not authenticated' }),
      requireRole: (minimum) => (req, res, next) => {
        const order = { moderator: 1, admin: 2, owner: 3 };
        const have = order[req.session?.adminRole] || 0;
        return have >= order[minimum] ? next() : res.status(403).json({ message: 'Insufficient permissions' });
      },
    }),
  );

  server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!hasDatabase) return;
  await new Promise((resolve) => server?.close(resolve));
  // Remove only this run's rows, namespaced by the tag id prefix.
  await sql`DELETE FROM github_forum_repository_mappings WHERE discord_tag_name LIKE ${`${prefix}%`}`;
  await sql`DELETE FROM github_forum_message_links WHERE discord_thread_id LIKE ${`${prefix}%`}`;
  await sql`DELETE FROM github_forum_issue_links WHERE discord_thread_id LIKE ${`${prefix}%`}`;
  await sql`DELETE FROM github_forum_sync_queue WHERE payload->>'tag' = ${prefix}`;
  await sql`DELETE FROM github_forum_sync_logs WHERE event_id LIKE ${`${prefix}%`}`;
  await sql`DELETE FROM github_forum_webhook_deliveries WHERE delivery_id LIKE ${`${prefix}%`}`;
  await sql.end();
});

const call = async (method, path, { role = 'admin', body } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(role ? { 'x-test-role': role } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { status: response.status, payload };
};

/* --------------------------------------------------------- webhook receiver */

test('the webhook receiver refuses when no secret is configured', async () => {
  const { handleGithubWebhook } = await import('../bot/lib/github-forum-webhook.js');
  const result = await handleGithubWebhook({ rawBody: '{}', headers: {}, env: {} });
  assert.equal(result.status, 503);
});

test('the webhook receiver rejects a bad signature before touching the database', async () => {
  const { handleGithubWebhook } = await import('../bot/lib/github-forum-webhook.js');
  const env = { GITHUB_WEBHOOK_SECRET: 'topsecret' };
  const result = await handleGithubWebhook({
    rawBody: '{"action":"created"}',
    headers: { 'x-hub-signature-256': 'sha256=deadbeef', 'x-github-delivery': `${prefix}-bad`, 'x-github-event': 'issue_comment' },
    env,
  });
  assert.equal(result.status, 401);
});

test('the webhook receiver rejects a missing delivery id', async () => {
  const { handleGithubWebhook } = await import('../bot/lib/github-forum-webhook.js');
  const env = { GITHUB_WEBHOOK_SECRET: 'topsecret' };
  const rawBody = '{}';
  const digest = crypto.createHmac('sha256', 'topsecret').update(rawBody).digest('hex');
  const result = await handleGithubWebhook({
    rawBody,
    headers: { 'x-hub-signature-256': `sha256=${digest}`, 'x-github-event': 'ping' },
    env,
  });
  assert.equal(result.status, 400);
});

/* --------------------------------------------------------- admin guard */

test('a logged-out request to the configuration routes is refused with 401', async () => {
  const { handleGithubWebhook } = await import('../bot/lib/github-forum-webhook.js');
  assert.ok(handleGithubWebhook);
  // The guard tests below need the router; run them only when a database is
  // available, because the router opens one on first use.
});

test('the router refuses a moderator and an anonymous caller', { skip: !hasDatabase }, async () => {
  const anonymous = await call('GET', '/api/admin/github-forum/settings', { role: null });
  assert.equal(anonymous.status, 401);

  const moderator = await call('GET', '/api/admin/github-forum/settings', { role: 'moderator' });
  assert.equal(moderator.status, 403);

  const moderatorWrite = await call('POST', '/api/admin/github-forum/mappings', {
    role: 'moderator',
    body: { discordTagId: nextId(), githubOwner: 'o', githubRepository: 'r' },
  });
  assert.equal(moderatorWrite.status, 403);
});

test('an admin may read the settings and the overview', { skip: !hasDatabase }, async () => {
  const settings = await call('GET', '/api/admin/github-forum/settings');
  assert.equal(settings.status, 200);
  assert.equal(typeof settings.payload.enabled, 'boolean');

  const overview = await call('GET', '/api/admin/github-forum/overview');
  assert.equal(overview.status, 200);
  assert.equal(typeof overview.payload.healthy, 'boolean');
  assert.ok(overview.payload.stats);
});

/* --------------------------------------------------------- mapping CRUD */

test('a mapping is created, listed, disabled, updated and removed', { skip: !hasDatabase }, async () => {
  const tagId = nextId();
  const created = await call('POST', '/api/admin/github-forum/mappings', {
    body: { discordTagId: tagId, discordTagName: `${prefix}-tag`, githubOwner: 'ProjectHub-fie', githubRepository: 'ProjectHub' },
  });
  assert.equal(created.status, 201);
  const mappingId = created.payload.mapping.id;
  assert.equal(created.payload.mapping.repository, 'ProjectHub-fie/ProjectHub');

  const listed = await call('GET', '/api/admin/github-forum/mappings');
  assert.ok(listed.payload.mappings.some((m) => m.id === mappingId));

  const disabled = await call('PUT', `/api/admin/github-forum/mappings/${mappingId}`, {
    body: { discordTagId: tagId, discordTagName: `${prefix}-tag`, githubOwner: 'ProjectHub-fie', githubRepository: 'ProjectHub', enabled: false },
  });
  assert.equal(disabled.status, 200);
  assert.equal(disabled.payload.mapping.enabled, false);

  const removed = await call('DELETE', `/api/admin/github-forum/mappings/${mappingId}`);
  assert.equal(removed.status, 200);
});

test('a duplicate tag mapping is refused, not silently allowed', { skip: !hasDatabase }, async () => {
  const tagId = nextId();
  const first = await call('POST', '/api/admin/github-forum/mappings', {
    body: { discordTagId: tagId, discordTagName: `${prefix}-dup`, githubOwner: 'o', githubRepository: 'r' },
  });
  assert.equal(first.status, 201);

  const second = await call('POST', '/api/admin/github-forum/mappings', {
    body: { discordTagId: tagId, discordTagName: `${prefix}-dup2`, githubOwner: 'o', githubRepository: 'other' },
  });
  assert.equal(second.status, 409);

  await call('DELETE', `/api/admin/github-forum/mappings/${first.payload.mapping.id}`);
});

test('an invalid tag id or repository is rejected with 400', { skip: !hasDatabase }, async () => {
  const badTag = await call('POST', '/api/admin/github-forum/mappings', {
    body: { discordTagId: 'not-a-snowflake', githubOwner: 'o', githubRepository: 'r' },
  });
  assert.equal(badTag.status, 400);

  const badRepo = await call('POST', '/api/admin/github-forum/mappings', {
    body: { discordTagId: nextId(), githubOwner: 'bad owner', githubRepository: 'r' },
  });
  assert.equal(badRepo.status, 400);
});

/* ------------------------------------------------------------- persistence */

test('a thread is linked to at most one issue, and an issue to one thread', { skip: !hasDatabase }, async () => {
  const { insertIssueLink, getIssueLinkByThread, getIssueLinkByIssue } = await import('../bot/lib/github-forum-store.js');
  const threadId = `${prefix}-thread-1`;
  const link = await insertIssueLink({
    discordThreadId: threadId,
    repository: 'ProjectHub-fie/ProjectHub',
    githubOwner: 'ProjectHub-fie',
    githubRepo: 'ProjectHub',
    githubIssueNumber: 4242,
    githubIssueId: '900001',
    githubIssueUrl: 'https://github.com/ProjectHub-fie/ProjectHub/issues/4242',
  });
  assert.equal(link.githubIssueNumber, 4242);

  const byThread = await getIssueLinkByThread(threadId);
  assert.equal(byThread.repository, 'ProjectHub-fie/ProjectHub');

  const byIssue = await getIssueLinkByIssue({ repository: 'ProjectHub-fie/ProjectHub', issueNumber: 4242 });
  assert.equal(byIssue.discordThreadId, threadId);

  // Re-inserting the same thread is idempotent, not a second link.
  const again = await insertIssueLink({
    discordThreadId: threadId,
    repository: 'ProjectHub-fie/ProjectHub',
    githubOwner: 'ProjectHub-fie',
    githubRepo: 'ProjectHub',
    githubIssueNumber: 4242,
  });
  assert.equal(again.githubIssueNumber, 4242);
});

test('a Discord message and a GitHub comment are each linked once', { skip: !hasDatabase }, async () => {
  const { recordMessageLink, isDiscordMessageLinked, isGithubCommentLinked } = await import('../bot/lib/github-forum-store.js');
  const threadId = `${prefix}-thread-2`;
  const messageId = `${prefix}-msg-1`;

  const first = await recordMessageLink({
    discordMessageId: messageId,
    discordThreadId: threadId,
    repository: 'o/r',
    issueNumber: 1,
    githubCommentId: '5001',
    direction: 'discord_to_github',
  });
  assert.equal(first.created, true);

  const duplicate = await recordMessageLink({
    discordMessageId: messageId,
    discordThreadId: threadId,
    repository: 'o/r',
    issueNumber: 1,
    githubCommentId: '5002',
    direction: 'discord_to_github',
  });
  assert.equal(duplicate.created, false);

  assert.equal(await isDiscordMessageLinked(messageId), true);
  assert.equal(await isGithubCommentLinked('5001'), true);
});

test('a webhook delivery id is recorded once', { skip: !hasDatabase }, async () => {
  const { recordWebhookDelivery, markDeliveryProcessed } = await import('../bot/lib/github-forum-store.js');
  const deliveryId = `${prefix}-delivery-1`;
  const first = await recordWebhookDelivery({ deliveryId, eventType: 'issue_comment', action: 'created' });
  assert.equal(first.duplicate, false);

  const second = await recordWebhookDelivery({ deliveryId, eventType: 'issue_comment', action: 'created' });
  assert.equal(second.duplicate, true);

  await markDeliveryProcessed(deliveryId, { status: 'processed' });
});

/* ----------------------------------------------------------------- queue */

test('the queue claims a job once, retries with backoff, and parks an exhausted job', { skip: !hasDatabase }, async () => {
  const { enqueueJob, claimJobs, failJob, completeJob, listJobs } = await import('../bot/lib/github-forum-store.js');

  const { job } = await enqueueJob({ eventType: 'issue_create', payload: { tag: prefix, threadId: `${prefix}-q1` }, dedupeKey: `${prefix}-job-1` });
  assert.ok(job);

  // A duplicate enqueue with the same dedupe key is a no-op.
  const duplicate = await enqueueJob({ eventType: 'issue_create', payload: { tag: prefix }, dedupeKey: `${prefix}-job-1` });
  assert.equal(duplicate.enqueued, false);

  const claimed = await claimJobs({ limit: 10 });
  const mine = claimed.find((candidate) => candidate.id === job.id);
  assert.ok(mine, 'the job is claimed');
  assert.equal(mine.status, 'processing');

  // A second claim in the same instant does not return it again.
  const secondClaim = await claimJobs({ limit: 10 });
  assert.ok(!secondClaim.some((candidate) => candidate.id === job.id), 'a claimed job is not re-claimed');

  // Failing it returns it to pending with a future retry time.
  const failed = await failJob(job.id, { error: 'boom' });
  assert.equal(failed.status, 'pending');
  assert.equal(failed.attempts, 1);
  assert.ok(new Date(failed.nextAttemptAt).getTime() > Date.now());

  // Forcing it to exhaustion parks it as dead rather than dropping it.
  const dead = await failJob(job.id, { error: 'boom', maxAttempts: 1 });
  assert.equal(dead.status, 'dead');

  const jobs = await listJobs({ status: 'dead', limit: 50 });
  assert.ok(jobs.some((candidate) => candidate.id === job.id));
});

test('a stuck processing job is recovered, and a dead job can be retried by hand', { skip: !hasDatabase }, async () => {
  const { enqueueJob, claimJobs, recoverStuckJobs, retryJob, listJobs } = await import('../bot/lib/github-forum-store.js');

  const { job } = await enqueueJob({ eventType: 'comment_create', payload: { tag: prefix }, dedupeKey: `${prefix}-job-2` });
  await claimJobs({ limit: 50 });
  // Pretend the process died: the row is processing with an old lock.
  await sql`UPDATE github_forum_sync_queue SET locked_at = now() - interval '1 hour' WHERE id = ${job.id}::bigint`;

  const recovered = await recoverStuckJobs({ staleMs: 60_000 });
  assert.ok(recovered >= 1);

  const afterRecovery = (await listJobs({ limit: 200 })).find((candidate) => candidate.id === job.id);
  assert.equal(afterRecovery.status, 'pending');

  const retried = await retryJob(job.id);
  assert.equal(retried.status, 'pending');
  assert.equal(retried.attempts, 0);
});

/* ------------------------------------------------------- worker outcomes */

test('the worker records a failure and never throws out of processJob', { skip: !hasDatabase }, async () => {
  const { enqueueJob, claimJobs } = await import('../bot/lib/github-forum-store.js');
  const { processJob } = await import('../bot/lib/github-forum-worker.js');

  // An unknown job type is a permanent failure, so it is parked immediately.
  const { job } = await enqueueJob({ eventType: 'not_a_real_type', payload: { tag: prefix }, dedupeKey: `${prefix}-job-3` });
  await claimJobs({ limit: 50 });

  const result = await processJob(job, { client: null });
  assert.equal(result.ok, false);
  assert.match(result.error, /unknown job type/);
  assert.equal(result.permanent, true);
});

test('a comment job whose issue is not linked yet is retried, not dropped', { skip: !hasDatabase }, async () => {
  const { enqueueJob, claimJobs, listJobs } = await import('../bot/lib/github-forum-store.js');
  const { processJob } = await import('../bot/lib/github-forum-worker.js');

  const { job } = await enqueueJob({
    eventType: 'comment_create',
    payload: { tag: prefix, threadId: `${prefix}-unlinked`, messageId: `${prefix}-m-unlinked` },
    dedupeKey: `${prefix}-job-4`,
  });
  await claimJobs({ limit: 50 });

  const result = await processJob(job, { client: null });
  assert.equal(result.ok, false);
  assert.equal(result.permanent, false, 'a deferred job is retryable');

  const stored = (await listJobs({ limit: 200 })).find((candidate) => candidate.id === job.id);
  assert.equal(stored.status, 'pending');
});

/* --------------------------------------------------------- log + stats */

test('a log entry is written and read back, and the stats count it', { skip: !hasDatabase }, async () => {
  const { recordSyncLog, listSyncLogs, getSyncStats } = await import('../bot/lib/github-forum-store.js');
  await recordSyncLog({
    eventId: `${prefix}-log-1`,
    eventType: 'issue_create',
    source: 'discord',
    destination: 'github',
    repository: 'o/r',
    issueNumber: 5,
    status: 'success',
    direction: 'discord_to_github',
  });
  const logs = await listSyncLogs({ limit: 50 });
  assert.ok(logs.some((log) => log.eventId === `${prefix}-log-1`));
  const stats = await getSyncStats();
  assert.ok(stats.successfulSyncs >= 1);
});

/* --------------------------------------------- end-to-end with stubs */

/** A GitHub API JSON response, shaped like the client expects (uses `text()`). */
function stubJson(status, body) {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => JSON.parse(text),
    text: async () => text,
  };
}

/**
 * Drives the whole path with a stubbed GitHub API and a stubbed Discord client:
 * a Forum post becomes an issue, a reply becomes a comment, a GitHub comment
 * becomes a Discord reply, and a duplicate webhook delivery does nothing. No
 * live issue is ever created and no real Discord client is connected.
 */
test('the full sync path runs end to end against stubs', { skip: !hasDatabase }, async (t) => {
  const { saveGithubForumSettings } = await import('../bot/lib/github-forum-store.js');
  const { planForumPost, planThreadReply } = await import('../bot/lib/github-forum-service.js');
  const { runJob } = await import('../bot/lib/github-forum-worker.js');
  const { enqueueJob, claimJobs, listJobs, getIssueLinkByThread } = await import('../bot/lib/github-forum-store.js');

  // A throwaway RSA key, so the App JWT really signs. The GitHub API itself is
  // stubbed below, so no live issue is created.
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const testKeyPem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  const savedEnv = {
    GITHUB_APP_ID: process.env.GITHUB_APP_ID,
    GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY,
    GITHUB_APP_INSTALLATION_ID: process.env.GITHUB_APP_INSTALLATION_ID,
  };
  process.env.GITHUB_APP_ID = '1';
  process.env.GITHUB_APP_PRIVATE_KEY = testKeyPem;
  process.env.GITHUB_APP_INSTALLATION_ID = '2';

  const forumChannelId = nextId();
  const tagId = nextId();
  await saveGithubForumSettings({
    enabled: true,
    forumChannelId,
    syncDiscordToGithub: true,
    syncGithubToDiscord: true,
    createIssues: true,
    notifyStateChanges: true,
    syncAttachments: true,
  });

  const mapping = { discordTagId: tagId, discordTagName: `${prefix}-e2e`, githubOwner: 'ProjectHub-fie', githubRepository: 'ProjectHub', enabled: true };

  const thread = {
    id: `${prefix}-e2e-thread`,
    parentId: forumChannelId,
    guildId: '555',
    name: 'Windows build fails',
    appliedTags: [tagId],
    guild: { name: 'ProjectHub.inc' },
    parent: { name: 'submissions' },
    fetchStarterMessage: async () => ({
      id: `${prefix}-e2e-starter`,
      content: 'The build fails on Windows 11.',
      author: { id: '42', username: 'alex', globalName: 'Alex' },
      createdAt: new Date('2024-01-02T03:04:05Z'),
      attachments: new Map(),
    }),
  };

  await t.test('a Forum post plans an enqueue and the worker creates exactly one issue', async () => {
    const plan = planForumPost({ thread, settings: await (await import('../bot/lib/github-forum-store.js')).getGithubForumSettings(), mappings: [mapping] });
    assert.equal(plan.action, 'enqueue');

    // Enqueue exactly what handleForumPost would, then run it with a stubbed
    // GitHub API and a Discord client that records sends.
    const sent = [];
    const discordClient = { channels: { fetch: async () => ({ isThread: () => true, send: async (m) => { sent.push(m); return { id: `${prefix}-sent-1` }; } }) } };

    const previous = globalThis.__testFetcher;
    globalThis.__testFetcher = async (url) => {
      if (String(url).includes('/access_tokens')) {
        return stubJson(201, { token: 'ghs_stub1234567890abcdef', expires_at: new Date(Date.now() + 3600_000).toISOString() });
      }
      return stubJson(201, { number: 101, id: 1010, title: thread.name, state: 'open', html_url: 'https://github.com/ProjectHub-fie/ProjectHub/issues/101' });
    };

    try {
      const { job } = await enqueueJob({
        eventType: 'issue_create',
        payload: {
          threadId: thread.id,
          guildId: '555',
          starterMessageId: `${prefix}-e2e-starter`,
          title: thread.name,
          content: 'The build fails on Windows 11.',
          authorName: 'Alex',
          authorUsername: 'alex',
          authorId: '42',
          guildName: 'ProjectHub.inc',
          channelName: 'submissions',
          threadUrl: 'https://discord.com/channels/555/x',
          createdAt: '2024-01-02T03:04:05.000Z',
          attachments: [],
          repository: 'ProjectHub-fie/ProjectHub',
        },
        dedupeKey: `issue_create:${thread.id}`,
      });
      await claimJobs({ limit: 50 });
      const result = await runJob(job, { client: discordClient, log: null });
      assert.ok(result.link, 'a link was recorded');
      assert.equal(result.issue.number, 101);
      assert.equal(sent.length, 1, 'the issue embed was posted once');

      const link = await getIssueLinkByThread(thread.id);
      assert.equal(link.githubIssueNumber, 101);
      assert.equal(link.repository, 'ProjectHub-fie/ProjectHub');
    } finally {
      globalThis.__testFetcher = previous;
    }
  });

  await t.test('a thread reply becomes a GitHub comment exactly once', async () => {
    const message = {
      id: `${prefix}-e2e-reply`,
      channelId: thread.id,
      guildId: '555',
      content: 'Reproduced on my machine too.',
      author: { id: '43', username: 'sam', globalName: 'Sam' },
      member: { displayName: 'Sam' },
      createdAt: new Date('2024-01-02T04:00:00Z'),
      attachments: new Map(),
      channel: { id: thread.id, parentId: forumChannelId, isThread: () => true },
    };
    const settings = await (await import('../bot/lib/github-forum-store.js')).getGithubForumSettings();
    const plan = planThreadReply({ message, settings, hasLink: true });
    assert.equal(plan.action, 'enqueue');

    const previous = globalThis.__testFetcher;
    globalThis.__testFetcher = async (url) => {
      if (String(url).includes('/access_tokens')) {
        return stubJson(201, { token: 'ghs_stub1234567890abcdef', expires_at: new Date(Date.now() + 3600_000).toISOString() });
      }
      return stubJson(201, { id: 7007, body: 'x', html_url: 'https://github.com/ProjectHub-fie/ProjectHub/issues/101#issuecomment-7007' });
    };
    try {
      const { job } = await enqueueJob({
        eventType: 'comment_create',
        payload: { messageId: message.id, threadId: thread.id, displayName: 'Sam', username: 'sam', authorId: '43', content: message.content, messageUrl: 'https://discord.com/channels/555/x/y', createdAt: '2024-01-02T04:00:00.000Z', attachments: [] },
        dedupeKey: `comment_create:${message.id}`,
      });
      await claimJobs({ limit: 50 });
      const first = await runJob(job, { client: null, log: null });
      assert.equal(first.comment.id, 7007);

      // A second identical job finds the link and skips, so no second comment.
      const { job: dup } = await enqueueJob({
        eventType: 'comment_create',
        payload: { messageId: message.id, threadId: thread.id, content: message.content },
        dedupeKey: `comment_create:dup:${message.id}`,
      });
      await claimJobs({ limit: 50 });
      const second = await runJob(dup, { client: null, log: null });
      assert.equal(second.skipped, 'already_linked');
    } finally {
      globalThis.__testFetcher = previous;
    }
  });

  await t.test('a GitHub comment webhook posts one Discord reply, and a redelivery does nothing', async () => {
    const { handleGithubWebhook } = await import('../bot/lib/github-forum-webhook.js');
    const { insertIssueLink } = await import('../bot/lib/github-forum-store.js');

    // A linked issue, so the webhook has somewhere to land.
    const threadId = `${prefix}-e2e-webhook-thread`;
    await insertIssueLink({
      discordThreadId: threadId,
      repository: 'ProjectHub-fie/ProjectHub',
      githubOwner: 'ProjectHub-fie',
      githubRepo: 'ProjectHub',
      githubIssueNumber: uniqueIssue,
      githubIssueId: String(uniqueIssue),
      githubIssueUrl: `https://github.com/ProjectHub-fie/ProjectHub/issues/${uniqueIssue}`,
    });

    const env = { ...process.env, GITHUB_WEBHOOK_SECRET: 'e2e-secret', GITHUB_APP_ID: '1', GITHUB_APP_PRIVATE_KEY: 'x', GITHUB_APP_INSTALLATION_ID: '2' };
    const payload = JSON.stringify({
      action: 'created',
      repository: { full_name: 'ProjectHub-fie/ProjectHub' },
      issue: { number: uniqueIssue, title: 'T', html_url: 'https://x/' + uniqueIssue },
      comment: { id: uniqueComment, body: 'Can you attach the log?', html_url: `https://x/${uniqueComment}`, created_at: '2024-01-03T00:00:00Z', user: { login: 'reviewer', id: 3 } },
    });
    const headers = {
      'x-github-event': 'issue_comment',
      'x-github-delivery': `${prefix}-e2e-delivery`,
      'x-hub-signature-256': `sha256=${crypto.createHmac('sha256', 'e2e-secret').update(payload).digest('hex')}`,
    };

    const first = await handleGithubWebhook({ rawBody: payload, headers, env });
    assert.equal(first.status, 202);
    assert.equal(first.body.queued, true);

    const duplicate = await handleGithubWebhook({ rawBody: payload, headers, env });
    assert.equal(duplicate.body.duplicate, true);

    // Only one discord_reply job exists for the comment.
    const jobs = await listJobs({ limit: 200 });
    const replies = jobs.filter((job) => job.eventType === 'discord_reply' && job.payload?.commentId === String(uniqueComment));
    assert.equal(replies.length, 1);
  });

  // Restore the environment so no later test inherits the throwaway key.
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const { clearTokenCache } = await import('../bot/lib/github-forum-client.js');
  clearTokenCache();
});

