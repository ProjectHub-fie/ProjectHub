import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../../drizzle/schema.js';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set");
}

// Create the connection
const client = postgres(databaseUrl, {
  ssl: 'require', // Standard for Vercel/Neon/Replit managed DBs
  max: 10,
});

export const db = drizzle(client, { schema });

// Export for cleanup
export const closeDB = async () => {
  await client.end();
};

/**
 * Normalises a driver error into a short, safe message.
 *
 * Driver errors embed the full SQL statement and its bound parameters (and,
 * for connection failures, the connection string). Those must never reach an
 * HTTP response, so callers log the raw error server-side and send this
 * summary to the client instead.
 */
export function describeDbError(error) {
  const code = error?.code;
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