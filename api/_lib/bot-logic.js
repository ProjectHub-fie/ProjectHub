/**
 * Pure command and alert logic for the ProjectHub Discord bot.
 *
 * Nothing here imports discord.js, a database driver or `process.env`. The bot
 * process decorates these results with live Discord objects, and the tests call
 * them directly, so the rules that matter — prefix parsing, who is allowed to
 * run a command, and when a usage figure becomes an alert — can be checked
 * without a gateway connection or a database.
 */

/** The private bot's command prefix. */
export const BOT_PREFIX = '&';

/**
 * Parses `&command args...` out of a message body.
 *
 * Returns `{ command, args, rest }` in lower case, or null when the message is
 * not a command for this bot. A message that merely contains the prefix later in
 * its text (`see foo & bar`) is not a command, and neither is a bare `&`.
 */
export function parseCommand(content, prefix = BOT_PREFIX) {
  const text = typeof content === 'string' ? content.trim() : '';
  if (!text.startsWith(prefix)) return null;

  const withoutPrefix = text.slice(prefix.length).trim();
  if (!withoutPrefix) return null;

  const [command, ...args] = withoutPrefix.split(/\s+/);
  return {
    command: command.toLowerCase(),
    args,
    rest: args.join(' '),
  };
}

/**
 * The site role a Discord identity holds.
 *
 * A Discord id is looked up against the admin portal first and the public users
 * table second, because the same Discord account can be linked to either or
 * both. The returned value is the union, so an administrator who is also a
 * client is reported as both rather than being flattened to one.
 */
export function resolveRoles({ admin = null, user = null } = {}) {
  const roles = [];

  if (admin?.role) {
    // The admin PIN is deliberately not carried here. It is half of the admin
    // login credential and this result is rendered into a channel where every
    // member can read it.
    roles.push({ scope: 'admin', label: admin.role });
  }
  if (user) {
    if (user.isBlocked) {
      roles.push({ scope: 'client', label: 'blocked', blocked: true });
    } else {
      roles.push({ scope: 'client', label: 'client', blocked: false });
    }
  }

  return {
    isLinked: Boolean(admin || user),
    roles,
    isAdmin: Boolean(admin?.role),
    // A blocked client still resolves, but the command output says so.
    isBlocked: Boolean(user?.isBlocked),
  };
}

/**
 * Metric keys the usage alert tracks, in the order the embed lists them.
 *
 * These mirror the fields the Neon consumption API returns. `limit` comes from
 * the dashboard configuration because Neon does not expose the plan's ceiling
 * through the same endpoint as the consumed totals.
 */
export const USAGE_METRICS = [
  { key: 'computeTimeSeconds', limitKey: 'computeLimitSeconds', label: 'Compute', unit: 'seconds' },
  { key: 'storageBytes', limitKey: 'storageLimitBytes', label: 'Storage', unit: 'bytes' },
  { key: 'transferBytes', limitKey: 'transferLimitBytes', label: 'Data transfer', unit: 'bytes' },
];

/** Alert severities, worst last so a max() picks the right one. */
const SEVERITY_ORDER = ['ok', 'warning', 'critical', 'exceeded'];

/**
 * Compares observed usage against the configured tier limits.
 *
 * A percent at or above 100 is `exceeded`; at or above the configured threshold
 * (default 80) it is `critical`; at or above half the threshold it is `warning`;
 * otherwise `ok`. The overall level is the worst of the three metrics, so one
 * metric near its ceiling raises the alert even if the others are quiet.
 */
export function evaluateUsage(usage = {}, limits = {}, thresholdPercent = 80) {
  const threshold = Number.isFinite(thresholdPercent) && thresholdPercent > 0 ? thresholdPercent : 80;
  const warningAt = threshold / 2;

  const metrics = USAGE_METRICS.map((metric) => {
    const used = numberOrZero(usage[metric.key]);
    const limit = numberOrZero(limits[metric.limitKey]);
    const percent = limit > 0 ? (used / limit) * 100 : 0;

    let level = 'ok';
    if (limit > 0 && percent >= 100) level = 'exceeded';
    else if (limit > 0 && percent >= threshold) level = 'critical';
    else if (limit > 0 && percent >= warningAt) level = 'warning';

    return {
      key: metric.key,
      label: metric.label,
      unit: metric.unit,
      used,
      limit,
      percent,
      level,
    };
  });

  const level = metrics.reduce(
    (worst, metric) => (SEVERITY_ORDER.indexOf(metric.level) > SEVERITY_ORDER.indexOf(worst) ? metric.level : worst),
    'ok',
  );

  return { level, metrics, thresholdPercent: threshold };
}

/**
 * Whether an alert should be sent.
 *
 * Two independent gates: the usage has to have reached `warning` or worse, and
 * the same metric must not have alerted within the cooldown. Without the second
 * gate a usage that sits over the threshold would post on every poll.
 */
export function shouldAlert({ evaluation, lastAlertedAt = {}, now = Date.now(), cooldownMinutes = 360 } = {}) {
  if (!evaluation || evaluation.level === 'ok') return { alert: false, reason: 'below_threshold' };

  const cooldownMs = Math.max(0, numberOrZero(cooldownMinutes)) * 60 * 1000;
  const breaching = evaluation.metrics.filter((metric) => metric.level !== 'ok');
  const due = breaching.filter((metric) => {
    const previous = lastAlertedAt[metric.key];
    if (!previous) return true;
    const previousMs = new Date(previous).getTime();
    if (!Number.isFinite(previousMs)) return true;
    return now - previousMs >= cooldownMs;
  });

  if (!due.length) return { alert: false, reason: 'cooldown', breaching };

  return {
    alert: true,
    breaching,
    due,
    // Stamped onto the metrics that fired, so the next poll can honour the cooldown.
    marks: Object.fromEntries(due.map((metric) => [metric.key, new Date(now).toISOString()])),
  };
}

/** Colors by severity, so the embed reads at a glance in the channel list. */
const ALERT_COLORS = {
  warning: 0xf59e0b,
  critical: 0xef4444,
  exceeded: 0x991b1b,
};

const ALERT_TITLES = {
  warning: 'Neon usage is climbing',
  critical: 'Neon usage is near the tier limit',
  exceeded: 'Neon usage has exceeded the tier limit',
};

/**
 * Builds the alert embed as plain data.
 *
 * Deliberately not a discord.js EmbedBuilder: keeping it a plain object means
 * the same value can be posted to a channel and serialised into a webhook body
 * by one code path, and the tests can assert on it without a Discord client.
 */
export function buildAlertEmbed({
  projectName,
  projectId,
  evaluation,
  organizationName = null,
  periodStart = null,
  dashboardUrl = 'https://console.neon.tech',
  at = new Date(),
} = {}) {
  const breaching = (evaluation?.metrics || []).filter((metric) => metric.level !== 'ok');
  const fields = (breaching.length ? breaching : evaluation?.metrics || []).map((metric) => ({
    name: `${metric.label} — ${formatPercent(metric.percent)}%`,
    value: `${formatQuantity(metric.used, metric.unit)} of ${formatQuantity(metric.limit, metric.unit)}`,
    inline: true,
  }));

  return {
    title: `${ALERT_TITLES[evaluation?.level] || ALERT_TITLES.critical}: ${projectName || 'project'}`,
    description:
      `Project \`${projectName || projectId || 'unknown'}\` has reached the ` +
      `${evaluation?.thresholdPercent ?? 80}% alert threshold on ${breaching.length} metric(s).`,
    color: ALERT_COLORS[evaluation?.level] || ALERT_COLORS.critical,
    fields,
    footer: { text: organizationName ? `Neon · ${organizationName}` : 'Neon usage monitor' },
    timestamp: new Date(at).toISOString(),
    url: projectId ? `${dashboardUrl}/projects/${projectId}` : dashboardUrl,
    ...(periodStart ? { periodStart } : {}),
  };
}

/** Bytes as GB, seconds as hours — matching how Neon's own dashboard reads. */
export function formatQuantity(value, unit) {
  const amount = numberOrZero(value);
  if (unit === 'bytes') {
    const gb = amount / 1024 ** 3;
    return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(amount / 1024 ** 2).toFixed(1)} MB`;
  }
  if (unit === 'seconds') return `${(amount / 3600).toFixed(2)} CU-h`;
  return String(amount);
}

export function formatPercent(value) {
  const amount = numberOrZero(value);
  return amount >= 100 ? Math.round(amount).toString() : amount.toFixed(1);
}

/**
 * Redacts a Discord webhook URL for display.
 *
 * The URL's path segment is the credential: anyone holding it can post to the
 * channel. The dashboard shows the shape of what is configured without ever
 * handing the secret back to a browser.
 */
export function maskWebhook(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/^(https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/[^/]+)\/(.+)$/);
  if (!match) return '••••••••';
  return `${match[1]}/••••••••`;
}

/** True when a value looks like a Discord webhook URL before it is saved. */
export function isValidWebhookUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d+\/[\w-]+$/.test(url);
}

/** True when a value looks like a Discord snowflake (channel id). */
export function isSnowflake(value) {
  return typeof value === 'string' && /^\d{17,20}$/.test(value);
}

function numberOrZero(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}
