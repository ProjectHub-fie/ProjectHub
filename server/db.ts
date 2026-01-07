import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

// For Neon/PostgreSQL serverless, we sometimes need to append sslmode=require
const connectionString = process.env.DATABASE_URL.includes('sslmode=') 
  ? process.env.DATABASE_URL 
  : `${process.env.DATABASE_URL}${process.env.DATABASE_URL.includes('?') ? '&' : '?'}sslmode=require`;

export const client = postgres(connectionString);
export const db = drizzle(client, { schema });
