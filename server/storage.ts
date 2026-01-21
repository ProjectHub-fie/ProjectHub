import {
  type IUser,
  type IProjectRequest,
  type IProjectInteraction,
  type InsertUser,
  type UpsertUser,
  type InsertProjectRequest,
  type InsertProjectInteraction,
} from "./../shared/schema.js";
import { db } from "./db.js";
import { eq, and, sql } from "drizzle-orm";
import { users, projectRequests, projectInteractions } from "../drizzle/schema.js";


export interface IStorage {
  // User operations
  getUser(id: string): Promise<IUser | null>;
  getUserByEmail(email: string): Promise<IUser | null>;
  getUserBySocialId(provider: string, socialId: string): Promise<IUser | null>;
  upsertUser(user: UpsertUser): Promise<IUser>;
  getAllUsers(): Promise<IUser[]>;
  toggleUserBlock(id: string): Promise<IUser>;
  
  // Project request operations
  createProjectRequest(request: InsertProjectRequest): Promise<IProjectRequest>;
  getProjectRequests(userId: string): Promise<IProjectRequest[]>;
  getAllProjectRequests(): Promise<IProjectRequest[]>;
  updateProjectRequestStatus(id: string, status: string): Promise<IProjectRequest | null>;
  deleteProjectRequest(id: string): Promise<void>;

  // Project interaction operations
  getProjectInteractions(projectId: string): Promise<{ likes: number, averageRating: number }>;
  upsertProjectInteraction(interaction: InsertProjectInteraction): Promise<IProjectInteraction>;
  getUserInteraction(projectId: string, userId: string): Promise<IProjectInteraction | null>;
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<IUser | null> {
    const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0] || null;
  }

  async getUserByEmail(email: string): Promise<IUser | null> {
    const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return result[0] || null;
  }

  async getUserBySocialId(provider: string, socialId: string): Promise<IUser | null> {
    const fieldMap: { [key: string]: any } = {
      google: users.googleId,
      discord: users.discordId,
      facebook: users.facebookId,
    };

    const field = fieldMap[provider];
    if (!field) return null;

    const result = await db.select().from(users).where(eq(field, socialId)).limit(1);
    return result[0] || null;
  }

  async getUserByResetToken(token: string): Promise<IUser | null> {
    const result = await db.select().from(users).where(eq(users.resetToken, token)).limit(1);
    return result[0] || null;
  }

  async updateUserResetToken(id: string, token: string, expiry: Date): Promise<void> {
    await db.update(users).set({
      resetToken: token,
      resetTokenExpiry: expiry,
      updatedAt: new Date(),
    }).where(eq(users.id, id));
  }

  async resetUserPassword(id: string, hashedPassword: string): Promise<void> {
    await db.update(users).set({
      password: hashedPassword,
      resetToken: null,
      resetTokenExpiry: null,
      updatedAt: new Date(),
    }).where(eq(users.id, id));
  }

  async upsertUser(userData: any): Promise<IUser> {
    // For upsert, we'll try to insert, and if conflict on email or id, update
    // But since id is uuid, and email is unique, we need to handle carefully
    // For simplicity, check if exists first
    let existingUser: IUser | null = null;
    if (userData.id) {
      existingUser = await this.getUser(userData.id);
    } else if (userData.email) {
      existingUser = await this.getUserByEmail(userData.email);
    }

    if (existingUser) {
      // Update existing user
      const updateData: any = {};
      const allowedFields = ['email', 'firstName', 'lastName', 'profileImageUrl', 'password', 'googleId', 'discordId', 'facebookId', 'username', 'resetToken', 'resetTokenExpiry', 'isAdmin', 'isBlocked'];

      for (const field of allowedFields) {
        if (userData[field] !== undefined) {
          updateData[field] = userData[field];
        }
      }

      updateData.updatedAt = new Date();

      await db.update(users).set(updateData).where(eq(users.id, existingUser.id));
      return { ...existingUser, ...updateData };
    } else {
      // Create new user
      const newUserData = {
        ...userData,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const result = await db.insert(users).values(newUserData).returning();
      return result[0];
    }
  }

  async getAllUsers(): Promise<IUser[]> {
    return await db.select().from(users);
  }

  async toggleUserBlock(id: string): Promise<IUser> {
    const user = await this.getUser(id);
    if (!user) throw new Error("User not found");
    const result = await db.update(users)
      .set({ isBlocked: !user.isBlocked, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return result[0];
  }

  // Project request operations
  async createProjectRequest(requestData: InsertProjectRequest): Promise<IProjectRequest> {
    const result = await db.insert(projectRequests).values({
      ...requestData,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();
    return result[0];
  }

  async getProjectRequests(userId: string): Promise<IProjectRequest[]> {
    return await db.select().from(projectRequests).where(eq(projectRequests.userId, userId));
  }

  async getAllProjectRequests(): Promise<IProjectRequest[]> {
    return await db.select().from(projectRequests);
  }

  async updateProjectRequestStatus(id: string, status: string): Promise<IProjectRequest | null> {
    const result = await db.update(projectRequests)
      .set({ 
        status: sql`${status}::project_request_status`, 
        updatedAt: new Date() 
      })
      .where(eq(projectRequests.id, id))
      .returning();
    return result[0] || null;
  }

  async deleteProjectRequest(id: string): Promise<void> {
    await db.delete(projectRequests).where(eq(projectRequests.id, id));
  }

  // Project interaction operations
  async getProjectInteractions(projectId: string): Promise<{ likes: number, averageRating: number }> {
    const likesResult = await db.select({ count: sql<string>`count(*)` })
      .from(projectInteractions)
      .where(and(
        eq(projectInteractions.projectId, projectId),
        eq(projectInteractions.isLiked, true)
      ));

    const ratingResult = await db.select({ average: sql<string>`avg(${projectInteractions.rating})` })
      .from(projectInteractions)
      .where(and(
        eq(projectInteractions.projectId, projectId),
        sql`${projectInteractions.rating} is not null`
      ));

    return {
      likes: parseInt(likesResult[0]?.count || "0", 10),
      averageRating: parseFloat(ratingResult[0]?.average || "0"),
    };
  }

  async getUserInteraction(projectId: string, userId: string): Promise<IProjectInteraction | null> {
    const result = await db.select()
      .from(projectInteractions)
      .where(and(
        eq(projectInteractions.projectId, projectId),
        eq(projectInteractions.userId, userId)
      ))
      .limit(1);
    return result[0] || null;
  }

  async upsertProjectInteraction(interactionData: InsertProjectInteraction): Promise<IProjectInteraction> {
    const existing = await this.getUserInteraction(interactionData.projectId, interactionData.userId);

    if (existing) {
      const updateData: any = { updatedAt: new Date() };
      if (interactionData.isLiked !== undefined) updateData.isLiked = interactionData.isLiked;
      if (interactionData.rating !== undefined) updateData.rating = interactionData.rating;

      const result = await db.update(projectInteractions)
        .set(updateData)
        .where(eq(projectInteractions.id, existing.id))
        .returning();
      return result[0];
    } else {
      const result = await db.insert(projectInteractions)
        .values({
          ...interactionData,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      return result[0];
    }
  }
}

export const storage = new DatabaseStorage();
