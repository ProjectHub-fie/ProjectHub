import crypto from 'node:crypto';

/**
 * Shared Mailjet mailer for the serverless API and the Express server.
 *
 * Mail is sent through Mailjet's Email Send API v3.1 over Basic auth. The HTTP
 * call is made server-side only: the private key is read from the environment
 * and never leaves this module, so no credential can reach Vite/browser code.
 *
 * `isEmailConfigured()` is the gate callers must treat as authoritative. A
 * silent no-op here is indistinguishable from success to the caller, which is
 * exactly the bug that let the recovery form report "instructions sent" while
 * nothing was ever delivered.
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

function senderEmail() {
  return process.env.MJ_SENDER_EMAIL || '';
}

function senderName() {
  return process.env.MJ_SENDER_NAME || 'ProjectHub';
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
 */
export function isEmailConfigured() {
  return Boolean(
    process.env.MJ_APIKEY_PUBLIC &&
      process.env.MJ_APIKEY_PRIVATE &&
      senderEmail(),
  );
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
 * Sends one message through Mailjet and reports whether it actually went out.
 *
 * Mailjet answers 200 for a partially failed batch (per-message `Status`), so a
 * successful HTTP status alone is not proof of delivery — the first message's
 * status is checked too. The private key is only ever placed in the
 * Authorization header and is never logged.
 */
export async function sendEmail({ to, subject, html, text, replyTo }) {
  if (!isEmailConfigured()) {
    console.error(
      'Email not sent: Mailjet is not configured (MJ_APIKEY_PUBLIC / MJ_APIKEY_PRIVATE / MJ_SENDER_EMAIL)',
    );
    return { sent: false, reason: 'not_configured' };
  }

  const message = {
    From: { Email: senderEmail(), Name: senderName() },
    To: [{ Email: to }],
    Subject: subject,
    HTMLPart: html,
  };
  if (text) message.TextPart = text;
  if (replyTo) message.ReplyTo = { Email: replyTo };

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

    if (!res.ok || entry?.Status === 'error') {
      // Mailjet reports failures in either `Messages[].Errors` or, for auth
      // problems, a top-level `ErrorMessage`.
      const detail = entry?.Errors?.[0] || payload?.ErrorMessage;
      console.error(
        'Mailjet send failed:',
        `status=${res.status}`,
        detail
          ? `code=${detail.ErrorCode ?? 'n/a'} message=${detail.ErrorMessage ?? detail}`
          : '',
      );
      return {
        sent: false,
        reason: 'send_failed',
        status: res.status,
        errorCode: detail?.ErrorCode,
        errorMessage: detail?.ErrorMessage || payload?.ErrorMessage,
      };
    }

    return { sent: true, id: entry?.To?.[0]?.MessageID };
  } catch (error) {
    console.error('Mailjet send threw:', error.message);
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
