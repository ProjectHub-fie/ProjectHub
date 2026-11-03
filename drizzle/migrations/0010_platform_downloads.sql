-- Per-platform installer links for installable utilities.
--
-- Idempotent so it is safe to run against the existing shared ProjectHub
-- database, and additive only: no existing column is touched, so all current
-- project rows keep their values.
--
-- Each URL holds a complete public MEGA share link, decryption key included.
-- The link is therefore a credential in its own right: it must never be logged,
-- echoed into an error message, or copied into a diagnostics table. See
-- api/_lib/download-links.js.

ALTER TABLE verified_projects ADD COLUMN IF NOT EXISTS android_download_url text;
ALTER TABLE verified_projects ADD COLUMN IF NOT EXISTS windows_download_url text;

-- Per-platform package facts for the download dialog: package name, version,
-- size, release date and SHA-256. jsonb so a platform can carry facts the other
-- does not without a further migration.
ALTER TABLE verified_projects ADD COLUMN IF NOT EXISTS download_details jsonb;

-- GitHub Releases used to be an implicit fallback for any utility with a repo,
-- which made an app with no installer still offer a download button. It is now
-- opt-in, so existing rows default to off.
ALTER TABLE verified_projects ADD COLUMN IF NOT EXISTS github_releases_fallback boolean DEFAULT false NOT NULL;
