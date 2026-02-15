-- Create verified_projects table and enums
CREATE TYPE IF NOT EXISTS "public"."project_category" AS ENUM('websites', 'bots', 'utilities');

CREATE TYPE IF NOT EXISTS "public"."project_status" AS ENUM('active', 'developing', 'live', 'beta', 'archived');

CREATE TABLE IF NOT EXISTS "verified_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"long_description" text,
	"image_url" text,
	"category" "project_category" NOT NULL,
	"technologies" text[],
	"features" text[],
	"highlights" text[],
	"live_url" text,
	"github_url" text,
	"status" "project_status" NOT NULL,
	"author_name" text,
	"author_avatar" text,
	"architecture" text,
	"timeline" text,
	"team_size" text,
	"user_count" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "verified_projects_slug_unique" UNIQUE("slug")
);

-- Add missing columns to users table if they don't exist
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_blocked" boolean DEFAULT false NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "reset_token" text UNIQUE;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "reset_token_expiry" timestamp;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "google_id" text UNIQUE;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "discord_id" text UNIQUE;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "facebook_id" text UNIQUE;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username" text UNIQUE;