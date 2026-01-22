import { pgTable, text, serial, timestamp, boolean, uuid, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique(),
  password: text("password"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  profileImageUrl: text("profile_image_url"),
  googleId: text("google_id"),
  discordId: text("discord_id"),
  facebookId: text("facebook_id"),
  username: text("username"),
  resetToken: text("reset_token"),
  resetTokenExpiry: timestamp("reset_token_expiry"),
  isBlocked: boolean("is_blocked").default(false),
  isAdmin: boolean("is_admin").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const projectRequestStatusEnum = pgEnum("project_request_status", ["pending", "in_review", "approved", "rejected", "completed"]);

export const projectRequests = pgTable("project_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  budget: text("budget"),
  timeline: text("timeline"),
  technologies: text("technologies").array(),
  status: projectRequestStatusEnum("status").default("pending").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const projectInteractions = pgTable("project_interactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: text("project_id").notNull(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  isLiked: boolean("is_liked").default(false),
  rating: text("rating"), // Stored as string for flexibility
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  sid: text("sid").primaryKey(),
  sess: text("sess").notNull(),
  expire: timestamp("expire").notNull(),
});

export const adminCredentials = pgTable("admin_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique().notNull(),
  pin: text("pin").unique().notNull(),
  passwordHash: text("password_hash").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
