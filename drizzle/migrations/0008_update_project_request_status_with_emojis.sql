-- Migration to update project_request_status enum with emoji values
-- Map existing values to new emoji-based values

-- First, update existing records to map old values to new ones
UPDATE project_requests 
SET status = CASE 
    WHEN status = 'pending' THEN 'pending'
    WHEN status = 'approved' THEN 'done'
    WHEN status = 'rejected' THEN 'canceled'
    WHEN status = 'in-progress' THEN 'working'
    WHEN status = 'completed' THEN 'done'
    ELSE 'pending'
END;

-- Drop the old enum type
DROP TYPE IF EXISTS project_request_status_old;

-- Rename current enum to old
ALTER TYPE project_request_status RENAME TO project_request_status_old;

-- Create new enum with emoji values
CREATE TYPE project_request_status AS ENUM('pending', 'working', 'done', 'canceled', 'suspended');

-- Alter table to use new enum type
ALTER TABLE project_requests 
ALTER COLUMN status TYPE project_request_status 
USING status::text::project_request_status;

-- Drop old enum
DROP TYPE project_request_status_old;

-- Update the default value for new records
ALTER TABLE project_requests 
ALTER COLUMN status SET DEFAULT 'pending';