/**
 * Shared test environment bootstrap.
 *
 * Import this before any api/ module: those modules read process.env at import
 * time (api/_lib/db.js throws when DATABASE_URL is missing), so the defaults have
 * to exist first.
 */
process.env.SESSION_SECRET ||= 'test-secret-not-for-production';
// Turnstile is disabled unless the secret is set; drop any inherited value so
// the suite does not depend on a network call to Cloudflare.
delete process.env.TURNSTILE_SECRET_KEY;

/**
 * Whether a real database was supplied by the caller.
 *
 * Checked before setting the placeholder below, so integration tests can tell
 * "someone gave us a database" from "we injected a dummy just to allow import".
 */
export const hasDatabase = Boolean(process.env.DATABASE_URL);

// A syntactically valid but unreachable URL. Importing api/_lib/db.js must not
// throw, and tests that do not touch the database never open a connection
// (postgres.js connects lazily on first query).
process.env.DATABASE_URL ||= 'postgresql://placeholder:placeholder@127.0.0.1:1/placeholder';

export const sessionSecret = process.env.SESSION_SECRET;
