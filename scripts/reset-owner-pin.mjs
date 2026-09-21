#!/usr/bin/env node
/**
 * Resets the primary owner account for the /pbad administration dashboard.
 *
 * The dashboard has no "forgot PIN" flow on purpose: ownership is recovered by
 * running this script against the shared database, so a lost PIN requires
 * database access rather than an emailed link.
 *
 *   DATABASE_URL='postgres://...' node scripts/reset-owner-pin.mjs
 *
 * It always rotates the PIN to a fresh random value and prints it once, then
 * sets a strong random password. Pass --keep-pin to only rotate the password
 * while keeping the existing PIN.
 *
 * This is the maintained equivalent of the older
 * scripts/reset-owner-password.ts, which assumed the hard-coded PIN 131313 and
 * the password "adminpassword".
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import postgres from 'postgres';

const { DATABASE_URL } = process.env;
const keepPin = process.argv.includes('--keep-pin');

if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

/** URL-safe PIN that is easy to read aloud but not guessable. */
const generatePin = () => crypto.randomBytes(9).toString('base64url').slice(0, 12);
const generatePassword = () => crypto.randomBytes(24).toString('base64url');

const sql = postgres(DATABASE_URL, { ssl: 'require', max: 1 });

try {
  const owners = await sql`
    SELECT id, pin FROM admin_credentials WHERE role = 'owner' ORDER BY updated_at LIMIT 1
  `;

  if (owners.length === 0) {
    console.error('No account with role "owner" exists.');
    console.error('Create one first:');
    console.error(
      "  ADMIN_PIN=<pin> ADMIN_PASSWORD='<secret>' ADMIN_ROLE=owner DATABASE_URL='...' node scripts/seed-admin.mjs"
    );
    process.exit(1);
  }

  const owner = owners[0];
  const newPin = keepPin ? owner.pin : generatePin();
  const newPassword = generatePassword();
  const hash = await bcrypt.hash(newPassword, 12);

  await sql`
    UPDATE admin_credentials
    SET pin = ${newPin}, password_hash = ${hash}, updated_at = now()
    WHERE id = ${owner.id}::uuid
  `;

  // Shown once, on stdout, to the operator running the script.
  console.log('Owner credentials rotated.');
  console.log(`  PIN:      ${newPin}`);
  console.log(`  Password: ${newPassword}`);
  console.log('Store these now: the password is only available in this output.');
} catch (error) {
  console.error('Failed to reset owner credentials:', error.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}