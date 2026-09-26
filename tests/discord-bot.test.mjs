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
import { GatewayIntentBits } from 'discord.js';

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
} = await import('../api/_lib/bot-logic.js');

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
  const store = source('api/_lib/bot-store.js');
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
  const routes = source('api/_lib/bot-routes.js');
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
  const routes = source('api/_lib/bot-routes.js');
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
  const neon = source('api/_lib/neon-usage.js');
  assert.match(neon, /NEON_API_KEY/);
  assert.ok(!/console\.log\([^)]*process\.env\.NEON_API_KEY/.test(neon), 'the key is not logged');
  assert.match(neon, /Authorization: `Bearer \$\{process\.env\.NEON_API_KEY\}`/, 'it is only sent to Neon');
});

test('the alert tolerates one metric failing instead of losing the whole poll', () => {
  const neon = source('api/_lib/neon-usage.js');
  assert.match(neon, /unavailable/, 'unavailable metrics are reported, not thrown');
});

/* --------------------------------------------- organization-wide usage */

const {
  fetchUsage,
  projectScopeFromEnv,
  fetchProjectNames,
} = await import('../api/_lib/neon-usage.js');

/** A fetch double that serves a canned consumption page, and records the URL. */
function neonFetchDouble({ rows, cursor = null, onCall } = {}) {
  return async (url, init) => {
    onCall?.(url, init);
    const parsed = new URL(url);
    return {
      ok: true,
      async json() {
        return {
          projects: rows.map((row) => ({
            project_id: row.id,
            consumption_history: row.points.map((value) => ({ [parsed.searchParams.get('metrics')]: value })),
          })),
          pagination: { cursor },
        };
      },
      async text() {
        return '';
      },
    };
  };
}

test('with no project ids the read is organization-wide and omits project_ids', async () => {
  process.env.NEON_API_KEY = 'test-key';
  const urls = [];
  const result = await fetchUsage({
    projectIds: null,
    orgId: 'org-1',
    fetchImpl: neonFetchDouble({
      rows: [
        { id: 'p1', points: [10, 5] },
        { id: 'p2', points: [1] },
      ],
      onCall: (url) => urls.push(url),
    }),
  });

  assert.equal(result.scope, 'org');
  assert.ok(urls.length > 0);
  for (const url of urls) {
    assert.equal(new URL(url).searchParams.getAll('project_ids').length, 0, 'project_ids must be absent');
    assert.equal(new URL(url).searchParams.get('org_id'), 'org-1');
  }
});

test('the org-wide total is the sum of every project, with a breakdown', async () => {
  process.env.NEON_API_KEY = 'test-key';
  const result = await fetchUsage({
    projectIds: null,
    fetchImpl: neonFetchDouble({
      rows: [
        { id: 'p1', points: [10, 5] },
        { id: 'p2', points: [2] },
      ],
    }),
  });

  // p1 contributes 10 + 5, p2 contributes 2, so the scope total is 17.
  assert.equal(result.usage.computeTimeSeconds, 17);
  assert.equal(result.projectCount, 2);
  // Sorted by compute, largest first.
  assert.deepEqual(result.perProject.map((p) => p.id), ['p1', 'p2']);
  assert.equal(result.perProject[0].computeTimeSeconds, 15);
});

test('an explicit project list filters the read and is sent as project_ids', async () => {
  process.env.NEON_API_KEY = 'test-key';
  const urls = [];
  const result = await fetchUsage({
    projectIds: ['p1', 'p2'],
    fetchImpl: neonFetchDouble({ rows: [{ id: 'p1', points: [7] }], onCall: (url) => urls.push(url) }),
  });

  assert.equal(result.scope, 'projects');
  for (const url of urls) {
    assert.deepEqual(new URL(url).searchParams.getAll('project_ids'), ['p1', 'p2']);
  }
});

test('pagination is followed so usage is never under-reported', async () => {
  process.env.NEON_API_KEY = 'test-key';
  // Each metric read is answered with one page that carries a cursor and a
  // second that does not, so a reader that ignored the cursor would miss half.
  const secondPages = [];
  const seen = new Set();
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    const metric = parsed.searchParams.get('metrics');
    const isSecondPage = seen.has(metric);
    seen.add(metric);
    if (isSecondPage) secondPages.push(metric);
    return {
      ok: true,
      async json() {
        return {
          projects: [
            {
              project_id: isSecondPage ? 'p2' : 'p1',
              consumption_history: [{ [metric]: 10 }],
            },
          ],
          pagination: { cursor: isSecondPage ? null : 'next' },
        };
      },
      async text() {
        return '';
      },
    };
  };

  const result = await fetchUsage({ projectIds: null, fetchImpl });
  // Every metric group asked for its second page.
  assert.ok(secondPages.length > 0, 'a cursor page was requested');
  // Ten on each of the two pages, for the compute metric.
  assert.equal(result.usage.computeTimeSeconds, 20);
  assert.equal(result.projectCount, 2);
});

test('NEON_PROJECT_IDS narrows the scope, and neither set means the whole org', () => {
  assert.deepEqual(projectScopeFromEnv({ NEON_PROJECT_IDS: 'a, b', NEON_PROJECT_ID: 'c' }), ['a', 'b']);
  assert.deepEqual(projectScopeFromEnv({ NEON_PROJECT_ID: 'c' }), ['c']);
  assert.equal(projectScopeFromEnv({}), null);
});

test('project names are looked up per id and never fail the read', async () => {
  process.env.NEON_API_KEY = 'test-key';
  const names = await fetchProjectNames(['p1', 'p2'], async (url) => {
    if (url.includes('p2')) throw new Error('network');
    return { ok: true, async json() { return { project: { name: 'ProjectHub' } }; } };
  });
  assert.deepEqual(names, { p1: 'ProjectHub' });
});

test('the usage-preview no longer demands a single project id', () => {
  const routes = source('api/_lib/bot-routes.js');
  assert.doesNotMatch(routes, /NEON_PROJECT_ID is not configured/);
  assert.match(routes, /projectScopeFromEnv/);
  assert.match(routes, /scope:/);
});

test('the bot alerts on the organization scope, not a single project', () => {
  const bot = source('bot/index.js');
  assert.match(bot, /projectScopeFromEnv\(\)/);
  assert.match(bot, /topProjects/);
  assert.match(bot, /projectCount/);
});

/* -------------------------------------------------------- bot liveness */

test('the bot process writes a heartbeat and the dashboard reads it back', () => {
  const store = source('api/_lib/bot-store.js');
  const bot = source('bot/index.js');

  // The heartbeat column is added by the same lazy schema step as the tables,
  // so a deployment that predates it picks it up without a manual migration.
  assert.match(store, /ALTER TABLE bot_settings ADD COLUMN IF NOT EXISTS last_seen_at/);
  assert.match(store, /export async function recordBotHeartbeat/);
  assert.match(store, /export async function getBotLiveness/);
  // The writer stamps the database clock, not the caller's.
  assert.match(store, /VALUES \('default', now\(\)\)/);
  assert.match(store, /ON CONFLICT \(id\) DO UPDATE SET last_seen_at = now\(\)/);

  // The bot process must actually call it, on its own interval.
  assert.match(bot, /recordBotHeartbeat\(\)/);
  assert.match(bot, /setInterval\(beat, HEARTBEAT_INTERVAL_MS\)/);
});

test('a configured token is not treated as a running bot', () => {
  // `botTokenConfigured` is read from the web deployment's environment, so it
  // stays true while the bot host is down. Liveness has to be separate or the
  // dashboard reports a healthy bot that answers nothing.
  const routes = source('api/_lib/bot-routes.js');
  assert.match(routes, /const liveness = await getBotLiveness\(\)/);
  assert.match(routes, /running: liveness\.running/);
  assert.match(routes, /lastSeenAt: liveness\.lastSeenAt/);

  const page = source('client/src/pages/admin-bot.tsx');
  assert.match(page, /ok=\{Boolean\(status\?\.running\)\}/);
  assert.match(page, /Bot process/);
  // And the page must say what to do about a dead process.
  assert.match(page, /npm run bot/);
});

test('the heartbeat threshold is well above the heartbeat interval', () => {
  // A 15-minute usage poll must not make a live bot look stale, so the heartbeat
  // is on its own interval rather than sharing the poll's cadence.
  const store = source('api/_lib/bot-store.js');
  const bot = source('bot/index.js');
  const staleMs = Number(/BOT_STALE_AFTER_MS = ([\d\s*]+);/.exec(store)[1].replace(/\s|\*/g, ''));
  const beatMs = Number(/HEARTBEAT_INTERVAL_MS = ([\d\s*]+);/.exec(bot)[1].replace(/\s|\*/g, ''));
  assert.ok(staleMs >= beatMs * 3, `stale ${staleMs}ms should allow at least 3 missed beats of ${beatMs}ms`);
});

/* ------------------------------------------------- token names and redaction */

const {
  TOKEN_VARIABLES,
  resolveDiscordToken,
  missingBotEnvironment,
  redactToken,
  botIntents,
} = await import('../bot/index.js');

test('the token is accepted under any of the documented names', () => {
  for (const name of TOKEN_VARIABLES) {
    const resolved = resolveDiscordToken({ [name]: '  a-token  ' });
    assert.equal(resolved.token, 'a-token', `${name} is trimmed and used`);
    assert.equal(resolved.source, name);
  }
});

test('DISCORD_BOT_TOKEN wins when several names are set', () => {
  // Precedence has to be stable: a host that sets both must not depend on
  // enumeration order, which is why the list is ordered and the first wins.
  const resolved = resolveDiscordToken({ BOT_TOKEN: 'second', DISCORD_BOT_TOKEN: 'first' });
  assert.equal(resolved.token, 'first');
  assert.equal(resolved.source, 'DISCORD_BOT_TOKEN');
  assert.deepEqual(TOKEN_VARIABLES[0], 'DISCORD_BOT_TOKEN');
});

test('an absent token reports no source rather than an empty name', () => {
  assert.deepEqual(resolveDiscordToken({}), { token: '', source: null });
  // Whitespace is not a token.
  assert.equal(resolveDiscordToken({ DISCORD_BOT_TOKEN: '   ' }).token, '');
});

test('a token under an alias satisfies the required-environment check', () => {
  assert.deepEqual(missingBotEnvironment({ DISCORD_TOKEN: 'x', DATABASE_URL: 'postgres://y' }), []);
  assert.deepEqual(missingBotEnvironment({ DATABASE_URL: 'postgres://y' }), ['DISCORD_BOT_TOKEN']);
  assert.deepEqual(missingBotEnvironment({ DISCORD_TOKEN: 'x' }), ['DATABASE_URL']);
});

test('a token is stripped from log text, by value and by shape', () => {
  // discord.js prints "Provided token: <token>" under its Debug event. The value
  // must not reach a host's log file, whatever name it arrived under.
  //
  // The fake is assembled from parts rather than written as one literal, so the
  // file never contains a token-shaped string: secret scanners match the shape,
  // and a fixture that trips them trains people to click through the warning.
  const parts = ['MTAwMDAwMDAwMDAwMDAwMDAwMA', 'AAAAAA', 'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789AB'];
  const token = parts.join('.');
  const byValue = redactToken(`Provided token: ${token}`, token);
  assert.ok(!byValue.includes(token), 'the configured value is removed');
  assert.match(byValue, /\[token redacted\]/);

  // And with no configured value — an alias this process never read still matches
  // the shape, so it cannot slip through.
  const byShape = redactToken(`Provided token: ${token}`);
  assert.ok(!byShape.includes(token), 'a token-looking string is removed without being configured');
  assert.ok(!byShape.includes(parts[0]), 'no fragment of the token survives');

  // discord.js censors the signature itself and prints asterisks in its place.
  // That form is token-shaped too, and is removed so no host log carries even a
  // partial credential.
  const censored = redactToken(`Provided token: ${parts[0]}.${parts[1]}.${'*'.repeat(38)}`);
  assert.equal(censored, 'Provided token: [token redacted]');

  // Ordinary text is untouched, and an empty input does not throw.
  assert.equal(redactToken('shard 0 ready'), 'shard 0 ready');
  assert.equal(redactToken('Waiting for event ready for 15000ms'), 'Waiting for event ready for 15000ms');
  assert.equal(redactToken(undefined), '');
});

test('the bot requests the intents the gateway actually needs', () => {
  // MessageContent is the one whose absence is silent: content arrives empty and
  // every prefix command is ignored without an error anywhere.
  const intents = botIntents();
  assert.ok(intents.includes(GatewayIntentBits.MessageContent), 'MessageContent is requested');
  assert.ok(intents.includes(GatewayIntentBits.GuildMessages), 'GuildMessages is requested');
  assert.ok(intents.includes(GatewayIntentBits.Guilds));
  // GuildMembers is privileged; it is what makes memberCount trustworthy.
  assert.ok(intents.includes(GatewayIntentBits.GuildMembers), 'GuildMembers is requested');
});

test('the gateway lifecycle is logged, not left silent', () => {
  const bot = source('bot/index.js');
  // Each transition that explains a silent bot must have a line.
  for (const event of ['ShardReady', 'ShardReconnecting', 'ShardResume', 'ShardDisconnect', 'ShardError']) {
    assert.match(bot, new RegExp(`Events\\.${event}`), `${event} is handled`);
  }
  // The ready banner names the account and the guilds, which is what tells an
  // operator the process reached Discord at all.
  assert.match(bot, /signed in as \$\{ready\.user\.tag\}/);
  assert.match(bot, /in \$\{guilds\.length\} guild\(s\)/);
  assert.match(bot, /connecting to Discord/);

  // The token source is reported, but never the token.
  assert.match(bot, /token source: \$\{tokenSource\}/);
  assert.ok(!/token source: \$\{token\}/.test(bot), 'the source is logged, not the value');

  // The Debug event goes through the redactor, and the console is wrapped so the
  // library cannot print a token around it.
  assert.match(bot, /logGateway\('%s', redactToken\(message\)\)/);
  assert.match(bot, /guardConsole\(\)/);
});

test('the org-wide embed counts projects and names the largest consumers', () => {
  const embed = buildAlertEmbed({
    projectName: 'All projects',
    projectId: null,
    evaluation: BREACHING,
    projectCount: 3,
    topProjects: [
      { id: 'p1', computeTimeSeconds: 7200 },
      { id: 'p2', computeTimeSeconds: 3600 },
      { id: 'p3', computeTimeSeconds: 0 },
    ],
    projectNames: { p1: 'ProjectHub', p2: 'bot' },
  });

  assert.match(embed.description, /across 3 projects/);
  const ranked = embed.fields.find((f) => /Top projects/.test(f.name));
  assert.ok(ranked, 'the breakdown field is present');
  assert.match(ranked.value, /ProjectHub/);
  assert.match(ranked.value, /bot/);
  // A project with zero compute is not worth a line.
  assert.doesNotMatch(ranked.value, /p3/);
  // With no single project there is no per-project URL to link to.
  assert.equal(embed.url, 'https://console.neon.tech');
});

