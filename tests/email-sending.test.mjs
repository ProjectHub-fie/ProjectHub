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
  sendAdminEmail,
  sendMailjetTestEmail,
  sendPublicEmail,
  passwordResetEmail,
  contactNotificationEmail,
  createResetToken,
  hashResetToken,
} from '../api/_lib/email.js';

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
        return new Response(JSON.stringify({ Messages: [{ Status: 'success', To: [{ Email: 'someone@example.com', MessageID: 999 }] }] }), {
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

test('a success status with no queued MessageID is not a delivery', async () => {
  // This is the Sandbox-mode signature: Mailjet answers `Status: "success"` while
  // omitting the tracking identifiers (`MessageID: 0`, empty `MessageUUID`).
  // Reading only the status there is what made the recovery form report
  // "instructions sent" for mail that never left the account.
  const originalFetch = globalThis.fetch;
  try {
    await withOnlyMailjet(async () => {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            Messages: [
              {
                Status: 'success',
                To: [{ Email: 'someone@example.com', MessageUUID: '', MessageID: 0, MessageHref: '' }],
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );

      const result = await sendPasswordResetEmail({
        to: 'someone@example.com',
        subject: 'Hello',
        html: '<p>hi</p>',
      });

      assert.equal(result.sent, false, 'a sandbox/queued-nothing response must read as a failure');
      assert.equal(result.reason, 'no_message_queued');
      assert.match(result.errorMessage, /SandboxMode|sender/i);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sendPasswordResetEmail treats a 200 with no queued message as a failure', async () => {
  // Mailjet answers 200 with `Messages: []` (Total/Count 0) when it accepts the
  // request but queues nothing — observed in production with a sender address it
  // would not send as. Reporting success there leaves the user waiting for mail
  // that was never sent, which is exactly the bug this guards.
  const originalFetch = globalThis.fetch;
  try {
    await withOnlyMailjet(async () => {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ Messages: [], Total: 0, Count: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });

      const result = await sendPasswordResetEmail({
        to: 'someone@example.com',
        subject: 'Hello',
        html: '<p>hi</p>',
      });

      assert.equal(result.sent, false, 'an empty Messages array must not read as success');
      assert.equal(result.reason, 'no_message_queued');
      assert.equal(result.status, 200);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sendPasswordResetEmail reports the MessageID when Mailjet accepts a message', async () => {
  const originalFetch = globalThis.fetch;
  try {
    await withOnlyMailjet(async () => {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            Messages: [{ Status: 'success', To: [{ MessageID: 1234567890 }] }],
            Total: 1,
            Count: 1,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );

      const result = await sendPasswordResetEmail({
        to: 'someone@example.com',
        subject: 'Hello',
        html: '<p>hi</p>',
      });

      assert.equal(result.sent, true);
      assert.equal(result.id, 1234567890, 'the MessageID makes a send traceable in Mailjet');
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test('a malformed message is rejected before any Mailjet request is made', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  const cases = [
    ['no recipient', { to: '', subject: 'Hello', html: '<p>hi</p>' }],
    ['bad recipient', { to: 'not-an-email', subject: 'Hello', html: '<p>hi</p>' }],
    ['no subject', { to: 'someone@example.com', subject: '   ', html: '<p>hi</p>' }],
    ['no body', { to: 'someone@example.com', subject: 'Hello', html: '' }],
  ];
  try {
    globalThis.fetch = async () => {
      called = true;
      return new Response('{}', { status: 200 });
    };

    // One send per withOnlyMailjet block: the env helper restores variables as
    // soon as the callback returns its promise, so only the first awaited send
    // in a block sees them.
    for (const [label, payload] of cases) {
      await withOnlyMailjet(async () => {
        const result = await sendPasswordResetEmail(payload);
        assert.equal(result.sent, false, label);
        assert.equal(result.reason, 'invalid_message', label);
      });
    }

    assert.equal(called, false, 'an invalid message must never reach Mailjet');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the [MAILJET] diagnostics report configuration without leaking credentials', async () => {
  const originalFetch = globalThis.fetch;
  const lines = [];
  const originalLog = console.log;
  try {
    await withOnlyMailjet(async () => {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({ Messages: [{ Status: 'success', To: [{ Email: 'someone@example.com', MessageID: 42 }] }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );

      console.log = (...args) => lines.push(args.join(' '));
      await sendPasswordResetEmail({
        to: 'someone@example.com',
        subject: 'Hello',
        html: '<p>hi</p>',
      });
    });

    const joined = lines.join('\n');
    assert.match(joined, /\[MAILJET\] Request starting/);
    assert.match(joined, /\[MAILJET\] Public key configured: true/);
    assert.match(joined, /\[MAILJET\] Private key configured: true/);
    assert.match(joined, /\[MAILJET\] Recipient: someone@example\.com/);
    assert.match(joined, /\[MAILJET\] Sender: sender@example\.com/);
    assert.match(joined, /\[MAILJET\] HTTP status: 200/);
    assert.match(joined, /\[MAILJET\] Request accepted/);

    // The actual key material must never be logged.
    assert.ok(!joined.includes('public-key'), 'the public key value must not be logged');
    assert.ok(!joined.includes('private-key'), 'the private key value must not be logged');
    assert.ok(!/Basic [A-Za-z0-9+/=]+/.test(joined), 'the Authorization header must not be logged');
  } finally {
    console.log = originalLog;
    globalThis.fetch = originalFetch;
  }
});

test('sendMailjetTestEmail uses the configured sender and reports acceptance', async () => {
  const originalFetch = globalThis.fetch;
  let body;
  try {
    await withOnlyMailjet(async () => {
      globalThis.fetch = async (_url, init) => {
        body = JSON.parse(init.body);
        return new Response(
          JSON.stringify({ Messages: [{ Status: 'success', To: [{ Email: 'admin@example.com', MessageID: 7 }] }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      };

      const result = await sendMailjetTestEmail({ to: 'admin@example.com' });
      assert.equal(result.sent, true);
      assert.equal(result.id, 7);
    });

    assert.equal(body.Messages[0].From.Email, 'sender@example.com');
    assert.equal(body.Messages[0].To[0].Email, 'admin@example.com');
    assert.ok(body.Messages[0].TextPart && body.Messages[0].HTMLPart, 'the test carries both parts');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sendMailjetTestEmail reports not_configured without credentials', async () => {
  await withEnv(MAILJET_VARS, {}, async () => {
    const result = await sendMailjetTestEmail({ to: 'admin@example.com' });
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'not_configured');
  });
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

test('the reset email button links the dynamic reset URL, not a placeholder', () => {
  const token = 'abc123def456';
  const resetUrl = `https://example.com/reset-password?email=a%40b.com&token=${token}`;
  const { html } = passwordResetEmail(token, resetUrl);

  // The URL as it appears in href is HTML-escaped (`&` -> `&amp;`).
  const escaped = resetUrl.replace(/&/g, '&amp;');
  assert.ok(html.includes(`href="${escaped}"`), 'the button must carry a real href');
  assert.ok(!/href="#"|href=""/.test(html), 'no placeholder href may ship in the email');

  // The button and the fallback link both resolve to the same URL, so a client
  // that refuses the button still leaves a working link; the address is also
  // repeated as plain text for a client that strips anchors altogether.
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  const matching = hrefs.filter((href) => href === escaped);
  assert.ok(matching.length >= 2, 'the button and the fallback link must both point at the reset URL');
  assert.ok(html.includes(`>${escaped}<`), 'the reset URL must also appear as plain text');
});

test('the fallback reset link is visibly a link, not plain text', () => {
  const resetUrl = 'https://example.com/reset-password?token=abc123def456';
  const { html } = passwordResetEmail('abc123def456', resetUrl);
  const escaped = resetUrl;

  const fallback = html.slice(html.indexOf('Or paste this link into your browser:'));
  assert.match(fallback, new RegExp(`<a href="${escaped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*text-decoration:underline`),
    'the fallback anchor must be underlined so it reads as a link');
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
