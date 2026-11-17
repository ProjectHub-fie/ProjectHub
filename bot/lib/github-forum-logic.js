/**
 * Pure rules for the Discord Forum ↔ GitHub Issues integration.
 *
 * Nothing here imports discord.js, a database driver, `node:crypto` or
 * `process.env`. The tag resolution, the issue body, the comment body, the loop
 * guard, the backoff schedule and the redaction helper are all plain functions,
 * so the rules that matter — which repository a post belongs to, what the issue
 * says, and whether a message is ours — are checkable without a gateway, a
 * GitHub App key or a database.
 *
 * The integration is one Forum channel whose only tags denote repositories.
 * A tag maps to exactly one GitHub repository, and a post is submitted by
 * applying exactly one of them.
 */

/** The sync directions a message link can record. */
export const SYNC_DIRECTION = {
  /** Discord message -> GitHub comment. */
  DISCORD_TO_GITHUB: 'discord_to_github',
  /** GitHub comment -> Discord reply. */
  GITHUB_TO_DISCORD: 'github_to_discord',
};

/** The states an issue link tracks. Mirrors GitHub's own `state` values. */
export const ISSUE_STATE = { OPEN: 'open', CLOSED: 'closed' };

/** The job statuses the persistent queue uses. */
export const JOB_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  DEAD: 'dead',
};

/** Event types the queue carries. */
export const JOB_TYPE = {
  /** Create a GitHub issue from a Forum post. */
  ISSUE_CREATE: 'issue_create',
  /** Create a GitHub comment from a Discord reply. */
  COMMENT_CREATE: 'comment_create',
  /** Publish a GitHub comment into the Discord thread. */
  DISCORD_REPLY: 'discord_reply',
  /** Post an issue state change (closed/reopened) into the Discord thread. */
  STATE_NOTIFY: 'state_notify',
};

/** The queue's bounded retry count and exponential backoff. */
export const MAX_JOB_ATTEMPTS = 6;
export const BASE_RETRY_MS = 30 * 1000;
export const MAX_RETRY_MS = 60 * 60 * 1000;

/** Bounded worker size: the bot is a small process, so concurrency stays small. */
export const WORKER_BATCH_SIZE = 5;

/** Caps that keep a single message from becoming an unbounded payload. */
export const MAX_BODY_LENGTH = 60_000;
export const MAX_ATTACHMENTS = 10;
export const MAX_TITLE_LENGTH = 250;

/** The footer every generated issue and comment carries. */
export const INTEGRATION_MARKER = '<!-- projecthub-forum-sync -->';

/**
 * Whether a Discord tag denotes a repository.
 *
 * A configured mapping is the only thing that counts: a tag an administrator
 * has not mapped (or has disabled) resolves to nothing, so the post is not
 * submitted. `mappings` is the list of enabled mapping rows.
 */
export function isRepositoryTag(tagId, mappings = []) {
  return mappings.some((mapping) => String(mapping.discordTagId) === String(tagId));
}

/**
 * Resolves the repository a Forum post belongs to.
 *
 * The single decision point for the whole feature, and the one the tests pin.
 * Returns a discriminated result rather than throwing, so the caller can tell a
 * missing tag from a conflicting one and reply with the right message:
 *
 *   - `ok`         — exactly one enabled mapping matched. Continue.
 *   - `no_tag`     — no applied tag is a configured repository tag.
 *   - `multiple`   — more than one applied tag is a configured repository tag.
 *   - `disabled`   — tags matched only disabled mappings (no enabled one).
 *   - `unmapped`   — the integration has no mappings at all.
 *
 * `appliedTagIds` are the tag ids on the Forum post; `mappings` is the full list
 * (enabled and disabled) so a disabled match can be reported distinctly.
 */
export function resolveRepositoryForTags(appliedTagIds = [], mappings = []) {
  const applied = (appliedTagIds || []).map((id) => String(id));
  if (!mappings.length) {
    return { ok: false, reason: 'unmapped', matches: [] };
  }

  const matched = mappings.filter((mapping) => applied.includes(String(mapping.discordTagId)));
  const enabled = matched.filter((mapping) => mapping.enabled !== false);

  if (enabled.length === 1) {
    return { ok: true, reason: 'ok', mapping: enabled[0], matches: enabled };
  }
  if (enabled.length > 1) {
    return { ok: false, reason: 'multiple', matches: enabled };
  }
  if (matched.length) {
    // The only tags applied belong to disabled mappings.
    return { ok: false, reason: 'disabled', matches: matched };
  }
  return { ok: false, reason: 'no_tag', matches: [] };
}

/** The user-facing explanation for a non-`ok` resolution. */
export function resolutionMessage(reason, { matches = [] } = {}) {
  switch (reason) {
    case 'no_tag':
      return 'Add exactly one repository tag to this post so I can open an issue. The tag names the repository.';
    case 'multiple':
      return `This post has more than one repository tag (${matches
        .map((m) => m.discordTagName || m.discordTagId)
        .join(', ')}). Keep exactly one and I will open the issue.`;
    case 'disabled':
      return 'The repository tag on this post is disabled in the ProjectHub dashboard, so no issue was opened.';
    case 'unmapped':
      return 'No repository tags are configured yet. An administrator can add them in the ProjectHub dashboard.';
    default:
      return 'This post could not be linked to a repository.';
  }
}

/** Splits `owner/repo` into its parts, or `null` when the shape is wrong. */
export function parseRepositoryFullName(fullName) {
  const value = String(fullName || '').trim();
  const match = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38})?)\/([A-Za-z0-9._-]{1,100})$/.exec(value);
  if (!match) return null;
  return { owner: match[1], repository: match[2] };
}

/** Validates a GitHub owner/repository pair, returning a reason or `null`. */
export function repositoryProblem(owner, repository) {
  if (!String(owner || '').trim() || !String(repository || '').trim()) {
    return 'Both a GitHub owner and a repository name are required';
  }
  const parsed = parseRepositoryFullName(`${owner}/${repository}`);
  if (!parsed) return 'Enter a GitHub repository as owner/name (letters, digits, dots, dashes, underscores)';
  return null;
}

/** Truncates a title to GitHub's practical limit without cutting mid-word. */
export function clampTitle(title) {
  const text = String(title || '').trim().replace(/\s+/g, ' ');
  if (!text) return 'Discord forum post';
  if (text.length <= MAX_TITLE_LENGTH) return text;
  return `${text.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}

/** A single backtick-wrapped value with any backticks removed. */
function code(value) {
  return `\`${String(value ?? '').replace(/`/g, "'")}\``;
}

/**
 * Renders an attachment list.
 *
 * Discord CDN URLs are signed and expire, so the URL is preserved verbatim and
 * the note says so rather than implying a permanent link. Nothing is uploaded to
 * GitHub here: the URL is all that travels.
 */
export function formatAttachments(attachments = []) {
  const list = (attachments || []).slice(0, MAX_ATTACHMENTS);
  const lines = list
    .filter((file) => file && typeof file.url === 'string' && /^https?:\/\//i.test(file.url))
    .map((file) => {
      // The name is data from Discord, so brackets are escaped: an unescaped
      // `]` would break the link and could forge markdown around it.
      const name = escapeMarkdownLinkText(file.name || 'attachment');
      const size = Number(file.size);
      const sizeText = Number.isFinite(size) && size > 0 ? ` (${formatBytes(size)})` : '';
      const type = file.contentType ? ` · ${escapeMarkdownLinkText(file.contentType)}` : '';
      return `- [${name}](${file.url})${sizeText}${type}`;
    });
  if (!lines.length) return '';
  return ['**Attachments**', ...lines, '', '_Discord attachment links are signed and may expire._'].join('\n');
}

/** Escapes the characters that would break a Markdown link's text. */
function escapeMarkdownLinkText(text) {
  return String(text).replace(/[[\]()\\`]/g, '\\$&');
}

/** A compact byte size for an attachment line. */
export function formatBytes(bytes) {
  const amount = Number(bytes);
  if (!Number.isFinite(amount) || amount <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = amount;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/**
 * Whether a message is one of ours.
 *
 * The loop guard for the Discord → GitHub direction. A bot message, or one
 * carrying the integration marker, must never be turned into a GitHub comment —
 * otherwise a GitHub comment we published into Discord would be read back and
 * re-commented, forever. A webhook author (our own integration posts) counts as
 * a bot even when `author.bot` is false.
 */
export function isBotGeneratedMessage(message) {
  if (!message) return true;
  if (message.author?.bot) return true;
  if (message.webhookId) return true;
  if (typeof message.content === 'string' && message.content.includes(INTEGRATION_MARKER)) return true;
  return false;
}

/**
 * Whether a GitHub comment body is one of ours.
 *
 * The loop guard for the GitHub → Discord direction, mirroring
 * `isBotGeneratedMessage`. A comment carrying the marker, or authored by our own
 * App (the `botLogin` ending in `[bot]`), is ignored.
 */
export function isIntegrationComment(body, { authorLogin = '', appLogin = '' } = {}) {
  if (typeof body === 'string' && body.includes(INTEGRATION_MARKER)) return true;
  const login = String(authorLogin || '');
  if (appLogin && login && login.toLowerCase() === String(appLogin).toLowerCase()) return true;
  if (login.endsWith('[bot]')) return true;
  return false;
}

/**
 * Builds the GitHub issue body for a Forum post.
 *
 * Every field comes from the caller: nothing is fabricated. The original post
 * text is kept verbatim, and the Discord metadata (author, ids, server, channel,
 * thread URL, timestamp) is rendered as a table so it survives as a record even
 * after the Discord post is gone.
 */
export function buildIssueBody({
  content = '',
  authorName = '',
  authorUsername = '',
  authorId = '',
  guildName = '',
  guildId = '',
  channelName = '',
  threadUrl = '',
  createdAt = null,
  attachments = [],
  marker = INTEGRATION_MARKER,
} = {}) {
  const body = String(content || '').trim() || '_No message content._';
  const lines = [
    body,
    '',
    formatAttachments(attachments),
    formatAttachments(attachments) ? '' : null,
    '---',
    '',
    '**Submitted from Discord**',
    '',
    `| Field | Value |`,
    `| --- | --- |`,
    `| Author | ${authorName || 'Unknown'}${authorUsername ? ` (@${authorUsername})` : ''} |`,
    `| Discord user id | ${code(authorId || 'unknown')} |`,
    `| Server | ${guildName || 'Unknown'}${guildId ? ` (${code(guildId)})` : ''} |`,
    `| Forum channel | ${channelName || 'Unknown'} |`,
    `| Thread | ${threadUrl ? `[open in Discord](${threadUrl})` : 'unavailable'} |`,
    `| Posted | ${formatTimestamp(createdAt)} |`,
    '',
    marker,
  ].filter((line) => line !== null);

  return truncate(lines.join('\n'), MAX_BODY_LENGTH);
}

/**
 * Builds the GitHub comment body for a Discord reply.
 *
 * The display name and username are both carried, because either alone is
 * ambiguous: two members can share a display name, and a username can change.
 * The message URL is included so the comment can be traced back to the exact
 * Discord message.
 */
export function buildCommentBody({
  content = '',
  displayName = '',
  username = '',
  authorId = '',
  messageUrl = '',
  createdAt = null,
  attachments = [],
  marker = INTEGRATION_MARKER,
} = {}) {
  const body = String(content || '').trim() || '_No message content._';
  const lines = [
    `**${displayName || username || 'Discord member'}** (Discord)`,
    '',
    body,
    '',
    formatAttachments(attachments),
    formatAttachments(attachments) ? '' : null,
    `_${username ? `@${username} · ` : ''}${code(authorId || 'unknown')} · ${formatTimestamp(createdAt)}${
      messageUrl ? ` · [message](${messageUrl})` : ''
    }_`,
    marker,
  ].filter((line) => line !== null);

  return truncate(lines.join('\n'), MAX_BODY_LENGTH);
}

/** An ISO-8601 UTC timestamp, or `unknown` when the value is missing. */
export function formatTimestamp(value) {
  if (!value) return 'unknown';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toISOString();
}

/** Hard-truncates text to a byte budget, appending a marker when it cuts. */
export function truncate(text, max) {
  const value = String(text ?? '');
  if (value.length <= max) return value;
  return `${value.slice(0, max - 20)}\n\n…_truncated_`;
}

/**
 * The backoff delay before the next attempt.
 *
 * Exponential with a cap, and a deterministic jitter derived from the attempt so
 * two jobs that failed together do not retry in lockstep. `attempt` is 1-based:
 * the first retry waits `BASE_RETRY_MS`.
 */
export function nextRetryDelay(attempt, { baseMs = BASE_RETRY_MS, maxMs = MAX_RETRY_MS } = {}) {
  const n = Math.max(1, Number(attempt) || 1);
  const raw = baseMs * 2 ** (n - 1);
  const capped = Math.min(maxMs, raw);
  // Deterministic jitter (no randomness): spread by up to 10% of the delay.
  const jitter = Math.floor(capped * 0.1 * ((n % 5) / 5));
  return capped + jitter;
}

/** Whether a failed job has exhausted its attempts and should be parked. */
export function isJobExhausted(attempts, maxAttempts = MAX_JOB_ATTEMPTS) {
  return Number(attempts) >= Number(maxAttempts);
}

/**
 * Whether an HTTP status is worth retrying.
 *
 * 5xx and 429 are transient; 4xx (except 429) is a permanent client error and
 * retrying it only wastes the budget. 403 is treated as transient because
 * GitHub returns it for both permission problems and secondary rate limits, and
 * the retry is bounded either way.
 */
export function isRetryableStatus(status) {
  const code = Number(status);
  if (!Number.isFinite(code)) return true;
  if (code === 429) return true;
  if (code === 403) return true;
  if (code >= 500) return true;
  return false;
}

/** The delay GitHub's `Retry-After`/`retry_after` asks for, in ms, or `null`. */
export function retryAfterMs(headers, body) {
  const read = (value) => {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(MAX_RETRY_MS, Math.round(seconds * 1000));
    return null;
  };
  const header = headers?.get?.('retry-after') ?? headers?.['retry-after'];
  const fromHeader = read(header);
  if (fromHeader !== null) return fromHeader;
  if (body && typeof body === 'object' && body.retry_after !== undefined) return read(body.retry_after);
  return null;
}

/** The plain-text summary shown in a Discord embed from a Markdown body. */
export function toEmbedDescription(markdown, { limit = 4000 } = {}) {
  const text = String(markdown || '')
    .replace(/<!--[^>]*-->/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return '_No content._';
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

/** The project name used in the issue footer, without the marker comment. */
export function integrationFooter({ repository = '', issueNumber = null, discordThreadId = '' } = {}) {
  const parts = ['Synced by **ProjectHub**'];
  if (repository) parts.push(`from ${code(repository)}`);
  if (issueNumber) parts.push(`issue ${code(`#${issueNumber}`)}`);
  if (discordThreadId) parts.push(`thread ${code(discordThreadId)}`);
  return `_${parts.join(' · ')}_`;
}

/* ---------------------------------------------------------------- embeds */

/** The colour of the integration's embeds, matching GitHub's dark accent. */
export const GITHUB_COLOR = 0x238636;
export const ISSUE_CLOSED_COLOR = 0x8957e5;
export const WARNING_COLOR = 0xd29922;
export const ERROR_COLOR = 0xda3633;

/** A Discord relative timestamp marker for the embed footer. */
export function relativeTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  const ms = Number.isNaN(date.getTime()) ? Date.now() : date.getTime();
  return `<t:${Math.floor(ms / 1000)}:R>`;
}

/**
 * The embed posted after a Forum post becomes an issue.
 *
 * Plain data, not a discord.js `EmbedBuilder`, so the shape is asserted directly
 * in the tests and every value already has its fallback applied — no field can
 * render `undefined`, `null` or `NaN`.
 */
export function buildIssueEmbed({
  repository,
  issueNumber,
  issueTitle,
  issueUrl,
  createdAt = new Date(),
  synchronized = true,
} = {}) {
  return {
    title: `Issue #${issueNumber} opened`,
    url: issueUrl || undefined,
    color: GITHUB_COLOR,
    description: `This post is now tracked in **${repository}**.`,
    fields: [
      { name: '📦 Repository', value: repository || 'Unknown', inline: true },
      { name: '🔢 Issue', value: issueNumber ? `#${issueNumber}` : 'Unknown', inline: true },
      { name: '📝 Title', value: issueTitle || 'Untitled', inline: false },
      {
        name: '🔗 Issue URL',
        value: issueUrl ? `[${repository}#${issueNumber}](${issueUrl})` : 'Unavailable',
        inline: false,
      },
      { name: '🔄 Synchronization', value: synchronized ? '✅ Active — replies sync to GitHub' : '⚠️ One-way', inline: false },
    ],
    footer: { text: `ProjectHub · opened ${relativeTimestamp(createdAt)}` },
    timestamp: new Date(createdAt).toISOString(),
  };
}

/** The embed posted when a GitHub comment is published into the thread. */
export function buildCommentEmbed({
  login,
  body,
  commentUrl,
  createdAt = new Date(),
  avatarUrl = null,
} = {}) {
  const embed = {
    author: { name: `${login || 'GitHub user'} commented`, ...(avatarUrl ? { icon_url: avatarUrl } : {}) },
    color: GITHUB_COLOR,
    description: toEmbedDescription(body),
    footer: { text: `GitHub · ${relativeTimestamp(createdAt)}` },
    timestamp: new Date(createdAt).toISOString(),
  };
  if (commentUrl) embed.url = commentUrl;
  return embed;
}

/** The embed posted when a linked issue is closed or reopened. */
export function buildStateEmbed({ repository, issueNumber, issueTitle, issueUrl, state, at = new Date() } = {}) {
  const closed = state === ISSUE_STATE.CLOSED;
  return {
    title: closed ? `Issue #${issueNumber} closed` : `Issue #${issueNumber} reopened`,
    url: issueUrl || undefined,
    color: closed ? ISSUE_CLOSED_COLOR : GITHUB_COLOR,
    description: closed
      ? `**${repository}** closed this issue. The Discord thread stays open.`
      : `**${repository}** reopened this issue.`,
    fields: [
      { name: '📦 Repository', value: repository || 'Unknown', inline: true },
      { name: '🔢 Issue', value: issueNumber ? `#${issueNumber}` : 'Unknown', inline: true },
      { name: '📌 State', value: closed ? '🔒 Closed' : '🟢 Open', inline: true },
      { name: '📝 Title', value: issueTitle || 'Untitled', inline: false },
    ],
    footer: { text: `ProjectHub · updated ${relativeTimestamp(at)}` },
    timestamp: new Date(at).toISOString(),
  };
}

/** A small informational embed for a mapping problem or a configuration error. */
export function buildNoticeEmbed({ title, description, tone = 'warning' } = {}) {
  const color = tone === 'error' ? ERROR_COLOR : tone === 'success' ? GITHUB_COLOR : WARNING_COLOR;
  return { title: title || 'ProjectHub', color, description: description || '' };
}

/** Redacts a token or secret from a log line. */
export function redactSecret(text, secret = '') {
  let out = String(text ?? '');
  if (secret) out = out.split(String(secret)).join('[redacted]');
  // A GitHub App installation token is `ghs_...`; a personal token `ghp_...`.
  out = out.replace(/\bgh[psuro]_[A-Za-z0-9]{20,}\b/g, '[redacted]');
  return out;
}

/* ------------------------------------------------------------- webhooks */

/**
 * What a webhook delivery should do.
 *
 * Pure: given the event name, its action, the payload and whether the issue is
 * linked, it returns the action to take and a human reason. The receiver turns
 * this into a queued job; the tests pin the decision without a database, a
 * network call or a live signature.
 *
 * Recognised deliveries:
 *   - `issue_comment` `created` on a linked issue  -> `discord_reply`
 *   - `issues` `closed` / `reopened` on a link     -> `state_notify`
 *
 * Everything else is `ignore`, and the reason distinguishes "not our event" from
 * "the issue is not linked" from "the comment is ours".
 */
export function planWebhookEvent({ event, action = '', payload = {}, linked = false, appLogin = '' } = {}) {
  const name = String(event || '');

  if (name === 'ping') return { action: 'ignore', reason: 'ping' };
  if (name === 'issue_comment') {
    if (action !== 'created') return { action: 'ignore', reason: `issue_comment.${action || 'unknown'}` };
    if (payload?.issue?.pull_request) return { action: 'ignore', reason: 'pull_request_comment' };
    if (!linked) return { action: 'ignore', reason: 'unlinked_issue' };
    const comment = payload?.comment;
    if (!comment?.id) return { action: 'ignore', reason: 'no_comment' };
    if (isIntegrationComment(comment.body, { authorLogin: comment.user?.login, appLogin })) {
      return { action: 'ignore', reason: 'integration_comment' };
    }
    return { action: 'discord_reply', reason: 'ok', comment };
  }

  if (name === 'issues') {
    if (action !== 'closed' && action !== 'reopened') return { action: 'ignore', reason: `issues.${action || 'unknown'}` };
    if (!linked) return { action: 'ignore', reason: 'unlinked_issue' };
    const issue = payload?.issue;
    if (!issue?.number) return { action: 'ignore', reason: 'no_issue' };
    return {
      action: 'state_notify',
      reason: 'ok',
      state: action === 'closed' ? ISSUE_STATE.CLOSED : ISSUE_STATE.OPEN,
      issue,
    };
  }

  return { action: 'ignore', reason: `unhandled_event:${name}` };
}

/** The repository full name and issue number a webhook payload refers to. */
export function webhookIssueRef(payload = {}) {
  const repository = payload?.repository?.full_name || '';
  const number = payload?.issue?.number ?? payload?.comment ? payload?.issue?.number : undefined;
  return { repository, issueNumber: number };
}
