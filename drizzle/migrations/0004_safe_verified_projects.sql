-- Check if verified_projects table exists, create only if it doesn't
DO $$
BEGIN
  -- Check if verified_projects table exists
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'verified_projects'
  ) THEN
    -- Create the verified_projects table
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
    
    RAISE NOTICE 'Created verified_projects table';
  ELSE
    RAISE NOTICE 'verified_projects table already exists';
  END IF;
END $$;

-- Add missing columns to users table only if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'users' 
    AND column_name = 'is_blocked'
  ) THEN
    ALTER TABLE "users" ADD COLUMN "is_blocked" boolean DEFAULT false NOT NULL;
    RAISE NOTICE 'Added is_blocked column to users table';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'users' 
    AND column_name = 'reset_token'
  ) THEN
    ALTER TABLE "users" ADD COLUMN "reset_token" text UNIQUE;
    RAISE NOTICE 'Added reset_token column to users table';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'users' 
    AND column_name = 'reset_token_expiry'
  ) THEN
    ALTER TABLE "users" ADD COLUMN "reset_token_expiry" timestamp;
    RAISE NOTICE 'Added reset_token_expiry column to users table';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'users' 
    AND column_name = 'google_id'
  ) THEN
    ALTER TABLE "users" ADD COLUMN "google_id" text UNIQUE;
    RAISE NOTICE 'Added google_id column to users table';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'users' 
    AND column_name = 'discord_id'
  ) THEN
    ALTER TABLE "users" ADD COLUMN "discord_id" text UNIQUE;
    RAISE NOTICE 'Added discord_id column to users table';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'users' 
    AND column_name = 'facebook_id'
  ) THEN
    ALTER TABLE "users" ADD COLUMN "facebook_id" text UNIQUE;
    RAISE NOTICE 'Added facebook_id column to users table';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'users' 
    AND column_name = 'username'
  ) THEN
    ALTER TABLE "users" ADD COLUMN "username" text UNIQUE;
    RAISE NOTICE 'Added username column to users table';
  END IF;
END $$;