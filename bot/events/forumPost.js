/**
 * The `ThreadCreate` handler: a new Forum post becomes a GitHub issue.
 *
 * Discord delivers a new Forum post as a thread whose `parentId` is the Forum
 * channel. This handler decides whether the post belongs to the configured
 * Forum, resolves its repository tag, and *enqueues* the work — it never makes
 * the GitHub call itself, so a slow GitHub API cannot stall the gateway.
 *
 * Everything is best-effort and self-contained: a database blip, an unconfigured
 * integration or an unrecognised tag is reported (in the thread, when there is a
 * reason to) and never thrown into the gateway's event loop.
 */
import { handleForumPost } from '../lib/github-forum-service.js';
import { getGithubForumSettings } from '../lib/github-forum-store.js';

/**
 * Creates the handler.
 *
 * The settings are read here only to short-circuit cheaply — a thread in an
 * unrelated forum channel is ignored before any work. The service re-reads the
 * settings for the authoritative decision, so a stale read cannot create an
 * issue for the wrong channel.
 */
export function createForumPostHandler({ log = null } = {}) {
  return (thread) => {
    handleThreadCreate(thread, { log }).catch((error) =>
      console.error('[bot] forum post handling failed:', error.message),
    );
  };
}

export async function handleThreadCreate(thread, { log = null } = {}) {
  // A non-thread, or a thread outside a forum, is not a submission.
  if (!thread?.isThread?.()) return { skipped: 'not_thread' };
  if (!thread.parentId) return { skipped: 'not_forum' };

  let settings;
  try {
    settings = await getGithubForumSettings();
  } catch (error) {
    console.error('[bot] forum settings read failed:', error.message);
    return { skipped: 'settings_unavailable' };
  }

  if (!settings.enabled) return { skipped: 'disabled' };
  // Cheap pre-filter: a thread in another forum channel is not ours.
  if (settings.forumChannelId && String(thread.parentId) !== String(settings.forumChannelId)) {
    return { skipped: 'wrong_channel' };
  }

  log?.('forum thread created: %s (%s)', thread.id, thread.name);
  return handleForumPost(thread, { log });
}
