import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid, boolean, pgEnum } from 'drizzle-orm/pg-core';

// Enums
const adminRoleEnum = pgEnum('admin_role', ['super_admin', 'admin', 'moderator']);
const adminActionTypeEnum = pgEnum('admin_action_type', [
  'user_created', 'user_updated', 'user_deleted',
  'project_created', 'project_updated', 'project_deleted',
  'request_approved', 'request_rejected',
  'settings_updated', 'system_maintenance',
  'admin_created', 'admin_updated'
]);
const adminTargetTypeEnum = pgEnum('admin_target_type', ['user', 'project', 'request', 'system']);

// Tables
const adminUsers = pgTable('admin_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  role: adminRoleEnum('role').notNull(),
  permissions: text('permissions').array().default([]),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

const adminActions = pgTable('admin_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  adminUserId: uuid('admin_user_id').references(() => adminUsers.id, { onDelete: 'cascade' }).notNull(),
  actionType: adminActionTypeEnum('action_type').notNull(),
  targetType: adminTargetTypeEnum('target_type').notNull(),
  targetId: uuid('target_id'),
  details: text('details'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Migration
export async function up() {
  // Create enums
  await sql`
    CREATE TYPE admin_role AS ENUM ('super_admin', 'admin', 'moderator');
  `;
  
  await sql`
    CREATE TYPE admin_action_type AS ENUM (
      'user_created', 'user_updated', 'user_deleted',
      'project_created', 'project_updated', 'project_deleted',
      'request_approved', 'request_rejected',
      'settings_updated', 'system_maintenance',
      'admin_created', 'admin_updated'
    );
  `;
  
  await sql`
    CREATE TYPE admin_target_type AS ENUM ('user', 'project', 'request', 'system');
  `;

  // Create tables
  await sql`
    CREATE TABLE admin_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role admin_role NOT NULL,
      permissions TEXT[] DEFAULT '{}',
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(user_id)
    );
  `;

  await sql`
    CREATE TABLE admin_actions (
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
  `;

  // Create indexes
  await sql`
    CREATE INDEX idx_admin_users_user_id ON admin_users(user_id);
  `;
  
  await sql`
    CREATE INDEX idx_admin_users_role ON admin_users(role);
  `;
  
  await sql`
    CREATE INDEX idx_admin_actions_admin_user_id ON admin_actions(admin_user_id);
  `;
  
  await sql`
    CREATE INDEX idx_admin_actions_created_at ON admin_actions(created_at);
  `;
  
  await sql`
    CREATE INDEX idx_admin_actions_target ON admin_actions(target_type, target_id);
  `;
}

export async function down() {
  // Drop indexes
  await sql`DROP INDEX IF EXISTS idx_admin_actions_target;`;
  await sql`DROP INDEX IF EXISTS idx_admin_actions_created_at;`;
  await sql`DROP INDEX IF EXISTS idx_admin_actions_admin_user_id;`;
  await sql`DROP INDEX IF EXISTS idx_admin_users_role;`;
  await sql`DROP INDEX IF EXISTS idx_admin_users_user_id;`;

  // Drop tables
  await sql`DROP TABLE IF EXISTS admin_actions;`;
  await sql`DROP TABLE IF EXISTS admin_users;`;

  // Drop enums
  await sql`DROP TYPE IF EXISTS admin_target_type;`;
  await sql`DROP TYPE IF EXISTS admin_action_type;`;
  await sql`DROP TYPE IF EXISTS admin_role;`;
}