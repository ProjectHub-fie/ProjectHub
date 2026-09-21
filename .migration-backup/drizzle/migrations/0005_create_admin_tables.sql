-- Create admin tables migration
CREATE TYPE admin_role AS ENUM ('super_admin', 'admin', 'moderator');
CREATE TYPE admin_action_type AS ENUM (
  'user_created', 'user_updated', 'user_deleted',
  'project_created', 'project_updated', 'project_deleted',
  'request_approved', 'request_rejected',
  'settings_updated', 'system_maintenance',
  'admin_created', 'admin_updated'
);
CREATE TYPE admin_target_type AS ENUM ('user', 'project', 'request', 'system');

CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role admin_role NOT NULL,
  permissions TEXT[] DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS admin_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  action_type admin_action_type NOT NULL,
  target_type admin_target_type NOT NULL,
  target_id UUID,
  details TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_admin_users_user_id ON admin_users(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_users_role ON admin_users(role);
CREATE INDEX IF NOT EXISTS idx_admin_actions_admin_user_id ON admin_actions(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_created_at ON admin_actions(created_at);
CREATE INDEX IF NOT EXISTS idx_admin_actions_target ON admin_actions(target_type, target_id);

-- Add initial super admin user (you can modify this with actual user ID)
-- INSERT INTO admin_users (user_id, role, permissions) 
-- VALUES ('YOUR_USER_ID_HERE', 'super_admin', ARRAY['manage_users', 'manage_projects', 'manage_requests', 'view_analytics', 'manage_settings']);