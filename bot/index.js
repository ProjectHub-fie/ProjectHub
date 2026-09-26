/**
 * The ProjectHub Discord bot.
 *
 * This is a long-running process, not a serverless function. A prefix bot with
 * mention replies needs a persistent gateway WebSocket, and a Vercel function is
 * request-scoped and cannot hold one, so the bot has to run somewhere that keeps
 * a process alive (a VPS, Railway, Fly, Render, WispByte, or Docker). The
 * dashboard half of this feature — configuration and status — still works on
 * Vercel, because it is ordinary request/response; only this file needs a
 * persistent host.
 *
 * What it does:
 *
 *   - Reads the message stream, so `&`-prefixed commands and @-mentions work.
 *   - `&dev` reports the site role of whoever asks, resolved from the Discord id
 *     they linked in the admin portal (or the client portal).
 *   - Replies when the bot is mentioned, so it works in a server where members
 *     expect to just @ it.
 *   - Polls Neon consumption and posts a usage embed to the configured channel
 *     and webhook when a metric crosses the tier threshold.
 *   - Stamps a heartbeat so the dashboard can tell a running process from a
 *     configured-but-dead one.
 *
 * Configuration is read from the database on a short interval, so changing the
 * channel or the threshold in the dashboard takes effect without restarting the
 * bot. The bot token and Neon API key come from the environment; they are never
 * loaded from the database or written to it.
 *
 * Logging. The startup sequence and every gateway transition are printed to the
 * console, because "the bot is silent" is otherwise indistinguishable from "the
 * process never started". Verbose per-event detail goes through `debug` under
 * the `bot:*` namespaces, enabled with either the standard `DEBUG=bot:*` or
 * `BOT_DEBUG=bot:*`.
 */
import debug from 'debug';
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Client, GatewayIntentBits, Partials, EmbedBuilder, Options } from 'discord.js';
import {
  BOT_PREFIX,
  parseCommand,
  resolveRoles,
  evaluateUsage,
  shouldAlert,
  buildAlertEmbed,
  formatQuantity,
  formatPercent,
  isValidWebhookUrl,
} from '../api/_lib/bot-logic.js';
import { getBotSettings, getAlertState, recordAlertTimes, resolveDiscordIdentity, recordBotHeartbeat } from '../api/_lib/bot-store.js';
import { fetchUsage, fetchProjectNames, projectScopeFromEnv, orgIdFromEnv, isNeonConfigured } from '../api/_lib/neon-usage.js';
import { attachBotEvents, attachGatewayLogging as attachEventGatewayLogging } from './events/index.js';

/* ---------------------------------------------------------------- logging */

// `debug` reads DEBUG at import time; BOT_DEBUG is an explicit override so the
// namespaces can be turned on without also enabling every other library's.
if (process.env.BOT_DEBUG) debug.enable(process.env.BOT_DEBUG);

const logBoot = debug('bot:boot');
const logGateway = debug('bot:gateway');
const logMessage = debug('bot:message');
const logCommand = debug('bot:command');
const logAlert = debug('bot:alert');

// A Discord token is three base64url parts joined by dots. The third character
// class includes `*` so this also matches the form discord.js prints itself:
// `_censoredToken` keeps the application id and timestamp and replaces the
// signature with asterisks, so the secret never leaves the process through its
// Debug event — but the result is still token-shaped, and a token-shaped string
// in a log is worth removing outright.
const TOKEN_SHAPE = /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_*-]{10,}/g;

/**
 * Removes a token from a log line.
 *
 * discord.js already censors the signature part, so this is a second layer: it
 * also covers a token that arrives under a name this process never read, and any
 * error or stack trace that quotes a request header. Matching the shape rather
 * than only the configured value is what makes that possible.
 */
export function redactToken(text, token = '') {
  let out = String(text ?? '');
  if (token) out = out.split(token).join('[token redacted]');
  return out.replace(TOKEN_SHAPE, '[token redacted]');
}

/** Prints the startup banner: what was resolved, and what is being requested. */
function logStartup({ tokenSource, intents, pollMinutes, heartbeatSeconds }) {
  console.log('[bot] ---- startup ----');
  console.log(`[bot] token source: ${tokenSource}`);
  console.log(`[bot] intents: ${intents.join(', ')}`);
  console.log(`[bot] usage poll every ${pollMinutes}m, heartbeat every ${heartbeatSeconds}s`);
  logBoot('token source %s, intents %o', tokenSource, intents);
}

const POLL_INTERVAL_MS = Number(process.env.BOT_POLL_INTERVAL_MINUTES || 15) * 60 * 1000;
// Well under BOT_STALE_AFTER_MS so a transient database blip does not flip the
// dashboard to "not running".
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
const SETTINGS_REFRESH_MS = 60 * 1000;

let settings = null;
let settingsLoadedAt = 0;

/**
 * The current configuration, refreshed on a short interval.
 *
 * A dashboard edit should not require an operator to restart the bot, so the
 * cached value expires rather than being read once at boot. A read failure keeps
 * the last good value instead of clearing it.
 */
export async function currentSettings() {
  const now = Date.now();
  if (settings && now - settingsLoadedAt < SETTINGS_REFRESH_MS) return settings;
  try {
    settings = await getBotSettings();
    settingsLoadedAt = now;
  } catch (error) {
    console.error('[bot] could not read settings:', error.message);
    // Fall back to the cached value; a database blip must not turn commands off.
  }
  return settings || { prefix: BOT_PREFIX, enabled: false };
}

/* ------------------------------------------------------------------- client */

/**
 * The intents this bot requests.
 *
 * GuildMembers is privileged and the application has it enabled; it is what
 * makes `guild.memberCount` and member-scoped events trustworthy. MessageContent
 * is required for prefix commands — without it `message.content` arrives empty
 * and every command is silently ignored, which is the failure this list exists
 * to make obvious at boot.
 */
export function botIntents() {
  return [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ];
}

/** The intent names, for the boot log. */
function intentNames(intents) {
  return Object.entries(GatewayIntentBits)
    .filter(([, value]) => intents.includes(value))
    .map(([name]) => name);
}

export function createClient() {
  return new Client({
    intents: botIntents(),
    // A DM needs the channel partial to arrive at all.
    partials: [Partials.Channel],
    // Bound the caches: a long-lived process should not grow with every message
    // it has ever seen. Reactions are fetched on demand, so they are not cached.
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: { maxSize: 50 },
      GuildMemberManager: { maxSize: 200 },
      UserManager: { maxSize: 200 },
      ReactionManager: { maxSize: 0 },
      GuildInviteManager: { maxSize: 0 },
      StageInstanceManager: { maxSize: 0 },
      VoiceStateManager: { maxSize: 0 },
    }),
  });
}

/** Backwards-compatible export for callers that only need gateway logging. */
export function attachGatewayLogging(client) {
  return attachEventGatewayLogging(client, { logGateway, redactToken });
}

/**
 * Keeps a token out of anything discord.js prints to the console directly.
 *
 * The gateway logger covers the Debug event, but the library also writes its own
 * warnings and stack traces. Wrapping the console methods covers both paths, and
 * `redactToken` is a no-op on text with no token in it.
 */
export function guardConsole() {
  for (const method of ['log', 'warn', 'error', 'info', 'debug']) {
    const original = console[method].bind(console);
    console[method] = (...args) =>
      original(...args.map((arg) => (typeof arg === 'string' ? redactToken(arg) : arg)));
  }
}

/**
 * Routes one message: a mention first, then a prefix command.
 *
 * The mention path exists because members treat an @ as "talk to the bot" and
 * should not have to remember the prefix. It answers the same `&dev` question
 * when the mention carries no command, so `@ProjectHub` and `@ProjectHub dev`
 * both work.
 */
export async function handleMessage(message) {
  if (!message || message.author?.bot) return undefined;

  const config = await currentSettings();
  const mentioned = message.mentions?.has?.(message.client?.user?.id);

  logMessage(
    '%s from %s in %s: %s',
    mentioned ? 'mention' : 'message',
    message.author?.tag || message.author?.id,
    message.guild ? message.guild.name : 'DM',
    message.content,
  );

  if (mentioned) {
    // Strip the mention so the remainder parses like a prefixed command.
    const stripped = message.content.replace(/<@!?\d+>/g, '').trim();
    const parsed = parseCommand(stripped, '') || { command: 'dev', args: [], rest: '' };
    return runCommand(parsed, message, config, { via: 'mention' });
  }

  const parsed = parseCommand(message.content, config.prefix || BOT_PREFIX);
  if (!parsed) return undefined;
  return runCommand(parsed, message, config, { via: 'prefix' });
}

async function runCommand(parsed, message, config, { via }) {
  logCommand('%s via %s from %s', parsed.command, via, message.author?.tag || message.author?.id);
  switch (parsed.command) {
    case 'dev':
      return handleDev(message, { via });
    case 'help':
      return message.reply(
        `ProjectHub commands:\n\`${config.prefix || BOT_PREFIX}dev\` — your role on the ProjectHub site.\n` +
          'You can also just @ me.',
      );
    default:
      // An unknown command is answered only when the bot was addressed directly;
      // otherwise ordinary chatter containing the prefix would get a reply.
      if (via === 'mention') {
        return message.reply(`I don't know \`${parsed.command}\`. Try \`${config.prefix || BOT_PREFIX}help\`.`);
      }
      return undefined;
  }
}

/**
 * `&dev` — reports the site role of the person asking.
 *
 * The lookup goes through the Discord id linked in the admin portal, falling
 * back to the client portal, so one command answers for both kinds of account.
 * An unlinked account is told how to link rather than being silently ignored.
 */
export async function handleDev(message, { via } = {}) {
  const discordId = message.author?.id;
  if (!discordId) return undefined;

  let identity;
  try {
    identity = await resolveDiscordIdentity(discordId);
  } catch (error) {
    console.error('[bot] role lookup failed:', error.message);
    return message.reply('I could not reach the ProjectHub database just now. Try again shortly.');
  }

  const resolved = resolveRoles(identity);
  logCommand(
    '&dev for %s resolved: linked=%s admin=%s roles=%o',
    discordId,
    resolved.isLinked,
    resolved.isAdmin,
    resolved.roles,
  );

  const embed = new EmbedBuilder()
    .setColor(resolved.isBlocked ? 0xef4444 : resolved.isAdmin ? 0x6366f1 : 0x22c55e)
    .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL?.() })
    .setTitle('ProjectHub role')
    .setTimestamp();

  if (!resolved.isLinked) {
    embed
      .setDescription('This Discord account is not linked to a ProjectHub account.')
      .addFields({
        name: 'How to link',
        value:
          'Sign in at the ProjectHub site, open **Settings**, and choose **Link Discord**.' +
          ' Administrators link from the admin portal settings page instead.',
      });
    return message.reply({ embeds: [embed] });
  }

  embed.setDescription(
    resolved.roles
      .map((role) =>
        role.scope === 'admin'
          ? `**Admin portal** — \`${role.label}\``
          : `**Client portal** — \`${role.label}\`${role.blocked ? ' (account is blocked)' : ''}`,
      )
      .join('\n'),
  );

  if (identity.user) {
    const name = [identity.user.firstName, identity.user.lastName].filter(Boolean).join(' ');
    embed.addFields({
      name: 'Client account',
      value: name || identity.user.username || identity.user.email || 'linked',
      inline: true,
    });
  }

  if (via === 'mention') embed.setFooter({ text: 'Resolved from your linked Discord account' });

  return message.reply({ embeds: [embed] });
}

/* --------------------------------------------------------------- usage alert */

/**
 * One usage check: read Neon, evaluate, and post if something crossed.
 *
 * Split from the timer so the dashboard's test action and the tests can invoke it
 * without waiting for an interval.
 */
export async function runUsageCheck({ client = null, now = Date.now(), fetchImpl = fetch, force = false } = {}) {
  const config = await currentSettings();
  if (!config.enabled && !force) return { skipped: 'disabled' };
  if (!isNeonConfigured()) return { skipped: 'no_neon_key' };

  // The scope is every project in the organization unless the environment
  // narrows it: `NEON_PROJECT_IDS` (or `NEON_PROJECT_ID`) filters to those.
  const projectIds = projectScopeFromEnv();
  const orgId = orgIdFromEnv();

  let usage;
  try {
    usage = await fetchUsage({ projectIds, orgId, fetchImpl });
  } catch (error) {
    console.error('[bot] usage read failed:', error.message);
    return { skipped: 'read_failed', error: error.message };
  }

  const evaluation = evaluateUsage(usage.usage, config, config.alertThresholdPercent);
  const lastAlertedAt = await getAlertState().catch(() => ({}));
  const decision = shouldAlert({
    evaluation,
    lastAlertedAt,
    now,
    cooldownMinutes: config.alertCooldownMinutes,
  });

  if (!decision.alert) return { evaluation, decision, sent: false };

  // The label is organization-wide unless the environment narrowed the scope to
  // explicit projects, in which case naming them is more honest than a count.
  const names = await fetchProjectNames(usage.perProject.map((p) => p.id), fetchImpl).catch(() => ({}));
  const orgWide = usage.scope === 'org';
  const projectName = config.projectName || (orgWide ? 'All projects' : names[usage.perProject[0]?.id] || projectIds.join(', '));
  const embed = buildAlertEmbed({
    projectName,
    projectId: orgWide ? null : usage.perProject[0]?.id,
    evaluation: { ...evaluation, metrics: decision.breaching },
    projectCount: usage.projectCount,
    topProjects: usage.perProject,
    projectNames: names,
    at: new Date(now),
  });

  const delivery = await deliverAlert(embed, config, client);
  // Only mark the metrics that actually reached a destination, so a total
  // delivery failure retries next poll.
  if (delivery.channel || delivery.webhook) {
    await recordAlertTimes(decision.marks).catch((error) =>
      console.error('[bot] could not record alert state:', error.message),
    );
  }

  if (usage.unavailable?.length) {
    console.warn('[bot] metrics unavailable this poll:', usage.unavailable.map((u) => u.key).join(', '));
  }

  logAlert('alert level %s delivered channel=%s webhook=%s', evaluation.level, delivery.channel, delivery.webhook);

  return { evaluation, decision, embed, delivery, sent: Boolean(delivery.channel || delivery.webhook) };
}

/**
 * Posts an alert to the channel and the webhook.
 *
 * Both destinations are attempted independently: the webhook is specified as an
 * independent copy, so a misconfigured channel must not suppress it.
 */
export async function deliverAlert(embed, config, client) {
  const result = { channel: false, webhook: false };

  if (client && config.alertChannelId) {
    try {
      const channel = await client.channels.fetch(config.alertChannelId);
      if (channel?.isTextBased?.()) {
        await channel.send({ embeds: [embed] });
        result.channel = true;
      }
    } catch (error) {
      console.error('[bot] channel alert failed:', error.message);
    }
  }

  if (config.alertWebhookUrl && isValidWebhookUrl(config.alertWebhookUrl)) {
    try {
      const response = await fetch(config.alertWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // allowed_mentions is pinned off: a usage alert must never ping the
        // channel, and a webhook post can otherwise mention roles.
        body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }),
      });
      if (!response.ok) throw new Error(`webhook responded ${response.status}`);
      result.webhook = true;
    } catch (error) {
      console.error('[bot] webhook alert failed:', error.message);
    }
  }

  return result;
}

/** A human summary of the current usage, used by the dashboard test action. */
export function summarizeUsage(evaluation) {
  return evaluation.metrics
    .map(
      (metric) =>
        `${metric.label}: ${formatPercent(metric.percent)}% (${formatQuantity(metric.used, metric.unit)} / ${formatQuantity(metric.limit, metric.unit)})`,
    )
    .join(' · ');
}

/* -------------------------------------------------------------------- start */

// The names a token may arrive under. DISCORD_BOT_TOKEN is the documented one;
// the rest are accepted because hosts label their secret fields differently and
// a bot that will not boot over a naming difference is a needless outage.
export const TOKEN_VARIABLES = ['DISCORD_BOT_TOKEN', 'BOT_TOKEN', 'DISCORD_TOKEN', 'TOKEN', 'CLIENT_TOKEN'];

/**
 * Finds the token and reports which variable supplied it.
 *
 * The source is returned rather than just the value so the boot log can say
 * which name won — with five candidates, "the token is set" is not enough to
 * debug a host that injected the wrong one.
 */
export function resolveDiscordToken(env = process.env) {
  for (const name of TOKEN_VARIABLES) {
    const value = String(env[name] || '').trim();
    if (value) return { token: value, source: name };
  }
  return { token: '', source: null };
}

export function botTokenFromEnv(env = process.env) {
  return resolveDiscordToken(env).token;
}

export function missingBotEnvironment(env = process.env) {
  return ['DISCORD_BOT_TOKEN', 'DATABASE_URL'].filter((name) => {
    if (name === 'DISCORD_BOT_TOKEN') return !botTokenFromEnv(env);
    return !String(env[name] || '').trim();
  });
}

const LOGIN_ATTEMPTS = 5;
const LOGIN_BACKOFF_MS = 5_000;

/**
 * Whether a login failure is permanent.
 *
 * A rejected token or an intent the application has not enabled will fail
 * identically on every retry, so retrying only delays the operator seeing the
 * real reason. Everything else — DNS not up yet, a refused connection, a
 * timeout — is what a host that starts the process before its network does.
 */
export function isFatalLoginError(error) {
  const code = String(error?.code || '');
  if (/TokenInvalid|TokenMissing|InvalidIntents|DisallowedIntents/i.test(code)) return true;
  return /invalid token|tokeninvalid|disallowed intents|used disallowed/i.test(String(error?.message || ''));
}

/**
 * Signs in, retrying transient failures with exponential backoff.
 *
 * discord.js reconnects on its own once the session exists; this covers the
 * first handshake, which is the one a host fails when the process comes up
 * before networking. A permanent failure is rethrown immediately.
 */
export async function loginWithRetry(
  client,
  token,
  { attempts = LOGIN_ATTEMPTS, baseDelayMs = LOGIN_BACKOFF_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {},
) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await client.login(token);
    } catch (error) {
      lastError = error;
      if (isFatalLoginError(error)) throw error;
      if (attempt === attempts) break;
      const delay = baseDelayMs * 2 ** (attempt - 1);
      console.warn(
        `[bot] login attempt ${attempt}/${attempts} failed (${error.message}); retrying in ${delay / 1000}s`,
      );
      await sleep(delay);
    }
  }
  throw lastError;
}

export async function main() {
  const { token, source } = resolveDiscordToken();
  const missing = missingBotEnvironment();
  if (missing.length) {
    throw new Error(
      `missing required environment variable${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`,
    );
  }

  const intents = botIntents();
  logStartup({
    tokenSource: source,
    intents: intentNames(intents),
    pollMinutes: POLL_INTERVAL_MS / 60_000,
    heartbeatSeconds: HEARTBEAT_INTERVAL_MS / 1000,
  });

  // Before anything touches Discord: the token is in this process now, so no
  // later log line should be able to print it.
  guardConsole();

  const client = createClient();
  attachBotEvents(client, {
    handleMessage,
    prefix: BOT_PREFIX,
    logBoot,
    logGateway,
    redactToken,
  });

  console.log('[bot] connecting to Discord...');
  await loginWithRetry(client, token);
  console.log('[bot] login resolved, gateway handshake complete');

  const tick = async () => {
    try {
      const result = await runUsageCheck({ client });
      if (result.sent) console.log('[bot] usage alert sent:', summarizeUsage(result.evaluation));
    } catch (error) {
      console.error('[bot] usage poll failed:', error.message);
    }
  };

  // The heartbeat is on its own, faster interval: it answers "is the process
  // alive", so it must not inherit the usage poll's cadence — a 15-minute poll
  // would look stale against the 5-minute threshold even while running.
  const beat = async () => {
    try {
      await recordBotHeartbeat();
      logBoot('heartbeat recorded');
    } catch (error) {
      console.error('[bot] heartbeat failed:', error.message);
    }
  };

  // Give the gateway a moment to be ready before the first poll.
  setTimeout(tick, 10_000);
  setInterval(tick, POLL_INTERVAL_MS);

  await beat();
  setInterval(beat, HEARTBEAT_INTERVAL_MS);

  const shutdown = async () => {
    console.log('[bot] shutting down');
    await client.destroy();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Only start when executed directly, so importing this module in a test or
// through the WispByte root launcher does not open two gateway connections.
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedFile === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('[bot] fatal:', error);
    process.exit(1);
  });
}
