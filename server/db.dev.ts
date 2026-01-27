import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from '../drizzle/schema.js';

// Create a local SQLite database for development
const sqlite = new Database('./local_dev.db');
export const db = drizzle(sqlite, { schema });