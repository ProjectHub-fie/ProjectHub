/**
 * The GitHub webhook receiver.
 *
 * The ProjectHub web deployment already exposes an API, so the receiver is a
 * route on it rather than a second service. This module is the logic behind that
 * route, kept free of Express so both the serverless function and the Express
 * dev server call the same code and the tests can drive it directly.
 *
 * A delivery is:
 *
 *   1. Authenticated by HMAC-SHA256 over the *raw* body with
 *      `GITHUB_WEBHOOK_SECRET` — an unset secret refuses every delivery rather
 *      than accepting anything.
 *   2. Deduplicated by its `X-GitHub-Delivery` id, so GitHub's retry (or a hand
 *      re-send) cannot be processed twice.
 *   3. Validated: only an event that belongs to a *linked* issue is turned into
 *      a job. An unlinked issue is acknowledged and ignored.
 *   4. Persisted as a queue job. Nothing is sent to Discord here — the bot
 *      process owns that — so the receiver stays a fast request/response and the
 *      function's 30s budget is never at risk.
 *
 * The signature check needs the raw bytes, so the caller must pass the
 * unparsed body; a re-serialized body will not verify.
 */
import { verifyWebhookSignature, SIGNATURE_HEADER } from './github-forum-client.js';
import { planWebhookEvent, webhookIssueRef } from './github-forum-logic.js';
import {
  getIssueLinkByIssue,
  recordWebhookDelivery,
  markDeliveryProcessed,
  recordSyncLog,
} from './github-forum-store.js';
import { enqueueGithubComment, enqueueStateChange } from './github-forum-service.js';

/**
 * Handles one delivery.
 *
 * Returns `{ status, body }` rather than writing a response, so the caller maps
 * it to HTTP. Every failure path returns a body safe to send back — no secret,
 * no token, no raw stack.
 */
export async function handleGithubWebhook({
  rawBody,
  headers = {},
  env = process.env,
  event = null,
  deliveryId = null,
  action = null,
  payload = null,
} = {}) {
  const secret = String(env.GITHUB_WEBHOOK_SECRET || '').trim();
  if (!secret) {
    // Refusing is the safe default: an unauthenticated endpoint that can drive
    // Discord posts would let anyone with the URL forge deliveries.
    return { status: 503, body: { message: 'GitHub webhook is not configured' } };
  }

  const signature = headers[SIGNATURE_HEADER] || headers['x-hub-signature-256'];
  const verification = verifyWebhookSignature(rawBody, signature, secret);
  if (!verification.ok) {
    console.warn(`[forum-webhook] rejected delivery: ${verification.reason}`);
    return { status: 401, body: { message: 'Invalid webhook signature' } };
  }

  const eventName = String(event || headers['x-github-event'] || '').trim();
  const delivery = String(deliveryId || headers['x-github-delivery'] || '').trim();
  let actionName = action ?? null;

  if (!delivery) {
    return { status: 400, body: { message: 'Missing X-GitHub-Delivery header' } };
  }

  // Dedupe first: a redelivery of an event already accepted must not be queued
  // again, whatever its outcome was.
  const recorded = await recordWebhookDelivery({
    deliveryId: delivery,
    eventType: eventName || null,
    action: actionName,
  });
  if (recorded.duplicate) {
    return { status: 200, body: { ok: true, duplicate: true } };
  }

  let parsed = payload;
  if (!parsed) {
    try {
      parsed = rawBody ? JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody)) : {};
    } catch {
      await markDeliveryProcessed(delivery, { status: 'invalid', note: 'unparseable body' });
      return { status: 400, body: { message: 'Invalid JSON body' } };
    }
  }

  // The action is read from the parsed body when it was not passed in: a
  // delivery arrives as bytes, and the action lives inside them.
  if (actionName == null) actionName = parsed?.action ?? null;

  const { repository, issueNumber } = webhookIssueRef(parsed);
  const linked = repository && issueNumber ? await getIssueLinkByIssue({ repository, issueNumber }) : null;

  const plan = planWebhookEvent({
    event: eventName,
    action: actionName,
    payload: parsed,
    linked: Boolean(linked),
    appLogin: String(env.GITHUB_APP_LOGIN || '').trim(),
  });

  if (plan.action === 'ignore') {
    await markDeliveryProcessed(delivery, { status: 'ignored', note: plan.reason });
    return { status: 200, body: { ok: true, ignored: plan.reason } };
  }

  let result;
  if (plan.action === 'discord_reply') {
    const comment = shapeWebhookComment(plan.comment);
    result = await enqueueGithubComment({ link: linked, comment, appLogin: String(env.GITHUB_APP_LOGIN || '').trim() });
  } else {
    result = await enqueueStateChange({
      link: linked,
      state: plan.state,
      title: plan.issue?.title || '',
      url: plan.issue?.html_url || '',
    });
  }

  const status = result.enqueued ? 'queued' : `skipped:${result.reason || 'duplicate'}`;
  await markDeliveryProcessed(delivery, { status, note: null });
  await recordSyncLog({
    eventId: delivery,
    eventType: eventName,
    source: 'github',
    destination: 'discord',
    repository,
    issueNumber: issueNumber || null,
    status: result.enqueued ? 'success' : 'skipped',
    direction: 'github_to_discord',
    errorSummary: result.enqueued ? null : result.reason || null,
  }).catch(() => {});

  return { status: 202, body: { ok: true, queued: result.enqueued, reason: result.reason || null } };
}

/** Shapes a webhook comment into what the service expects. */
export function shapeWebhookComment(comment) {
  if (!comment) return null;
  return {
    id: comment.id,
    body: comment.body || '',
    url: comment.html_url || '',
    createdAt: comment.created_at || null,
    user: comment.user ? { login: comment.user.login, id: comment.user.id } : null,
  };
}

export { SIGNATURE_HEADER };
