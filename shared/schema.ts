import { z } from "zod";
import { createInsertSchema } from "drizzle-zod";
import {
  users,
  projectRequests,
  projectInteractions,
  sessions
} from '../drizzle/schema.js';

// Re-export types from Drizzle schema using $inferSelect/$inferInsert
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type ProjectRequest = typeof projectRequests.$inferSelect;
export type InsertProjectRequest = typeof projectRequests.$inferInsert;
export type ProjectInteraction = typeof projectInteractions.$inferSelect;
export type InsertProjectInteraction = typeof projectInteractions.$inferInsert;
export type Session = typeof sessions.$inferSelect;

// Alias types for backward compatibility
export type IUser = User;
export type IProjectRequest = ProjectRequest;
export type IProjectInteraction = ProjectInteraction;
export type ISession = Session;
export type UserType = User;
export type ProjectRequestType = ProjectRequest;
export type ProjectInteractionType = ProjectInteraction;

// Zod Schemas for validation using drizzle-zod
export const insertUserSchema = createInsertSchema(users).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});

export const upsertUserSchema = z.object({
  id: z.string().uuid().optional(),
  email: z.string().email().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  profileImageUrl: z.string().optional(),
  googleId: z.string().optional(),
  discordId: z.string().optional(),
  facebookId: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
});

export const insertProjectRequestSchema = createInsertSchema(projectRequests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  status: true
});

export const insertProjectInteractionSchema = createInsertSchema(projectInteractions).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

// Type exports for schemas
export type UpsertUser = z.infer<typeof upsertUserSchema>;
