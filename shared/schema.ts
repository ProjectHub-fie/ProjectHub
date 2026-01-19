import mongoose, { Schema, Document } from "mongoose";
import { z } from "zod";

// Session storage interface for authentication
export interface ISession extends Document {
  sid: string;
  sess: any;
  expire: Date;
}

// Users interface with social authentication support
export interface IUser extends Document {
  email?: string;
  firstName?: string;
  lastName?: string;
  profileImageUrl?: string;
  // Social provider IDs
  googleId?: string;
  discordId?: string;
  facebookId?: string;
  // Traditional email/password (optional)
  username?: string;
  password?: string;
  // Password reset
  resetToken?: string;
  resetTokenExpiry?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Project requests interface
export interface IProjectRequest extends Document {
  userId: mongoose.Types.ObjectId;
  title: string;
  description: string;
  budget?: string;
  timeline?: string;
  technologies: string[];
  status: string; // pending, approved, rejected, in-progress, completed
  createdAt: Date;
  updatedAt: Date;
}

// Project interactions interface (likes and ratings)
export interface IProjectInteraction extends Document {
  projectId: string;
  userId: mongoose.Types.ObjectId;
  isLiked: string; // "true" or "false"
  rating?: string; // "1" to "5"
  createdAt: Date;
  updatedAt: Date;
}

// Mongoose Schemas
export const SessionSchema = new Schema<ISession>({
  sid: { type: String, required: true, unique: true },
  sess: { type: Schema.Types.Mixed, required: true },
  expire: { type: Date, required: true },
});

export const UserSchema = new Schema<IUser>({
  email: { type: String, unique: true, sparse: true },
  firstName: { type: String },
  lastName: { type: String },
  profileImageUrl: { type: String },
  googleId: { type: String, unique: true, sparse: true },
  discordId: { type: String, unique: true, sparse: true },
  facebookId: { type: String, unique: true, sparse: true },
  username: { type: String, unique: true, sparse: true },
  password: { type: String },
  resetToken: { type: String, unique: true, sparse: true },
  resetTokenExpiry: { type: Date },
}, {
  timestamps: true,
});

export const ProjectRequestSchema = new Schema<IProjectRequest>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  budget: { type: String },
  timeline: { type: String },
  technologies: [{ type: String }],
  status: { type: String, default: 'pending' },
}, {
  timestamps: true,
});

export const ProjectInteractionSchema = new Schema<IProjectInteraction>({
  projectId: { type: String, required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  isLiked: { type: String, default: 'false' },
  rating: { type: String },
}, {
  timestamps: true,
});

// Models
export const Session = mongoose.models.Session || mongoose.model<ISession>('Session', SessionSchema);
export const User = mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
export const ProjectRequest = mongoose.models.ProjectRequest || mongoose.model<IProjectRequest>('ProjectRequest', ProjectRequestSchema);
export const ProjectInteraction = mongoose.models.ProjectInteraction || mongoose.model<IProjectInteraction>('ProjectInteraction', ProjectInteractionSchema);

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
  id: z.string().optional(),
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
  userId: z.string(),
  title: z.string(),
  description: z.string(),
  budget: z.string().optional(),
  timeline: z.string().optional(),
  technologies: z.array(z.string()).optional(),
});

export const insertProjectInteractionSchema = z.object({
  projectId: z.string(),
  userId: z.string(),
  isLiked: z.string().optional(),
  rating: z.string().optional(),
});

// Type exports
export type InsertUser = z.infer<typeof insertUserSchema>;
export type UpsertUser = z.infer<typeof upsertUserSchema>;
export type User = IUser;
export type InsertProjectRequest = z.infer<typeof insertProjectRequestSchema>;
export type ProjectRequest = IProjectRequest;
export type ProjectInteraction = IProjectInteraction;
export type InsertProjectInteraction = z.infer<typeof insertProjectInteractionSchema>;