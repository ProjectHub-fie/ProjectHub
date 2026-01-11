import {
  users,
  projectRequests,
  type User,
  type UpsertUser,
  type InsertProjectRequest,
  type ProjectRequest,
} from "./../shared/schema.js";
import { db } from "./db.js";
import { eq } from "drizzle-orm";


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
  getAllUsers(): Promise<User[]>;
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
      // Update existing user
      await db
        .update(users)
        .set({
          ...userData,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existingUser.id));
      
      return existingUser;
    } else {
      // Generate ID if not provided
      const userId = userData.id || (await import("crypto")).randomUUID();
      
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
    const { randomUUID } = await import("crypto");
    const requestId = randomUUID();
    
    const requestWithId = {
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

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users);
  }
}

export const storage = new DatabaseStorage();
