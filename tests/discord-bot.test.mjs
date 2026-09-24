/**
 * The ProjectHub Discord bot: command parsing, role resolution, the usage
 * threshold logic, and the dashboard wiring.
 *
 * The pure parts are exercised directly — they import nothing from discord.js or
 * a database driver on purpose. The wiring is read from source, the same
 * approach `client-auth.test.mjs` uses, because no gateway or database is
 * available to the runner.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const source = (relative) => readFileSync(resolve(root, relative), 'utf8');

const {
  BOT_PREFIX,
  parseCommand,
  resolveRoles,
  evaluateUsage,
  shouldAlert,
  buildAlertEmbed,
  formatQuantity,
  formatPercent,
  maskWebhook,
  isValidWebhookUrl,
  isSnowflake,
} = await import('../api/lib/bot-logic.js');

/* ------------------------------------------------------------- the prefix */

test('the bot prefix is &', () => {
  assert.equal(BOT_PREFIX, '&');
});

test('&dev is recognised as the dev command', () => {
  assert.deepEqual(parseCommand('&dev'), { command: 'dev', args: [], rest: '' });
  assert.equal(parseCommand('&dev hello').command, 'dev');
  assert.deepEqual(parseCommand('&dev hello').args, ['hello']);
});

test('the command is case-insensitive and tolerant of whitespace', () => {
  assert.equal(parseCommand('  &DEV  ').command, 'dev');
  assert.equal(parseCommand('&  dev').command, 'dev');
});

test('ordinary messages are not commands', () => {
  // No prefix at all.
  assert.equal(parseCommand('hello world'), null);
  // Prefix appears mid-message, which is not an invocation.
  assert.equal(parseCommand('see foo & bar'), null);
  // A bare prefix has no command.
  assert.equal(parseCommand('&'), null);
  assert.equal(parseCommand('&   '), null);
  assert.equal(parseCommand(''), null);
  assert.equal(parseCommand(null), null);
});

/* --------------------------------------------------------- role resolution */

test('an admin-linked Discord id reports the admin portal role', () => {
  const resolved = resolveRoles({ admin: { role: 'owner', pin: '1234' } });
  assert.equal(resolved.isLinked, true);
  assert.equal(resolved.isAdmin, true);
  assert.deepEqual(resolved.roles, [{ scope: 'admin', label: 'owner' }]);
});

test('the admin PIN is never carried into the reply', () => {
  // `&dev` answers in a public channel and the PIN is half of the admin login
  // credential, so even an input that carries one must not surface it.
  const resolved = resolveRoles({ admin: { role: 'owner', pin: '9876' } });
  assert.ok(!JSON.stringify(resolved).includes('9876'), 'the PIN must not appear in the resolved roles');

  // And the bot must not read it from the database at all.
  const store = source('api/lib/bot-store.js');
  assert.match(store, /SELECT id, role, email FROM admin_credentials/);
  assert.ok(!/SELECT[^`]*\bpin\b[^`]*FROM admin_credentials/.test(store), 'the PIN is not selected');
});

test('a client-linked Discord id reports the client role', () => {
  const resolved = resolveRoles({ user: { isBlocked: false } });
  assert.equal(resolved.isLinked, true);
  assert.equal(resolved.isAdmin, false);
  assert.deepEqual(resolved.roles, [{ scope: 'client', label: 'client', blocked: false }]);
});

test('an account linked to both reports both roles, not one', () => {
  const resolved = resolveRoles({ admin: { role: 'admin' }, user: { isBlocked: false } });
  assert.equal(resolved.roles.length, 2);
  assert.deepEqual(
    resolved.roles.map((role) => role.scope).sort(),
    ['admin', 'client'],
  );
});

test('a blocked client is reported as blocked, not as absent', () => {
  const resolved = resolveRoles({ user: { isBlocked: true } });
  assert.equal(resolved.isLinked, true);
  assert.equal(resolved.isBlocked, true);
  assert.equal(resolved.roles[0].blocked, true);
});

test('an unlinked Discord id resolves to nothing', () => {
  const resolved = resolveRoles({});
  assert.equal(resolved.isLinked, false);
  assert.deepEqual(resolved.roles, []);
});

/* -------------------------------------------------------- usage thresholds */

const LIMITS = { computeLimitSeconds: 1000, storageLimitBytes: 1000, transferLimitBytes: 1000 };

test('usage below half the threshold is ok', () => {
  const result = evaluateUsage({ computeTimeSeconds: 300 }, LIMITS, 80);
  assert.equal(result.level, 'ok');
});

test('usage at the threshold is critical and at the limit is exceeded', () => {
  assert.equal(evaluateUsage({ computeTimeSeconds: 800 }, LIMITS, 80).level, 'critical');
  assert.equal(evaluateUsage({ computeTimeSeconds: 1000 }, LIMITS, 80).level, 'exceeded');
  assert.equal(evaluateUsage({ computeTimeSeconds: 1200 }, LIMITS, 80).level, 'exceeded');
});

test('the worst metric decides the overall level', () => {
  const result = evaluateUsage(
    { computeTimeSeconds: 100, storageBytes: 900, transferBytes: 100 },
    LIMITS,
    80,
  );
  assert.equal(result.level, 'critical');
  const storage = result.metrics.find((metric) => metric.key === 'storageBytes');
  assert.equal(storage.level, 'critical');
});

test('a zero limit is treated as unknown rather than instantly exceeded', () => {
  const result = evaluateUsage(
    { computeTimeSeconds: 999999 },
    { computeLimitSeconds: 0, storageLimitBytes: 0, transferLimitBytes: 0 },
    80,
  );
  assert.equal(result.level, 'ok');
});

test('each metric reports its own percent and level', () => {
  const result = evaluateUsage({ computeTimeSeconds: 500, storageBytes: 1000 }, LIMITS, 80);
  const compute = result.metrics.find((metric) => metric.key === 'computeTimeSeconds');
  const storage = result.metrics.find((metric) => metric.key === 'storageBytes');
  assert.equal(compute.percent, 50);
  assert.equal(storage.percent, 100);
  assert.equal(storage.level, 'exceeded');
});

/* ------------------------------------------------------------- alert gating */

const BREACHING = evaluateUsage({ computeTimeSeconds: 900 }, LIMITS, 80);

test('nothing is sent when usage is below the threshold', () => {
  const quiet = evaluateUsage({ computeTimeSeconds: 10 }, LIMITS, 80);
  assert.equal(shouldAlert({ evaluation: quiet }).alert, false);
  assert.equal(shouldAlert({ evaluation: quiet }).reason, 'below_threshold');
});

test('an over-threshold metric alerts on the first poll', () => {
  const decision = shouldAlert({ evaluation: BREACHING, lastAlertedAt: {}, now: Date.now() });
  assert.equal(decision.alert, true);
  assert.deepEqual(decision.due.map((metric) => metric.key), ['computeTimeSeconds']);
});

test('the cooldown suppresses a repeat of the same metric', () => {
  const now = Date.now();
  const decision = shouldAlert({
    evaluation: BREACHING,
    lastAlertedAt: { computeTimeSeconds: new Date(now - 60_000).toISOString() },
    now,
    cooldownMinutes: 360,
  });
  assert.equal(decision.alert, false);
  assert.equal(decision.reason, 'cooldown');
});

test('the cooldown expires after the configured window', () => {
  const now = Date.now();
  const decision = shouldAlert({
    evaluation: BREACHING,
    lastAlertedAt: { computeTimeSeconds: new Date(now - 7 * 60 * 60 * 1000).toISOString() },
    now,
    cooldownMinutes: 360,
  });
  assert.equal(decision.alert, true);
});

test('a metric that fired does not suppress a different metric', () => {
  const now = Date.now();
  const both = evaluateUsage({ computeTimeSeconds: 900, storageBytes: 900 }, LIMITS, 80);
  const decision = shouldAlert({
    evaluation: both,
    lastAlertedAt: { computeTimeSeconds: new Date(now).toISOString() },
    now,
    cooldownMinutes: 360,
  });
  assert.equal(decision.alert, true);
  assert.deepEqual(decision.due.map((metric) => metric.key), ['storageBytes']);
});

test('the decision marks exactly the metrics that fired', () => {
  const now = Date.now();
  const decision = shouldAlert({ evaluation: BREACHING, lastAlertedAt: {}, now });
  assert.deepEqual(Object.keys(decision.marks), ['computeTimeSeconds']);
  assert.equal(new Date(decision.marks.computeTimeSeconds).getTime(), now);
});

/* ------------------------------------------------------------------ embed */

test('the alert embed carries the fields the report asked for', () => {
  const embed = buildAlertEmbed({
    projectName: 'ProjectHub',
    projectId: 'sparkling-hill-99143322',
    evaluation: BREACHING,
    organizationName: 'Acme',
  });

  assert.match(embed.title, /ProjectHub/);
  assert.equal(typeof embed.color, 'number');
  assert.ok(embed.timestamp);
  assert.match(embed.url, /sparkling-hill-99143322/);
  // The breaking metric is a field, with its percentage in the name.
  const field = embed.fields.find((f) => /Compute/.test(f.name));
  assert.ok(field, 'the compute metric is present');
  assert.match(field.name, /%/);
  assert.equal(embed.footer.text, 'Neon · Acme');
});

test('only the breaching metrics are shown when some are quiet', () => {
  const mixed = evaluateUsage({ computeTimeSeconds: 900, storageBytes: 1 }, LIMITS, 80);
  const embed = buildAlertEmbed({ projectName: 'P', projectId: 'p', evaluation: mixed });
  assert.equal(embed.fields.length, 1);
  assert.match(embed.fields[0].name, /Compute/);
});

test('quantities read in the units Neon uses', () => {
  assert.equal(formatQuantity(2 * 1024 ** 3, 'bytes'), '2.00 GB');
  assert.equal(formatQuantity(512 * 1024 ** 2, 'bytes'), '512.0 MB');
  assert.equal(formatQuantity(3600, 'seconds'), '1.00 CU-h');
  assert.equal(formatPercent(80), '80.0');
  assert.equal(formatPercent(120), '120');
});

/* ---------------------------------------------------------------- secrets */

test('a webhook URL is masked before it reaches the browser', () => {
  const masked = maskWebhook('https://discord.com/api/webhooks/123456789/abcdefTOKEN');
  assert.ok(!masked.includes('abcdefTOKEN'), 'the token must not survive masking');
  assert.match(masked, /^https:\/\/discord\.com\/api\/webhooks\/123456789\//);
  assert.equal(maskWebhook(null), null);
});

test('webhook and snowflake values are validated before saving', () => {
  assert.equal(isValidWebhookUrl('https://discord.com/api/webhooks/123456789/abc-DEF_1'), true);
  assert.equal(isValidWebhookUrl('https://discord.com/api/webhooks/123'), false);
  assert.equal(isValidWebhookUrl('https://evil.example.com/webhooks/1/x'), false);
  assert.equal(isValidWebhookUrl('not a url'), false);
  assert.equal(isSnowflake('123456789012345678'), true);
  assert.equal(isSnowflake('123'), false);
  assert.equal(isSnowflake('#general'), false);
});

/* --------------------------------------------------------- dashboard wiring */

test('the admin portal exposes a bot configuration page', () => {
  const page = source('client/src/pages/admin-bot.tsx');
  assert.match(page, /\/api\/admin\/bot\/settings/);
  assert.match(page, /\/api\/admin\/bot\/status/);
  assert.match(page, /\/api\/admin\/bot\/usage-preview/);

  const app = source('client/src/AdminApp.tsx');
  assert.match(app, /path="\/bot"/, 'the route exists');
  assert.match(app, /permission="bot"/, 'the route is gated');

  const sidebar = source('client/src/components/admin/admin-sidebar.tsx');
  assert.match(sidebar, /href="\/bot"/, 'the sidebar links to it');
  assert.match(sidebar, /canManageBot/, 'the link is gated for moderators');
});

test('the bot console never asks for a secret, only reports whether one is set', () => {
  const page = source('client/src/pages/admin-bot.tsx');
  // It must not collect the bot token or the Neon key.
  assert.ok(!/DISCORD_BOT_TOKEN\s*[=:]\s*["']/.test(page), 'no hardcoded token');
  assert.match(page, /botTokenConfigured/, 'it reports token presence');
  assert.match(page, /neonKeyConfigured/, 'it reports key presence');

  // And the API must report presence, not the value.
  const routes = source('api/lib/bot-routes.js');
  assert.match(routes, /botTokenConfigured/);
  assert.match(routes, /neonKeyConfigured/);
  assert.ok(!/res\.json\([\s\S]{0,200}process\.env\.DISCORD_BOT_TOKEN/.test(routes), 'the token value is never returned');
});

test('both backends mount the same bot router behind the owner/admin guard', () => {
  const serverless = source('api/admin/index.js');
  const express = source('server/admin-routes.ts');
  for (const backend of [serverless, express]) {
    assert.match(backend, /buildBotRouter\(\{\s*requireAuth,\s*requireRole\s*\}\)/);
  }
  const routes = source('api/lib/bot-routes.js');
  assert.match(routes, /requireRole\('admin'\)/, 'a moderator is refused server-side');
});

test('the bot process is a standalone entry point, not a serverless function', () => {
  const bot = source('bot/index.js');
  assert.match(bot, /DISCORD_BOT_TOKEN/);
  // It must not be wired into a Vercel function path.
  const vercel = source('vercel.json');
  assert.ok(!vercel.includes('bot/index.js'), 'the bot is not a vercel function');

  const pkg = JSON.parse(source('package.json'));
  assert.match(pkg.scripts.bot, /node bot\/index\.js/);
  assert.ok(pkg.dependencies['discord.js'], 'discord.js is a dependency');
});

test('the bot handles both prefix commands and mentions', () => {
  const bot = source('bot/index.js');
  assert.match(bot, /message\.mentions/, 'mentions are handled');
  assert.match(bot, /parseCommand/, 'prefix commands are parsed');
  assert.match(bot, /GatewayIntentBits\.MessageContent/, 'message content intent is requested');
});

test('the mention reply is pinned not to ping, and the alert posts to both destinations', () => {
  const bot = source('bot/index.js');
  assert.match(bot, /allowed_mentions:\s*\{\s*parse:\s*\[\]\s*\}/, 'webhook mentions are suppressed');
  assert.match(bot, /deliverAlert/);
  assert.match(bot, /config\.alertChannelId/);
  assert.match(bot, /config\.alertWebhookUrl/);
});

test('the Neon alert read never logs the API key', () => {
  const neon = source('api/lib/neon-usage.js');
  assert.match(neon, /NEON_API_KEY/);
  assert.ok(!/console\.log\([^)]*process\.env\.NEON_API_KEY/.test(neon), 'the key is not logged');
  assert.match(neon, /Authorization: `Bearer \$\{process\.env\.NEON_API_KEY\}`/, 'it is only sent to Neon');
});

test('the alert tolerates one metric failing instead of losing the whole poll', () => {
  const neon = source('api/lib/neon-usage.js');
  assert.match(neon, /unavailable/, 'unavailable metrics are reported, not thrown');
});
