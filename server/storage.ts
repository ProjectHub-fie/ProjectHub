import {
  users,
  projectRequests,
  projectInteractions,
  type User,
  type UpsertUser,
  type InsertProjectRequest,
  type ProjectRequest,
  type ProjectInteraction,
  type InsertProjectInteraction,
} from "./../shared/schema.js";
import { db } from "./db.js";
import { eq, and, avg, count, sql } from "drizzle-orm";
import crypto from "crypto";


export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserBySocialId(provider: string, socialId: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  
  // Project request operations
  createProjectRequest(request: InsertProjectRequest): Promise<ProjectRequest>;
  getProjectRequests(userId: string): Promise<ProjectRequest[]>;
  getAllProjectRequests(): Promise<ProjectRequest[]>;
  updateProjectRequestStatus(id: string, status: string): Promise<ProjectRequest>;

  // Project interaction operations
  getProjectInteractions(projectId: string): Promise<{ likes: number, averageRating: number }>;
  upsertProjectInteraction(interaction: InsertProjectInteraction): Promise<ProjectInteraction>;
  getUserInteraction(projectId: string, userId: string): Promise<ProjectInteraction | undefined>;
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserBySocialId(provider: string, socialId: string): Promise<User | undefined> {
    let whereCondition;
    switch (provider) {
      case 'google':
        whereCondition = eq(users.googleId, socialId);
        break;
      case 'discord':
        whereCondition = eq(users.discordId, socialId);
        break;
      case 'facebook':
        whereCondition = eq(users.facebookId, socialId);
        break;
      default:
        return undefined;
    }
    
    const [user] = await db.select().from(users).where(whereCondition);
    return user;
  }

  async getUserByResetToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.resetToken, token));
    return user;
  }

  async updateUserResetToken(id: string, token: string, expiry: Date): Promise<void> {
    await db
      .update(users)
      .set({
        resetToken: token,
        resetTokenExpiry: expiry,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));
  }

  async resetUserPassword(id: string, hashedPassword: string): Promise<void> {
    await db
      .update(users)
      .set({
        password: hashedPassword,
        resetToken: null,
        resetTokenExpiry: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));
  }

  async upsertUser(userData: any): Promise<User> {
    // Check if user exists by email if ID is not provided
    let existingUser: User | undefined;
    if (userData.id) {
      existingUser = await this.getUser(userData.id);
    } else if (userData.email) {
      existingUser = await this.getUserByEmail(userData.email);
    }
    
    if (existingUser) {
      // Filter out null/undefined values and only include fields that exist in the schema
      const updateData: any = {};
      const allowedFields = ['email', 'firstName', 'lastName', 'profileImageUrl', 'password', 'googleId', 'discordId', 'facebookId', 'username', 'resetToken', 'resetTokenExpiry'];
      
      for (const field of allowedFields) {
        if (userData[field] !== undefined) {
          updateData[field] = userData[field];
        }
      }

      console.log('Updating user profile with data:', { id: existingUser.id, ...updateData });

      // Update existing user
      const [updatedUser] = await db
        .update(users)
        .set({
          ...updateData,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existingUser.id))
        .returning();
      
      console.log('User profile updated successfully:', { id: updatedUser.id, profileImageUrl: updatedUser.profileImageUrl ? 'exists' : 'null' });
      return updatedUser;
    } else {
      // Generate ID if not provided
      const userId = userData.id || crypto.randomUUID();
      
      const userWithId = {
        ...userData,
        id: userId
      };
      
      const [newUser] = await db.insert(users).values(userWithId).returning();
      return newUser;
    }
  }

  // Project request operations
  async createProjectRequest(requestData: InsertProjectRequest): Promise<ProjectRequest> {
    // Generate a UUID for the request
    const requestId = crypto.randomUUID();
    
    const requestWithId: any = {
      ...requestData,
      id: requestId
    };
    
    await db.insert(projectRequests).values(requestWithId);
    
    // Return the created request
    const [createdRequest] = await db
      .select()
      .from(projectRequests)
      .where(eq(projectRequests.id, requestId));
    return createdRequest;
  }

  async getProjectRequests(userId: string): Promise<ProjectRequest[]> {
    return db.select().from(projectRequests).where(eq(projectRequests.userId, userId));
  }

  async getAllProjectRequests(): Promise<ProjectRequest[]> {
    return db.select().from(projectRequests);
  }

  async updateProjectRequestStatus(id: string, status: string): Promise<ProjectRequest> {
    await db
      .update(projectRequests)
      .set({ status, updatedAt: new Date() })
      .where(eq(projectRequests.id, id));
    
    // Return the updated request
    const [updatedRequest] = await db
      .select()
      .from(projectRequests)
      .where(eq(projectRequests.id, id));
    return updatedRequest;
  }

  // Project interaction operations
  async getProjectInteractions(projectId: string): Promise<{ likes: number, averageRating: number }> {
    const likesResult = await db.select({ value: count() }).from(projectInteractions).where(and(eq(projectInteractions.projectId, projectId), eq(projectInteractions.isLiked, "true")));
    const ratingResult = await db.select({ value: avg(sql`CAST(${projectInteractions.rating} AS DECIMAL)`) }).from(projectInteractions).where(eq(projectInteractions.projectId, projectId));
    
    return {
      likes: Number(likesResult[0]?.value || 0),
      averageRating: Number(ratingResult[0]?.value || 0),
    };
  }

  async getUserInteraction(projectId: string, userId: string): Promise<ProjectInteraction | undefined> {
    const [interaction] = await db.select().from(projectInteractions).where(and(eq(projectInteractions.projectId, projectId), eq(projectInteractions.userId, userId)));
    return interaction;
  }

  async upsertProjectInteraction(interactionData: InsertProjectInteraction): Promise<ProjectInteraction> {
    const existing = await this.getUserInteraction(interactionData.projectId, interactionData.userId);
    
    if (existing) {
      const [updated] = await db
        .update(projectInteractions)
        .set({
          isLiked: interactionData.isLiked !== undefined ? interactionData.isLiked : existing.isLiked,
          rating: interactionData.rating !== undefined ? interactionData.rating : existing.rating,
          updatedAt: new Date(),
        })
        .where(eq(projectInteractions.id, existing.id))
        .returning();
      return updated;
    } else {
      const [inserted] = await db.insert(projectInteractions).values({
        ...interactionData,
        id: crypto.randomUUID(),
      }).returning();
      return inserted;
    }
  }
}

export const storage = new DatabaseStorage();
