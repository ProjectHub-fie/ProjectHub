-- Targeted migration to add only verified_projects table
-- This avoids any risk of dropping existing admin tables

-- Create verified_projects table if it doesn't exist
CREATE TABLE IF NOT EXISTS "verified_projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "long_description" text,
  "image_url" text,
  "category" text NOT NULL,
  "technologies" text[],
  "features" text[],
  "highlights" text[],
  "live_url" text,
  "github_url" text,
  "status" text NOT NULL,
  "author_name" text,
  "author_avatar" text,
  "architecture" text,
  "timeline" text,
  "team_size" text,
  "user_count" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS "idx_verified_projects_slug" ON "verified_projects" ("slug");
CREATE INDEX IF NOT EXISTS "idx_verified_projects_category" ON "verified_projects" ("category");
CREATE INDEX IF NOT EXISTS "idx_verified_projects_status" ON "verified_projects" ("status");
CREATE INDEX IF NOT EXISTS "idx_verified_projects_active" ON "verified_projects" ("is_active");

-- Add missing columns to users table if they don't exist
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username" text UNIQUE;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "google_id" text UNIQUE;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "discord_id" text UNIQUE;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "facebook_id" text UNIQUE;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_blocked" boolean DEFAULT false;