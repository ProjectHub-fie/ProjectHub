/**
 * The Discord Forum ↔ GitHub Issues integration: the pure rules and the GitHub
 * App client.
 *
 * The rules (tag resolution, the issue/comment bodies, the loop guards, the
 * retry schedule, the webhook plan) import nothing from discord.js, a database
 * driver or `process.env`, so they are exercised directly. The GitHub client is
 * driven with a stub `fetch` through the same `__testFetcher` seam the
 * test-runner console uses, so the JWT, the token exchange, the API calls and
 * the 429 handling are checked without a real App key and without ever creating
 * a live issue.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const source = (relative) => readFileSync(resolve(root, relative), 'utf8');

const {
  SYNC_DIRECTION,
  ISSUE_STATE,
  JOB_TYPE,
  JOB_STATUS,
  MAX_JOB_ATTEMPTS,
  BASE_RETRY_MS,
  MAX_RETRY_MS,
  INTEGRATION_MARKER,
  isRepositoryTag,
  resolveRepositoryForTags,
  resolutionMessage,
  parseRepositoryFullName,
  repositoryProblem,
  clampTitle,
  formatAttachments,
  formatBytes,
  isBotGeneratedMessage,
  isIntegrationComment,
  buildIssueBody,
  buildCommentBody,
  toEmbedDescription,
  nextRetryDelay,
  isJobExhausted,
  isRetryableStatus,
  retryAfterMs,
  redactSecret,
  planWebhookEvent,
  buildIssueEmbed,
  buildCommentEmbed,
  buildStateEmbed,
} = await import('../bot/lib/github-forum-logic.js');

const {
  signAppJwt,
  normalizePrivateKey,
  isGithubAppConfigured,
  isWebhookConfigured,
  verifyWebhookSignature,
  getInstallationToken,
  clearTokenCache,
  createIssue,
  createIssueComment,
  getIssue,
  checkRepositoryAccess,
  GithubApiError,
  SIGNATURE_HEADER,
} = await import('../bot/lib/github-forum-client.js');

const { planForumPost, planThreadReply, messageAttachments } = await import('../bot/lib/github-forum-service.js');

/* ---------------------------------------------------------------- helpers */

const mapping = (over = {}) => ({
  discordTagId: '100',
  discordTagName: 'ProjectHub',
  githubOwner: 'ProjectHub-fie',
  githubRepository: 'ProjectHub',
  enabled: true,
  ...over,
});

/** Installs a stub fetcher and returns a restore function. */
function stubFetch(fn) {
  const previous = globalThis.__testFetcher;
  globalThis.__testFetcher = fn;
  return () => {
    globalThis.__testFetcher = previous;
  };
}

/** A GitHub API JSON response. */
function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** A throwaway RSA key, generated once for the JWT tests. */
const { privateKey: TEST_KEY } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const TEST_PEM = TEST_KEY.export({ type: 'pkcs1', format: 'pem' }).toString();

/* ------------------------------------------------------------ tag mapping */

test('a configured tag denotes a repository; an unconfigured one does not', () => {
  assert.equal(isRepositoryTag('100', [mapping()]), true);
  assert.equal(isRepositoryTag('999', [mapping()]), false);
  assert.equal(isRepositoryTag('100', []), false);
});

test('exactly one repository tag resolves to its repository', () => {
  const result = resolveRepositoryForTags(['100'], [mapping()]);
  assert.equal(result.ok, true);
  assert.equal(result.mapping.repository ?? `${result.mapping.githubOwner}/${result.mapping.githubRepository}`, 'ProjectHub-fie/ProjectHub');
});

test('no repository tag does not resolve', () => {
  const result = resolveRepositoryForTags(['777'], [mapping()]);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no_tag');
});

test('multiple repository tags are refused as a conflict', () => {
  const result = resolveRepositoryForTags(['100', '200'], [mapping(), mapping({ discordTagId: '200', githubRepository: 'PrimeBot' })]);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'multiple');
  assert.equal(result.matches.length, 2);
});

test('a disabled mapping does not resolve, and is reported distinctly', () => {
  const result = resolveRepositoryForTags(['100'], [mapping({ enabled: false })]);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'disabled');
});

test('a tag applied alongside a non-repository tag still resolves', () => {
  // A tag that is not configured is simply not a repository tag.
  const result = resolveRepositoryForTags(['100', 'status-tag'], [mapping()]);
  assert.equal(result.ok, true);
});

test('with no mappings at all the reason is "unmapped"', () => {
  assert.equal(resolveRepositoryForTags(['100'], []).reason, 'unmapped');
});

test('each resolution reason has its own explanation', () => {
  assert.match(resolutionMessage('no_tag'), /repository tag/);
  assert.match(resolutionMessage('multiple'), /more than one/);
  assert.match(resolutionMessage('disabled'), /disabled/);
  assert.match(resolutionMessage('unmapped'), /configured/);
});

/* ------------------------------------------------------ repository config */

test('a repository full name parses to owner and name', () => {
  assert.deepEqual(parseRepositoryFullName('ProjectHub-fie/ProjectHub'), { owner: 'ProjectHub-fie', repository: 'ProjectHub' });
  assert.equal(parseRepositoryFullName('no-slash'), null);
  assert.equal(parseRepositoryFullName('a/b/c'), null);
  assert.equal(parseRepositoryFullName(''), null);
  assert.equal(parseRepositoryFullName('-bad/repo'), null);
});

test('an invalid repository configuration is reported, not accepted', () => {
  assert.ok(repositoryProblem('', 'repo'));
  assert.ok(repositoryProblem('owner', ''));
  assert.ok(repositoryProblem('owner', 'bad name'));
  assert.equal(repositoryProblem('ProjectHub-fie', 'ProjectHub'), null);
});

test('an issue title is clamped without cutting mid-word nonsense', () => {
  assert.equal(clampTitle('  hello   world  '), 'hello world');
  assert.equal(clampTitle(''), 'Discord forum post');
  const long = clampTitle('x'.repeat(400));
  assert.ok(long.length <= 250);
  assert.match(long, /…$/);
});

/* ---------------------------------------------------------------- bodies */

test('the issue body keeps the original post and carries the Discord metadata', () => {
  const body = buildIssueBody({
    content: 'The build fails on Windows.',
    authorName: 'Alex',
    authorUsername: 'alex',
    authorId: '42',
    guildName: 'ProjectHub.inc',
    guildId: '7',
    channelName: 'submissions',
    threadUrl: 'https://discord.com/channels/7/9',
    createdAt: '2024-01-02T03:04:05.000Z',
    attachments: [{ url: 'https://cdn.discordapp.com/a.png', name: 'shot.png', size: 2048, contentType: 'image/png' }],
  });
  assert.match(body, /The build fails on Windows\./);
  assert.match(body, /@alex/);
  assert.match(body, /`42`/);
  assert.match(body, /ProjectHub\.inc/);
  assert.match(body, /open in Discord/);
  assert.match(body, /2024-01-02T03:04:05\.000Z/);
  assert.match(body, /shot\.png/);
  assert.match(body, /may expire/);
  assert.match(body, new RegExp(INTEGRATION_MARKER));
});

test('the issue body never fabricates an author or loses the content', () => {
  const body = buildIssueBody({ content: 'only content', authorId: '1' });
  assert.match(body, /only content/);
  assert.match(body, /Unknown/);
});

test('the comment body carries the display name, username, id, url and timestamp', () => {
  const body = buildCommentBody({
    content: 'Reproduced on my machine.',
    displayName: 'Alex Smith',
    username: 'alex',
    authorId: '42',
    messageUrl: 'https://discord.com/channels/7/9/10',
    createdAt: '2024-05-06T07:08:09.000Z',
  });
  assert.match(body, /Alex Smith/);
  assert.match(body, /@alex/);
  assert.match(body, /`42`/);
  assert.match(body, /\[message\]\(https:\/\/discord\.com\/channels\/7\/9\/10\)/);
  assert.match(body, /2024-05-06T07:08:09\.000Z/);
  assert.match(body, new RegExp(INTEGRATION_MARKER));
});

test('an attachment list preserves the URL and notes that it expires', () => {
  const rendered = formatAttachments([{ url: 'https://cdn.discordapp.com/x.zip', name: 'x.zip', size: 5 * 1024 * 1024 }]);
  assert.match(rendered, /https:\/\/cdn\.discordapp\.com\/x\.zip/);
  assert.match(rendered, /5\.0 MB/);
  assert.match(rendered, /may expire/);
  assert.equal(formatAttachments([]), '');
});

test('an attachment without a usable URL is dropped, not rendered as a dead link', () => {
  // A missing, empty or non-http URL would render `[name](undefined)` or a
  // `javascript:` link; both are worse than saying nothing.
  assert.equal(formatAttachments([{ name: 'x', size: 10 }]), '');
  assert.equal(formatAttachments([{ url: '', name: 'x' }]), '');
  assert.equal(formatAttachments([{ url: 'javascript:alert(1)', name: 'x' }]), '');
  assert.equal(formatAttachments([null, { url: 'ftp://x/y', name: 'x' }]), '');
  // One valid entry among invalid ones still renders.
  const mixed = formatAttachments([{ name: 'bad' }, { url: 'https://cdn/x.png', name: 'ok.png' }]);
  assert.match(mixed, /ok\.png/);
  assert.ok(!mixed.includes('undefined'));
});

test('a bracket in an attachment name cannot break the Markdown link', () => {
  const rendered = formatAttachments([{ url: 'https://cdn/x', name: 'a]b(evil' }]);
  assert.match(rendered, /\\\]/);
  assert.ok(!rendered.includes('](evil'));
});

test('messageAttachments drops an attachment with no usable URL', () => {
  const message = { attachments: new Map([['a', { name: 'no-url' }], ['b', { url: 'https://cdn/ok', name: 'ok' }]]) };
  const collected = messageAttachments(message, { enabled: true });
  assert.equal(collected.length, 1);
  assert.equal(collected[0].name, 'ok');
});

test('formatBytes is bounded and readable', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1024 * 1024), '1.0 MB');
});

/* ---------------------------------------------------------- loop guards */

test('a bot or integration message is never synced', () => {
  assert.equal(isBotGeneratedMessage({ author: { bot: true } }), true);
  assert.equal(isBotGeneratedMessage({ webhookId: '1', author: {} }), true);
  assert.equal(isBotGeneratedMessage({ content: `${INTEGRATION_MARKER} hello`, author: {} }), true);
  assert.equal(isBotGeneratedMessage({ content: 'a normal reply', author: { id: '1' } }), false);
  assert.equal(isBotGeneratedMessage(null), true);
});

test('an integration comment is never published back to Discord', () => {
  assert.equal(isIntegrationComment(`${INTEGRATION_MARKER} hi`, {}), true);
  assert.equal(isIntegrationComment('hello', { appLogin: 'projecthub[bot]', authorLogin: 'projecthub[bot]' }), true);
  assert.equal(isIntegrationComment('hello', { authorLogin: 'someone[bot]' }), true);
  assert.equal(isIntegrationComment('hello', { authorLogin: 'alex' }), false);
});

/* ------------------------------------------------------------ the embeds */

test('the issue embed has every field and no undefined', () => {
  const embed = buildIssueEmbed({ repository: 'o/r', issueNumber: 5, issueTitle: 'T', issueUrl: 'https://x', createdAt: new Date() });
  const text = JSON.stringify(embed);
  assert.doesNotMatch(text, /undefined|null|NaN/);
  assert.match(text, /o\/r/);
  assert.equal(embed.fields.length, 5);
});

test('the state embed distinguishes closed from reopened', () => {
  const closed = buildStateEmbed({ repository: 'o/r', issueNumber: 1, state: ISSUE_STATE.CLOSED });
  const open = buildStateEmbed({ repository: 'o/r', issueNumber: 1, state: ISSUE_STATE.OPEN });
  assert.match(closed.title, /closed/);
  assert.match(open.title, /reopened/);
  assert.doesNotMatch(JSON.stringify(closed), /undefined/);
});

test('the comment embed strips the marker and bounds its length', () => {
  const embed = buildCommentEmbed({ login: 'alex', body: `${INTEGRATION_MARKER}\nhello`, commentUrl: 'https://x' });
  assert.doesNotMatch(embed.description, new RegExp(INTEGRATION_MARKER));
  assert.match(embed.author.name, /alex/);
  assert.ok(toEmbedDescription('x'.repeat(9000)).length <= 4000);
});

/* ----------------------------------------------------------- retry rules */

test('the retry delay is exponential and capped', () => {
  assert.ok(nextRetryDelay(1) >= BASE_RETRY_MS);
  assert.ok(nextRetryDelay(2) > nextRetryDelay(1));
  assert.ok(nextRetryDelay(50) <= MAX_RETRY_MS + Math.floor(MAX_RETRY_MS * 0.1));
});

test('a job is exhausted at its attempt limit', () => {
  assert.equal(isJobExhausted(MAX_JOB_ATTEMPTS - 1), false);
  assert.equal(isJobExhausted(MAX_JOB_ATTEMPTS), true);
  assert.equal(isJobExhausted(MAX_JOB_ATTEMPTS + 1), true);
});

test('5xx and 429 are retryable, other 4xx are not', () => {
  assert.equal(isRetryableStatus(500), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(403), true);
  assert.equal(isRetryableStatus(404), false);
  assert.equal(isRetryableStatus(422), false);
});

test("GitHub's Retry-After is honoured, from the header or the body", () => {
  assert.equal(retryAfterMs({ get: () => '2' }, null), 2000);
  assert.equal(retryAfterMs({}, { retry_after: 3 }), 3000);
  assert.equal(retryAfterMs({}, null), null);
});

test('a secret is redacted from a log line', () => {
  assert.match(redactSecret('token ghs_abcdefghijklmnopqrstuvwx here'), /\[redacted\]/);
  assert.equal(redactSecret('my secret value', 'secret'), 'my [redacted] value');
});

/* ------------------------------------------------------- forum post plan */

const settings = {
  enabled: true,
  forumChannelId: '999',
  createIssues: true,
  syncDiscordToGithub: true,
  syncGithubToDiscord: true,
  notifyStateChanges: true,
  syncAttachments: true,
};

test('a Forum post with one repository tag plans an enqueue', () => {
  const plan = planForumPost({ thread: { parentId: '999', appliedTags: ['100'] }, settings, mappings: [mapping()] });
  assert.equal(plan.action, 'enqueue');
  assert.equal(plan.repository, 'ProjectHub-fie/ProjectHub');
});

test('a post without a repository tag plans a notification, not an issue', () => {
  const plan = planForumPost({ thread: { parentId: '999', appliedTags: [] }, settings, mappings: [mapping()] });
  assert.equal(plan.action, 'notify');
  assert.equal(plan.reason, 'no_tag');
});

test('a post with two repository tags plans a conflict notification', () => {
  const plan = planForumPost({ thread: { parentId: '999', appliedTags: ['100', '200'] }, settings, mappings: [mapping(), mapping({ discordTagId: '200' })] });
  assert.equal(plan.action, 'notify');
  assert.equal(plan.reason, 'multiple');
});

test('a post in another forum channel is ignored', () => {
  const plan = planForumPost({ thread: { parentId: '111', appliedTags: ['100'] }, settings, mappings: [mapping()] });
  assert.equal(plan.action, 'skip');
  assert.equal(plan.reason, 'wrong_channel');
});

test('an invalid repository in a mapping is reported as a configuration error', () => {
  const plan = planForumPost({
    thread: { parentId: '999', appliedTags: ['100'] },
    settings,
    mappings: [mapping({ githubOwner: 'bad owner' })],
  });
  assert.equal(plan.action, 'notify');
  assert.equal(plan.reason, 'invalid_repository');
});

test('issue creation is skipped when the switch is off', () => {
  const plan = planForumPost({ thread: { parentId: '999', appliedTags: ['100'] }, settings: { ...settings, createIssues: false }, mappings: [mapping()] });
  assert.equal(plan.action, 'skip');
  assert.equal(plan.reason, 'issues_disabled');
});

/* ------------------------------------------------------ thread reply plan */

const threadMessage = (over = {}) => ({
  id: 'm1',
  channel: { id: 't1', parentId: '999', isThread: () => true },
  author: { id: '1', username: 'alex' },
  content: 'a reply',
  ...over,
});

test('a reply in a linked thread plans an enqueue', () => {
  const plan = planThreadReply({ message: threadMessage(), settings, hasLink: true });
  assert.equal(plan.action, 'enqueue');
});

test('a bot reply is never synced', () => {
  const plan = planThreadReply({ message: threadMessage({ author: { id: '2', bot: true } }), settings, hasLink: true });
  assert.equal(plan.action, 'skip');
  assert.equal(plan.reason, 'bot_message');
});

test('the starter message is not synced as a reply', () => {
  const plan = planThreadReply({ message: threadMessage(), settings, starterMessageId: 'm1', hasLink: true });
  assert.equal(plan.action, 'skip');
  assert.equal(plan.reason, 'starter_message');
});

test('a reply in an unlinked thread with no pending issue is skipped', () => {
  const plan = planThreadReply({ message: threadMessage(), settings, hasLink: false, hasPendingIssue: false });
  assert.equal(plan.action, 'skip');
  assert.equal(plan.reason, 'unlinked_thread');
});

test('a reply that arrives while issue creation is queued is kept', () => {
  const plan = planThreadReply({ message: threadMessage(), settings, hasLink: false, hasPendingIssue: true });
  assert.equal(plan.action, 'enqueue');
});

test('a message outside a thread is not a reply', () => {
  const plan = planThreadReply({ message: threadMessage({ channel: { id: 'c1', parentId: '999', isThread: () => false } }), settings, hasLink: true });
  assert.equal(plan.action, 'skip');
  assert.equal(plan.reason, 'not_thread');
});

test('the discord-to-github switch gates replies', () => {
  const plan = planThreadReply({ message: threadMessage(), settings: { ...settings, syncDiscordToGithub: false }, hasLink: true });
  assert.equal(plan.action, 'skip');
  assert.equal(plan.reason, 'sync_disabled');
});

test('attachments are collected only when the switch allows them', () => {
  const message = { attachments: new Map([['a', { url: 'https://cdn/x', name: 'x', size: 10, contentType: 'image/png' }]]) };
  assert.equal(messageAttachments(message, { enabled: true }).length, 1);
  assert.equal(messageAttachments(message, { enabled: false }).length, 0);
});

/* ------------------------------------------------------------ webhook plan */

const commentPayload = (over = {}) => ({
  action: 'created',
  repository: { full_name: 'o/r' },
  issue: { number: 4, title: 'T', html_url: 'https://x/4' },
  comment: { id: 55, body: 'hello', html_url: 'https://x/55', created_at: '2024-01-01T00:00:00Z', user: { login: 'alex', id: 9 } },
  ...over,
});

test('a created issue comment on a linked issue plans a Discord reply', () => {
  const plan = planWebhookEvent({ event: 'issue_comment', action: 'created', payload: commentPayload(), linked: true });
  assert.equal(plan.action, 'discord_reply');
  assert.equal(plan.comment.id, 55);
});

test('a comment on an unlinked issue is ignored', () => {
  const plan = planWebhookEvent({ event: 'issue_comment', action: 'created', payload: commentPayload(), linked: false });
  assert.equal(plan.action, 'ignore');
  assert.equal(plan.reason, 'unlinked_issue');
});

test('an integration comment is ignored even on a linked issue', () => {
  const plan = planWebhookEvent({
    event: 'issue_comment',
    action: 'created',
    payload: commentPayload({ comment: { id: 1, body: `${INTEGRATION_MARKER} ours`, user: { login: 'projecthub[bot]' } } }),
    linked: true,
  });
  assert.equal(plan.action, 'ignore');
  assert.equal(plan.reason, 'integration_comment');
});

test('an edited or deleted comment is ignored', () => {
  assert.equal(planWebhookEvent({ event: 'issue_comment', action: 'edited', payload: commentPayload(), linked: true }).action, 'ignore');
  assert.equal(planWebhookEvent({ event: 'issue_comment', action: 'deleted', payload: commentPayload(), linked: true }).action, 'ignore');
});

test('a pull-request comment is ignored', () => {
  const plan = planWebhookEvent({ event: 'issue_comment', action: 'created', payload: commentPayload({ issue: { number: 1, pull_request: {} } }), linked: true });
  assert.equal(plan.action, 'ignore');
  assert.equal(plan.reason, 'pull_request_comment');
});

test('a closed issue on a link plans a state notice', () => {
  const plan = planWebhookEvent({ event: 'issues', action: 'closed', payload: { issue: { number: 4, state: 'closed' } }, linked: true });
  assert.equal(plan.action, 'state_notify');
  assert.equal(plan.state, ISSUE_STATE.CLOSED);
});

test('a reopened issue on a link plans a state notice with the open state', () => {
  const plan = planWebhookEvent({ event: 'issues', action: 'reopened', payload: { issue: { number: 4 } }, linked: true });
  assert.equal(plan.action, 'state_notify');
  assert.equal(plan.state, ISSUE_STATE.OPEN);
});

test('a closed unlinked issue is ignored', () => {
  assert.equal(planWebhookEvent({ event: 'issues', action: 'closed', payload: { issue: { number: 4 } }, linked: false }).action, 'ignore');
});

test('an unhandled event or a ping is ignored', () => {
  assert.equal(planWebhookEvent({ event: 'ping' }).action, 'ignore');
  assert.match(planWebhookEvent({ event: 'push' }).reason, /unhandled_event/);
  assert.equal(planWebhookEvent({ event: 'issues', action: 'labeled', payload: { issue: { number: 1 } }, linked: true }).action, 'ignore');
});

/* ------------------------------------------------------- webhook signature */

test('a correct signature verifies', () => {
  const body = Buffer.from(JSON.stringify({ hello: 'world' }));
  const digest = crypto.createHmac('sha256', 'topsecret').update(body).digest('hex');
  const result = verifyWebhookSignature(body, `sha256=${digest}`, 'topsecret');
  assert.equal(result.ok, true);
});

test('a tampered body does not verify', () => {
  const digest = crypto.createHmac('sha256', 'topsecret').update(Buffer.from('original')).digest('hex');
  const result = verifyWebhookSignature(Buffer.from('tampered'), `sha256=${digest}`, 'topsecret');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'mismatch');
});

test('the wrong secret does not verify', () => {
  const body = Buffer.from('x');
  const digest = crypto.createHmac('sha256', 'right').update(body).digest('hex');
  assert.equal(verifyWebhookSignature(body, `sha256=${digest}`, 'wrong').ok, false);
});

test('a missing secret, header or scheme is refused', () => {
  assert.equal(verifyWebhookSignature(Buffer.from('x'), 'sha256=abc', '').reason, 'no_secret');
  assert.equal(verifyWebhookSignature(Buffer.from('x'), '', 'secret').reason, 'missing_signature');
  assert.equal(verifyWebhookSignature(Buffer.from('x'), 'sha1=abc', 'secret').reason, 'bad_scheme');
});

test('the signature header name is the SHA-256 one', () => {
  assert.equal(SIGNATURE_HEADER, 'x-hub-signature-256');
});

/* ------------------------------------------------------------- GitHub App */

test('a private key stored with literal newlines is rebuilt', () => {
  const oneLine = TEST_PEM.replace(/\n/g, '\\n');
  assert.equal(normalizePrivateKey(oneLine), TEST_PEM.trim());
});

test('the App is only "configured" when all three values are present', () => {
  assert.equal(isGithubAppConfigured({ GITHUB_APP_ID: '1', GITHUB_APP_PRIVATE_KEY: TEST_PEM, GITHUB_APP_INSTALLATION_ID: '2' }), true);
  assert.equal(isGithubAppConfigured({ GITHUB_APP_ID: '1' }), false);
  assert.equal(isWebhookConfigured({ GITHUB_WEBHOOK_SECRET: 's' }), true);
  assert.equal(isWebhookConfigured({}), false);
});

test('the App JWT is a valid RS256 token with the App id as issuer', () => {
  const jwt = signAppJwt({ appId: '123', privateKey: TEST_PEM, now: Date.now() });
  const [header, payload, signature] = jwt.split('.');
  const decodedHeader = JSON.parse(Buffer.from(header, 'base64url').toString());
  const decodedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString());
  assert.equal(decodedHeader.alg, 'RS256');
  assert.equal(decodedPayload.iss, '123');
  assert.ok(decodedPayload.exp - decodedPayload.iat <= 600, 'exp is within ten minutes of iat');
  // The signature verifies against the key pair it was signed with.
  const valid = crypto.createVerify('RSA-SHA256').update(`${header}.${payload}`).verify(TEST_KEY, signature, 'base64url');
  assert.equal(valid, true);
});

test('signing without an app id or key throws', () => {
  assert.throws(() => signAppJwt({ appId: '', privateKey: TEST_PEM }));
  assert.throws(() => signAppJwt({ appId: '1', privateKey: '' }));
});

test('an installation token is minted, cached, and reused', async () => {
  clearTokenCache();
  let calls = 0;
  const restore = stubFetch(async (url, options) => {
    calls += 1;
    assert.match(url, /\/app\/installations\/99\/access_tokens$/);
    assert.match(options.headers.Authorization, /^Bearer /);
    return jsonResponse(201, { token: 'ghs_installationtoken1234567890', expires_at: new Date(Date.now() + 3600_000).toISOString() });
  });
  const env = { GITHUB_APP_ID: '123', GITHUB_APP_PRIVATE_KEY: TEST_PEM, GITHUB_APP_INSTALLATION_ID: '99' };
  try {
    const first = await getInstallationToken({ env });
    const second = await getInstallationToken({ env });
    assert.equal(first, 'ghs_installationtoken1234567890');
    assert.equal(second, first);
    assert.equal(calls, 1, 'the token is cached');
  } finally {
    restore();
    clearTokenCache();
  }
});

test('a missing token in the response is an error, not a silent success', async () => {
  clearTokenCache();
  const restore = stubFetch(async () => jsonResponse(201, { expires_at: 'x' }));
  try {
    await assert.rejects(
      () => getInstallationToken({ env: { GITHUB_APP_ID: '1', GITHUB_APP_PRIVATE_KEY: TEST_PEM, GITHUB_APP_INSTALLATION_ID: '2' }, force: true }),
      /no installation token/,
    );
  } finally {
    restore();
    clearTokenCache();
  }
});

test('createIssue posts the title and body and returns the shaped issue', async () => {
  clearTokenCache();
  const calls = [];
  const restore = stubFetch(async (url, options) => {
    if (url.includes('/access_tokens')) return jsonResponse(201, { token: 'ghs_x1234567890abcdefghij', expires_at: new Date(Date.now() + 3600_000).toISOString() });
    calls.push({ url, options });
    return jsonResponse(201, { number: 7, id: 70, title: 'T', state: 'open', html_url: 'https://github.com/o/r/issues/7' });
  });
  const env = { GITHUB_APP_ID: '1', GITHUB_APP_PRIVATE_KEY: TEST_PEM, GITHUB_APP_INSTALLATION_ID: '2' };
  try {
    const issue = await createIssue({ owner: 'o', repository: 'r', title: 'T', body: 'B', labels: ['bug'], env });
    assert.equal(issue.number, 7);
    assert.equal(issue.url, 'https://github.com/o/r/issues/7');
    assert.match(calls[0].url, /\/repos\/o\/r\/issues$/);
    const sent = JSON.parse(calls[0].options.body);
    assert.equal(sent.title, 'T');
    assert.deepEqual(sent.labels, ['bug']);
  } finally {
    restore();
    clearTokenCache();
  }
});

test('createIssueComment posts to the issue comments endpoint', async () => {
  clearTokenCache();
  let called = null;
  const restore = stubFetch(async (url, options) => {
    if (url.includes('/access_tokens')) return jsonResponse(201, { token: 'ghs_x1234567890abcdefghij', expires_at: new Date(Date.now() + 3600_000).toISOString() });
    called = { url, options };
    return jsonResponse(201, { id: 99, body: 'hi', html_url: 'https://github.com/o/r/issues/7#issuecomment-99' });
  });
  const env = { GITHUB_APP_ID: '1', GITHUB_APP_PRIVATE_KEY: TEST_PEM, GITHUB_APP_INSTALLATION_ID: '2' };
  try {
    const comment = await createIssueComment({ owner: 'o', repository: 'r', issueNumber: 7, body: 'hi', env });
    assert.equal(comment.id, 99);
    assert.match(called.url, /\/repos\/o\/r\/issues\/7\/comments$/);
  } finally {
    restore();
    clearTokenCache();
  }
});

test('a 404 from createIssue surfaces as a GithubApiError with the status', async () => {
  clearTokenCache();
  const restore = stubFetch(async (url) => {
    if (url.includes('/access_tokens')) return jsonResponse(201, { token: 'ghs_x1234567890abcdefghij', expires_at: new Date(Date.now() + 3600_000).toISOString() });
    return jsonResponse(404, { message: 'Not Found' });
  });
  const env = { GITHUB_APP_ID: '1', GITHUB_APP_PRIVATE_KEY: TEST_PEM, GITHUB_APP_INSTALLATION_ID: '2' };
  try {
    await assert.rejects(
      () => createIssue({ owner: 'o', repository: 'r', title: 'T', body: 'B', env }),
      (error) => error instanceof GithubApiError && error.status === 404,
    );
  } finally {
    restore();
    clearTokenCache();
  }
});

test('checkRepositoryAccess reports an actionable reason for a missing installation', async () => {
  clearTokenCache();
  const restore = stubFetch(async (url) => {
    if (url.includes('/access_tokens')) return jsonResponse(201, { token: 'ghs_x1234567890abcdefghij', expires_at: new Date(Date.now() + 3600_000).toISOString() });
    return jsonResponse(404, { message: 'Not Found' });
  });
  const env = { GITHUB_APP_ID: '1', GITHUB_APP_PRIVATE_KEY: TEST_PEM, GITHUB_APP_INSTALLATION_ID: '2' };
  try {
    const result = await checkRepositoryAccess({ owner: 'o', repository: 'r', env });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'not_installed');
    assert.match(result.message, /Install the App/);
  } finally {
    restore();
    clearTokenCache();
  }
});

test('checkRepositoryAccess reports success with the repository name', async () => {
  clearTokenCache();
  const restore = stubFetch(async (url) => {
    if (url.includes('/access_tokens')) return jsonResponse(201, { token: 'ghs_x1234567890abcdefghij', expires_at: new Date(Date.now() + 3600_000).toISOString() });
    return jsonResponse(200, { full_name: 'o/r', private: false, default_branch: 'main', html_url: 'https://github.com/o/r', permissions: { push: true } });
  });
  const env = { GITHUB_APP_ID: '1', GITHUB_APP_PRIVATE_KEY: TEST_PEM, GITHUB_APP_INSTALLATION_ID: '2' };
  try {
    const result = await checkRepositoryAccess({ owner: 'o', repository: 'r', env });
    assert.equal(result.ok, true);
    assert.equal(result.fullName, 'o/r');
  } finally {
    restore();
    clearTokenCache();
  }
});

test('when the App is not configured, access validation says so instead of calling GitHub', async () => {
  let called = 0;
  const restore = stubFetch(async () => {
    called += 1;
    return jsonResponse(200, {});
  });
  try {
    const result = await checkRepositoryAccess({ owner: 'o', repository: 'r', env: {} });
    assert.equal(result.reason, 'app_not_configured');
    assert.equal(called, 0);
  } finally {
    restore();
  }
});

/* --------------------------------------------------------------- wiring */

test('the bot registers the forum handlers without removing the existing ones', () => {
  const events = source('bot/events/index.js');
  assert.match(events, /createForumPostHandler/);
  assert.match(events, /createForumReplyHandler/);
  assert.match(events, /Events\.ThreadCreate/);
  // The existing features must still be wired.
  assert.match(events, /createMessageCreateHandler/);
  assert.match(events, /createGuildMemberAddHandler/);
  assert.match(events, /createRobloxJoinHandler/);
  assert.match(events, /createReadyHandler/);
});

test('the bot process starts the sync worker and stops it on shutdown', () => {
  const index = source('bot/index.js');
  assert.match(index, /startWorker/);
  assert.match(index, /stopWorker/);
  // The existing poll and heartbeat are untouched.
  assert.match(index, /runUsageCheck/);
  assert.match(index, /recordBotHeartbeat/);
});

test('the worker enqueues only — the event handlers never call the GitHub API', () => {
  // The gateway handlers must stay fast, so the GitHub calls live in the worker.
  const post = source('bot/events/forumPost.js');
  const reply = source('bot/events/forumReply.js');
  assert.doesNotMatch(post, /github-forum-client/);
  assert.doesNotMatch(reply, /github-forum-client/);
});
