import { pgTable, text, timestamp, uuid, boolean, integer, varchar, pgEnum, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// Enums
export const projectRequestStatusEnum = pgEnum('project_request_status', ['pending', 'working', 'done', 'canceled', 'suspended']);
export const projectCategoryEnum = pgEnum('project_category', ['websites', 'bots', 'utilities']);
export const projectStatusEnum = pgEnum('project_status', ['active', 'developing', 'live', 'beta', 'archived']);

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
  isBlocked: boolean('is_blocked').default(false).notNull(),
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

export const verifiedProjects = pgTable('verified_projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').unique().notNull(), // URL-friendly identifier
  title: text('title').notNull(),
  description: text('description').notNull(),
  longDescription: text('long_description'),
  imageUrl: text('image_url'),
  category: projectCategoryEnum('category').notNull(),
  technologies: text('technologies').array(), // Array of strings
  features: text('features').array(), // Array of strings
  highlights: text('highlights').array(), // Array of strings
  liveUrl: text('live_url'),
  githubUrl: text('github_url'),
  status: projectStatusEnum('status').notNull(),
  authorName: text('author_name'),
  authorAvatar: text('author_avatar'),
  architecture: text('architecture'),
  timeline: text('timeline'),
  teamSize: text('team_size'),
  userCount: text('user_count'),
  isActive: boolean('is_active').default(true).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
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

export const verifiedProjectsRelations = relations(verifiedProjects, ({ many }) => ({
  interactions: many(projectInteractions),
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

// Admin credentials used by the /pbad administration dashboard
export const adminCredentials = pgTable('admin_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').unique(),
  pin: text('pin').unique().notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').default('moderator').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const adminCredentialsRelations = relations(adminCredentials, () => ({}));

/* -------------------------------------------------------------------------
   ProjectHub Mail

   The admin mail workspace. Inbound public mail (Resend) and outbound admin
   mail (Mailjet) both land here so the dashboard can show one inbox.

   Deliberately minimal: a thread table plus a message table carry the whole
   conversation, and everything else (drafts, templates, signatures,
   notifications, push subscriptions) is a small record hanging off an admin.
   Attachment binaries are never stored in Postgres — only metadata, because the
   deployment runs on Vercel where there is no durable local filesystem.
------------------------------------------------------------------------- */

/** Where a mail row came from, which decides which transport replies use. */
export const mailDirectionEnum = pgEnum('mail_direction', ['inbound', 'outbound']);
/** Delivery state of an outbound message. */
export const mailStatusEnum = pgEnum('mail_status', ['draft', 'queued', 'sent', 'failed', 'received', 'trashed']);

export const mailThreads = pgTable('mail_threads', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Stable identity of the conversation, so an inbound reply with only
  // In-Reply-To/References headers can still be attached to the right thread.
  rootMessageId: text('root_message_id'),
  subject: text('subject'),
  // Lowercased participant addresses, used for a fast "does this thread involve
  // this person" lookup without scanning every message body.
  participants: text('participants').array(),
  lastMessageAt: timestamp('last_message_at').defaultNow().notNull(),
  messageCount: integer('message_count').default(1).notNull(),
  unreadCount: integer('unread_count').default(0).notNull(),
  isStarred: boolean('is_starred').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  lastMessageIdx: index('mail_threads_last_message_idx').on(table.lastMessageAt),
  rootMessageIdx: index('mail_threads_root_message_idx').on(table.rootMessageId),
}));

export const mailMessages = pgTable('mail_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  threadId: uuid('thread_id').references(() => mailThreads.id, { onDelete: 'cascade' }).notNull(),
  // Idempotency key. The inbound webhook can be retried by the provider, and a
  // duplicate insert would show the same email twice in the inbox.
  providerMessageId: text('provider_message_id'),
  direction: mailDirectionEnum('direction').default('inbound').notNull(),
  status: mailStatusEnum('status').default('received').notNull(),
  fromName: text('from_name'),
  fromEmail: text('from_email'),
  toEmails: text('to_emails').array(),
  ccEmails: text('cc_emails').array(),
  bccEmails: text('bcc_emails').array(),
  replyTo: text('reply_to'),
  subject: text('subject'),
  // Stored raw. Rendered HTML is sanitized at read time, never trusted from here.
  bodyHtml: text('body_html'),
  bodyText: text('body_text'),
  snippet: text('snippet'),
  hasAttachments: boolean('has_attachments').default(false).notNull(),
  isRead: boolean('is_read').default(false).notNull(),
  isStarred: boolean('is_starred').default(false).notNull(),
  isTrashed: boolean('is_trashed').default(false).notNull(),
  // Which transport produced this row: 'resend' for public mail, 'mailjet' for
  // admin mail. Keeps the two providers independently attributable.
  provider: text('provider'),
  inReplyTo: text('in_reply_to'),
  references: text('references').array(),
  // Source record this message mirrors, so a public form submission is linked
  // to its inbox copy instead of being stored twice with no relation.
  sourceType: text('source_type'),
  sourceId: text('source_id'),
  sentAt: timestamp('sent_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  threadIdx: index('mail_messages_thread_idx').on(table.threadId, table.createdAt),
  providerMessageIdx: uniqueIndex('mail_messages_provider_message_idx')
    .on(table.providerMessageId)
    .where(sql`${table.providerMessageId} is not null`),
  sourceIdx: index('mail_messages_source_idx').on(table.sourceType, table.sourceId),
  statusIdx: index('mail_messages_status_idx').on(table.status, table.direction),
}));

export const mailAttachments = pgTable('mail_attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  messageId: uuid('message_id').references(() => mailMessages.id, { onDelete: 'cascade' }).notNull(),
  filename: text('filename').notNull(),
  contentType: text('content_type'),
  sizeBytes: integer('size_bytes'),
  // Provider-side identifier when the file lives with Mailjet/Resend rather than
  // in our database. Kept nullable so metadata-only rows still work.
  providerAttachmentId: text('provider_attachment_id'),
  // Inline data URL for small attachments only. Large binaries are never put in
  // Postgres; those rows keep metadata and no content.
  contentData: text('content_data'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  messageIdx: index('mail_attachments_message_idx').on(table.messageId),
}));

export const mailDrafts = pgTable('mail_drafts', {
  id: uuid('id').primaryKey().defaultRandom(),
  adminId: uuid('admin_id').references(() => adminCredentials.id, { onDelete: 'cascade' }).notNull(),
  threadId: uuid('thread_id').references(() => mailThreads.id, { onDelete: 'set null' }),
  templateId: uuid('template_id'),
  mode: text('mode').default('new').notNull(),
  toEmails: text('to_emails').array(),
  ccEmails: text('cc_emails').array(),
  bccEmails: text('bcc_emails').array(),
  subject: text('subject'),
  bodyHtml: text('body_html'),
  attachmentsMeta: jsonb('attachments_meta'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  adminIdx: index('mail_drafts_admin_idx').on(table.adminId, table.updatedAt),
}));

export const mailTemplates = pgTable('mail_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  category: text('category').default('general').notNull(),
  subject: text('subject'),
  bodyHtml: text('body_html'),
  bodyText: text('body_text'),
  createdBy: uuid('created_by').references(() => adminCredentials.id, { onDelete: 'set null' }),
  isArchived: boolean('is_archived').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  categoryIdx: index('mail_templates_category_idx').on(table.category, table.isArchived),
}));

export const mailSignatures = pgTable('mail_signatures', {
  id: uuid('id').primaryKey().defaultRandom(),
  adminId: uuid('admin_id').references(() => adminCredentials.id, { onDelete: 'cascade' }).notNull().unique(),
  name: text('name'),
  position: text('position'),
  company: text('company'),
  website: text('website'),
  socialLinks: jsonb('social_links'),
  logoUrl: text('logo_url'),
  enabled: boolean('enabled').default(true).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const mailNotifications = pgTable('mail_notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Per-admin row: the unread badge is "how many unread notifications does this
  // admin have", which cannot be derived from one global read flag.
  adminId: uuid('admin_id').references(() => adminCredentials.id, { onDelete: 'cascade' }).notNull(),
  type: text('type').default('new_email').notNull(),
  messageId: uuid('message_id').references(() => mailMessages.id, { onDelete: 'cascade' }),
  threadId: uuid('thread_id').references(() => mailThreads.id, { onDelete: 'cascade' }),
  title: text('title'),
  // Short preview only. Notification rows must never carry a full email body.
  bodyPreview: text('body_preview'),
  isRead: boolean('is_read').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  adminUnreadIdx: index('mail_notifications_admin_unread_idx').on(table.adminId, table.isRead, table.createdAt),
}));

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  adminId: uuid('admin_id').references(() => adminCredentials.id, { onDelete: 'cascade' }).notNull(),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
}, (table) => ({
  adminIdx: index('push_subscriptions_admin_idx').on(table.adminId),
}));

/** Per-admin notification preferences. One row per admin, nothing shared. */
export const mailNotificationSettings = pgTable('mail_notification_settings', {
  adminId: uuid('admin_id').primaryKey().references(() => adminCredentials.id, { onDelete: 'cascade' }),
  notifyNewEmail: boolean('notify_new_email').default(true).notNull(),
  notifyProjectRequest: boolean('notify_project_request').default(true).notNull(),
  notifyReply: boolean('notify_reply').default(true).notNull(),
  notifyImportant: boolean('notify_important').default(true).notNull(),
  desktopEnabled: boolean('desktop_enabled').default(false).notNull(),
  soundEnabled: boolean('sound_enabled').default(false).notNull(),
  badgeEnabled: boolean('badge_enabled').default(true).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/** Append-only trail of important mail actions for the dashboard audit view. */
export const mailAuditLog = pgTable('mail_audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  adminId: uuid('admin_id').references(() => adminCredentials.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  // Never carries bodies, addresses of third parties, or provider secrets.
  details: jsonb('details'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  createdIdx: index('mail_audit_log_created_idx').on(table.createdAt),
}));

// Types
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type VerifiedProject = typeof verifiedProjects.$inferSelect;
export type NewVerifiedProject = typeof verifiedProjects.$inferInsert;
export type ProjectRequest = typeof projectRequests.$inferSelect;
export type NewProjectRequest = typeof projectRequests.$inferInsert;
export type ProjectInteraction = typeof projectInteractions.$inferSelect;
export type NewProjectInteraction = typeof projectInteractions.$inferInsert;