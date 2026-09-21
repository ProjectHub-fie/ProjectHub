import {
  type IUser,
  type IProjectRequest,
  type IProjectInteraction,
  type InsertUser,
  type UpsertUser,
  type InsertProjectRequest,
  type InsertProjectInteraction,
  type InsertVerifiedProjectInput,
  type VerifiedProject,
} from "./../shared/schema.js";
import { db, pgClient } from "./db.js";
import { eq, and, sql } from "drizzle-orm";
import { users, projectRequests, projectInteractions, verifiedProjects } from "../drizzle/schema.js";
import seedProjects from './seed-projects.js';

// Maps a raw DB row (snake_case) to VerifiedProject (camelCase)
function mapRowToProject(r: any): VerifiedProject {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description,
    longDescription: r.long_description ?? null,
    imageUrl: r.image_url ?? null,
    category: r.category,
    technologies: r.technologies ?? null,
    features: r.features ?? null,
    highlights: r.highlights ?? null,
    liveUrl: r.live_url ?? null,
    githubUrl: r.github_url ?? null,
    status: r.status,
    authorName: r.author_name ?? null,
    authorAvatar: r.author_avatar ?? null,
    architecture: r.architecture ?? null,
    timeline: r.timeline ?? null,
    teamSize: r.team_size ?? null,
    userCount: r.user_count ?? null,
    isActive: r.is_active,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// Simple in-memory storage for development/testing when database is unavailable
class InMemoryStorage implements IStorage {
  private users: Map<string, any> = new Map();
  private projectRequests: Map<string, any> = new Map();
  private projectInteractions: Map<string, any> = new Map();
  private verifiedProjects: Map<string, any> = new Map();
  private nextId = 1;

  constructor() {
    // Load seed data
    this.loadSeedData();
  }

  private loadSeedData() {
    seedProjects.forEach(project => {
      const projectId = this.generateId();
      this.verifiedProjects.set(projectId, {
        id: projectId,
        ...project,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    });
  }

  private generateId(): string {
    return `mem_${this.nextId++}_${Date.now()}`;
  }

  // User operations
  async getUser(id: string): Promise<IUser | null> {
    return this.users.get(id) || null;
  }

  async getUserByEmail(email: string): Promise<IUser | null> {
    for (const user of this.users.values()) {
      if (user.email === email) {
        return user;
      }
    }
    return null;
  }

  async getUserBySocialId(provider: string, socialId: string): Promise<IUser | null> {
    for (const user of this.users.values()) {
      if ((provider === 'discord' && user.discordId === socialId) ||
          (provider === 'google' && user.googleId === socialId) ||
          (provider === 'facebook' && user.facebookId === socialId)) {
        return user;
      }
    }
    return null;
  }

  async getUserByResetToken(token: string): Promise<IUser | null> {
    for (const user of this.users.values()) {
      if (user.resetToken === token && user.resetTokenExpiry && new Date() < user.resetTokenExpiry) {
        return user;
      }
    }
    return null;
  }

  async updateUserResetToken(id: string, token: string, expiry: Date): Promise<void> {
    const user = this.users.get(id);
    if (user) {
      user.resetToken = token;
      user.resetTokenExpiry = expiry;
      user.updatedAt = new Date();
    }
  }

  async resetUserPassword(id: string, hashedPassword: string): Promise<void> {
    const user = this.users.get(id);
    if (user) {
      user.password = hashedPassword;
      user.resetToken = null;
      user.resetTokenExpiry = null;
      user.updatedAt = new Date();
    }
  }

  async upsertUser(userData: any): Promise<IUser> {
    let existingUser: IUser | null = null;
    
    if (userData.id) {
      existingUser = this.users.get(userData.id) || null;
    } else if (userData.email) {
      existingUser = await this.getUserByEmail(userData.email);
    }

    if (existingUser) {
      // Update existing user
      const updateData: any = { ...existingUser };
      const allowedFields = ['email', 'firstName', 'lastName', 'profileImageUrl', 'password', 'googleId', 'discordId', 'facebookId', 'username', 'resetToken', 'resetTokenExpiry'];

      for (const field of allowedFields) {
        if (userData[field] !== undefined) {
          updateData[field] = userData[field];
        }
      }

      updateData.updatedAt = new Date();
      this.users.set(existingUser.id, updateData);
      return updateData;
    } else {
      // Create new user
      const newUser: IUser = {
        id: userData.id || this.generateId(),
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        profileImageUrl: userData.profileImageUrl || null,
        googleId: userData.googleId || null,
        discordId: userData.discordId || null,
        facebookId: userData.facebookId || null,
        username: userData.username || null,
        password: userData.password || null,
        isBlocked: userData.isBlocked || false,
        resetToken: userData.resetToken || null,
        resetTokenExpiry: userData.resetTokenExpiry || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      this.users.set(newUser.id, newUser);
      return newUser;
    }
  }

  async getAllVerifiedProjects(): Promise<VerifiedProject[]> {
    try {
      const rows = await withTimeout(
        pgClient`SELECT * FROM verified_projects WHERE is_active = true ORDER BY sort_order`
      );
      if (rows.length === 0 && this.fallbackProjects.size > 0) {
        return Array.from(this.fallbackProjects.values())
          .filter(project => project.isActive)
          .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      }
      return rows.map(mapRowToProject);
    } catch (error: any) {
      console.error('getAllVerifiedProjects error:', error.message);
      return Array.from(this.fallbackProjects.values())
        .filter(project => project.isActive)
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    }
  }

  async getVerifiedProjectBySlug(slug: string): Promise<VerifiedProject | null> {
    try {
      const rows = await withTimeout(
        pgClient`SELECT * FROM verified_projects WHERE slug = ${slug} AND is_active = true LIMIT 1`
      );
      if (rows.length === 0) {
        return this.fallbackProjects.get(slug) || null;
      }
      return mapRowToProject(rows[0]);
    } catch (error: any) {
      console.error('getVerifiedProjectBySlug error:', error.message);
      return this.fallbackProjects.get(slug) || null;
    }
  }

  async createVerifiedProject(projectData: InsertVerifiedProjectInput): Promise<VerifiedProject> {
    const newProject: VerifiedProject = {
      id: this.generateId(),
      slug: projectData.slug,
      title: projectData.title,
      description: projectData.description,
      longDescription: projectData.longDescription || null,
      imageUrl: projectData.imageUrl || null,
      category: projectData.category,
      technologies: projectData.technologies || [],
      features: projectData.features || [],
      highlights: projectData.highlights || [],
      liveUrl: projectData.liveUrl || null,
      githubUrl: projectData.githubUrl || null,
      status: projectData.status,
      authorName: projectData.authorName || null,
      authorAvatar: projectData.authorAvatar || null,
      architecture: projectData.architecture || null,
      timeline: projectData.timeline || null,
      teamSize: projectData.teamSize || null,
      userCount: projectData.userCount || null,
      isActive: projectData.isActive !== undefined ? projectData.isActive : true,
      sortOrder: projectData.sortOrder || 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    this.verifiedProjects.set(newProject.id, newProject);
    return newProject;
  }

  async updateVerifiedProject(id: string, projectData: Partial<InsertVerifiedProjectInput>): Promise<VerifiedProject | null> {
    const project = this.verifiedProjects.get(id);
    if (project) {
      Object.assign(project, projectData, { updatedAt: new Date() });
      return project;
    }
    return null;
  }

  async deleteVerifiedProject(id: string): Promise<boolean> {
    return this.verifiedProjects.delete(id);
  }

  // Project request operations
  async createProjectRequest(requestData: InsertProjectRequest): Promise<IProjectRequest> {
    try {
      const result = await withTimeout(
        db.insert(projectRequests).values({
          userId: requestData.userId,
          title: requestData.title,
          description: requestData.description,
          budget: requestData.budget,
          timeline: requestData.timeline,
          technologies: requestData.technologies,
          status: 'pending',
          createdAt: new Date(),
          updatedAt: new Date(),
        }).returning()
      );
      return result[0];
    } catch (error: any) {
      console.error('createProjectRequest error:', error.message);
      if (error.message?.includes('timeout')) {
        throw new Error('Database timeout');
      }
      throw error;
    }
  }

  async getProjectRequests(userId: string): Promise<IProjectRequest[]> {
    return Array.from(this.projectRequests.values()).filter(req => req.userId === userId);
  }

  async getAllProjectRequests(): Promise<IProjectRequest[]> {
    return Array.from(this.projectRequests.values());
  }

  async updateProjectRequestStatus(id: string, status: string): Promise<IProjectRequest | null> {
    const request = this.projectRequests.get(id);
    if (request) {
      request.status = status as any;
      request.updatedAt = new Date();
      return request;
    }
    return null;
  }

  // Project interaction operations
  async getProjectInteractions(projectId: string): Promise<{ likes: number, averageRating: number }> {
    const interactions = Array.from(this.projectInteractions.values()).filter(
      interaction => interaction.projectId === projectId
    );
    
    const likes = interactions.filter(i => i.isLiked).length;
    const ratings = interactions.filter(i => i.rating !== null).map(i => i.rating);
    const averageRating = ratings.length > 0 
      ? ratings.reduce((sum, rating) => sum + (rating || 0), 0) / ratings.length 
      : 0;
    
    return { likes, averageRating };
  }

  async getUserInteraction(projectId: string, userId: string): Promise<IProjectInteraction | null> {
    for (const interaction of this.projectInteractions.values()) {
      if (interaction.projectId === projectId && interaction.userId === userId) {
        return interaction;
      }
    }
    return null;
  }

  async upsertProjectInteraction(interactionData: InsertProjectInteraction): Promise<IProjectInteraction> {
    const existing = await this.getUserInteraction(interactionData.projectId, interactionData.userId);

    if (existing) {
      existing.isLiked = interactionData.isLiked !== undefined ? interactionData.isLiked : existing.isLiked;
      existing.rating = interactionData.rating !== undefined ? interactionData.rating : existing.rating;
      existing.updatedAt = new Date();
      return existing;
    } else {
      const newInteraction: IProjectInteraction = {
        id: this.generateId(),
        projectId: interactionData.projectId,
        userId: interactionData.userId,
        isLiked: interactionData.isLiked || false,
        rating: interactionData.rating || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      this.projectInteractions.set(newInteraction.id, newInteraction);
      return newInteraction;
    }
  }
}

// Utility function to add timeout to database operations
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number = 5000): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Database operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

// Update the IStorage interface to include missing methods
export interface IStorage {
  // User operations
  getUser(id: string): Promise<IUser | null>;
  getUserByEmail(email: string): Promise<IUser | null>;
  getUserBySocialId(provider: string, socialId: string): Promise<IUser | null>;
  getUserByResetToken(token: string): Promise<IUser | null>;
  upsertUser(user: UpsertUser): Promise<IUser>;
  updateUserResetToken(id: string, token: string, expiry: Date): Promise<void>;
  resetUserPassword(id: string, hashedPassword: string): Promise<void>;
  
  // Verified projects operations
  getAllVerifiedProjects(): Promise<VerifiedProject[]>;
  getVerifiedProjectBySlug(slug: string): Promise<VerifiedProject | null>;
  createVerifiedProject(project: InsertVerifiedProjectInput): Promise<VerifiedProject>;
  updateVerifiedProject(id: string, project: Partial<InsertVerifiedProjectInput>): Promise<VerifiedProject | null>;
  deleteVerifiedProject(id: string): Promise<boolean>;

  // Project interaction operations
  getProjectInteractions(projectId: string): Promise<{ likes: number, averageRating: number }>;
  upsertProjectInteraction(interaction: InsertProjectInteraction): Promise<IProjectInteraction>;
  getUserInteraction(projectId: string, userId: string): Promise<IProjectInteraction | null>;
}

export class DatabaseStorage implements IStorage {
  private fallbackProjects: Map<string, any> = new Map();

  constructor() {
    seedProjects.forEach(project => {
      this.fallbackProjects.set(project.slug, {
        ...project,
        id: crypto.randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date()
      });
    });
  }

  // User operations
  async getUser(id: string): Promise<IUser | null> {
    try {
      const result = await withTimeout(
        db.select().from(users).where(eq(users.id, id)).limit(1)
      );
      return result[0] || null;
    } catch (error: any) {
      console.error('getUser error:', error.message);
      if (error.message?.includes('timeout')) {
        throw new Error('Database timeout');
      }
      throw error;
    }
  }

  async getUserByEmail(email: string): Promise<IUser | null> {
    try {
      const result = await withTimeout(
        db.select().from(users).where(eq(users.email, email)).limit(1)
      );
      return result[0] || null;
    } catch (error: any) {
      console.error('getUserByEmail error:', error.message);
      if (error.message?.includes('timeout')) {
        throw new Error('Database timeout');
      }
      throw error;
    }
  }

  async getUserBySocialId(provider: string, socialId: string): Promise<IUser | null> {
    try {
      const fieldMap: { [key: string]: any } = {
        google: users.googleId,
        discord: users.discordId,
        facebook: users.facebookId,
      };

      const field = fieldMap[provider];
      if (!field) return null;

      const result = await withTimeout(
        db.select().from(users).where(eq(field, socialId)).limit(1)
      );
      return result[0] || null;
    } catch (error: any) {
      console.error('getUserBySocialId error:', error.message);
      if (error.message?.includes('timeout')) {
        throw new Error('Database timeout');
      }
      throw error;
    }
  }

  async getUserByResetToken(token: string): Promise<IUser | null> {
    try {
      const result = await withTimeout(
        db.select().from(users).where(eq(users.resetToken, token)).limit(1)
      );
      return result[0] || null;
    } catch (error: any) {
      console.error('getUserByResetToken error:', error.message);
      if (error.message?.includes('timeout')) {
        throw new Error('Database timeout');
      }
      throw error;
    }
  }

  async updateUserResetToken(id: string, token: string, expiry: Date): Promise<void> {
    try {
      await withTimeout(
        db.update(users).set({
          resetToken: token,
          resetTokenExpiry: expiry,
          updatedAt: new Date(),
        }).where(eq(users.id, id))
      );
    } catch (error: any) {
      console.error('updateUserResetToken error:', error.message);
      if (error.message?.includes('timeout')) {
        throw new Error('Database timeout');
      }
      throw error;
    }
  }

  async resetUserPassword(id: string, hashedPassword: string): Promise<void> {
    try {
      await withTimeout(
        db.update(users).set({
          password: hashedPassword,
          resetToken: null,
          resetTokenExpiry: null,
          updatedAt: new Date(),
        }).where(eq(users.id, id))
      );
    } catch (error: any) {
      console.error('resetUserPassword error:', error.message);
      if (error.message?.includes('timeout')) {
        throw new Error('Database timeout');
      }
      throw error;
    }
  }

  async upsertUser(userData: any): Promise<IUser> {
    try {
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
        const allowedFields = ['email', 'firstName', 'lastName', 'profileImageUrl', 'password', 'googleId', 'discordId', 'facebookId', 'username', 'resetToken', 'resetTokenExpiry'];

        for (const field of allowedFields) {
          if (userData[field] !== undefined) {
            updateData[field] = userData[field];
          }
        }

        updateData.updatedAt = new Date();

        await withTimeout(
          db.update(users).set(updateData).where(eq(users.id, existingUser.id))
        );
        return { ...existingUser, ...updateData };
      } else {
        // Create new user
        const newUserData = {
          ...userData,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        const result = await withTimeout(
          db.insert(users).values(newUserData).returning()
        );
        return result[0];
      }
    } catch (error: any) {
      console.error('upsertUser error:', error.message);
      if (error.message?.includes('timeout')) {
        throw new Error('Database timeout');
      }
      throw error;
    }
  }

  // Verified projects operations
  async getAllVerifiedProjects(): Promise<VerifiedProject[]> {
    try {
      const rows = await withTimeout(
        pgClient`SELECT * FROM verified_projects WHERE is_active = true ORDER BY sort_order`
      );
      return rows.map(mapRowToProject);
    } catch (error: any) {
      console.error('getAllVerifiedProjects error:', error.message);
      throw error;
    }
  }

  async getVerifiedProjectBySlug(slug: string): Promise<VerifiedProject | null> {
    try {
      const rows = await withTimeout(
        pgClient`SELECT * FROM verified_projects WHERE slug = ${slug} AND is_active = true LIMIT 1`
      );
      return rows.length > 0 ? mapRowToProject(rows[0]) : null;
    } catch (error: any) {
      console.error('getVerifiedProjectBySlug error:', error.message);
      throw error;
    }
  }

  async createVerifiedProject(projectData: InsertVerifiedProjectInput): Promise<VerifiedProject> {
    try {
      const result = await withTimeout(
        db.insert(verifiedProjects)
          .values({
            ...projectData,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning()
      );
      return result[0];
    } catch (error: any) {
      console.error('createVerifiedProject error:', error.message);
      if (error.message?.includes('timeout')) {
        throw new Error('Database timeout');
      }
      throw error;
    }
  }

  async updateVerifiedProject(id: string, projectData: Partial<InsertVerifiedProjectInput>): Promise<VerifiedProject | null> {
    try {
      const result = await withTimeout(
        db.update(verifiedProjects)
          .set({ ...projectData, updatedAt: new Date() })
          .where(eq(verifiedProjects.id, id))
          .returning()
      );
      return result[0] || null;
    } catch (error: any) {
      console.error('updateVerifiedProject error:', error.message);
      if (error.message?.includes('timeout')) {
        throw new Error('Database timeout');
      }
      throw error;
    }
  }

  async deleteVerifiedProject(id: string): Promise<boolean> {
    try {
      const result = await withTimeout(
        db.delete(verifiedProjects)
          .where(eq(verifiedProjects.id, id))
          .returning()
      );
      return result.length > 0;
    } catch (error: any) {
      console.error('deleteVerifiedProject error:', error.message);
      if (error.message?.includes('timeout')) {
        throw new Error('Database timeout');
      }
      throw error;
    }
  }

  // Project request operations
  async createProjectRequest(requestData: InsertProjectRequest): Promise<IProjectRequest> {
    try {
      const result = await withTimeout(
        db.insert(projectRequests).values({
          userId: requestData.userId,
          title: requestData.title,
          description: requestData.description || null,
          budget: requestData.budget || null,
          timeline: requestData.timeline || null,
          technologies: requestData.technologies || null,
          status: 'pending',
          createdAt: new Date(),
          updatedAt: new Date(),
        }).returning()
      );
      return result[0];
    } catch (error: any) {
      console.error('createProjectRequest error:', error.message);
      if (error.message?.includes('timeout')) {
        throw new Error('Database timeout');
      }
      throw error;
    }
  }

  async getProjectRequests(userId: string): Promise<IProjectRequest[]> {
    try {
      return await withTimeout(
        db.select().from(projectRequests).where(eq(projectRequests.userId, userId))
      );
    } catch (error: any) {
      console.error('getProjectRequests error:', error.message);
      if (error.message?.includes('timeout')) {
        throw new Error('Database timeout');
      }
      throw error;
    }
  }

  async getAllProjectRequests(): Promise<IProjectRequest[]> {
    try {
      return await withTimeout(db.select().from(projectRequests));
    } catch (error: any) {
      console.error('getAllProjectRequests error:', error.message);
      if (error.message?.includes('timeout')) {
        throw new Error('Database timeout');
      }
      throw error;
    }
  }

  async updateProjectRequestStatus(id: string, status: string): Promise<IProjectRequest | null> {
    try {
      const result = await withTimeout(
        db.update(projectRequests)
          .set({ 
            status: sql`${status}::project_request_status`, 
            updatedAt: new Date() 
          })
          .where(eq(projectRequests.id, id))
          .returning()
      );
      return result[0] || null;
    } catch (error: any) {
      console.error('updateProjectRequestStatus error:', error.message);
      if (error.message?.includes('timeout')) {
        throw new Error('Database timeout');
      }
      throw error;
    }
  }

  // Project interaction operations
  async getProjectInteractions(projectId: string): Promise<{ likes: number, averageRating: number }> {
    try {
      const [likesResult, ratingResult] = await Promise.all([
        withTimeout(
          db.select({ count: sql<string>`count(*)` })
            .from(projectInteractions)
            .where(and(
              eq(projectInteractions.projectId, projectId),
              eq(projectInteractions.isLiked, true)
            ))
        ),
        withTimeout(
          db.select({ average: sql<string>`avg(${projectInteractions.rating}::numeric)` })
            .from(projectInteractions)
            .where(and(
              eq(projectInteractions.projectId, projectId),
              sql`${projectInteractions.rating} is not null`
            ))
        )
      ]);

      return {
        likes: parseInt(likesResult[0]?.count || "0", 10),
        averageRating: parseFloat(ratingResult[0]?.average || "0"),
      };
    } catch (error: any) {
      console.error('getProjectInteractions error:', error.message);
      if (error.message?.includes('timeout')) {
        throw new Error('Database timeout');
      }
      throw error;
    }
  }

  async getUserInteraction(projectId: string, userId: string): Promise<IProjectInteraction | null> {
    try {
      const result = await withTimeout(
        db.select()
          .from(projectInteractions)
          .where(and(
            eq(projectInteractions.projectId, projectId),
            eq(projectInteractions.userId, userId)
          ))
          .limit(1)
      );
      return result[0] || null;
    } catch (error: any) {
      console.error('getUserInteraction error:', error.message);
      if (error.message?.includes('timeout')) {
        throw new Error('Database timeout');
      }
      throw error;
    }
  }

  async upsertProjectInteraction(interactionData: InsertProjectInteraction): Promise<IProjectInteraction> {
    try {
      const existing = await this.getUserInteraction(interactionData.projectId, interactionData.userId);

      if (existing) {
        const updateData: any = { updatedAt: new Date() };
        if (interactionData.isLiked !== undefined) updateData.isLiked = interactionData.isLiked;
        if (interactionData.rating !== undefined) updateData.rating = interactionData.rating;

        const result = await withTimeout(
          db.update(projectInteractions)
            .set(updateData)
            .where(eq(projectInteractions.id, existing.id))
            .returning()
        );
        return result[0];
      } else {
        const result = await withTimeout(
          db.insert(projectInteractions)
            .values({
              ...interactionData,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .returning()
        );
        return result[0];
      }
    } catch (error: any) {
      console.error('upsertProjectInteraction error:', error.message);
      if (error.message?.includes('timeout')) {
        throw new Error('Database timeout');
      }
      throw error;
    }
  }
}

// Export storage instance with fallback to in-memory storage when database fails
let storage: IStorage;

// For tsx -e or environments that struggle with top-level await in certain contexts,
// we provide a way to get the storage instance asynchronously.
// In the main app (ESM), top-level await is used for the export.

const dbStorage = new DatabaseStorage();
try {
  // Test database connection using raw client (more reliable, no Drizzle ORM overhead)
  await withTimeout(pgClient`SELECT 1`, 5000);
  console.log('✅ Database storage initialized successfully');
  storage = dbStorage;
} catch (error: any) {
  console.warn('⚠️ Database storage failed, falling back to in-memory storage:', error.message);
  storage = new InMemoryStorage();
}

export { storage };