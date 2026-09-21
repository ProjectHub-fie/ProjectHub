import { eq, sql } from "drizzle-orm";
import { db } from "./db.js";
import {
  users,
  adminCredentials,
  projectRequests,
  verifiedProjects,
} from "../drizzle/schema.js";

/**
 * Storage used exclusively by the /pbad administration dashboard.
 *
 * Kept separate from the public `storage` so the shared public API surface stays
 * unchanged while administrators get the extra reads/writes they need.
 */
export const adminStorage = {
  async getAdminByPin(pin: string) {
    const result = await db.select().from(adminCredentials).where(eq(adminCredentials.pin, pin)).limit(1);
    return result[0] || null;
  },

  async getAllAdmins() {
    return await db.select().from(adminCredentials);
  },

  async setAdminPassword(pin: string, email: string | null, hash: string, role: string = "moderator") {
    const [existing] = await db
      .select()
      .from(adminCredentials)
      .where(eq(adminCredentials.pin, pin))
      .limit(1);

    if (existing) {
      await db.update(adminCredentials)
        .set({
          passwordHash: hash,
          email: email || existing.email,
          role,
          updatedAt: new Date(),
        })
        .where(eq(adminCredentials.id, existing.id));
      return;
    }

    await db.insert(adminCredentials).values({
      pin,
      email: email || null,
      passwordHash: hash,
      role,
    });
  },

  async deleteAdmin(id: string) {
    await db.delete(adminCredentials).where(eq(adminCredentials.id, id));
  },

  async updateAdminRole(id: string, role: string) {
    await db.update(adminCredentials).set({ role }).where(eq(adminCredentials.id, id));
  },

  // Credential material (password hash, reset token) never leaves the server,
  // even for an authenticated dashboard session.
  async getAllUsers() {
    return await db
      .select({
        id: users.id,
        email: users.email,
        username: users.username,
        firstName: users.firstName,
        lastName: users.lastName,
        profileImageUrl: users.profileImageUrl,
        isBlocked: users.isBlocked,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users);
  },

  async toggleUserBlock(id: string) {
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) throw new Error("User not found");

    const [updated] = await db.update(users)
      .set({ isBlocked: !user.isBlocked, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({
        id: users.id,
        email: users.email,
        username: users.username,
        firstName: users.firstName,
        lastName: users.lastName,
        profileImageUrl: users.profileImageUrl,
        isBlocked: users.isBlocked,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      });
    return updated;
  },

  async deleteUser(id: string) {
    await db.delete(users).where(eq(users.id, id));
  },

  async getAllProjectRequests() {
    return await db.select().from(projectRequests);
  },

  async updateProjectRequestStatus(id: string, status: string) {
    const [updated] = await db.update(projectRequests)
      .set({ status: sql`${status}::project_request_status`, updatedAt: new Date() })
      .where(eq(projectRequests.id, id))
      .returning();
    return updated || null;
  },

  async deleteProjectRequest(id: string) {
    await db.delete(projectRequests).where(eq(projectRequests.id, id));
  },

  async getAllVerifiedProjectsIncludingInactive() {
    return await db.select().from(verifiedProjects).orderBy(verifiedProjects.sortOrder, verifiedProjects.createdAt);
  },

  async createVerifiedProject(projectData: any) {
    const [created] = await db.insert(verifiedProjects).values({
      ...projectData,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();
    return created;
  },

  async updateVerifiedProject(id: string, data: any) {
    const [updated] = await db.update(verifiedProjects)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(verifiedProjects.id, id))
      .returning();
    return updated || null;
  },

  async deleteVerifiedProject(id: string) {
    await db.delete(verifiedProjects).where(eq(verifiedProjects.id, id));
  },
};