CREATE TYPE "public"."admin_role" AS ENUM('owner', 'admin', 'moderator');--> statement-breakpoint
DROP TABLE "contact_requests" CASCADE;--> statement-breakpoint
ALTER TABLE "admin_credentials" ADD COLUMN "role" "admin_role" DEFAULT 'moderator' NOT NULL;