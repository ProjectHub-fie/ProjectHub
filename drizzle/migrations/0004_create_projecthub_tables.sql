-- Create projecthub tables and enums (prefixed to avoid conflicts with admin site)
CREATE TYPE IF NOT EXISTS "public"."projecthub_project_category" AS ENUM('websites', 'bots', 'utilities');

CREATE TYPE IF NOT EXISTS "public"."projecthub_project_status" AS ENUM('active', 'developing', 'live', 'beta', 'archived');

CREATE TYPE IF NOT EXISTS "public"."projecthub_project_request_status" AS ENUM('pending', 'approved', 'rejected', 'in-progress', 'completed');

CREATE TABLE IF NOT EXISTS "projecthub_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text UNIQUE,
	"first_name" text,
	"last_name" text,
	"profile_image_url" text,
	"google_id" text UNIQUE,
	"discord_id" text UNIQUE,
	"facebook_id" text UNIQUE,
	"username" text UNIQUE,
	"password" text,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"reset_token" text UNIQUE,
	"reset_token_expiry" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "projecthub_sessions" (
	"sid" text PRIMARY KEY,
	"sess" text NOT NULL,
	"expire" timestamp NOT NULL
);

CREATE TABLE IF NOT EXISTS "projecthub_verified_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"long_description" text,
	"image_url" text,
	"category" "projecthub_project_category" NOT NULL,
	"technologies" text[],
	"features" text[],
	"highlights" text[],
	"live_url" text,
	"github_url" text,
	"status" "projecthub_project_status" NOT NULL,
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
	CONSTRAINT "projecthub_verified_projects_slug_unique" UNIQUE("slug")
);

CREATE TABLE IF NOT EXISTS "projecthub_project_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"budget" text,
	"timeline" text,
	"technologies" text[],
	"status" "projecthub_project_request_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "projecthub_project_interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"is_liked" boolean DEFAULT false NOT NULL,
	"rating" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- Add foreign key constraints
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'projecthub_project_requests_user_id_projecthub_users_id_fk'
  ) THEN
    ALTER TABLE "projecthub_project_requests" 
    ADD CONSTRAINT "projecthub_project_requests_user_id_projecthub_users_id_fk" 
    FOREIGN KEY ("user_id") REFERENCES "projecthub_users"("id") 
    ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'projecthub_project_interactions_user_id_projecthub_users_id_fk'
  ) THEN
    ALTER TABLE "projecthub_project_interactions" 
    ADD CONSTRAINT "projecthub_project_interactions_user_id_projecthub_users_id_fk" 
    FOREIGN KEY ("user_id") REFERENCES "projecthub_users"("id") 
    ON DELETE no action ON UPDATE no action;
  END IF;
END $$;