import { z } from "zod";
import { createInsertSchema } from "drizzle-zod";
import {
  users,
  projectRequests,
  projectInteractions,
  verifiedProjects
} from '../../drizzle/schema.js';

// Admin-specific enums
export const adminRoleEnum = z.enum(['super_admin', 'admin', 'moderator']);
export const adminPermissionEnum = z.enum([
  'manage_users',
  'manage_projects',
  'manage_requests',
  'view_analytics',
  'manage_settings'
]);

// Admin user extension
export const adminUserSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  role: adminRoleEnum,
  permissions: adminPermissionEnum.array().default([]),
  isActive: z.boolean().default(true),
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
});

// Admin actions logging
export const adminActionSchema = z.object({
  id: z.string().uuid(),
  adminUserId: z.string().uuid(),
  actionType: z.string(),
  targetType: z.enum(['user', 'project', 'request', 'system']),
  targetId: z.string().uuid().optional(),
  details: z.record(z.any()).optional(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  createdAt: z.date().default(() => new Date()),
});

// Admin dashboard statistics
export const adminStatsSchema = z.object({
  totalUsers: z.number(),
  totalProjects: z.number(),
  pendingRequests: z.number(),
  totalInteractions: z.number(),
  recentActivity: z.array(z.object({
    action: z.string(),
    timestamp: z.date(),
    adminName: z.string(),
  })),
});

// Zod schemas for validation
export const insertAdminUserSchema = adminUserSchema.omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});

export const insertAdminActionSchema = adminActionSchema.omit({ 
  id: true, 
  createdAt: true 
});

// Type exports
export type AdminUser = z.infer<typeof adminUserSchema>;
export type InsertAdminUser = z.infer<typeof insertAdminUserSchema>;
export type AdminAction = z.infer<typeof adminActionSchema>;
export type InsertAdminAction = z.infer<typeof insertAdminActionSchema>;
export type AdminStats = z.infer<typeof adminStatsSchema>;

// Re-export existing types for convenience
export type {
  User,
  InsertUser,
  VerifiedProject,
  InsertVerifiedProject,
  ProjectRequest,
  InsertProjectRequest,
  ProjectInteraction,
  InsertProjectInteraction
} from '../schema.js';

// Export validation schemas
export {
  insertUserSchema,
  upsertUserSchema,
  insertVerifiedProjectSchema,
  insertProjectRequestSchema,
  insertProjectInteractionSchema
} from '../schema.js';