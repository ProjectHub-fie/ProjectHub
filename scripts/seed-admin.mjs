#!/usr/bin/env node
/**
 * Seeds (or resets) an administration dashboard account.
 *
 * The dashboard at /pbad has no public sign-up: accounts are provisioned by
 * running this script against the shared database, e.g.
 *
 *   ADMIN_PIN=131313 ADMIN_PASSWORD='<strong-secret>' ADMIN_ROLE=owner \
 *     DATABASE_URL='postgres://...' node scripts/seed-admin.mjs
 *
 * Passwords are bcrypt-hashed before storage, and re-running with the same PIN
 * rotates that account's password and role.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import postgres from 'postgres';
import { sslOptionForUrl } from '../api/_lib/db-url.js';

const { DATABASE_URL, ADMIN_PIN, ADMIN_PASSWORD, ADMIN_EMAIL } = process.env;
const role = process.env.ADMIN_ROLE || 'moderator';

if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
if (!ADMIN_PIN || !ADMIN_PASSWORD) {
  console.error('ADMIN_PIN and ADMIN_PASSWORD are required');
  process.exit(1);
}
if (!['moderator', 'admin', 'owner'].includes(role)) {
  console.error(`Invalid ADMIN_ROLE "${role}" (expected moderator, admin or owner)`);
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { ssl: sslOptionForUrl(DATABASE_URL), max: 1 });

try {
  await sql`
    CREATE TABLE IF NOT EXISTS admin_credentials (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      email text UNIQUE,
      pin text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      role text DEFAULT 'moderator' NOT NULL,
      updated_at timestamp DEFAULT now() NOT NULL
    )
  `;

  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  await sql`
    INSERT INTO admin_credentials (pin, email, password_hash, role)
    VALUES (${ADMIN_PIN}, ${ADMIN_EMAIL || null}, ${hash}, ${role})
    ON CONFLICT (pin) DO UPDATE
      SET password_hash = EXCLUDED.password_hash,
          email = COALESCE(EXCLUDED.email, admin_credentials.email),
          role = EXCLUDED.role,
          updated_at = now()
  `;

  console.log(`Dashboard account ready (pin ${ADMIN_PIN}, role ${role})`);
} catch (error) {
  console.error('Failed to seed dashboard account:', error.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}