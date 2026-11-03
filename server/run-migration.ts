import 'dotenv/config';
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { join } from 'path';

async function runMigration() {
  const client = postgres(process.env.DATABASE_URL!, { ssl: { rejectUnauthorized: false }, max: 1 });

  try {
    // Create enums if they don't exist
    console.log('Creating enums...');
    
    await client`
      DO $$ BEGIN
        CREATE TYPE project_category AS ENUM('websites', 'bots', 'utilities');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `;
    console.log('✅ project_category enum');

    await client`
      DO $$ BEGIN
        CREATE TYPE project_status AS ENUM('active', 'developing', 'live', 'beta', 'archived');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `;
    console.log('✅ project_status enum');

    // Create verified_projects table
    console.log('Creating verified_projects table...');
    await client`
      CREATE TABLE IF NOT EXISTS verified_projects (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        slug text NOT NULL,
        title text NOT NULL,
        description text NOT NULL,
        long_description text,
        image_url text,
        category project_category NOT NULL,
        technologies text[],
        features text[],
        highlights text[],
        live_url text,
        github_url text,
        status project_status NOT NULL,
        author_name text,
        author_avatar text,
        architecture text,
        timeline text,
        team_size text,
        user_count text,
        app_version text,
        app_size text,
        platforms text[],
        requirements text[],
        release_notes text,
        screenshots text[],
        is_active boolean DEFAULT true NOT NULL,
        sort_order integer DEFAULT 0 NOT NULL,
        created_at timestamp DEFAULT now() NOT NULL,
        updated_at timestamp DEFAULT now() NOT NULL,
        CONSTRAINT verified_projects_slug_unique UNIQUE(slug)
      )
    `;
    console.log('✅ verified_projects table created');

    // App-store metadata for installable utilities, added after the table
    // shipped so a pre-existing deployment gains the columns.
    await client`ALTER TABLE verified_projects ADD COLUMN IF NOT EXISTS app_version text`;
    await client`ALTER TABLE verified_projects ADD COLUMN IF NOT EXISTS app_size text`;
    await client`ALTER TABLE verified_projects ADD COLUMN IF NOT EXISTS platforms text[]`;
    await client`ALTER TABLE verified_projects ADD COLUMN IF NOT EXISTS requirements text[]`;
    await client`ALTER TABLE verified_projects ADD COLUMN IF NOT EXISTS release_notes text`;
    await client`ALTER TABLE verified_projects ADD COLUMN IF NOT EXISTS screenshots text[]`;
    console.log('✅ verified_projects app columns');

    // Also patch users table
    await client`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_blocked boolean DEFAULT false NOT NULL`;
    await client`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token text`;
    await client`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expiry timestamp`;
    await client`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id text`;
    await client`ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_id text`;
    await client`ALTER TABLE users ADD COLUMN IF NOT EXISTS facebook_id text`;
    await client`ALTER TABLE users ADD COLUMN IF NOT EXISTS username text`;
    console.log('✅ users table patched');

  } catch(e: any) {
    console.error('Migration error:', e.message);
  } finally {
    await client.end();
  }
}

runMigration();
