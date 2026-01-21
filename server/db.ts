import { drizzle } from 'drizzle-orm/neon-http';
import { neon, neonConfig } from '@neondatabase/serverless';
import * as schema from '../drizzle/schema.js';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set");
}

// Enable connection pooling for serverless environments like Vercel
neonConfig.fetchConnectionCache = true;

const sql = neon(databaseUrl);
export const db = drizzle(sql, { schema });
