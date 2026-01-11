import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { pgTable, varchar, text, timestamp, json, uuid, boolean } from "drizzle-orm/pg-core";

// Session storage table for authentication
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid", { length: 255 }).primaryKey(),
    sess: json("sess").notNull(),
    expire: timestamp("expire").notNull(),
  }
);

// Users table with social authentication support
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).unique(),
  firstName: varchar("first_name", { length: 255 }),
  lastName: varchar("last_name", { length: 255 }),
  profileImageUrl: varchar("profile_image_url", { length: 500 }),
  // Social provider IDs
  googleId: varchar("google_id", { length: 255 }).unique(),
  discordId: varchar("discord_id", { length: 255 }).unique(),
  facebookId: varchar("facebook_id", { length: 255 }).unique(),
  // Traditional email/password (optional)
  username: text("username").unique(),
  password: text("password"),
  isAdmin: boolean("is_admin").default(false),
  // Password reset
  resetToken: varchar("reset_token", { length: 255 }).unique(),
  resetTokenExpiry: timestamp("reset_token_expiry"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Project requests table
export const projectRequests = pgTable("project_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  budget: varchar("budget", { length: 100 }),
  timeline: varchar("timeline", { length: 100 }),
  technologies: json("technologies").$type<string[]>(),
  status: varchar("status", { length: 50 }).default("pending"), // pending, approved, rejected, in-progress, completed
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Schemas for validation
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const upsertUserSchema = createInsertSchema(users).pick({
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  profileImageUrl: true,
  googleId: true,
  discordId: true,
  facebookId: true,
  username: true,
  password: true,
});

export const insertProjectRequestSchema = createInsertSchema(projectRequests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  technologies: z.array(z.string()).optional(),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type UpsertUser = z.infer<typeof upsertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertProjectRequest = z.infer<typeof insertProjectRequestSchema>;
export type ProjectRequest = typeof projectRequests.$inferSelect;