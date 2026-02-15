CREATE TYPE "public"."project_category" AS ENUM('websites', 'bots', 'utilities');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('active', 'developing', 'live', 'beta', 'archived');--> statement-breakpoint
CREATE TABLE "verified_projects" (
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
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_blocked" boolean DEFAULT false NOT NULL;