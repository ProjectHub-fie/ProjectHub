/**
 * Bloxlink and Roblox API clients.
 *
 * Two providers, deliberately kept apart:
 *
 *   - **Bloxlink** answers "which Roblox account has this Discord member
 *     linked?". That answer is the only thing this project ever treats as proof
 *     of ownership, because Bloxlink's own linking process is what establishes
 *     it. The endpoint is the server-scoped public API:
 *
 *         GET https://api.blox.link/v4/public/guilds/{guildId}/discord-to-roblox/{discordId}
 *         Authorization: <server API key>
 *
 *     A successful response is `{ robloxID: "..." }`; `{ error: "User not
 *     found" }` means the member has not linked an account, and
 *     `{ error: "Invalid API Key" }` / `{ error: "You must provide an api-key" }`
 *     mean the key is missing or wrong. Those three are distinct outcomes and are
 *     never collapsed into each other.
 *
 *   - **Roblox** answers public account questions: resolve a username to an id,
 *     read a profile, read the avatar thumbnail. This is a *public lookup* — it
 *     proves nothing about who owns the account, so its result never becomes a
 *     "verified" state.
 *
 * ## Reliability
 *
 * Every call is bounded by a timeout and resolves an outcome envelope instead of
 * throwing: the caller distinguishes "not linked" from "could not ask", which is
 * exactly the distinction the UI needs to avoid telling a member they are
 * unverified during an outage. The API key is read from the environment here,
 * only ever sent to Bloxlink, and never logged or returned.
 */
import {
  ROBLOX_STATUS,
  isValidRobloxId,
  isValidRobloxUsername,
} from '../../bot/lib/roblox-logic.js';

const BLOXLINK_API = 'https://api.blox.link/v4';
const ROBLOX_USERS_API = 'https://users.roblox.com/v1';
const ROBLOX_THUMBNAILS_API = 'https://thumbnails.roblox.com/v1';

/** Bounded so a hung provider cannot hold a command or a dashboard request open. */
const DEFAULT_TIMEOUT_MS = 6000;

/**
 * Whether Bloxlink can be asked at all.
 *
 * The key is the server's Bloxlink API key (`BLOXLINK_API_KEY`) and lives only
 * in the environment; there is no default, because a published fallback would be
 * a credential any reader of this repository could use.
 */
export function isBloxlinkConfigured(env = process.env) {
  return Boolean(String(env.BLOXLINK_API_KEY || '').trim());
}

/**
 * The guild the Bloxlink key is scoped to.
 *
 * `BLOXLINK_GUILD_ID` is the private server's guild id. A server API key is only
 * valid for the guild it was generated for, so a request without one cannot be
 * built — and building it for the wrong guild would return `not_found` for every
 * member, which is the silent failure this explicit check avoids.
 */
export function bloxlinkGuildId(env = process.env) {
  const value = String(env.BLOXLINK_GUILD_ID || '').trim();
  return /^\d{15,25}$/.test(value) ? value : null;
}

/** A `fetch` bounded by a timeout, so a provider stall becomes a normal error. */
async function fetchWithTimeout(fetchImpl, url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Asks Bloxlink which Roblox account a Discord member has linked.
 *
 * Resolves an envelope, never throws:
 *
 *   - `{ status: 'linked', robloxId }`
 *   - `{ status: 'not_linked' }`
 *   - `{ status: 'verification_unavailable', reason }` — not configured,
 *     rate-limited, or the key was rejected. We could not answer, and the caller
 *     must not render this as "not linked".
 *   - `{ status: 'bloxlink_unavailable', reason }` — network, timeout or 5xx.
 */
export async function lookupBloxlinkLink(
  { discordId, guildId = bloxlinkGuildId(), apiKey = process.env.BLOXLINK_API_KEY, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (!discordId) return { status: ROBLOX_STATUS.VERIFICATION_UNAVAILABLE, reason: 'no_discord_id' };
  if (!apiKey) return { status: ROBLOX_STATUS.VERIFICATION_UNAVAILABLE, reason: 'not_configured' };
  if (!guildId) return { status: ROBLOX_STATUS.VERIFICATION_UNAVAILABLE, reason: 'no_guild' };

  const url = `${BLOXLINK_API}/public/guilds/${encodeURIComponent(guildId)}/discord-to-roblox/${encodeURIComponent(discordId)}`;

  let response;
  try {
    response = await fetchWithTimeout(
      fetchImpl,
      url,
      { headers: { Authorization: String(apiKey), Accept: 'application/json' } },
      timeoutMs,
    );
  } catch (error) {
    return { status: ROBLOX_STATUS.BLOXLINK_UNAVAILABLE, reason: error?.name === 'AbortError' ? 'timeout' : 'network_error' };
  }

  if (response.status === 429) {
    return { status: ROBLOX_STATUS.VERIFICATION_UNAVAILABLE, reason: 'rate_limited' };
  }
  if (response.status >= 500) {
    return { status: ROBLOX_STATUS.BLOXLINK_UNAVAILABLE, reason: `bloxlink_${response.status}` };
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  // A JSON `error` field is how Bloxlink reports both "no link" and auth
  // problems, so the message is the discriminator, not the status code.
  const error = typeof body?.error === 'string' ? body.error : null;
  if (error) {
    if (/user not found|not linked|no linked/i.test(error)) return { status: ROBLOX_STATUS.NOT_LINKED };
    if (/api.?key|unauthori[sz]ed|forbidden/i.test(error)) {
      return { status: ROBLOX_STATUS.VERIFICATION_UNAVAILABLE, reason: 'invalid_key' };
    }
    return { status: ROBLOX_STATUS.BLOXLINK_UNAVAILABLE, reason: 'bloxlink_error' };
  }

  if (!response.ok) {
    return { status: ROBLOX_STATUS.BLOXLINK_UNAVAILABLE, reason: `bloxlink_${response.status}` };
  }

  // The documented success shape. A success with no usable id is treated as
  // "could not verify" rather than "not linked", because an unexpected payload
  // is not evidence of anything.
  const robloxId = body?.robloxID ?? body?.robloxId ?? body?.roblox_id ?? null;
  if (isValidRobloxId(robloxId)) return { status: ROBLOX_STATUS.LINKED, robloxId: String(robloxId) };
  return { status: ROBLOX_STATUS.VERIFICATION_UNAVAILABLE, reason: 'unexpected_payload' };
}

/* --------------------------------------------------------------- Roblox API */

/**
 * Resolves a Roblox username to a public account.
 *
 * A public lookup: the returned id is not tied to any Discord account. Resolves
 * `{ found: false }` for an unknown username (Roblox returns an empty list) and
 * `{ found: false, unavailable: true }` when the API could not be reached, so
 * the two are distinguishable in the reply.
 */
export async function resolveRobloxUsername(username, { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!isValidRobloxUsername(username)) return { found: false, invalid: true };

  let response;
  try {
    response = await fetchWithTimeout(
      fetchImpl,
      `${ROBLOX_USERS_API}/usernames/users`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ usernames: [String(username).trim()], excludeBannedUsers: false }),
      },
      timeoutMs,
    );
  } catch {
    return { found: false, unavailable: true };
  }

  if (!response.ok) {
    // 429 and 5xx are "ask again later", not "no such user".
    return { found: false, unavailable: response.status === 429 || response.status >= 500 };
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    return { found: false, unavailable: true };
  }

  const entry = Array.isArray(body?.data) ? body.data[0] : null;
  if (!entry?.id) return { found: false };
  return {
    found: true,
    userId: String(entry.id),
    username: entry.name || String(username),
    displayName: entry.displayName || entry.name || String(username),
  };
}

/**
 * Reads a public Roblox profile by id.
 *
 * `avatarUrl` is fetched separately and is best-effort: an avatar failure must
 * not sink the profile, since the rest of the fields are still correct.
 */
export async function fetchRobloxProfile(userId, { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!isValidRobloxId(userId)) return { found: false, invalid: true };

  let response;
  try {
    response = await fetchWithTimeout(
      fetchImpl,
      `${ROBLOX_USERS_API}/users/${encodeURIComponent(userId)}`,
      { headers: { Accept: 'application/json' } },
      timeoutMs,
    );
  } catch {
    return { found: false, unavailable: true };
  }

  if (!response.ok) return { found: false, unavailable: response.status === 429 || response.status >= 500 };

  let body = null;
  try {
    body = await response.json();
  } catch {
    return { found: false, unavailable: true };
  }

  if (!body?.id) return { found: false };

  return {
    found: true,
    userId: String(body.id),
    username: body.name || null,
    displayName: body.displayName || body.name || null,
    created: body.created || null,
    description: body.description || null,
    avatarUrl: await fetchRobloxAvatar(String(body.id), { fetchImpl, timeoutMs }),
  };
}

/** The headshot thumbnail URL for an account, or `null` when unavailable. */
export async function fetchRobloxAvatar(userId, { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!isValidRobloxId(userId)) return null;
  try {
    const response = await fetchWithTimeout(
      fetchImpl,
      `${ROBLOX_THUMBNAILS_API}/users/avatar-headshot?userIds=${encodeURIComponent(userId)}&size=420x420&format=Png&isCircular=false`,
      { headers: { Accept: 'application/json' } },
      timeoutMs,
    );
    if (!response.ok) return null;
    const body = await response.json();
    const state = body?.data?.[0];
    if (state?.state === 'Completed' && state.imageUrl) return state.imageUrl;
    return null;
  } catch {
    return null;
  }
}
