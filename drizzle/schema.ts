import { pgTable, text, timestamp, uuid, boolean, integer, varchar, pgEnum } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Enums
export const projectRequestStatusEnum = pgEnum('project_request_status', ['pending', 'approved', 'rejected', 'in-progress', 'completed']);

// Tables
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').unique(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  profileImageUrl: text('profile_image_url'),
  googleId: text('google_id').unique(),
  discordId: text('discord_id').unique(),
  facebookId: text('facebook_id').unique(),
  username: text('username').unique(),
  password: text('password'),
  resetToken: text('reset_token').unique(),
  resetTokenExpiry: timestamp('reset_token_expiry'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const sessions = pgTable('sessions', {
  sid: text('sid').primaryKey(),
  sess: text('sess').notNull(), // JSON stored as text
  expire: timestamp('expire').notNull(),
});

export const projectRequests = pgTable('project_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  budget: text('budget'),
  timeline: text('timeline'),
  technologies: text('technologies').array(), // Array of strings
  status: projectRequestStatusEnum('status').default('pending').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const projectInteractions = pgTable('project_interactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: text('project_id').notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  isLiked: boolean('is_liked').default(false).notNull(),
  rating: integer('rating'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  projectRequests: many(projectRequests),
  projectInteractions: many(projectInteractions),
}));

export const projectRequestsRelations = relations(projectRequests, ({ one }) => ({
  user: one(users, {
    fields: [projectRequests.userId],
    references: [users.id],
  }),
}));

export const projectInteractionsRelations = relations(projectInteractions, ({ one }) => ({
  user: one(users, {
    fields: [projectInteractions.userId],
    references: [users.id],
  }),
}));

// Types
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type ProjectRequest = typeof projectRequests.$inferSelect;
export type NewProjectRequest = typeof projectRequests.$inferInsert;
export type ProjectInteraction = typeof projectInteractions.$inferSelect;
export type NewProjectInteraction = typeof projectInteractions.$inferInsert;