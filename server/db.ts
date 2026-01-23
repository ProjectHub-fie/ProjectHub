import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../drizzle/schema.js';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set");
}

// Create the connection
const client = postgres(databaseUrl, {
  ssl: { rejectUnauthorized: false }, // Improved for Vercel
  max: 10,
});

export const db = drizzle(client, { schema });

// Export for cleanup
export const closeDB = async () => {
  await client.end();
};
