import { pgTable, text, serial, timestamp, boolean, uuid, pgEnum, integer } from "drizzle-orm/pg-core";
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

export const adminRoleEnum = pgEnum("admin_role", ["owner", "admin", "moderator"]);

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

export const projectCategoryEnum = pgEnum("project_category", ["websites", "bots", "utilities"]);
export const projectStatusEnum = pgEnum("project_status", ["active", "developing", "live", "beta", "archived"]);

export const verifiedProjects = pgTable("verified_projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  longDescription: text("long_description"),
  imageUrl: text("image_url"),
  category: projectCategoryEnum("category").notNull(),
  technologies: text("technologies").array(),
  features: text("features").array(),
  highlights: text("highlights").array(),
  liveUrl: text("live_url"),
  githubUrl: text("github_url"),
  status: projectStatusEnum("status").notNull(),
  authorName: text("author_name"),
  authorAvatar: text("author_avatar"),
  architecture: text("architecture"),
  timeline: text("timeline"),
  teamSize: text("team_size"),
  userCount: text("user_count"),
  isActive: boolean("is_active").default(true).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const adminCredentials = pgTable("admin_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique(), // Made optional by removing .notNull()
  pin: text("pin").unique().notNull(),
  passwordHash: text("password_hash").notNull(),
  role: adminRoleEnum("role").default("moderator").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});