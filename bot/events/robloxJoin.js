/**
 * The one best-effort Bloxlink check the bot runs on a join.
 *
 * This is what feeds the linked-accounts table and the "Roblox account linked"
 * notification without continuously polling every member: a member is checked
 * once when they join, and thereafter only when they open their profile or run a
 * Roblox command. The result is cached, so the join check is also what makes
 * that first profile view cheap.
 *
 * Everything here is a side effect. A Bloxlink outage, a missing key or a
 * configuration error must never affect the join, so failures are swallowed.
 */
import { getRobloxSettings, applyLinkResult } from '../../api/_lib/roblox-store.js';
import { lookupBloxlinkLink, isBloxlinkConfigured } from '../../api/_lib/roblox-client.js';

export function createRobloxJoinHandler({ logInvite = null, notify = null } = {}) {
  return async (member) => {
    try {
      const settings = await getRobloxSettings();
      if (!settings.enabled || !settings.bloxlinkEnabled) return;
      if (!isBloxlinkConfigured()) return;

      const guildId = member.guild?.id || '';
      const result = await lookupBloxlinkLink({ discordId: member.id, guildId: guildId || undefined });
      // Only a definite answer is cached here. An unreachable Bloxlink on join
      // writes nothing rather than recording a misleading "unavailable" row, so
      // the first real profile view does the check instead.
      if (result.status !== 'linked' && result.status !== 'not_linked') return;

      const applied = await applyLinkResult({
        guildId,
        discordId: member.id,
        result: { status: result.status, robloxId: result.robloxId || null, source: 'bloxlink' },
      });

      logInvite?.(
        'roblox join check %s: %s%s',
        member.id,
        result.status,
        applied.eventType ? ` (${applied.eventType})` : '',
      );

      if (applied.eventType && typeof notify === 'function') {
        await notify(member.client, settings, {
          eventType: applied.eventType,
          discordId: member.id,
          robloxId: result.robloxId || null,
          detail: result.status,
        });
      }
    } catch (error) {
      console.error('[bot] roblox join check failed:', error.message);
    }
  };
}
