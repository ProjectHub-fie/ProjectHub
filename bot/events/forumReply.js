/**
 * The thread-reply half of the Discord → GitHub direction.
 *
 * Every eligible user message in a linked Forum thread becomes a GitHub issue
 * comment. This handler is registered alongside the command handler and never
 * interferes with it: it only looks at messages in a thread whose parent is the
 * configured Forum channel, and the service refuses anything else.
 *
 * The reply is *enqueued*, not sent inline, so the gateway is never blocked by a
 * GitHub call and a restart resumes an unprocessed reply. The loop guard (a bot
 * or integration message is never synced) lives in the pure rules and is applied
 * before the enqueue.
 */
import { handleThreadReply } from '../lib/github-forum-service.js';
import { getGithubForumSettings } from '../lib/github-forum-store.js';

export function createForumReplyHandler({ log = null } = {}) {
  return (message) => {
    handleThreadMessage(message, { log }).catch((error) =>
      console.error('[bot] forum reply handling failed:', error.message),
    );
  };
}

export async function handleThreadMessage(message, { log = null } = {}) {
  // The cheapest possible filter first: only a message inside a thread can be a
  // forum reply, so ordinary channel traffic never reaches the database.
  if (!message?.channel?.isThread?.()) return { skipped: 'not_thread' };
  if (message.author?.bot) return { skipped: 'bot_message' };

  let settings;
  try {
    settings = await getGithubForumSettings();
  } catch (error) {
    console.error('[bot] forum settings read failed:', error.message);
    return { skipped: 'settings_unavailable' };
  }
  if (!settings.enabled) return { skipped: 'disabled' };
  if (settings.forumChannelId && String(message.channel.parentId) !== String(settings.forumChannelId)) {
    return { skipped: 'wrong_channel' };
  }

  return handleThreadReply(message, { log });
}
