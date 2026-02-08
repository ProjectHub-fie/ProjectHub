import { z } from "zod";
import { createInsertSchema } from "drizzle-zod";
import { users, projectRequests, projectInteractions } from '../drizzle/schema.ts';
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
    isBlocked: z.boolean().optional(),
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
