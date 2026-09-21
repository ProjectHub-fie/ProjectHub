-- Admin dashboard (/pbad) support table.
-- Idempotent so it is safe to run against the existing shared ProjectHub database.
--
-- role is stored as text on purpose: an admin_role enum with a different value
-- set already exists in some environments, and the dashboard needs 'owner',
-- 'admin' and 'moderator'.

CREATE TABLE IF NOT EXISTS admin_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  email text UNIQUE,
  pin text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text DEFAULT 'moderator' NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);
