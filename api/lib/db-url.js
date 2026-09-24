/**
 * Connection-string normalisation, kept free of side effects.
 *
 * `api/lib/db.js` opens a pooled connection at import time, so anything that
 * only needs to rewrite a URL (the Express server, the admin session store,
 * mail storage) imports this module instead. Importing `db.js` there would
 * create a second pool just to read a pure function.
 */

/**
 * Removes connection parameters the `postgres` driver does not understand and
 * makes the SSL mode explicit.
 *
 * Neon's dashboard emits `channel_binding=require` in the connection string.
 * That requests SCRAM-SHA-256-PLUS (TLS channel binding), which postgres.js
 * does not implement — it only speaks `SCRAM-SHA-256` without the `-PLUS`
 * variant. The driver does not forward the parameter to the server; it treats
 * it as an unrecognised startup option and ignores it, so requests the driver
 * cannot honour must be dropped before it sees them rather than left to be
 * silently misinterpreted.
 *
 * `prefer`, `require` and `verify-ca` are also rewritten to `verify-full`. The
 * `pg-connection-string` driver that backs `pg` treats all four as aliases for
 * `verify-full` today but warns on the other three, and will keep the weaker
 * libpq semantics for them in its next major. Writing `verify-full` therefore
 * preserves the behaviour that is already in effect (including the CA check
 * `pg` performs against the system store) while silencing a warning that reads
 * like a connection failure but is not one.
 */
export function normalizeDatabaseUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) return rawUrl;

  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.delete('channel_binding');

    const sslmode = parsed.searchParams.get('sslmode');
    if (sslmode === 'prefer' || sslmode === 'require' || sslmode === 'verify-ca') {
      parsed.searchParams.set('sslmode', 'verify-full');
    }

    return parsed.toString();
  } catch {
    // Not a URL the WHATWG parser accepts; hand it back untouched and let the
    // driver produce its own, more specific connection error.
    return rawUrl;
  }
}
