import crypto from 'node:crypto';
import { Resend } from 'resend';

/**
 * Shared mail utilities for the serverless API and the Express server.
 *
 * Two transports, deliberately, because the two flows have different needs:
 *
 *   - **Password reset** goes through Mailjet's Email Send API v3.1 over Basic
 *     auth. It is the flow that was broken and the one Mailjet now owns.
 *   - **Public/contact email** keeps using Resend, unchanged.
 *
 * Both run server-side only: credentials are read from the environment and
 * never leave this module, so no key can reach Vite/browser code.
 *
 * Each transport has its own "is it configured" gate and its own sender. They
 * are deliberately not collapsed into one function — a single shared gate would
 * let a missing Resend key silently disable password reset (and vice versa),
 * which is the class of bug that let the recovery form report "instructions
 * sent" while nothing was ever delivered.
 */

const MAILJET_SEND_URL = 'https://api.mailjet.com/v3.1/send';

/** Base URL links inside emails are built from. Empty string means "same origin". */
export function appOrigin() {
  return (process.env.APP_ORIGIN || '').replace(/\/$/, '');
}

/**
 * The origin used for links inside an email.
 *
 * A configured `APP_ORIGIN` always wins. Falling back to the request host keeps
 * a preview deployment self-consistent instead of mailing a production link.
 */
export function resolveOrigin(request) {
  const configured = appOrigin();
  if (configured) return configured;
  const host = request?.headers?.host;
  if (!host) return '';
  const proto = request?.headers?.['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

function mailjetSenderEmail() {
  return process.env.MJ_SENDER_EMAIL || '';
}

function mailjetSenderName() {
  return process.env.MJ_SENDER_NAME || 'ProjectHub';
}

/** Resend's verified sender, prefixed with a display name. */
function resendFromAddress() {
  return process.env.EMAIL_FROM || 'ProjectHub <onboarding@resend.dev>';
}

/**
 * Contact-form notifications are delivered here. `CONTACT_TO_EMAIL` wins, then
 * `OWNER_EMAIL`, then the project inbox, so both backends agree on the
 * destination instead of drifting apart.
 */
export function contactRecipient() {
  return (
    process.env.CONTACT_TO_EMAIL ||
    process.env.OWNER_EMAIL ||
    'dev.projecthub.fie@gmail.com'
  );
}

/**
 * True only when every value Mailjet needs to accept an authenticated send is
 * present. The sender address must be one Mailjet has validated, so a missing
 * `MJ_SENDER_EMAIL` is treated as "not configured" rather than a guess.
 *
 * This gates password reset and nothing else — see `isPublicEmailConfigured`.
 */
export function isPasswordResetEmailConfigured() {
  return Boolean(
    process.env.MJ_APIKEY_PUBLIC &&
      process.env.MJ_APIKEY_PRIVATE &&
      mailjetSenderEmail(),
  );
}

/** True when Resend is configured, which is what public/contact email needs. */
export function isPublicEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

/**
 * Health-check helper: whether *both* transports are ready.
 *
 * `/api/health` reports a single status, so it needs the conjunction; the send
 * paths use the per-transport gates above.
 */
export function isEmailConfigured() {
  return isPasswordResetEmailConfigured() && isPublicEmailConfigured();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* -------------------------------------------------------------------------
   Branded layout
   Table-based with inline styles so it survives Outlook, Gmail and Apple Mail.
   `bgcolor` is repeated alongside the CSS colour because a few clients ignore
   the stylesheet form.
------------------------------------------------------------------------- */

const BRAND = {
  bg: '#0b1220',
  card: '#ffffff',
  text: '#0f172a',
  muted: '#64748b',
  border: '#e2e8f0',
  accentFrom: '#10b981',
  accentTo: '#3b82f6',
  panel: '#f8fafc',
};

function renderLayout({ preheader, heading, intro, bodyHtml, footnoteHtml }) {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" />
<title>${escapeHtml(heading)}</title>
<!--[if mso]><style>body,table,td{font-family:Arial,Helvetica,sans-serif !important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${BRAND.bg};-webkit-text-size-adjust:100%;">
<div style="display:none;font-size:1px;color:${BRAND.bg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(
    preheader,
  )}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.bg}" style="background-color:${BRAND.bg};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
        <tr>
          <td align="center" style="padding-bottom:24px;">
            <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:20px;font-weight:700;letter-spacing:0.5px;color:#ffffff;">
              &lt;Project<span style="color:${BRAND.accentFrom};">Hub</span>/&gt;
            </div>
          </td>
        </tr>
        <tr>
          <td style="height:4px;font-size:0;background-color:${BRAND.accentFrom};background-image:linear-gradient(90deg,${BRAND.accentFrom} 0%,${BRAND.accentTo} 100%);border-radius:999px;line-height:0;">&nbsp;</td>
        </tr>
        <tr>
          <td bgcolor="${BRAND.card}" style="background-color:${BRAND.card};border-radius:16px;padding:40px 36px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND.text};box-shadow:0 18px 40px rgba(2,6,23,0.35);">
            <h1 style="margin:0 0 16px 0;font-size:24px;line-height:1.3;font-weight:700;color:${BRAND.text};">${escapeHtml(
              heading,
            )}</h1>
            ${
              intro
                ? `<p style="margin:0 0 24px 0;font-size:15px;line-height:1.65;color:${BRAND.muted};">${intro}</p>`
                : ''
            }
            ${bodyHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:24px 8px 0 8px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.7;color:#94a3b8;text-align:center;">
            ${footnoteHtml}
            <p style="margin:16px 0 0 0;color:#64748b;">
              &copy; ${new Date().getFullYear()} ProjectHub &middot;
              <a href="${escapeHtml(appOrigin() || 'https://projecthub-me.vercel.app')}" style="color:${BRAND.accentFrom};text-decoration:none;">projecthub-me.vercel.app</a>
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** Gradient call-to-action button with a visible URL fallback beneath it. */
function renderButton(url, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 20px auto;">
  <tr>
    <td align="center" bgcolor="${BRAND.accentTo}" style="border-radius:10px;background-color:${BRAND.accentTo};background-image:linear-gradient(90deg,${BRAND.accentFrom} 0%,${BRAND.accentTo} 100%);">
      <a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 30px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(
        label,
      )}</a>
    </td>
  </tr>
</table>
<p style="margin:0 0 8px 0;font-size:12px;color:${BRAND.muted};">Or paste this link into your browser:</p>
<p style="margin:0 0 24px 0;font-size:12px;word-break:break-all;">
  <a href="${escapeHtml(url)}" style="color:${BRAND.accentTo};text-decoration:none;">${escapeHtml(url)}</a>
</p>`;
}

function renderCodeBlock(code) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
  <tr>
    <td bgcolor="${BRAND.panel}" style="background-color:${BRAND.panel};border:1px dashed ${BRAND.border};border-radius:12px;padding:18px;text-align:center;">
      <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;color:${BRAND.muted};margin-bottom:8px;">Your reset code</div>
      <div style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:19px;font-weight:700;letter-spacing:1px;color:${BRAND.text};word-break:break-all;">${escapeHtml(
        code,
      )}</div>
    </td>
  </tr>
</table>`;
}

/**
 * Password reset message.
 *
 * Carries both the one-time code (so a user can type it on the reset page) and
 * a direct link. Either resolves to the same single-use token.
 */
export function passwordResetEmail(resetToken, resetUrl) {
  const link = resetUrl || null;
  const intro =
    'We received a request to reset your ProjectHub password. This code expires in 1 hour and can only be used once.';

  const html = renderLayout({
    preheader: 'Reset your ProjectHub password — this code expires in 1 hour.',
    heading: 'Reset your password',
    intro,
    bodyHtml: `
      ${renderCodeBlock(resetToken)}
      ${link ? renderButton(link, 'Reset my password') : ''}
      <p style="margin:0;font-size:13px;line-height:1.65;color:${BRAND.muted};">
        If you did not request this, you can safely ignore this email — your password will not change.
      </p>
    `,
    footnoteHtml:
      'For your security, never share this code. ProjectHub will never ask you for it.',
  });

  const text = [
    'Reset your ProjectHub password',
    '',
    `Your reset code: ${resetToken}`,
    'This code expires in 1 hour and can only be used once.',
    link ? `\nReset link: ${link}` : '',
    '',
    'If you did not request this, ignore this email.',
  ]
    .filter(Boolean)
    .join('\n');

  return { subject: 'Reset your ProjectHub password', text, html };
}

/** Contact-form notification delivered to the ProjectHub inbox. */
export function contactNotificationEmail({ name, email, subject, message }) {
  const rows = [
    ['From', `<strong style="color:${BRAND.text};">${escapeHtml(name)}</strong>`],
    [
      'Email',
      `<a href="mailto:${escapeHtml(email)}" style="color:${BRAND.accentTo};text-decoration:none;">${escapeHtml(
        email,
      )}</a>`,
    ],
  ]
    .map(
      ([label, value]) => `<tr>
        <td style="padding:10px 0;font-size:13px;color:${BRAND.muted};width:90px;vertical-align:top;">${label}</td>
        <td style="padding:10px 0;font-size:14px;color:${BRAND.text};">${value}</td>
      </tr>`,
    )
    .join('');

  const html = renderLayout({
    preheader: `New message from ${name}: ${subject}`,
    heading: 'New contact message',
    intro: 'Someone reached out through the ProjectHub contact form.',
    bodyHtml: `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
        ${rows}
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px 0;">
        <tr>
          <td bgcolor="${BRAND.panel}" style="background-color:${BRAND.panel};border:1px solid ${BRAND.border};border-radius:12px;padding:20px;">
            <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;color:${BRAND.muted};margin-bottom:10px;">Subject</div>
            <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;color:${BRAND.text};margin-bottom:16px;">${escapeHtml(
              subject,
            )}</div>
            <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.7;color:${BRAND.text};white-space:pre-wrap;">${escapeHtml(
              message,
            )}</div>
          </td>
        </tr>
      </table>
      <p style="margin:0;font-size:13px;color:${BRAND.muted};">
        Reply directly to this email to answer ${escapeHtml(name)}.
      </p>
    `,
    footnoteHtml: 'This notification was generated automatically by the ProjectHub contact form.',
  });

  const text = [
    'New Contact Form Submission',
    '',
    `From: ${name} (${email})`,
    `Subject: ${subject}`,
    '',
    message,
  ].join('\n');

  return { subject: `New Contact Form Submission: ${subject}`, html, text };
}

/**
 * Collects every recipient slot Mailjet reports back for a message.
 *
 * The Send API v3.1 answers per address under `To`, `Cc` and `Bcc`, so the
 * tracking metadata (and any per-address error) lives in those arrays rather
 * than on the message itself.
 */
function mailjetRecipientSlots(entry) {
  return ['To', 'Cc', 'Bcc'].flatMap((field) =>
    Array.isArray(entry?.[field]) ? entry[field] : [],
  );
}

const EMAIL_ADDRESS =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

function isEmailAddress(value) {
  return typeof value === 'string' && value.length <= 254 && EMAIL_ADDRESS.test(value.trim());
}

/** First address in a Send API recipient list, as a bare string. */
function mailjetFirstAddress(list) {
  const first = Array.isArray(list) ? list[0] : list;
  if (!first) return undefined;
  return typeof first === 'string' ? first : first.Email;
}

/**
 * Validates a Send API message before it is posted.
 *
 * Returns a reason, or null when Mailjet has everything it needs. The composer
 * enforces the same rules, but a caller can bypass the form, and Mailjet answers
 * a malformed request with an error or an empty queue — never a delivery — so the
 * check has to live at the transport too.
 */
function validateMailjetMessage(message) {
  const from = message?.From?.Email;
  if (!isEmailAddress(from)) return 'sender address is missing or invalid';

  const recipients = Array.isArray(message?.To) ? message.To : [];
  if (recipients.length === 0) return 'at least one recipient is required';
  if (!recipients.every((slot) => isEmailAddress(slot?.Email))) {
    return 'a recipient address is invalid';
  }

  if (!String(message?.Subject || '').trim()) return 'a subject is required';
  const hasHtml = String(message?.HTMLPart || '').trim().length > 0;
  const hasText = String(message?.TextPart || '').trim().length > 0;
  if (!hasHtml && !hasText) return 'an email body is required';
  return null;
}

/**
 * Low-level Mailjet send used by every outbound message.
 *
 * Centralised so the "did it really go out" checks cannot drift between the
 * password-reset path and admin mail. Returns the same result shape in both
 * cases, plus the per-recipient tracking ids when Mailjet provides them.
 */
async function mailjetSend(message, { requireMessageId = true } = {}) {
  // Diagnostics deliberately report only whether credentials exist, never their
  // value, and never the Authorization header. Any of these five lines is what
  // tells a broken deployment apart from a rejected send.
  console.log('[MAILJET] Request starting');
  console.log('[MAILJET] Public key configured:', !!process.env.MJ_APIKEY_PUBLIC);
  console.log('[MAILJET] Private key configured:', !!process.env.MJ_APIKEY_PRIVATE);

  const recipient = mailjetFirstAddress(message?.To);
  const sender = message?.From?.Email;
  console.log('[MAILJET] Recipient:', recipient);
  console.log('[MAILJET] Sender:', sender);

  const validationError = validateMailjetMessage(message);
  if (validationError) {
    console.error('[MAILJET] Request rejected before sending:', validationError);
    return { sent: false, reason: 'invalid_message', errorMessage: validationError };
  }

  if (!process.env.MJ_APIKEY_PUBLIC || !process.env.MJ_APIKEY_PRIVATE) {
    console.error('[MAILJET] Credentials missing; request not attempted');
    return { sent: false, reason: 'not_configured' };
  }

  const auth = Buffer.from(
    `${process.env.MJ_APIKEY_PUBLIC}:${process.env.MJ_APIKEY_PRIVATE}`,
  ).toString('base64');

  try {
    const res = await fetch(MAILJET_SEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ Messages: [message] }),
    });

    const payload = await res.json().catch(() => ({}));
    const entry = Array.isArray(payload?.Messages) ? payload.Messages[0] : null;

    console.log('[MAILJET] HTTP status:', res.status);
    console.log('[MAILJET] Response:', JSON.stringify(payload));

    if (!res.ok || !entry || entry.Status === 'error') {
      const detail = entry?.Errors?.[0] || payload?.ErrorMessage;
      const queued = !entry && res.ok ? 'no message entry returned (nothing queued)' : '';
      console.error(
        '[MAILJET] Request rejected:',
        `status=${res.status}`,
        `total=${payload?.Total ?? 'n/a'} count=${payload?.Count ?? 'n/a'}`,
        queued,
        detail
          ? `code=${detail.ErrorCode ?? 'n/a'} message=${detail.ErrorMessage ?? detail}`
          : '',
      );
      return {
        sent: false,
        reason: !entry && res.ok ? 'no_message_queued' : 'send_failed',
        status: res.status,
        errorCode: detail?.ErrorCode,
        errorMessage: detail?.ErrorMessage || payload?.ErrorMessage,
      };
    }

    const slots = mailjetRecipientSlots(entry);
    const delivered = slots.filter((slot) => Number(slot?.MessageID) > 0);

    // A success status with no identifier means nothing was queued — sandbox
    // mode, or a send the account is not permitted to make.
    if (requireMessageId && delivered.length === 0) {
      console.error(
        '[MAILJET] Request rejected:',
        'success status without a queued message',
        `status=${res.status}`,
        `recipients=${slots.length}`,
      );
      return {
        sent: false,
        reason: 'no_message_queued',
        status: res.status,
        errorMessage:
          'Mailjet accepted the request but queued no message. Check that the sender address is validated and that SandboxMode is not enabled.',
      };
    }

    console.log('[MAILJET] Request accepted');
    return {
      sent: true,
      id: delivered[0] ? Number(delivered[0].MessageID) : undefined,
      recipients: delivered.map((slot) => ({
        email: slot.Email,
        messageId: Number(slot.MessageID),
        messageUuid: slot.MessageUUID || null,
      })),
    };
  } catch (error) {
    console.error('[MAILJET] Request threw:', error.message);
    return { sent: false, reason: 'send_failed', errorMessage: error.message };
  }
}

/**
 * Sends the password-reset message through Mailjet and reports whether it
 * actually went out.
 *
 * Three separate ways a send can look successful without being one, all of
 * which have to be rejected explicitly:
 *
 *   1. Mailjet answers 200 for a partially failed batch and reports the failure
 *      per message in `Messages[].Status`.
 *   2. It accepts the request but queues nothing, returning an empty `Messages`
 *      array (Total/Count 0) when the sender is not one it will send as.
 *   3. Sandbox mode — and any send Mailjet declines to queue — answers
 *      `Status: "success"` while omitting the tracking identifiers, leaving
 *      `MessageID` as `0` and `MessageUUID`/`MessageHref` empty. Reading only
 *      the status there is exactly the bug that made the recovery form report
 *      "instructions sent" for mail that never left the account.
 *
 * A message therefore counts as sent only when Mailjet returns a real,
 * non-zero `MessageID`. The private key is only ever placed in the
 * Authorization header and is never logged.
 */
export async function sendPasswordResetEmail({ to, subject, html, text }) {
  if (!isPasswordResetEmailConfigured()) {
    console.error(
      'Password reset not sent: Mailjet is not configured (MJ_APIKEY_PUBLIC / MJ_APIKEY_PRIVATE / MJ_SENDER_EMAIL)',
    );
    return { sent: false, reason: 'not_configured' };
  }

  const message = {
    From: { Email: mailjetSenderEmail(), Name: mailjetSenderName() },
    To: [{ Email: to }],
    Subject: subject,
    HTMLPart: html,
  };
  if (text) message.TextPart = text;

  return mailjetSend(message);
}

/** True when Mailjet is configured well enough to send admin mail. */
export function isAdminMailConfigured() {
  return isPasswordResetEmailConfigured();
}

/**
 * Sends an admin-composed message (new mail, reply, reply-all or forward)
 * through Mailjet.
 *
 * Same transport as password reset on purpose: Resend owns public/inbound mail
 * and Mailjet owns everything an administrator sends out, so the two providers
 * stay independently configured and neither can disable the other.
 *
 * `to`/`cc`/`bcc` accept either a bare address or `{ email, name }`.
 */
export async function sendAdminEmail({
  to = [],
  cc = [],
  bcc = [],
  subject,
  html,
  text,
  replyTo,
  attachments = [],
  customId,
}) {
  if (!isAdminMailConfigured()) {
    console.error(
      'Admin mail not sent: Mailjet is not configured (MJ_APIKEY_PUBLIC / MJ_APIKEY_PRIVATE / MJ_SENDER_EMAIL)',
    );
    return { sent: false, reason: 'not_configured' };
  }

  const address = (value) =>
    typeof value === 'string'
      ? { Email: value }
      : { Email: value?.email, ...(value?.name ? { Name: value.name } : {}) };

  const message = {
    From: { Email: mailjetSenderEmail(), Name: mailjetSenderName() },
    To: (Array.isArray(to) ? to : [to]).filter(Boolean).map(address),
    Subject: subject,
    HTMLPart: html,
  };
  if (text) message.TextPart = text;
  if (replyTo) message.ReplyTo = address(replyTo);
  if (cc.length) message.Cc = cc.map(address);
  if (bcc.length) message.Bcc = bcc.map(address);
  if (customId) message.CustomID = String(customId).slice(0, 255);

  // Mailjet takes base64 content plus an explicit filename and MIME type. The
  // type is sent as-is because Mailjet (not the browser) is the one that
  // decides whether the attachment is acceptable.
  if (attachments.length) {
    message.Attachments = attachments.map((file) => ({
      ContentType: file.contentType,
      Filename: file.filename,
      Base64Content: file.base64Content,
    }));
  }

  return mailjetSend(message);
}

/**
 * Minimal message used by the administrator diagnostic endpoint.
 *
 * Goes through the same `mailjetSend` as every other message, so whatever this
 * reports is what a real send from this deployment would do — credentials,
 * sender validation and account permissions included.
 */
export async function sendMailjetTestEmail({ to }) {
  if (!isAdminMailConfigured()) {
    return { sent: false, reason: 'not_configured' };
  }

  const message = {
    From: { Email: mailjetSenderEmail(), Name: mailjetSenderName() },
    To: [{ Email: to }],
    Subject: 'ProjectHub Mailjet test',
    TextPart:
      'This is a ProjectHub Mailjet diagnostic message. Receiving it means the deployed credentials and sender are accepted by Mailjet.',
    HTMLPart:
      '<p>This is a ProjectHub Mailjet diagnostic message.</p><p>Receiving it means the deployed credentials and sender are accepted by Mailjet.</p>',
  };

  return mailjetSend(message);
}

/**
 * Sends public/contact email through Resend.
 *
 * `resend.emails.send` resolves with `{ data, error }` rather than rejecting, so
 * a failed send has to be detected from `error`; awaiting the promise alone
 * looks like success.
 */
export async function sendPublicEmail({ to, subject, html, text, replyTo }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('Public email not sent: RESEND_API_KEY is not configured');
    return { sent: false, reason: 'not_configured' };
  }

  const resend = new Resend(apiKey);

  try {
    const { data, error } = await resend.emails.send({
      from: resendFromAddress(),
      to,
      subject,
      html,
      ...(text ? { text } : {}),
      ...(replyTo ? { replyTo } : {}),
    });

    if (error) {
      console.error('Resend send failed:', error.message || error);
      return {
        sent: false,
        reason: 'send_failed',
        errorMessage: error.message || String(error),
      };
    }

    return { sent: true, id: data?.id };
  } catch (error) {
    console.error('Resend send threw:', error.message);
    return { sent: false, reason: 'send_failed', errorMessage: error.message };
  }
}

/**
 * Single-use reset token.
 *
 * The raw token goes in the email; only its SHA-256 hash is stored, so a leaked
 * database row cannot be replayed against the reset endpoint.
 */
export function createResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function hashResetToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}
