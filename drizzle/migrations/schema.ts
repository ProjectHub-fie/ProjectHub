import { pgTable, unique, uuid, text, timestamp, index, boolean, integer, foreignKey, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const adminRole = pgEnum("admin_role", ['owner', 'admin', 'moderator'])
export const projectRequestStatus = pgEnum("project_request_status", ['pending', 'working', 'done', 'canceled', 'suspended'])


export const adminCredentials = pgTable("admin_credentials", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	email: text(),
	pin: text().notNull(),
	passwordHash: text("password_hash").notNull(),
	role: adminRole().default('moderator').notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("admin_credentials_email_unique").on(table.email),
	unique("admin_credentials_pin_unique").on(table.pin),
]);

export const verifiedProjects = pgTable("verified_projects", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	slug: text().notNull(),
	title: text().notNull(),
	description: text().notNull(),
	longDescription: text("long_description"),
	imageUrl: text("image_url"),
	category: text().notNull(),
	technologies: text().array(),
	features: text().array(),
	highlights: text().array(),
	liveUrl: text("live_url"),
	githubUrl: text("github_url"),
	status: text().notNull(),
	authorName: text("author_name"),
	authorAvatar: text("author_avatar"),
	architecture: text(),
	timeline: text(),
	teamSize: text("team_size"),
	userCount: text("user_count"),
	isActive: boolean("is_active").default(true).notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_verified_projects_active").using("btree", table.isActive.asc().nullsLast().op("bool_ops")),
	index("idx_verified_projects_category").using("btree", table.category.asc().nullsLast().op("text_ops")),
	index("idx_verified_projects_slug").using("btree", table.slug.asc().nullsLast().op("text_ops")),
	index("idx_verified_projects_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	unique("verified_projects_slug_key").on(table.slug),
]);

export const projectRequests = pgTable("project_requests", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	title: text().notNull(),
	description: text().notNull(),
	budget: text(),
	timeline: text(),
	technologies: text().array(),
	status: projectRequestStatus().default('pending').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "project_requests_user_id_users_id_fk"
		}),
]);

export const users = pgTable("users", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	email: text(),
	firstName: text("first_name"),
	lastName: text("last_name"),
	profileImageUrl: text("profile_image_url"),
	googleId: text("google_id"),
	discordId: text("discord_id"),
	facebookId: text("facebook_id"),
	username: text(),
	password: text(),
	resetToken: text("reset_token"),
	resetTokenExpiry: timestamp("reset_token_expiry", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	isBlocked: boolean("is_blocked").default(false),
	isAdmin: boolean("is_admin").default(false),
}, (table) => [
	unique("users_email_unique").on(table.email),
]);

export const sessions = pgTable("sessions", {
	sid: text().primaryKey().notNull(),
	sess: text().notNull(),
	expire: timestamp({ mode: 'string' }).notNull(),
});

export const projectInteractions = pgTable("project_interactions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	projectId: text("project_id").notNull(),
	userId: uuid("user_id").notNull(),
	isLiked: boolean("is_liked").default(false),
	rating: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "project_interactions_user_id_users_id_fk"
		}),
]);
