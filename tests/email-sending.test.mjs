/**
 * Email sending behaviour.
 *
 * The bug these pin: the recovery and contact endpoints reported success while
 * sending nothing at all, so the UI said "instructions sent to your email" and
 * no mail ever arrived. A caller must not be able to observe success unless a
 * send actually happened.
 *
 * There are two transports and they are tested apart, because they must not be
 * able to switch each other off: password reset runs on Mailjet, public/contact
 * mail on Resend. A shared gate would let a missing RESEND_API_KEY silently
 * disable password reset.
 */
import './helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isEmailConfigured,
  isPasswordResetEmailConfigured,
  isPublicEmailConfigured,
  sendPasswordResetEmail,
  sendPublicEmail,
  passwordResetEmail,
  contactNotificationEmail,
  createResetToken,
  hashResetToken,
} from '../api/lib/email.js';

const MAILJET_VARS = ['MJ_APIKEY_PUBLIC', 'MJ_APIKEY_PRIVATE', 'MJ_SENDER_EMAIL', 'MJ_SENDER_NAME'];
const RESEND_VARS = ['RESEND_API_KEY', 'EMAIL_FROM'];

/** Temporarily sets (or clears) a group of environment variables for one test. */
function withEnv(names, values, run) {
  const originals = names.map((name) => [name, process.env[name]]);
  try {
    for (const name of names) {
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

/** Mailjet is configured; Resend is not. */
function withOnlyMailjet(run) {
  return withEnv(RESEND_VARS, {}, () =>
    withEnv(
      MAILJET_VARS,
      {
        MJ_APIKEY_PUBLIC: 'public-key',
        MJ_APIKEY_PRIVATE: 'private-key',
        MJ_SENDER_EMAIL: 'sender@example.com',
        MJ_SENDER_NAME: 'ProjectHub',
      },
      run,
    ),
  );
}

test('the password-reset gate depends on Mailjet, not on Resend', () => {
  withEnv(MAILJET_VARS, {}, () =>
    withEnv(RESEND_VARS, { RESEND_API_KEY: 're_key' }, () => {
      assert.equal(isPasswordResetEmailConfigured(), false, 'no Mailjet keys means no reset mail');

      process.env.MJ_APIKEY_PUBLIC = 'public-key';
      process.env.MJ_APIKEY_PRIVATE = 'private-key';
      assert.equal(
        isPasswordResetEmailConfigured(),
        false,
        'the sender address is part of the configuration',
      );

      process.env.MJ_SENDER_EMAIL = 'sender@example.com';
      assert.equal(isPasswordResetEmailConfigured(), true);
    }),
  );
});

test('the public-email gate depends on Resend, not on Mailjet', () => {
  withEnv(RESEND_VARS, {}, () =>
    withEnv(
      MAILJET_VARS,
      { MJ_APIKEY_PUBLIC: 'public-key', MJ_APIKEY_PRIVATE: 'private-key', MJ_SENDER_EMAIL: 's@example.com' },
      () => {
        assert.equal(isPublicEmailConfigured(), false, 'no Resend key means no public mail');
        process.env.RESEND_API_KEY = 're_key';
        assert.equal(isPublicEmailConfigured(), true);
      },
    ),
  );
});

test('isEmailConfigured is the conjunction of both transports', () => {
  withEnv(MAILJET_VARS, {}, () =>
    withEnv(RESEND_VARS, {}, () => {
      assert.equal(isEmailConfigured(), false);
      process.env.MJ_APIKEY_PUBLIC = 'public-key';
      process.env.MJ_APIKEY_PRIVATE = 'private-key';
      process.env.MJ_SENDER_EMAIL = 'sender@example.com';
      assert.equal(isEmailConfigured(), false, 'Mailjet alone is not enough');
      process.env.RESEND_API_KEY = 're_key';
      assert.equal(isEmailConfigured(), true);
    }),
  );
});

test('a validated sender address is required, not just the API keys', () => {
  withEnv(
    MAILJET_VARS,
    { MJ_APIKEY_PUBLIC: 'public-key', MJ_APIKEY_PRIVATE: 'private-key' },
    () => {
      assert.equal(
        isPasswordResetEmailConfigured(),
        false,
        'Mailjet rejects a send with no validated sender',
      );
    },
  );
});

test('sendPasswordResetEmail reports not_configured instead of pretending to succeed', async () => {
  await withEnv(MAILJET_VARS, {}, async () => {
    const result = await sendPasswordResetEmail({
      to: 'someone@example.com',
      subject: 'x',
      html: '<p>x</p>',
    });
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'not_configured');
  });
});

test('sendPasswordResetEmail reports send_failed when Mailjet rejects the message', async () => {
  const originalFetch = globalThis.fetch;
  try {
    await withOnlyMailjet(async () => {
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

      const result = await sendPasswordResetEmail({
        to: 'someone@example.com',
        subject: 'x',
        html: '<p>x</p>',
      });
      assert.equal(result.sent, false);
      assert.equal(result.reason, 'send_failed');
      assert.equal(result.errorCode, 'send-0003');
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sendPasswordResetEmail posts to the Mailjet v3.1 endpoint with Basic auth and the configured sender', async () => {
  const originalFetch = globalThis.fetch;
  let seen;
  try {
    await withOnlyMailjet(async () => {
      globalThis.fetch = async (url, init) => {
        seen = { url, init };
        return new Response(JSON.stringify({ Messages: [{ Status: 'success' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const result = await sendPasswordResetEmail({
        to: 'someone@example.com',
        subject: 'Hello',
        html: '<p>hi</p>',
        text: 'hi',
      });

      assert.equal(result.sent, true);
    });

    assert.equal(seen.url, 'https://api.mailjet.com/v3.1/send');
    assert.equal(
      seen.init.headers.Authorization,
      `Basic ${Buffer.from('public-key:private-key').toString('base64')}`,
    );

    const body = JSON.parse(seen.init.body);
    assert.equal(body.Messages[0].From.Email, 'sender@example.com');
    assert.equal(body.Messages[0].From.Name, 'ProjectHub');
    assert.equal(body.Messages[0].To[0].Email, 'someone@example.com');
    assert.equal(body.Messages[0].TextPart, 'hi');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sendPublicEmail reports not_configured without a Resend key', async () => {
  await withEnv(RESEND_VARS, {}, async () => {
    const result = await sendPublicEmail({
      to: 'owner@example.com',
      subject: 'x',
      html: '<p>x</p>',
    });
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'not_configured');
  });
});

test('sendPublicEmail reports send_failed when Resend returns an error object', async () => {
  const originalFetch = globalThis.fetch;
  try {
    await withEnv(RESEND_VARS, { RESEND_API_KEY: 're_key' }, async () => {
      // resend.emails.send resolves with { data, error } rather than throwing,
      // so a rejection has to be read out of the payload.
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({ statusCode: 422, name: 'validation_error', message: 'invalid from' }),
          { status: 422, headers: { 'Content-Type': 'application/json' } },
        );

      const result = await sendPublicEmail({
        to: 'owner@example.com',
        subject: 'x',
        html: '<p>x</p>',
      });
      assert.equal(result.sent, false);
      assert.equal(result.reason, 'send_failed');
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sendPublicEmail sends through Resend with the configured sender', async () => {
  const originalFetch = globalThis.fetch;
  let seen;
  try {
    await withEnv(
      RESEND_VARS,
      { RESEND_API_KEY: 're_key', EMAIL_FROM: 'ProjectHub <hello@projecthub.dev>' },
      async () => {
        globalThis.fetch = async (url, init) => {
          seen = { url: String(url), init };
          return new Response(JSON.stringify({ id: 'msg_123' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        };

        const result = await sendPublicEmail({
          to: 'owner@example.com',
          subject: 'Contact',
          html: '<p>hi</p>',
          text: 'hi',
          replyTo: 'visitor@example.com',
        });

        assert.equal(result.sent, true);
        assert.equal(result.id, 'msg_123');
      },
    );

    assert.match(seen.url, /api\.resend\.com/, 'public mail goes to Resend, not Mailjet');
    const body = JSON.parse(seen.init.body);
    assert.equal(body.from, 'ProjectHub <hello@projecthub.dev>');
    // The Resend SDK normalises a single recipient to a bare string.
    assert.equal(body.to, 'owner@example.com');
    assert.equal(body.reply_to, 'visitor@example.com');
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
