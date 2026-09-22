import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../../drizzle/schema.js';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set");
}

/**
 * Removes connection parameters the `postgres` driver does not understand.
 *
 * Neon's dashboard emits `channel_binding=require` in the connection string.
 * That requests SCRAM-SHA-256-PLUS (TLS channel binding), which postgres.js
 * does not implement — it only speaks `SCRAM-SHA-256` without the `-PLUS`
 * variant. The driver does not forward the parameter to the server; it treats
 * it as an unrecognised startup option and ignores it, so requests the driver
 * cannot honour must be dropped before it sees them rather than left to be
 * silently misinterpreted.
 */
export function normalizeDatabaseUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) return rawUrl;

  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.delete('channel_binding');
    return parsed.toString();
  } catch {
    // Not a URL the WHATWG parser accepts; hand it back untouched and let the
    // driver produce its own, more specific connection error.
    return rawUrl;
  }
}

const connectionUrl = normalizeDatabaseUrl(databaseUrl);

// Create the connection
const client = postgres(connectionUrl, {
  ssl: 'require', // Standard for Vercel/Neon/Replit managed DBs
  max: 10,
});

export const db = drizzle(client, { schema });

// Export for cleanup
export const closeDB = async () => {
  await client.end();
};

/**
 * Finds the Postgres error code on an error or any of its `cause` links.
 *
 * Drizzle wraps driver failures in a DrizzleQueryError and keeps the original
 * PostgresError on `cause`. Reading only the outermost `code` therefore reports
 * "unknown" for every database-level failure, including an authentication
 * rejection, which is the case a health check most needs to explain.
 */
export function findDbErrorCode(error) {
  const seen = new Set();
  let current = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if (typeof current.code === 'string') return current.code;
    current = current.cause;
  }
  return undefined;
}

/**
 * Normalises a driver error into a short, safe message.
 *
 * Driver errors embed the full SQL statement and its bound parameters (and,
 * for connection failures, the connection string). Those must never reach an
 * HTTP response, so callers log the raw error server-side and send this
 * summary to the client instead.
 */
export function describeDbError(error) {
  const code = findDbErrorCode(error);
  if (code === '28P01' || code === '28000') {
    return 'Database rejected the configured credentials';
  }
  if (code === '3D000') {
    return 'Configured database does not exist';
  }
  if (code === '42P01' || code === '42703') {
    return 'Database schema is missing an expected object';
  }
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT') {
    return 'Database is unreachable';
  }
  return 'Database request failed';
}