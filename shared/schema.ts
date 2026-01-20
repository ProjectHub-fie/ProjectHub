import { z } from "zod";
import type {
  User,
  ProjectRequest,
  ProjectInteraction,
  Session,
  NewUser,
  NewProjectRequest,
  NewProjectInteraction
} from '../drizzle/schema.js';

// Re-export types from Drizzle schema
export type IUser = User;
export type IProjectRequest = ProjectRequest;
export type IProjectInteraction = ProjectInteraction;
export type ISession = Session;
export type InsertUser = NewUser;
export type InsertProjectRequest = NewProjectRequest;
export type InsertProjectInteraction = NewProjectInteraction;

// Zod Schemas for validation (keeping these for API validation)
export const insertUserSchema = z.object({
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

export const insertProjectRequestSchema = z.object({
  userId: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  budget: z.string().optional(),
  timeline: z.string().optional(),
  technologies: z.array(z.string()).optional(),
});

export const insertProjectInteractionSchema = z.object({
  projectId: z.string(),
  userId: z.string().uuid(),
  isLiked: z.boolean().optional(),
  rating: z.number().int().min(1).max(5).optional(),
});

// Type exports
export type UpsertUser = z.infer<typeof upsertUserSchema>;
export type User = IUser;
export type ProjectRequest = IProjectRequest;
export type ProjectInteraction = IProjectInteraction;