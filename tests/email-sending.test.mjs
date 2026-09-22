/**
 * Email sending behaviour.
 *
 * The bug these pin: the recovery and contact endpoints reported success while
 * sending nothing at all, so the UI said "instructions sent to your email" and
 * no mail ever arrived. A caller must not be able to observe success unless a
 * send actually happened.
 */
import './helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isEmailConfigured,
  sendEmail,
  passwordResetEmail,
  contactNotificationEmail,
} from '../api/lib/email.js';

test('isEmailConfigured reflects RESEND_API_KEY rather than assuming a send', () => {
  const original = process.env.RESEND_API_KEY;
  try {
    delete process.env.RESEND_API_KEY;
    assert.equal(isEmailConfigured(), false);
    process.env.RESEND_API_KEY = 're_test_key';
    assert.equal(isEmailConfigured(), true);
  } finally {
    if (original === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = original;
  }
});

test('sendEmail reports not_configured instead of pretending to succeed', async () => {
  const original = process.env.RESEND_API_KEY;
  try {
    delete process.env.RESEND_API_KEY;
    const result = await sendEmail({ to: 'someone@example.com', subject: 'x', html: '<p>x</p>' });
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'not_configured');
  } finally {
    if (original === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = original;
  }
});

test('sendEmail reports send_failed when the API rejects the send', async () => {
  const originalKey = process.env.RESEND_API_KEY;
  const originalFetch = globalThis.fetch;
  try {
    process.env.RESEND_API_KEY = 're_test_key';
    // Resend resolves with { data, error } rather than throwing on rejection, so
    // awaiting the promise alone looks like success. This mirrors that shape.
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ statusCode: 403, name: 'validation_error', message: 'nope' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });

    const result = await sendEmail({ to: 'someone@example.com', subject: 'x', html: '<p>x</p>' });
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'send_failed');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
  }
});

test('the password reset email carries the token the reset endpoint looks up', () => {
  const token = 'abc123def456';
  const { subject, html, text } = passwordResetEmail(
    token,
    'https://example.com/reset-password?token=' + token,
  );

  assert.match(subject, /password/i);
  assert.ok(html.includes(token), 'html must include the token');
  assert.ok(text.includes(token), 'text must include the token');
});

test('the contact notification keeps the message body', () => {
  const { subject, html } = contactNotificationEmail({
    name: 'Ada',
    email: 'ada@example.com',
    subject: 'Hello',
    message: 'line one\nline two',
  });

  assert.ok(subject.includes('Hello'));
  assert.ok(html.includes('Ada'));
  assert.ok(html.includes('line one'));
  assert.ok(html.includes('line two'));
});
