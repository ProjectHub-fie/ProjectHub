import { relations } from "drizzle-orm/relations";
import { users, projectRequests, projectInteractions } from "./schema";

export const projectRequestsRelations = relations(projectRequests, ({one}) => ({
	user: one(users, {
		fields: [projectRequests.userId],
		references: [users.id]
	}),
}));

export const usersRelations = relations(users, ({many}) => ({
	projectRequests: many(projectRequests),
	projectInteractions: many(projectInteractions),
}));

export const projectInteractionsRelations = relations(projectInteractions, ({one}) => ({
	user: one(users, {
		fields: [projectInteractions.userId],
		references: [users.id]
	}),
}));