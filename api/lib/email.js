import { Resend } from 'resend';

/**
 * Shared Resend mailer for the serverless API.
 *
 * `RESEND_API_KEY` is what decides whether mail can be sent at all. Callers must
 * treat `isEmailConfigured()` as the gate instead of assuming a send happened,
 * because a silent no-op here is indistinguishable from success to the caller.
 */
export function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

function fromAddress() {
  return process.env.EMAIL_FROM || 'ProjectHub <onboarding@resend.dev>';
}

export function appOrigin() {
  return (process.env.APP_ORIGIN || '').replace(/\/$/, '');
}

/**
 * Where contact-form notifications are delivered.
 *
 * `CONTACT_TO_EMAIL` wins, then `OWNER_EMAIL`, then the project inbox. The
 * serverless handler used to demand one of the first two and answer 502 when
 * neither was set - the "CONTACT_TO_EMAIL is not configured" report - while the
 * Express route already defaulted. Keeping the order here means both backends
 * agree on the destination instead of drifting apart.
 */
export function contactRecipient() {
  return (
    process.env.CONTACT_TO_EMAIL ||
    process.env.OWNER_EMAIL ||
    'dev.projecthub.fie@gmail.com'
  );
}

/**
 * Sends one email and reports whether it actually went out.
 *
 * `resend.emails.send` resolves with `{ data, error }` rather than rejecting, so
 * a failed send has to be detected from `error`; awaiting the promise alone
 * looks like success.
 */
export async function sendEmail({ to, subject, html, replyTo, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('Email not sent: RESEND_API_KEY is not configured');
    return { sent: false, reason: 'not_configured' };
  }

  const resend = new Resend(apiKey);

  try {
    const { data, error } = await resend.emails.send({
      from: fromAddress(),
      to,
      subject,
      html,
      ...(text ? { text } : {}),
      ...(replyTo ? { replyTo } : {}),
    });

    if (error) {
      console.error('Email send failed:', error.message || error);
      return { sent: false, reason: 'send_failed', error };
    }

    return { sent: true, id: data?.id };
  } catch (error) {
    console.error('Email send threw:', error.message);
    return { sent: false, reason: 'send_failed', error };
  }
}

export function passwordResetEmail(resetToken, resetUrl) {
  const link = resetUrl || null;
  return {
    subject: 'Reset your ProjectHub password',
    text: `Use this code to reset your ProjectHub password: ${resetToken}\n\nThis code expires in 1 hour.${
      link ? `\n\nOr open: ${link}` : ''
    }`,
    html: `
      <h2>Reset your ProjectHub password</h2>
      <p>Use this code to reset your password:</p>
      <p style="font-family:monospace;font-size:18px;letter-spacing:2px"><strong>${resetToken}</strong></p>
      <p>This code expires in 1 hour.</p>
      ${link ? `<p>Or <a href="${link}">open the reset page</a>.</p>` : ''}
      <p>If you did not request this, you can ignore this email.</p>
    `,
  };
}

export function contactNotificationEmail({ name, email, subject, message }) {
  const escaped = String(message).replace(/\n/g, '<br>');
  return {
    subject: `New Contact Form Submission: ${subject}`,
    html: `
      <h2>New Contact Form Submission</h2>
      <p><strong>From:</strong> ${name} (${email})</p>
      <p><strong>Subject:</strong> ${subject}</p>
      <h3>Message:</h3>
      <p>${escaped}</p>
    `,
  };
}
