/**
 * The Discord Forum ↔ GitHub Issues service.
 *
 * The one place that composes the store, the GitHub App client and the pure
 * rules, so the bot's event handlers and the queue worker share exactly the same
 * behaviour. Everything here is written so a failure is a *value*, not an
 * exception that escapes into the gateway handler: a GitHub outage must never
 * crash the bot or stop it answering messages.
 *
 * ## Ordering and idempotency
 *
 * A Discord event only *enqueues* a job; the worker performs the GitHub call.
 * That keeps the gateway handler fast (the requirement that a long GitHub call
 * never blocks message handling) and means a restart resumes the work from the
 * queue. Every job carries a database-level dedupe key, and every link is
 * written with `ON CONFLICT DO NOTHING`, so a redelivered event is a no-op.
 */
import {
  JOB_TYPE,
  JOB_STATUS,
  ISSUE_STATE,
  SYNC_DIRECTION,
  resolveRepositoryForTags,
  resolutionMessage,
  buildIssueBody,
  buildCommentBody,
  buildIssueEmbed,
  buildCommentEmbed,
  buildStateEmbed,
  buildNoticeEmbed,
  isBotGeneratedMessage,
  isIntegrationComment,
  clampTitle,
  parseRepositoryFullName,
  toEmbedDescription,
} from './github-forum-logic.js';
import {
  getGithubForumSettings,
  listEnabledMappings,
  getIssueLinkByThread,
  getIssueLinkByIssue,
  insertIssueLink,
  updateIssueState,
  recordMessageLink,
  isDiscordMessageLinked,
  isGithubCommentLinked,
  enqueueJob,
  listJobs,
  recordSyncLog,
} from './github-forum-store.js';
import {
  createIssue,
  createIssueComment,
  getIssue,
  isGithubAppConfigured,
} from './github-forum-client.js';

/** How many messages are read back when looking for a pending issue job. */
const PENDING_LOOKUP_LIMIT = 50;

/* -------------------------------------------------------------- helpers */

/** Whether the integration is on and has the minimum it needs. */
export function isIntegrationReady(settings) {
  return Boolean(settings?.enabled && settings.forumChannelId);
}

/** Splits a stored `owner/repo` full name safely. */
function splitRepository(repository) {
  const parsed = parseRepositoryFullName(repository);
  if (!parsed) return null;
  return { owner: parsed.owner, repository: parsed.repository };
}

/** A tolerant ISO timestamp: accepts a Date, an ISO string, or nothing. */
function toIso(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? new Date().toISOString() : value.toISOString();
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

/**
 * The Discord attachments of a message, shaped for the sync.
 *
 * Only the URL, name, size and type travel; nothing is downloaded and nothing is
 * uploaded, so a Discord CDN link is preserved as-is (and the body says it may
 * expire) rather than being treated as permanent.
 */
export function messageAttachments(message, { enabled = true } = {}) {
  if (!enabled) return [];
  const collection = message?.attachments;
  if (!collection) return [];
  const values = typeof collection.values === 'function' ? [...collection.values()] : [...collection];
  return values
    .filter((file) => file && typeof file.url === 'string' && /^https?:\/\//i.test(file.url))
    .map((file) => ({
      url: file.url,
      name: file.name || 'attachment',
      size: Number(file.size) || 0,
      contentType: file.contentType || null,
    }));
}

/* --------------------------------------------------- forum post -> issue */

/**
 * Decides what a new Forum post should do, without doing it.
 *
 * The pure decision the tests pin: it resolves the applied tags against the
 * mappings and returns either a job to enqueue or a reason to tell the author
 * why nothing happened. It reads no live Discord state beyond the thread's tags.
 */
export function planForumPost({ thread, settings, mappings }) {
  if (!isIntegrationReady(settings)) return { action: 'skip', reason: 'disabled' };
  if (!settings.createIssues) return { action: 'skip', reason: 'issues_disabled' };
  if (String(thread?.parentId || '') !== String(settings.forumChannelId)) {
    return { action: 'skip', reason: 'wrong_channel' };
  }

  const appliedTags = Array.isArray(thread?.appliedTags) ? thread.appliedTags : [];
  const resolution = resolveRepositoryForTags(appliedTags, mappings);
  if (!resolution.ok) {
    return { action: 'notify', reason: resolution.reason, message: resolutionMessage(resolution.reason, resolution) };
  }

  const repository = `${resolution.mapping.githubOwner}/${resolution.mapping.githubRepository}`;
  if (!splitRepository(repository)) {
    return {
      action: 'notify',
      reason: 'invalid_repository',
      message: `The mapping for tag "${resolution.mapping.discordTagName || resolution.mapping.discordTagId}" is not a valid owner/repository pair. Fix it in the ProjectHub dashboard.`,
    };
  }

  return { action: 'enqueue', reason: 'ok', mapping: resolution.mapping, repository };
}

/**
 * Enqueues issue creation for a Forum post.
 *
 * Called from the `ThreadCreate` handler. It fetches the starter message,
 * snapshots everything the issue needs into the payload (so the job is
 * processable after a restart), and returns the enqueue result. A notify
 * outcome posts an explanation into the thread instead of creating an issue.
 */
export async function handleForumPost(thread, { log = null } = {}) {
  const settings = await getGithubForumSettings();
  if (!isIntegrationReady(settings)) return { skipped: 'disabled' };

  const mappings = await listEnabledMappings();
  const plan = planForumPost({ thread, settings, mappings });

  if (plan.action === 'skip') return { skipped: plan.reason };

  if (plan.action === 'notify') {
    await postNotice(thread, {
      title: 'No repository tag',
      description: plan.message,
      tone: plan.reason === 'multiple' ? 'warning' : 'error',
    });
    await recordSyncLog({
      eventType: 'forum_post',
      source: 'discord',
      destination: 'github',
      status: 'skipped',
      errorSummary: plan.reason,
      detail: { threadId: thread?.id || null, tags: thread?.appliedTags || [] },
    });
    log?.('forum post %s skipped: %s', thread?.id, plan.reason);
    return { skipped: plan.reason, message: plan.message };
  }

  // A thread is linked at most once: a duplicate ThreadCreate delivery finds the
  // existing link and does nothing.
  const existing = await getIssueLinkByThread(thread.id);
  if (existing) return { skipped: 'already_linked', link: existing };

  const starter = await fetchStarter(thread);
  const payload = {
    threadId: thread.id,
    guildId: thread.guildId || thread.guild?.id || null,
    channelId: thread.parentId || null,
    starterMessageId: starter?.id || null,
    title: clampTitle(thread.name || starter?.content || 'Discord forum post'),
    content: starter?.content || '',
    authorName: starter?.member?.displayName || starter?.author?.globalName || starter?.author?.username || 'Unknown',
    authorUsername: starter?.author?.username || '',
    authorId: starter?.author?.id || '',
    guildName: thread.guild?.name || '',
    channelName: thread.parent?.name || '',
    threadUrl: threadUrl(thread),
    createdAt: (starter?.createdAt || thread.createdAt || new Date()).toISOString(),
    attachments: messageAttachments(starter, { enabled: settings.syncAttachments }),
    repository: plan.repository,
    owner: plan.mapping.githubOwner,
    repo: plan.mapping.githubRepository,
    tagId: plan.mapping.discordTagId,
  };

  const result = await enqueueJob({
    eventType: JOB_TYPE.ISSUE_CREATE,
    payload,
    dedupeKey: `issue_create:${thread.id}`,
  });
  log?.('forum post %s queued for %s (%s)', thread.id, plan.repository, result.enqueued ? 'new' : 'duplicate');
  return { enqueued: result.enqueued, repository: plan.repository };
}

/** Fetches the starter message of a thread, tolerating a missing one. */
export async function fetchStarter(thread) {
  try {
    if (typeof thread?.fetchStarterMessage === 'function') return await thread.fetchStarterMessage();
  } catch {
    // A deleted starter message is not fatal: the issue is still opened with the
    // thread title and no body, rather than not at all.
  }
  return null;
}

/** The `https://discord.com/channels/...` URL for a thread. */
export function threadUrl(thread) {
  const guildId = thread?.guildId || thread?.guild?.id;
  if (!guildId || !thread?.id) return '';
  return `https://discord.com/channels/${guildId}/${thread.id}`;
}

/** The `https://discord.com/channels/...` URL for a message. */
export function messageUrl(message) {
  const guildId = message?.guildId || message?.guild?.id;
  if (!guildId || !message?.channelId || !message?.id) return '';
  return `https://discord.com/channels/${guildId}/${message.channelId}/${message.id}`;
}

/** Posts a small embed into a thread, ignoring a failure. */
async function postNotice(channel, notice) {
  try {
    if (typeof channel?.send === 'function') {
      await channel.send({ embeds: [buildNoticeEmbed(notice)], allowed_mentions: { parse: [] } });
    }
  } catch (error) {
    console.error('[bot] forum notice failed:', error.message);
  }
}

/* --------------------------------------------------- thread reply -> comment */

/**
 * Decides whether a thread message should become a GitHub comment.
 *
 * Pure: given the message's shape and the settings, it answers yes/no and why.
 * The starter message of the thread is not a reply, and a bot or integration
 * message is never synced — that is the loop guard.
 */
export function planThreadReply({ message, settings, starterMessageId = null, hasLink = false, hasPendingIssue = false }) {
  if (!isIntegrationReady(settings)) return { action: 'skip', reason: 'disabled' };
  if (!settings.syncDiscordToGithub) return { action: 'skip', reason: 'sync_disabled' };
  if (!message?.channel?.isThread?.()) return { action: 'skip', reason: 'not_thread' };
  if (String(message.channel.parentId || '') !== String(settings.forumChannelId)) {
    return { action: 'skip', reason: 'wrong_channel' };
  }
  if (isBotGeneratedMessage(message)) return { action: 'skip', reason: 'bot_message' };
  if (starterMessageId && String(message.id) === String(starterMessageId)) {
    return { action: 'skip', reason: 'starter_message' };
  }
  // The thread must be linked, or about to be: a reply that arrives while issue
  // creation is still queued is kept, and the worker waits for the link.
  if (!hasLink && !hasPendingIssue) return { action: 'skip', reason: 'unlinked_thread' };
  return { action: 'enqueue', reason: 'ok' };
}

/**
 * Enqueues a Discord reply as a GitHub comment.
 *
 * The payload is self-contained, so a job recovered after a restart still has
 * everything the comment needs.
 */
export async function handleThreadReply(message, { log = null } = {}) {
  const settings = await getGithubForumSettings();
  if (!isIntegrationReady(settings)) return { skipped: 'disabled' };

  const threadId = message.channel?.id;
  const link = await getIssueLinkByThread(threadId);
  const hasPendingIssue = link ? false : await hasPendingIssueJob(threadId);

  const plan = planThreadReply({
    message,
    settings,
    starterMessageId: link?.discordStarterMessageId || null,
    hasLink: Boolean(link),
    hasPendingIssue,
  });
  if (plan.action !== 'enqueue') return { skipped: plan.reason };

  const payload = {
    messageId: message.id,
    threadId,
    displayName: message.member?.displayName || message.author?.globalName || message.author?.username || 'Discord member',
    username: message.author?.username || '',
    authorId: message.author?.id || '',
    content: message.content || '',
    messageUrl: messageUrl(message),
    createdAt: (message.createdAt || new Date()).toISOString(),
    attachments: messageAttachments(message, { enabled: settings.syncAttachments }),
  };

  const result = await enqueueJob({
    eventType: JOB_TYPE.COMMENT_CREATE,
    payload,
    dedupeKey: `comment_create:${message.id}`,
  });
  log?.('thread reply %s queued (%s)', message.id, result.enqueued ? 'new' : 'duplicate');
  return { enqueued: result.enqueued };
}

/** Whether an issue-creation job for this thread is still waiting. */
async function hasPendingIssueJob(threadId) {
  const jobs = await listJobs({ status: JOB_STATUS.PENDING, limit: PENDING_LOOKUP_LIMIT }).catch(() => []);
  return jobs.some(
    (job) => job.eventType === JOB_TYPE.ISSUE_CREATE && String(job.payload?.threadId) === String(threadId),
  );
}

/* ------------------------------------------- GitHub comment -> Discord reply */

/**
 * Enqueues a GitHub comment for publication into its Discord thread.
 *
 * Called by the webhook consumer. `comment` is already validated and known to
 * belong to a linked issue. An integration-authored comment is refused here as
 * well as at the webhook, so the loop guard does not depend on one call site.
 */
export async function enqueueGithubComment({ link, comment, appLogin = '' } = {}) {
  if (!link || !comment) return { enqueued: false, reason: 'no_link' };
  if (isIntegrationComment(comment.body, { authorLogin: comment.user?.login, appLogin })) {
    return { enqueued: false, reason: 'integration_comment' };
  }
  if (await isGithubCommentLinked(comment.id)) return { enqueued: false, reason: 'already_linked' };

  const settings = await getGithubForumSettings();
  if (!settings.syncGithubToDiscord) return { enqueued: false, reason: 'sync_disabled' };

  const payload = {
    commentId: String(comment.id),
    threadId: link.discordThreadId,
    repository: link.repository,
    issueNumber: link.githubIssueNumber,
    login: comment.user?.login || 'GitHub user',
    body: comment.body || '',
    commentUrl: comment.url || '',
    avatarUrl: comment.user?.avatarUrl || null,
    createdAt: toIso(comment.createdAt),
  };
  const result = await enqueueJob({
    eventType: JOB_TYPE.DISCORD_REPLY,
    payload,
    dedupeKey: `discord_reply:${comment.id}`,
  });
  return { enqueued: result.enqueued };
}

/* ------------------------------------------- issue state -> Discord notice */

/**
 * Enqueues a close/reopen notification for a linked issue.
 *
 * `notifyStateChanges` gates it, and the tracked state is updated by the worker
 * only once the notice is posted, so a delivery that arrives twice does not post
 * twice (the second sees the state already recorded).
 */
export async function enqueueStateChange({ link, state, title = '', url = '', appLogin = '' } = {}) {
  if (!link) return { enqueued: false, reason: 'no_link' };
  const settings = await getGithubForumSettings();
  if (!settings.notifyStateChanges) return { enqueued: false, reason: 'notify_disabled' };
  if (link.issueState === state) return { enqueued: false, reason: 'no_change' };

  const payload = {
    threadId: link.discordThreadId,
    repository: link.repository,
    issueNumber: link.githubIssueNumber,
    issueTitle: title || '',
    issueUrl: url || link.githubIssueUrl || '',
    state,
    at: new Date().toISOString(),
  };
  const result = await enqueueJob({
    eventType: JOB_TYPE.STATE_NOTIFY,
    payload,
    // The state is part of the key, so a close and a reopen are distinct jobs
    // while a duplicate delivery of the same one collapses.
    dedupeKey: `state:${link.repository}:${link.githubIssueNumber}:${state}`,
  });
  return { enqueued: result.enqueued };
}

/* ------------------------------------------------------------ worker steps */

/**
 * Performs issue creation for one job.
 *
 * On success it records the link, posts the premium embed, and logs the result.
 * The link write is what makes the operation idempotent: a retried job finds the
 * link already present (the store's `ON CONFLICT`) rather than opening a second
 * issue — the GitHub call itself is guarded by the job's dedupe key, which is
 * why the key is written before the first attempt can be retried.
 */
export async function performIssueCreate(job, { client = null, log = null } = {}) {
  const payload = job.payload || {};
  const split = splitRepository(payload.repository);
  if (!split) throw new Error(`invalid repository: ${payload.repository}`);

  if (!isGithubAppConfigured()) {
    const error = new Error('The GitHub App is not configured; set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and GITHUB_APP_INSTALLATION_ID');
    error.permanent = true;
    throw error;
  }

  const existing = await getIssueLinkByThread(payload.threadId);
  if (existing) {
    log?.('issue for thread %s already exists (#%s)', payload.threadId, existing.githubIssueNumber);
    return { skipped: 'already_linked', link: existing };
  }

  const body = buildIssueBody({
    content: payload.content,
    authorName: payload.authorName,
    authorUsername: payload.authorUsername,
    authorId: payload.authorId,
    guildName: payload.guildName,
    guildId: payload.guildId,
    channelName: payload.channelName,
    threadUrl: payload.threadUrl,
    createdAt: payload.createdAt,
    attachments: payload.attachments,
  });

  const settings = await getGithubForumSettings();
  const labels = settings.issueLabels
    ? String(settings.issueLabels).split(',').map((l) => l.trim()).filter(Boolean)
    : [];

  const issue = await createIssue({
    owner: split.owner,
    repository: split.repository,
    title: payload.title,
    body,
    labels,
  });

  const link = await insertIssueLink({
    discordThreadId: payload.threadId,
    discordStarterMessageId: payload.starterMessageId,
    discordGuildId: payload.guildId,
    repository: payload.repository,
    githubOwner: split.owner,
    githubRepo: split.repository,
    githubIssueNumber: issue.number,
    githubIssueId: issue.id,
    githubIssueUrl: issue.url,
    issueState: issue.state || ISSUE_STATE.OPEN,
  });

  // The starter message is recorded as a message link too, so a reply that
  // arrives for the starter id can never be mistaken for a new comment.
  if (payload.starterMessageId) {
    await recordMessageLink({
      discordMessageId: payload.starterMessageId,
      discordThreadId: payload.threadId,
      repository: payload.repository,
      issueNumber: issue.number,
      direction: SYNC_DIRECTION.DISCORD_TO_GITHUB,
    }).catch(() => {});
  }

  await postToThread(client, payload.threadId, {
    embeds: [
      buildIssueEmbed({
        repository: payload.repository,
        issueNumber: issue.number,
        issueTitle: issue.title,
        issueUrl: issue.url,
        createdAt: new Date(),
        synchronized: true,
      }),
    ],
  });

  await recordSyncLog({
    eventId: job.id,
    eventType: JOB_TYPE.ISSUE_CREATE,
    source: 'discord',
    destination: 'github',
    repository: payload.repository,
    issueNumber: issue.number,
    status: 'success',
    direction: SYNC_DIRECTION.DISCORD_TO_GITHUB,
    attempts: job.attempts,
    detail: { threadId: payload.threadId },
  });

  return { link, issue };
}

/**
 * Performs comment creation for one job.
 *
 * If the thread's issue link does not exist yet the job is *deferred*: it is
 * thrown as a retryable error so the queue backs off and tries again after issue
 * creation completes, rather than dropping the reply.
 */
export async function performCommentCreate(job, { client = null, log = null } = {}) {
  const payload = job.payload || {};
  const link = await getIssueLinkByThread(payload.threadId);
  if (!link) {
    const error = new Error('the thread is not linked to an issue yet');
    error.defer = true;
    throw error;
  }

  if (await isDiscordMessageLinked(payload.messageId)) {
    return { skipped: 'already_linked' };
  }

  const body = buildCommentBody({
    content: payload.content,
    displayName: payload.displayName,
    username: payload.username,
    authorId: payload.authorId,
    messageUrl: payload.messageUrl,
    createdAt: payload.createdAt,
    attachments: payload.attachments,
  });

  const comment = await createIssueComment({
    owner: link.githubOwner,
    repository: link.githubRepo,
    issueNumber: link.githubIssueNumber,
    body,
  });

  await recordMessageLink({
    discordMessageId: payload.messageId,
    discordThreadId: payload.threadId,
    repository: link.repository,
    issueNumber: link.githubIssueNumber,
    githubCommentId: comment.id,
    direction: SYNC_DIRECTION.DISCORD_TO_GITHUB,
  });

  await recordSyncLog({
    eventId: job.id,
    eventType: JOB_TYPE.COMMENT_CREATE,
    source: 'discord',
    destination: 'github',
    repository: link.repository,
    issueNumber: link.githubIssueNumber,
    status: 'success',
    direction: SYNC_DIRECTION.DISCORD_TO_GITHUB,
    attempts: job.attempts,
    detail: { messageId: payload.messageId, commentId: String(comment.id) },
  });

  log?.('comment created for message %s -> %s#%s', payload.messageId, link.repository, comment.id);
  return { comment };
}

/** Publishes a GitHub comment into its Discord thread. */
export async function performDiscordReply(job, { client = null, log = null } = {}) {
  const payload = job.payload || {};
  if (await isGithubCommentLinked(payload.commentId)) return { skipped: 'already_linked' };

  const message = await postToThread(client, payload.threadId, {
    embeds: [
      buildCommentEmbed({
        login: payload.login,
        body: payload.body,
        commentUrl: payload.commentUrl,
        createdAt: payload.createdAt ? new Date(payload.createdAt) : new Date(),
      }),
    ],
  });

  await recordMessageLink({
    discordMessageId: message?.id || `github:${payload.commentId}`,
    discordThreadId: payload.threadId,
    repository: payload.repository,
    issueNumber: payload.issueNumber,
    githubCommentId: payload.commentId,
    direction: SYNC_DIRECTION.GITHUB_TO_DISCORD,
  });

  await recordSyncLog({
    eventId: job.id,
    eventType: JOB_TYPE.DISCORD_REPLY,
    source: 'github',
    destination: 'discord',
    repository: payload.repository,
    issueNumber: payload.issueNumber,
    status: 'success',
    direction: SYNC_DIRECTION.GITHUB_TO_DISCORD,
    attempts: job.attempts,
    detail: { commentId: payload.commentId, messageId: message?.id || null },
  });

  log?.('github comment %s published into thread %s', payload.commentId, payload.threadId);
  return { messageId: message?.id || null };
}

/** Posts an issue state change into the thread and records the new state. */
export async function performStateNotify(job, { client = null, log = null } = {}) {
  const payload = job.payload || {};
  const link = await getIssueLinkByThread(payload.threadId);
  if (!link) {
    const error = new Error('the thread is not linked to an issue');
    error.permanent = true;
    throw error;
  }

  await postToThread(client, payload.threadId, {
    embeds: [
      buildStateEmbed({
        repository: payload.repository,
        issueNumber: payload.issueNumber,
        issueTitle: payload.issueTitle,
        issueUrl: payload.issueUrl,
        state: payload.state,
        at: payload.at ? new Date(payload.at) : new Date(),
      }),
    ],
  });

  await updateIssueState({
    repository: payload.repository,
    issueNumber: payload.issueNumber,
    state: payload.state,
  });

  await recordSyncLog({
    eventId: job.id,
    eventType: JOB_TYPE.STATE_NOTIFY,
    source: 'github',
    destination: 'discord',
    repository: payload.repository,
    issueNumber: payload.issueNumber,
    status: 'success',
    direction: SYNC_DIRECTION.GITHUB_TO_DISCORD,
    attempts: job.attempts,
    detail: { state: payload.state },
  });

  log?.('issue %s#%s state %s announced', payload.repository, payload.issueNumber, payload.state);
  return { state: payload.state };
}

/** Sends to a thread by id, resolving the channel through the client. */
async function postToThread(client, threadId, message) {
  if (!client || !threadId) return null;
  try {
    const channel = await client.channels.fetch(threadId);
    if (!channel?.isThread?.() && !channel?.isTextBased?.()) return null;
    return await channel.send({ ...message, allowed_mentions: { parse: [] } });
  } catch (error) {
    // A send failure is not fatal to the sync: the link is still recorded, so a
    // retry does not duplicate the GitHub side.
    console.error('[bot] could not post into thread', threadId, error.message);
    throw error;
  }
}

/**
 * Refreshes a linked issue's live state from GitHub.
 *
 * Used by the webhook path when the payload does not carry the full issue, and
 * by the dashboard's manual refresh. Best-effort: an unreachable GitHub returns
 * `null` rather than failing the caller.
 */
export async function refreshIssueState(link) {
  if (!link) return null;
  try {
    const issue = await getIssue({
      owner: link.githubOwner,
      repository: link.githubRepo,
      issueNumber: link.githubIssueNumber,
    });
    return issue;
  } catch (error) {
    console.error('[bot] issue refresh failed:', error.message);
    return null;
  }
}

/* ------------------------------------------------------------ dashboard */

/**
 * The integration's health, for the dashboard overview.
 *
 * `healthy` is deliberately conservative: it is true only when the integration
 * is enabled, a Forum channel and at least one enabled mapping exist, and the
 * GitHub App credentials are present. It is not a claim that a live GitHub call
 * just succeeded — the dashboard's Test action does that.
 */
export async function getIntegrationHealth({ env = process.env } = {}) {
  const settings = await getGithubForumSettings();
  const mappings = await listEnabledMappings();
  const appConfigured = isGithubAppConfigured(env);
  const webhookConfigured = Boolean(String(env.GITHUB_WEBHOOK_SECRET || '').trim());

  const problems = [];
  if (!settings.enabled) problems.push('The integration is disabled.');
  if (!settings.forumChannelId) problems.push('No Forum channel is configured.');
  if (!mappings.length) problems.push('No enabled repository mappings.');
  if (!appConfigured) problems.push('The GitHub App credentials are not set.');
  if (!webhookConfigured) problems.push('The webhook secret is not set, so GitHub comments cannot arrive.');

  return {
    enabled: settings.enabled,
    forumConfigured: Boolean(settings.forumChannelId),
    appConfigured,
    webhookConfigured,
    mappingCount: mappings.length,
    healthy: problems.length === 0,
    problems,
  };
}

export { toEmbedDescription, buildStateEmbed, buildCommentEmbed, buildIssueEmbed, ISSUE_STATE };
