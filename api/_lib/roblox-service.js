/**
 * The Roblox integration service: one place to ask "is this member linked?".
 *
 * Both the bot process and the dashboard call through here, so the cache rules,
 * the TTL, the failure vocabulary and the feature-gating decision are defined
 * once. It composes three pieces:
 *
 *   - `roblox-client.js`  — the Bloxlink and Roblox HTTP calls.
 *   - `roblox-store.js`   — the cache, settings and log.
 *   - `roblox-logic.js`   — the pure status vocabulary.
 *
 * ## Caching
 *
 * A member's Bloxlink answer is cached in `roblox_links` for
 * `ROBLOX_CACHE_TTL_MS` (default six hours). A profile view inside the TTL is a
 * single database read and **no** provider call, which is what keeps a busy
 * server from hammering Bloxlink. A refresh outside the TTL re-asks Bloxlink and
 * re-reads the public Roblox profile, whose result is additionally held in a
 * small in-process TTL cache so several embeds in one poll share the read.
 *
 * A failed check never overwrites a good cached link with an "unavailable"
 * status: the last known answer survives an outage, and the outage is reported
 * separately. That matters because the alternative — treating an unreachable
 * API as "not linked" — would strip a verified member of their access during a
 * Bloxlink blip.
 */
import {
  ROBLOX_STATUS,
  isLinkedStatus,
  normalizeStatus,
} from '../../bot/lib/roblox-logic.js';
import { lookupBloxlinkLink, fetchRobloxProfile, isBloxlinkConfigured } from './roblox-client.js';
import { getCachedLink, applyLinkResult, getRobloxSettings } from './roblox-store.js';

/** How long a cached Bloxlink answer is trusted before it is re-read. */
export const ROBLOX_CACHE_TTL_MS = Number(process.env.ROBLOX_CACHE_TTL_MS || 6 * 60 * 60 * 1000);

/** Whether a cached row is still inside the TTL. */
export function isCacheFresh(row, now = Date.now(), ttlMs = ROBLOX_CACHE_TTL_MS) {
  if (!row?.lastCheckedAt) return false;
  const checked = new Date(row.lastCheckedAt).getTime();
  if (!Number.isFinite(checked)) return false;
  return now - checked < ttlMs;
}

/**
 * Resolves a member's Bloxlink status, using the cache when it is fresh.
 *
 * `force` re-asks Bloxlink even inside the TTL — the dashboard's Member Lookup
 * uses it when the operator explicitly wants the current answer. (The dashboard's
 * Test action does not go through here; it probes `lookupBloxlinkLink` directly,
 * because it needs the raw provider outcome rather than a member's status.)
 *
 * Resolves `{ status, robloxId, cached, checkedAt }`. A read failure inside the
 * provider is a status, not an exception: the caller decides how to present it.
 */
export async function checkMemberLink(
  { guildId = '', discordId, force = false, fetchImpl = fetch, now = Date.now() } = {},
) {
  if (!discordId) return { status: ROBLOX_STATUS.VERIFICATION_UNAVAILABLE, robloxId: null, cached: false, checkedAt: null };

  // The cache is consulted first, before any configuration check. A fresh cached
  // answer is a real answer Bloxlink gave earlier in the TTL window, so it is
  // served even when the deployment's environment is momentarily missing a key:
  // a configuration gap must not strip a verified member, and it must not spend
  // a provider call either.
  const cached = await getCachedLink(guildId, discordId).catch(() => null);
  if (!force && isCacheFresh(cached, now)) {
    return { status: normalizeStatus(cached.status), robloxId: cached.robloxId || null, cached: true, checkedAt: cached.lastCheckedAt };
  }

  const settings = await getRobloxSettings().catch(() => null);
  if (settings && !settings.bloxlinkEnabled) {
    return { status: ROBLOX_STATUS.VERIFICATION_UNAVAILABLE, robloxId: cached?.robloxId || null, cached: false, reason: 'bloxlink_disabled' };
  }
  if (!isBloxlinkConfigured()) {
    return { status: ROBLOX_STATUS.VERIFICATION_UNAVAILABLE, robloxId: cached?.robloxId || null, cached: false, reason: 'not_configured' };
  }

  const result = await lookupBloxlinkLink({ discordId, guildId: guildId || undefined, fetchImpl });

  // A check we could not answer: the live answer stays "unavailable" (never a
  // fabricated link or a fabricated "not linked"), and `applyLinkResult`
  // preserves whatever link was already known, bumping only its timestamp so the
  // outage neither strips the member nor re-asks Bloxlink on every message.
  if (result.status === ROBLOX_STATUS.BLOXLINK_UNAVAILABLE || result.status === ROBLOX_STATUS.VERIFICATION_UNAVAILABLE) {
    await applyLinkResult({
      guildId,
      discordId,
      result: { status: result.status, robloxId: null, source: 'bloxlink' },
    }).catch(() => {});
    return {
      status: result.status,
      robloxId: cached?.robloxId || null,
      previous: cached,
      cached: false,
      reason: result.reason || null,
      checkedAt: new Date(now),
    };
  }

  const applied = await applyLinkResult({
    guildId,
    discordId,
    result: { status: result.status, robloxId: result.robloxId || null, source: 'bloxlink' },
  }).catch(() => ({ changed: false, eventType: null, previous: cached }));

  return {
    status: result.status,
    robloxId: result.robloxId || null,
    cached: false,
    changed: applied.changed,
    eventType: applied.eventType,
    previous: applied.previous,
    checkedAt: new Date(now),
  };
}

/* ------------------------------------------- in-process Roblox profile cache */

const PROFILE_TTL_MS = Number(process.env.ROBLOX_PROFILE_TTL_MS || 6 * 60 * 60 * 1000);
const PROFILE_CACHE_MAX = 500;
const profileCache = new Map();

function readProfileCache(userId, now) {
  const entry = profileCache.get(userId);
  if (!entry) return null;
  if (now - entry.at >= PROFILE_TTL_MS) {
    profileCache.delete(userId);
    return null;
  }
  return entry.value;
}

function writeProfileCache(userId, value, now) {
  // A bounded Map used as an LRU: re-inserting moves the key to the end, and the
  // oldest entry is evicted when the cap is exceeded.
  profileCache.delete(userId);
  profileCache.set(userId, { value, at: now });
  if (profileCache.size > PROFILE_CACHE_MAX) {
    const oldest = profileCache.keys().next().value;
    profileCache.delete(oldest);
  }
}

/** Clears the in-process profile cache. Used by tests. */
export function clearProfileCache() {
  profileCache.clear();
}

/**
 * The public Roblox profile for an account id, cached in-process.
 *
 * Best-effort: an unavailable profile resolves `null` rather than failing the
 * caller, because the Bloxlink status is the part that must always render.
 */
export async function getRobloxProfile(userId, { fetchImpl = fetch, now = Date.now(), force = false } = {}) {
  if (!userId) return null;
  if (!force) {
    const hit = readProfileCache(userId, now);
    if (hit) return hit;
  }
  const profile = await fetchRobloxProfile(userId, { fetchImpl });
  const value = profile.found ? profile : null;
  writeProfileCache(userId, value, now);
  return value;
}

/**
 * Everything a member's Roblox card needs, in one call.
 *
 * Combines the cached Bloxlink status with the public Roblox profile. A member
 * with no link returns just the status; a linked member also gets the profile
 * fields, which may be `null` if the Roblox API is briefly unavailable.
 */
export async function getMemberRoblox(
  { guildId = '', discordId, force = false, fetchImpl = fetch, now = Date.now() } = {},
) {
  const link = await checkMemberLink({ guildId, discordId, force, fetchImpl, now });
  // A stale-but-known id still renders the public profile, so a provider outage
  // does not blank a card the server can otherwise fill. The Bloxlink status
  // itself stays whatever the live answer was, so nothing is reported as
  // "verified" on the strength of a stale row.
  if (!link.robloxId) return { ...link, profile: null };
  const profile = await getRobloxProfile(link.robloxId, { fetchImpl, now });
  return { ...link, profile };
}

/* ----------------------------------------------------------- feature access */

/**
 * Whether a channel is configured as verified-only.
 *
 * The stored value is a comma-separated list of channel ids; a missing or empty
 * list means no channel is restricted.
 */
export function isVerifiedOnlyChannel(settings, channelId) {
  if (!settings?.requireVerification || !settings.verifiedOnlyChannels || !channelId) return false;
  return String(settings.verifiedOnlyChannels)
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(String(channelId));
}

/**
 * The feature-gating decision.
 *
 * Returns `{ required, allowed, reason }`.
 *
 *   - `required` is false when the integration is off, or verification is not
 *     required, or the setting does not apply.
 *   - Staff (`isStaff`, the caller's site role resolving to admin/owner) always
 *     pass, so an administrator is never locked out of their own server by a
 *     Bloxlink outage.
 *   - A member is allowed only on a confirmed link. `not_linked`,
 *     `verification_unavailable` and `bloxlink_unavailable` are all refusals for
 *     a non-staff member, but the reason differs so the bot can say *why*
 *     (an outage should not read as "you are not verified").
 */
export function evaluateFeatureAccess({ settings, status, isStaff = false } = {}) {
  if (!settings?.enabled || !settings?.requireVerification) return { required: false, allowed: true, reason: 'not_required' };
  if (isStaff) return { required: true, allowed: true, reason: 'staff' };

  const normalized = normalizeStatus(status);
  if (normalized === ROBLOX_STATUS.LINKED) return { required: true, allowed: true, reason: 'linked' };
  if (normalized === ROBLOX_STATUS.NOT_LINKED) return { required: true, allowed: false, reason: 'not_linked' };
  return { required: true, allowed: false, reason: normalized };
}

/** The refusal message, worded so an outage is not reported as "unverified". */
export function featureAccessMessage(reason, { prefix = '&' } = {}) {
  switch (reason) {
    case 'not_linked':
      return (
        '🎮 **Roblox Verified required**\n' +
        'Link a Roblox account through Bloxlink to use this. Run ' +
        `\`${prefix}roblox verify\` for the steps.`
      );
    case ROBLOX_STATUS.VERIFICATION_UNAVAILABLE:
      return '🚧 Roblox verification is temporarily unavailable (Bloxlink is not configured or is rate-limited). Try again shortly.';
    case ROBLOX_STATUS.BLOXLINK_UNAVAILABLE:
      return '🚧 Bloxlink could not be reached just now, so I cannot confirm your Roblox link. Try again shortly.';
    default:
      return 'This feature requires a Bloxlink-verified Roblox account.';
  }
}

/** The one-line status a member sees in a compact display. */
export function compactLinkedLine(robloxUsername, status) {
  if (!isLinkedStatus(status) || !robloxUsername) return null;
  return `🎮 \`${robloxUsername}\``;
}
