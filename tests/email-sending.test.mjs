/**
 * Email sending behaviour.
 *
 * The bug these pin: the recovery and contact endpoints reported success while
 * sending nothing at all, so the UI said "instructions sent to your email" and
 * no mail ever arrived. A caller must not be able to observe success unless a
 * send actually happened.
 *
 * Mail transit is Mailjet now, so the tests configure the Mailjet variables and
 * stub the Email Send API v3.1 response shape.
 */
import './helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isEmailConfigured,
  sendEmail,
  passwordResetEmail,
  contactNotificationEmail,
  createResetToken,
  hashResetToken,
} from '../api/lib/email.js';

const MAILJET_VARS = ['MJ_APIKEY_PUBLIC', 'MJ_APIKEY_PRIVATE', 'MJ_SENDER_EMAIL'];

/** Temporarily sets (or clears) the Mailjet environment for one test. */
function withMailjetEnv(values, run) {
  const originals = MAILJET_VARS.map((name) => [name, process.env[name]]);
  try {
    for (const name of MAILJET_VARS) {
      if (values[name] === undefined) delete process.env[name];
      else process.env[name] = values[name];
    }
    return run();
  } finally {
    for (const [name, value] of originals) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test('isEmailConfigured reflects the Mailjet credentials rather than assuming a send', () => {
  withMailjetEnv({}, () => {
    assert.equal(isEmailConfigured(), false);
    process.env.MJ_APIKEY_PUBLIC = 'public-key';
    process.env.MJ_APIKEY_PRIVATE = 'private-key';
    assert.equal(isEmailConfigured(), false, 'the sender address is part of the configuration');
    process.env.MJ_SENDER_EMAIL = 'sender@example.com';
    assert.equal(isEmailConfigured(), true);
  });
});

test('a validated sender address is required, not just the API keys', () => {
  withMailjetEnv(
    { MJ_APIKEY_PUBLIC: 'public-key', MJ_APIKEY_PRIVATE: 'private-key' },
    () => {
      assert.equal(isEmailConfigured(), false, 'Mailjet rejects a send with no validated sender');
    },
  );
});

test('sendEmail reports not_configured instead of pretending to succeed', async () => {
  await withMailjetEnv({}, async () => {
    const result = await sendEmail({ to: 'someone@example.com', subject: 'x', html: '<p>x</p>' });
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'not_configured');
  });
});

test('sendEmail reports send_failed when Mailjet rejects the message', async () => {
  const originalFetch = globalThis.fetch;
  try {
    await withMailjetEnv(
      {
        MJ_APIKEY_PUBLIC: 'public-key',
        MJ_APIKEY_PRIVATE: 'private-key',
        MJ_SENDER_EMAIL: 'sender@example.com',
      },
      async () => {
        // Mailjet answers 200 even for a failed batch and reports the failure
        // per message in `Messages[].Status`, so a status code alone is not
        // proof of delivery.
        globalThis.fetch = async () =>
          new Response(
            JSON.stringify({
              Messages: [
                {
                  Status: 'error',
                  Errors: [{ ErrorCode: 'send-0003', ErrorMessage: 'sender not validated' }],
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );

        const result = await sendEmail({
          to: 'someone@example.com',
          subject: 'x',
          html: '<p>x</p>',
        });
        assert.equal(result.sent, false);
        assert.equal(result.reason, 'send_failed');
        assert.equal(result.errorCode, 'send-0003');
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sendEmail posts to the Mailjet v3.1 endpoint with Basic auth and the configured sender', async () => {
  const originalFetch = globalThis.fetch;
  let seen;
  try {
    await withMailjetEnv(
      {
        MJ_APIKEY_PUBLIC: 'public-key',
        MJ_APIKEY_PRIVATE: 'private-key',
        MJ_SENDER_EMAIL: 'sender@example.com',
        MJ_SENDER_NAME: 'ProjectHub',
      },
      async () => {
        globalThis.fetch = async (url, init) => {
          seen = { url, init };
          return new Response(JSON.stringify({ Messages: [{ Status: 'success' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        };

        const result = await sendEmail({
          to: 'someone@example.com',
          subject: 'Hello',
          html: '<p>hi</p>',
          text: 'hi',
          replyTo: 'reply@example.com',
        });

        assert.equal(result.sent, true);
      },
    );

    assert.equal(seen.url, 'https://api.mailjet.com/v3.1/send');
    assert.equal(
      seen.init.headers.Authorization,
      `Basic ${Buffer.from('public-key:private-key').toString('base64')}`,
    );

    const body = JSON.parse(seen.init.body);
    assert.equal(body.Messages[0].From.Email, 'sender@example.com');
    assert.equal(body.Messages[0].From.Name, 'ProjectHub');
    assert.equal(body.Messages[0].To[0].Email, 'someone@example.com');
    assert.equal(body.Messages[0].ReplyTo.Email, 'reply@example.com');
  } finally {
    globalThis.fetch = originalFetch;
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

test('only the hash of a reset token is stored, never the raw value', () => {
  const token = createResetToken();
  const stored = hashResetToken(token);

  assert.notEqual(stored, token, 'the raw token must not be what the database holds');
  assert.match(stored, /^[0-9a-f]{64}$/, 'the stored value is a SHA-256 hex digest');
  assert.equal(hashResetToken(token), stored, 'hashing is deterministic for the reset lookup');
  assert.notEqual(hashResetToken(createResetToken()), stored);
});
