#!/usr/bin/env node
/**
 * Creates the ProjectHub schema on an empty database.
 *
 * Why this exists: `drizzle-kit migrate` cannot build this schema from scratch.
 * drizzle/migrations/meta/_journal.json lists only 3 of the 10 SQL files on
 * disk (0000, 0001, 0008) and its entries have no `hash` field, so `migrate`
 * would replay 0000 (whose project_request_status enum has the old value set)
 * and then fail on 0008, and would never reach 0009_admin_credentials.sql.
 * As a result a fresh Neon database ends up with no tables at all.
 *
 * `drizzle-kit push` is not a substitute either: against a database that
 * already contains any unmanaged table it prompts to RENAME that table into
 * one of ours. Neon databases ship with a `playing_with_neon` sample table, so
 * an unattended push will offer `playing_with_neon -> admin_credentials`.
 *
 * This script instead derives the DDL from drizzle/schema.ts via
 * `drizzle-kit generate`, so it cannot drift from the schema, and applies it
 * idempotently so it is safe to re-run.
 *
 *   DATABASE_URL='postgres://...' node scripts/db-bootstrap.mjs
 */
import 'dotenv/config';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import postgres from 'postgres';

// Codes meaning "already in that state"; safe to skip so the script re-runs.
const ALREADY_EXISTS = new Set([
  '42P07', // duplicate_table
  '42710', // duplicate_object (type / constraint)
  '42701', // duplicate_column
  '42P16', // invalid_table_definition (duplicate index)
]);

const EXPECTED_TABLES = [
  'admin_credentials',
  'project_interactions',
  'project_requests',
  'sessions',
  'users',
  'verified_projects',
];

function generateDdl() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'projecthub-ddl-'));
  try {
    execFileSync(
      'npx',
      ['drizzle-kit', 'generate', '--dialect=postgresql', '--schema=./drizzle/schema.ts', `--out=${out}`],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const file = fs.readdirSync(out).find((f) => f.endsWith('.sql'));
    if (!file) throw new Error('drizzle-kit generate produced no .sql file');
    return fs.readFileSync(path.join(out, file), 'utf8');
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}

function splitStatements(ddl) {
  return ddl
    .split('--> statement-breakpoint')
    .flatMap((chunk) => chunk.split(/;\s*\n/))
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('--'));
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const statements = splitStatements(generateDdl());
  console.log(`Applying ${statements.length} statements...`);

  const sql = postgres(url, { ssl: { rejectUnauthorized: false }, max: 1 });

  try {
    let applied = 0;
    let skipped = 0;
    for (const statement of statements) {
      try {
        await sql.unsafe(statement);
        applied++;
      } catch (error) {
        if (ALREADY_EXISTS.has(error.code)) {
          skipped++;
          continue;
        }
        console.error(`\nFailed (${error.code || 'unknown'}): ${error.message}`);
        console.error(`  in statement: ${statement.slice(0, 160)}`);
        throw error;
      }
    }
    console.log(`  ${applied} applied, ${skipped} already present`);

    const rows = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY(${EXPECTED_TABLES})
    `;
    const found = new Set(rows.map((r) => r.table_name));
    const missing = EXPECTED_TABLES.filter((t) => !found.has(t));

    if (missing.length) {
      console.error(`Missing after bootstrap: ${missing.join(', ')}`);
      process.exitCode = 1;
      return;
    }
    console.log(`All ${EXPECTED_TABLES.length} application tables present.`);
    console.log('Admin accounts are seeded separately: scripts/seed-admin.mjs');
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error('Bootstrap failed:', error.message);
  process.exit(1);
});
