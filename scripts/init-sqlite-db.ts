import Database from 'better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../drizzle/schema.js';

// Create a fresh SQLite database
const sqlite = new Database('./local.db');
const db = drizzle(sqlite);

// Run migrations to create tables
migrate(db, { migrationsFolder: './drizzle/migrations' });

console.log('Database initialized successfully!');
sqlite.close();