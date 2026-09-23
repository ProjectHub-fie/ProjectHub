/**
 * Administrative mail API.
 *
 * Every route here is mounted under /api/admin/mail/* and is reachable only with
 * an authenticated admin session, because the caller passes in its own
 * `requireAuth`/`requireRole` guards. The dashboard already has exactly those
 * guards, so mail reuses them rather than inventing a second auth system — this
 * router is transport-agnostic and is mounted by both `api/admin/index.js` (the
 * Vercel function) and `server/admin-routes.ts` (local development).
 *
 * Permission model: owner and admin may use the whole workspace. Moderators are
 * refused, per the requirement that mail is owner/admin only.
 */
import express from 'express';
import { sanitizeEmailHtml, toSnippet } from './mail-sanitize.js';
import {
  backfillFromProjectRequests,
  bulkUpdate,
  createTemplate,
  deleteDraft,
  deletePushSubscription,
  deleteTemplate,
  duplicateTemplate,
  getAttachment,
  getDraft,
  getMailCounts,
  getMessage,
  getNotificationSettings,
  getSignature,
  getThreadMessages,
  ingestMessage,
  listAudit,
  listDrafts,
  listMessages,
  listNotifications,
  listTemplates,
  markNotificationsRead,
  markThreadRead,
  recordAudit,
  saveDraft,
  saveNotificationSettings,
  savePushSubscription,
  saveSignature,
  setMessageRead,
  setMessageStar,
  setMessageTrashed,
  updateTemplate,
} from './mail-store.js';
import { isAdminMailConfigured, sendAdminEmail, isPublicEmailConfigured } from './email.js';

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 10 * 1024 * 1024;

// Attachment types the composer accepts. The client MIME value is never
// trusted on its own, but it is the only signal available at compose time, so it
// is checked against this allow-list and the size is bounded before a send.
const ALLOWED_ATTACHMENT_TYPES = new Set([
  'application/pdf',
  'application/zip',
  'application/json',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

const EMAIL_PATTERN = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

/** Splits a comma/semicolon separated address field into clean addresses. */
function parseAddressList(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(/[,;]/);
  return [...new Set(list.map((item) => String(item).trim().toLowerCase()).filter(Boolean))];
}

/** Returns the first invalid address in a list, or null when all are valid. */
function invalidAddress(list) {
  return list.find((email) => !EMAIL_PATTERN.test(email)) || null;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Renders a signature as email-safe HTML.
 *
 * The signature is administrator-authored, but it is still escaped here: a
 * signature field is not a place to smuggle markup into an outbound message, and
 * escaping keeps one rule for all user-supplied values.
 */
export function renderSignatureHtml(signature) {
  if (!signature || signature.enabled === false) return '';
  const lines = [];
  if (signature.name) lines.push(`<strong>${escapeHtml(signature.name)}</strong>`);
  if (signature.position) lines.push(escapeHtml(signature.position));
  if (signature.company) lines.push(escapeHtml(signature.company));

  const links = [];
  if (signature.website) {
    const url = /^https?:\/\//i.test(signature.website) ? signature.website : `https://${signature.website}`;
    links.push(`<a href="${escapeHtml(url)}">${escapeHtml(signature.website)}</a>`);
  }
  const social = signature.socialLinks || {};
  for (const [label, url] of Object.entries(social)) {
    if (!url || !/^https?:\/\//i.test(String(url))) continue;
    links.push(`<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`);
  }

  return `
<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#334155;">
  ${signature.logoUrl ? `<img src="${escapeHtml(signature.logoUrl)}" alt="" style="max-height:48px;margin-bottom:8px;" />` : ''}
  ${lines.join('<br />')}
  ${links.length ? `<br />${links.join(' &middot; ')}` : ''}
</div>`.trim();
}

/** Wraps composed body HTML in the branded shell used for outbound mail. */
export function renderOutboundHtml({ bodyHtml, signature }) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background:#ffffff;border-radius:14px;padding:32px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.7;color:#0f172a;">
        <tr><td>
          ${bodyHtml || ''}
          ${renderSignatureHtml(signature)}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/** Validates and normalises outgoing attachments from the compose payload. */
function prepareAttachments(list) {
  if (!Array.isArray(list) || list.length === 0) return { attachments: [], error: null };
  const attachments = [];
  let total = 0;

  for (const file of list) {
    const filename = String(file?.filename || '').slice(0, 200);
    const contentType = String(file?.contentType || '').toLowerCase();
    const base64 = typeof file?.base64Content === 'string' ? file.base64Content : '';

    if (!filename || !base64) return { attachments: [], error: 'Each attachment needs a filename and content' };
    if (!ALLOWED_ATTACHMENT_TYPES.has(contentType)) {
      return { attachments: [], error: `Attachments of type "${contentType || 'unknown'}" are not allowed` };
    }
    // `Buffer` decodes at send time; the byte length is what the limit applies
    // to, not the base64 character count.
    const sizeBytes = Math.floor((base64.length * 3) / 4);
    if (sizeBytes > MAX_ATTACHMENT_BYTES) {
      return { attachments: [], error: `${filename} exceeds the 5 MB per-file limit` };
    }
    total += sizeBytes;
    if (total > MAX_TOTAL_ATTACHMENT_BYTES) {
      return { attachments: [], error: 'Attachments exceed the 10 MB total limit' };
    }

    attachments.push({ filename, contentType, base64Content: base64, sizeBytes });
  }

  return { attachments, error: null };
}

/** Shapes an outbound payload into the fields Mailjet and our store both need. */
function buildOutboundBody({ subject, bodyHtml, signature }) {
  const plain = toSnippet(bodyHtml, 20000);
  const html = renderOutboundHtml({ bodyHtml, signature });
  return { subject: subject || '(no subject)', html, text: plain };
}

/**
 * Builds the mail router.
 *
 * `adminIdFrom(req)` returns the acting administrator's id, which is used to
 * scope drafts, signatures and notification settings to that admin only.
 */
export function buildMailRouter({ requireAuth, requireRole, adminIdFrom }) {
  const router = express.Router();

  // Owner and admin only. Moderators are deliberately excluded.
  const requireMailAccess = requireRole('admin');

  /** Records the acting admin id on the request for the handlers below. */
  const withAdmin = (req, res, next) => {
    req.mailAdminId = adminIdFrom(req);
    if (!req.mailAdminId) return res.status(403).json({ message: 'Administrator identity unavailable' });
    next();
  };

  const mailGuard = [requireAuth, requireMailAccess, withAdmin];

  const fail = (res, error, message) => {
    console.error('Mail API error:', error);
    const isMissingSchema = String(error?.message || '').includes('does not exist');
    res.status(500).json({
      message: isMissingSchema
        ? 'Mail storage is not available yet; run the mail schema bootstrap'
        : message,
    });
  };

  /* ------------------------------------------------------------ config/state */

  router.get('/api/admin/mail/status', ...mailGuard, async (_req, res) => {
    res.json({
      mailjetConfigured: isAdminMailConfigured(),
      resendConfigured: isPublicEmailConfigured(),
    });
  });

  router.get('/api/admin/mail/counts', ...mailGuard, async (_req, res) => {
    try {
      res.json(await getMailCounts());
    } catch (error) {
      fail(res, error, 'Failed to load mail counts');
    }
  });

  /* ------------------------------------------------------------------ inbox */

  router.get('/api/admin/mail/messages', ...mailGuard, async (req, res) => {
    const allowedViews = new Set(['inbox', 'starred', 'drafts', 'sent', 'trash', 'all']);
    const view = allowedViews.has(String(req.query.view)) ? String(req.query.view) : 'inbox';

    const truthy = (value) => value === 'true' || value === '1' || value === true;
    try {
      const result = await listMessages({
        view,
        filters: {
          search: req.query.search ? String(req.query.search).slice(0, 200) : null,
          unread: truthy(req.query.unread),
          attachments: truthy(req.query.attachments),
          starred: truthy(req.query.starred),
          inbox: truthy(req.query.inbox),
          after: req.query.after || null,
          before: req.query.before || null,
        },
        page: req.query.page,
        pageSize: req.query.pageSize,
      });
      res.json(result);
    } catch (error) {
      fail(res, error, 'Failed to load messages');
    }
  });

  router.get('/api/admin/mail/messages/:id', ...mailGuard, async (req, res) => {
    try {
      const message = await getMessage(req.params.id);
      if (!message) return res.status(404).json({ message: 'Message not found' });

      // Opening a message marks it read, which is what keeps the sidebar badge
      // honest without a separate request from the client.
      if (!message.isRead && message.direction === 'inbound') {
        await setMessageRead(req.params.id, true);
        message.isRead = true;
      }
      res.json(message);
    } catch (error) {
      fail(res, error, 'Failed to load message');
    }
  });

  router.get('/api/admin/mail/threads/:id', ...mailGuard, async (req, res) => {
    try {
      const result = await getThreadMessages(req.params.id);
      if (!result.thread) return res.status(404).json({ message: 'Thread not found' });
      await markThreadRead(req.params.id, true);
      res.json(result);
    } catch (error) {
      fail(res, error, 'Failed to load thread');
    }
  });

  /* ------------------------------------------------------------- attachments */

  router.get('/api/admin/mail/attachments/:id', ...mailGuard, async (req, res) => {
    try {
      const meta = await getAttachment(req.params.id, { withContent: true });
      if (!meta) return res.status(404).json({ message: 'Attachment not found' });

      // Metadata-only attachments live with the provider; there is nothing local
      // to serve, so the client is told rather than handed an empty file.
      if (!meta.content_data) {
        return res.status(404).json({
          message: 'This attachment is not stored locally',
          providerAttachmentId: meta.provider_attachment_id || null,
        });
      }

      const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(meta.content_data);
      const type = match?.[1] || meta.content_type || 'application/octet-stream';
      const buffer = match?.[2]
        ? Buffer.from(match[3], 'base64')
        : Buffer.from(decodeURIComponent(match?.[3] || ''));

      // `Content-Disposition: attachment` prevents the browser from rendering the
      // file inline; `nosniff` stops it second-guessing the declared type.
      res.setHeader('Content-Type', type);
      res.setHeader('Content-Disposition', `attachment; filename="${String(meta.filename).replace(/["\r\n]/g, '')}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(buffer);
    } catch (error) {
      fail(res, error, 'Failed to load attachment');
    }
  });

  /* ----------------------------------------------------------------- actions */

  router.patch('/api/admin/mail/messages/:id', ...mailGuard, async (req, res) => {
    const { isRead, isStarred, isTrashed, thread } = req.body || {};
    try {
      const result = {};
      if (typeof isRead === 'boolean') result.read = await setMessageRead(req.params.id, isRead);
      if (typeof isStarred === 'boolean') result.star = await setMessageStar(req.params.id, isStarred, { thread: thread === true });
      if (typeof isTrashed === 'boolean') result.trash = await setMessageTrashed(req.params.id, isTrashed);
      res.json({ success: true, ...result });
    } catch (error) {
      fail(res, error, 'Failed to update message');
    }
  });

  router.post('/api/admin/mail/bulk', ...mailGuard, async (req, res) => {
    const { ids, action } = req.body || {};
    const allowed = new Set(['read', 'unread', 'trash', 'restore', 'star', 'unstar']);
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ message: 'No messages selected' });
    if (!allowed.has(action)) return res.status(400).json({ message: 'Unsupported bulk action' });

    try {
      const result = await bulkUpdate(ids.slice(0, 200), action);
      await recordAudit(req.mailAdminId, `mail.bulk.${action}`, { details: { count: result.updated } });
      res.json({ success: true, ...result });
    } catch (error) {
      fail(res, error, 'Failed to apply bulk action');
    }
  });

  router.delete('/api/admin/mail/messages/:id', ...mailGuard, async (req, res) => {
    try {
      const result = await setMessageTrashed(req.params.id, true);
      if (!result) return res.status(404).json({ message: 'Message not found' });
      await recordAudit(req.mailAdminId, 'mail.trashed', { targetType: 'message', targetId: req.params.id });
      res.json({ success: true });
    } catch (error) {
      fail(res, error, 'Failed to delete message');
    }
  });

  /* ------------------------------------------------------------------ compose */

  /**
   * Sends a new message, a reply, a reply-all or a forward through Mailjet.
   *
   * The response reports the real outcome: a send that Mailjet did not queue is
   * a failure here, so the composer can never show "sent" for a message that
   * never left the account.
   */
  router.post('/api/admin/mail/send', ...mailGuard, async (req, res) => {
    const {
      to, cc, bcc, subject, bodyHtml, mode = 'new',
      threadId = null, replyToMessageId = null, draftId = null,
      attachmentPayload = [], includeSignature = true,
    } = req.body || {};

    const toList = parseAddressList(to);
    const ccList = parseAddressList(cc);
    const bccList = parseAddressList(bcc);

    if (!toList.length) return res.status(400).json({ message: 'At least one recipient is required' });

    const bad = invalidAddress([...toList, ...ccList, ...bccList]);
    if (bad) return res.status(400).json({ message: `"${bad}" is not a valid email address` });

    const prepared = prepareAttachments(attachmentPayload);
    if (prepared.error) return res.status(400).json({ message: prepared.error });

    if (!isAdminMailConfigured()) {
      return res.status(503).json({ message: 'Mailjet is not configured on the server' });
    }

    try {
      const signature = includeSignature ? await getSignature(req.mailAdminId) : null;
      const { html, text, subject: finalSubject } = buildOutboundBody({ subject, bodyHtml, signature });

      // Resolve the thread this send belongs to so the reply lands in the
      // existing conversation instead of starting a new one.
      let resolvedThreadId = threadId;
      let inReplyTo = null;
      let references = [];

      if (replyToMessageId && !resolvedThreadId) {
        const original = await getMessage(replyToMessageId);
        if (original) {
          resolvedThreadId = original.threadId;
          inReplyTo = original.providerMessageId || null;
          references = [original.providerMessageId, ...(original.references || [])].filter(Boolean);
        }
      }

      const result = await sendAdminEmail({
        to: toList.map((email) => ({ email })),
        cc: ccList,
        bcc: bccList,
        subject: finalSubject,
        html,
        text,
        attachments: prepared.attachments.map((file) => ({
          filename: file.filename,
          contentType: file.contentType,
          base64Content: file.base64Content,
        })),
      });

      if (!result.sent) {
        // Nothing was queued, so no Sent row is written — the Sent view must
        // only ever contain messages Mailjet accepted.
        await recordAudit(req.mailAdminId, 'mail.send.failed', {
          details: { reason: result.reason, errorCode: result.errorCode || null },
        });
        const message =
          result.reason === 'not_configured'
            ? 'Mailjet is not configured on the server'
            : result.errorMessage || 'Mailjet did not accept the message';
        return res.status(502).json({ message });
      }

      const ingested = await ingestMessage({
        providerMessageId: result.recipients?.[0]?.messageUuid || `mailjet-${result.id}`,
        // An explicit thread keeps a reply inside the conversation it answers.
        threadId: resolvedThreadId || null,
        direction: 'outbound',
        status: 'sent',
        fromName: null,
        fromEmail: process.env.MJ_SENDER_EMAIL || null,
        to: toList,
        cc: ccList,
        bcc: bccList,
        subject: finalSubject,
        bodyHtml: html,
        bodyText: text,
        provider: 'mailjet',
        inReplyTo,
        references,
        sentAt: new Date(),
        isRead: true,
        attachments: prepared.attachments.map((file) => ({
          filename: file.filename,
          contentType: file.contentType,
          sizeBytes: file.sizeBytes,
        })),
      });

      if (draftId) await deleteDraft(draftId, req.mailAdminId);

      await recordAudit(req.mailAdminId, mode === 'new' ? 'mail.sent' : `mail.${mode}.sent`, {
        targetType: 'message',
        targetId: ingested.id,
        details: { recipients: toList.length, attachments: prepared.attachments.length },
      });

      res.json({
        success: true,
        messageId: ingested.id,
        threadId: ingested.threadId,
        providerMessageId: result.id,
      });
    } catch (error) {
      fail(res, error, 'Failed to send message');
    }
  });

  /* ------------------------------------------------------------------ drafts */

  router.get('/api/admin/mail/drafts', ...mailGuard, async (req, res) => {
    try {
      res.json(await listDrafts(req.mailAdminId));
    } catch (error) {
      fail(res, error, 'Failed to load drafts');
    }
  });

  router.get('/api/admin/mail/drafts/:id', ...mailGuard, async (req, res) => {
    try {
      const draft = await getDraft(req.params.id, req.mailAdminId);
      if (!draft) return res.status(404).json({ message: 'Draft not found' });
      res.json(draft);
    } catch (error) {
      fail(res, error, 'Failed to load draft');
    }
  });

  /**
   * Saves a draft. The client debounces, and this endpoint upserts, so a burst
   * of keystrokes becomes one write rather than one per character.
   */
  router.post('/api/admin/mail/drafts', ...mailGuard, async (req, res) => {
    const { id = null, threadId = null, templateId = null, mode = 'new', to, cc, bcc, subject, bodyHtml, attachments } = req.body || {};
    try {
      const saved = await saveDraft({
        id,
        adminId: req.mailAdminId,
        threadId,
        templateId,
        mode,
        to: parseAddressList(to),
        cc: parseAddressList(cc),
        bcc: parseAddressList(bcc),
        subject: subject || '',
        bodyHtml: bodyHtml || '',
        attachments: Array.isArray(attachments) ? attachments.slice(0, 20) : [],
      });
      res.json({ success: true, ...saved });
    } catch (error) {
      fail(res, error, 'Failed to save draft');
    }
  });

  router.delete('/api/admin/mail/drafts/:id', ...mailGuard, async (req, res) => {
    try {
      const removed = await deleteDraft(req.params.id, req.mailAdminId);
      if (!removed) return res.status(404).json({ message: 'Draft not found' });
      res.json({ success: true });
    } catch (error) {
      fail(res, error, 'Failed to discard draft');
    }
  });

  /* --------------------------------------------------------------- templates */

  router.get('/api/admin/mail/templates', ...mailGuard, async (req, res) => {
    try {
      res.json(await listTemplates({ includeArchived: req.query.includeArchived === 'true' }));
    } catch (error) {
      fail(res, error, 'Failed to load templates');
    }
  });

  router.post('/api/admin/mail/templates', ...mailGuard, async (req, res) => {
    const { name, category, subject, bodyHtml, bodyText } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ message: 'Template name is required' });
    try {
      const template = await createTemplate({
        name: String(name).slice(0, 160),
        category: String(category || 'general').slice(0, 60),
        subject: subject || '',
        bodyHtml: bodyHtml || '',
        bodyText: bodyText || '',
        createdBy: req.mailAdminId,
      });
      await recordAudit(req.mailAdminId, 'mail.template.created', { targetType: 'template', targetId: template.id, details: { name: template.name } });
      res.status(201).json(template);
    } catch (error) {
      fail(res, error, 'Failed to create template');
    }
  });

  router.patch('/api/admin/mail/templates/:id', ...mailGuard, async (req, res) => {
    try {
      const updated = await updateTemplate(req.params.id, req.body || {});
      if (!updated) return res.status(404).json({ message: 'Template not found' });
      await recordAudit(req.mailAdminId, 'mail.template.updated', { targetType: 'template', targetId: req.params.id });
      res.json(updated);
    } catch (error) {
      fail(res, error, 'Failed to update template');
    }
  });

  router.post('/api/admin/mail/templates/:id/duplicate', ...mailGuard, async (req, res) => {
    try {
      const copy = await duplicateTemplate(req.params.id, req.mailAdminId);
      if (!copy) return res.status(404).json({ message: 'Template not found' });
      await recordAudit(req.mailAdminId, 'mail.template.duplicated', { targetType: 'template', targetId: copy.id });
      res.status(201).json(copy);
    } catch (error) {
      fail(res, error, 'Failed to duplicate template');
    }
  });

  router.delete('/api/admin/mail/templates/:id', ...mailGuard, async (req, res) => {
    try {
      const removed = await deleteTemplate(req.params.id);
      if (!removed) return res.status(404).json({ message: 'Template not found' });
      await recordAudit(req.mailAdminId, 'mail.template.deleted', { targetType: 'template', targetId: req.params.id });
      res.json({ success: true });
    } catch (error) {
      fail(res, error, 'Failed to delete template');
    }
  });

  /* -------------------------------------------------------------- signature */

  router.get('/api/admin/mail/signature', ...mailGuard, async (req, res) => {
    try {
      res.json((await getSignature(req.mailAdminId)) || {
        name: null, position: null, company: null, website: null, socialLinks: {}, logoUrl: null, enabled: true,
      });
    } catch (error) {
      fail(res, error, 'Failed to load signature');
    }
  });

  router.put('/api/admin/mail/signature', ...mailGuard, async (req, res) => {
    const { name, position, company, website, socialLinks, logoUrl, enabled } = req.body || {};
    try {
      const saved = await saveSignature(req.mailAdminId, {
        name: name?.slice(0, 120) || null,
        position: position?.slice(0, 120) || null,
        company: company?.slice(0, 120) || null,
        website: website?.slice(0, 200) || null,
        socialLinks: typeof socialLinks === 'object' && socialLinks ? socialLinks : {},
        logoUrl: logoUrl?.slice(0, 500) || null,
        enabled: enabled !== false,
      });
      await recordAudit(req.mailAdminId, 'mail.signature.updated');
      res.json(saved);
    } catch (error) {
      fail(res, error, 'Failed to save signature');
    }
  });

  /* ----------------------------------------------------------- notifications */

  router.get('/api/admin/mail/notifications', ...mailGuard, async (req, res) => {
    try {
      const unreadOnly = req.query.unreadOnly === 'true';
      const [items, settings, counts] = await Promise.all([
        listNotifications(req.mailAdminId, { unreadOnly, limit: 25 }),
        getNotificationSettings(req.mailAdminId),
        getMailCounts(),
      ]);
      res.json({ items, settings, counts });
    } catch (error) {
      fail(res, error, 'Failed to load notifications');
    }
  });

  router.post('/api/admin/mail/notifications/read', ...mailGuard, async (req, res) => {
    const { ids = null } = req.body || {};
    try {
      await markNotificationsRead(req.mailAdminId, Array.isArray(ids) ? ids.slice(0, 200) : null);
      res.json({ success: true });
    } catch (error) {
      fail(res, error, 'Failed to update notifications');
    }
  });

  router.get('/api/admin/mail/notification-settings', ...mailGuard, async (req, res) => {
    try {
      res.json(await getNotificationSettings(req.mailAdminId));
    } catch (error) {
      fail(res, error, 'Failed to load notification settings');
    }
  });

  /**
   * Saves this admin's notification preferences.
   *
   * Scoped to the acting admin id, so one administrator can never read or write
   * another's settings.
   */
  router.put('/api/admin/mail/notification-settings', ...mailGuard, async (req, res) => {
    const { notifyNewEmail, notifyProjectRequest, notifyReply, notifyImportant, desktopEnabled, soundEnabled, badgeEnabled } = req.body || {};
    try {
      const saved = await saveNotificationSettings(req.mailAdminId, {
        notifyNewEmail,
        notifyProjectRequest,
        notifyReply,
        notifyImportant,
        desktopEnabled,
        soundEnabled,
        badgeEnabled,
      });
      await recordAudit(req.mailAdminId, 'mail.notification_settings.updated');
      res.json(saved);
    } catch (error) {
      fail(res, error, 'Failed to save notification settings');
    }
  });

  /* --------------------------------------------------- push subscriptions */

  router.get('/api/admin/mail/push/public-key', ...mailGuard, (_req, res) => {
    // Only the public VAPID key ever leaves the server; the private key is used
    // to sign push messages and never reaches the browser.
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
  });

  router.post('/api/admin/mail/push/subscribe', ...mailGuard, async (req, res) => {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ message: 'A complete push subscription is required' });
    }
    try {
      await savePushSubscription(req.mailAdminId, {
        endpoint: String(endpoint).slice(0, 1000),
        keys,
        userAgent: req.headers?.['user-agent']?.slice(0, 300) || null,
      });
      res.json({ success: true });
    } catch (error) {
      fail(res, error, 'Failed to save push subscription');
    }
  });

  router.post('/api/admin/mail/push/unsubscribe', ...mailGuard, async (req, res) => {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ message: 'An endpoint is required' });
    try {
      await deletePushSubscription(req.mailAdminId, String(endpoint).slice(0, 1000));
      res.json({ success: true });
    } catch (error) {
      fail(res, error, 'Failed to remove push subscription');
    }
  });

  /* ------------------------------------------------------------------ audit */

  router.get('/api/admin/mail/audit', ...mailGuard, async (_req, res) => {
    try {
      res.json(await listAudit(100));
    } catch (error) {
      fail(res, error, 'Failed to load audit log');
    }
  });

  /**
   * Imports public project-request rows that are not yet in the inbox.
   *
   * Explicit and idempotent rather than automatic: the public flow keeps using
   * Resend unchanged, and nothing about it depends on this endpoint running.
   */
  router.post('/api/admin/mail/backfill', ...mailGuard, async (req, res) => {
    try {
      const result = await backfillFromProjectRequests();
      await recordAudit(req.mailAdminId, 'mail.backfill', { details: result });
      res.json({ success: true, ...result });
    } catch (error) {
      fail(res, error, 'Failed to import public requests');
    }
  });

  return router;
}

/**
 * Shared handler for provider inbound webhooks.
 *
 * Inbound mail is untrusted: the payload is parsed defensively, the body is
 * stored raw (sanitised at read time), and duplicate deliveries are absorbed by
 * the provider message id.
 */
export async function handleInboundMessage(payload) {
  const from = payload.from || payload.From || {};
  const fromEmail = typeof from === 'string' ? from : from.email || from.Email || null;
  const fromName = typeof from === 'string' ? null : from.name || from.Name || null;

  const list = (value) => {
    if (!value) return [];
    const items = Array.isArray(value) ? value : [value];
    return items
      .map((item) => (typeof item === 'string' ? item : item?.email || item?.Email))
      .filter(Boolean);
  };

  // `text`/`html` are the Resend/Postmark field names; `TextPart`/`HTMLPart` are
  // Mailjet's, accepted so one handler can serve either provider.
  const bodyHtml = payload.html || payload.HTMLPart || null;
  const bodyText = payload.text || payload.TextPart || (bodyHtml ? null : payload.body || null);

  const attachments = (payload.attachments || payload.Attachments || []).map((file) => ({
    filename: file.filename || file.Name || 'attachment',
    contentType: file.contentType || file.ContentType || null,
    sizeBytes: file.size ?? null,
    providerAttachmentId: file.id || null,
    contentData: file.content
      ? `data:${file.contentType || 'application/octet-stream'};base64,${file.content}`
      : null,
  }));

  return ingestMessage({
    providerMessageId: payload.messageId || payload.MessageID || payload['message-id'] || null,
    direction: 'inbound',
    status: 'received',
    fromName,
    fromEmail,
    to: list(payload.to),
    cc: list(payload.cc),
    bcc: list(payload.bcc),
    replyTo: payload.replyTo || null,
    subject: payload.subject || payload.Subject || '(no subject)',
    bodyHtml,
    bodyText,
    hasAttachments: attachments.length > 0,
    provider: payload.provider || 'resend',
    inReplyTo: payload.inReplyTo || payload['in-reply-to'] || null,
    references: list(payload.references || payload.References),
    attachments,
  });
}

export { MAX_ATTACHMENT_BYTES, MAX_TOTAL_ATTACHMENT_BYTES, ALLOWED_ATTACHMENT_TYPES, parseAddressList, prepareAttachments, sanitizeEmailHtml };
