import { db } from "./db.js";
import { eq, and, sql } from "drizzle-orm";
import { users, projectRequests, projectInteractions, verifiedProjects } from "../../drizzle/schema.js";

// Seed data for fallback / auto-seeding
const SEED_PROJECTS = [
  {
    slug: "blaze-audio-player",
    title: "Blaze Audio Player",
    description: "A free open source web audio player with advanced features directly accessible from your browser!",
    longDescription: "Blaze Audio Player is a powerful, open-source browser-based audio player built for audiophiles and casual listeners alike. It supports a wide range of audio formats, provides equalizer controls, playlist management, and a beautiful visualizer — all without any installation required.",
    imageUrl: "/blaze.png",
    category: "websites",
    technologies: ["JavaScript", "Web Audio API", "HTML5", "CSS3"],
    features: ["Supports multiple audio formats (MP3, WAV, FLAC, OGG)", "Built-in audio visualizer with customizable themes", "Playlist management with drag-and-drop support", "10-band equalizer for fine-tuned audio control"],
    highlights: ["100% browser-based — no installation needed", "Open source and free to use"],
    liveUrl: "https://blaze-audio-player.vercel.app/",
    githubUrl: null,
    status: "active",
    authorName: "Blaze & RadFlame",
    architecture: "Pure frontend application using the Web Audio API for processing and visualization.",
    timeline: "Ongoing",
    teamSize: "2 developers",
    userCount: null,
    isActive: true,
    sortOrder: 0,
  },
  {
    slug: "primebot",
    title: "PrimeBot",
    description: "PrimeBot is a sleek, multipurpose Discord bot built to supercharge your server with essential tools.",
    longDescription: "PrimeBot is a comprehensive Discord bot designed to enhance server functionality with a complete suite of moderation, entertainment, and utility features.",
    imageUrl: "/primebot.gif",
    category: "bots",
    technologies: ["discord.js", "Node.js", "PostgreSQL", "Docker", "TypeScript"],
    features: ["Dynamic giveaway system", "Interactive polls", "Advanced ticket system", "Moderation tools"],
    highlights: ["Serving 500+ Discord servers", "99.9% uptime"],
    liveUrl: "https://discord.com/oauth2/authorize?client_id=1356575287151951943&permissions=8&integration_type=0&scope=bot%20applications.commands",
    githubUrl: null,
    status: "active",
    authorName: "Team ProjectHub",
    architecture: "Multi-sharded microservices architecture with a centralized command handler.",
    timeline: "6 months development",
    teamSize: "Team ProjectHub",
    userCount: "500+ active users",
    isActive: true,
    sortOrder: 1,
  },
  {
    slug: "primebot-dashboard",
    title: "PrimeBot Dashboard",
    description: "Interactive and dynamic website with dashboard of PrimeBot discord bot.",
    longDescription: "A comprehensive web dashboard for PrimeBot that allows server administrators to configure bot settings, view analytics, and manage giveaways.",
    imageUrl: "/primebot.gif",
    category: "websites",
    technologies: ["TypeScript", "React", "Node.js", "PostgreSQL", "TailwindCSS"],
    features: ["Real-time analytics", "Giveaway management", "Role management interface"],
    highlights: ["Modern React-based dashboard", "OAuth integration with Discord"],
    liveUrl: "https://primebot-online.vercel.app",
    githubUrl: null,
    status: "developing",
    authorName: "Team ProjectHub",
    architecture: "React-based frontend with a Node.js backend.",
    timeline: "In development",
    teamSize: "Team ProjectHub",
    userCount: null,
    isActive: true,
    sortOrder: 2,
  },
  {
    slug: "sky-bot",
    title: "Sky Bot",
    description: "Collaborative task management Discord bot with real-time updates and team collaboration features.",
    longDescription: "Sky is a modern task management platform that brings teams together with real-time collaboration and advanced project tracking.",
    imageUrl: "/api/placeholder/400/300",
    category: "bots",
    technologies: ["Discord.js"],
    features: ["Real-time task editing", "Project timeline tracking", "Role-based access control"],
    highlights: ["Real-time synchronization", "Scalable architecture"],
    liveUrl: null,
    githubUrl: null,
    status: "active",
    authorName: "Raj Roy",
    architecture: null,
    timeline: "8 months development",
    teamSize: "3 developers",
    userCount: "5,000+ active teams",
    isActive: true,
    sortOrder: 3,
  },
  {
    slug: "database-dashboard",
    title: "Database Dashboard",
    description: "Online based database dashboard for your PostgreSQL.",
    longDescription: "A comprehensive web-based management tool for PostgreSQL databases with real-time query execution and schema visualization.",
    imageUrl: "/api/placeholder/400/300",
    category: "websites",
    technologies: ["TypeScript", "React", "Node.js", "PostgreSQL"],
    features: ["Real-time SQL query editor", "Schema explorer", "Data export"],
    highlights: ["Supports large-scale PostgreSQL instances", "Secure connection management"],
    liveUrl: null,
    githubUrl: "https://github.com/rajroy1313/Database-web.git",
    status: "developing",
    authorName: "Raj Roy",
    architecture: "Client-server architecture utilizing direct PostgreSQL connection protocols.",
    timeline: "Ongoing",
    teamSize: "Solo project",
    userCount: null,
    isActive: true,
    sortOrder: 4,
  },
  {
    slug: "webhost",
    title: "Webhost",
    description: "Discord bot hosting platform",
    longDescription: "A dedicated hosting platform optimized for Discord bots, providing 24/7 uptime and automated deployments.",
    imageUrl: "/api/placeholder/400/300",
    category: "websites",
    technologies: ["React", "TypeScript", "PostgreSQL", "Docker"],
    features: ["Automated deployment", "Real-time console logs", "DDoS protection"],
    highlights: ["99.9% uptime guaranteed", "Low-latency global infrastructure"],
    liveUrl: null,
    githubUrl: "https://github.com/rajroy1313/Webhost.git",
    status: "developing",
    authorName: "Raj Roy",
    architecture: null,
    timeline: "In development",
    teamSize: "Solo project",
    userCount: null,
    isActive: true,
    sortOrder: 5,
  },
];

async function ensureTableAndSeed() {
  try {
    // Try to create enums and table if they don't exist
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE project_category AS ENUM('websites', 'bots', 'utilities');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE project_status AS ENUM('active', 'developing', 'live', 'beta', 'archived');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS verified_projects (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        slug text NOT NULL,
        title text NOT NULL,
        description text NOT NULL,
        long_description text,
        image_url text,
        category project_category NOT NULL,
        technologies text[],
        features text[],
        highlights text[],
        live_url text,
        github_url text,
        status project_status NOT NULL,
        author_name text,
        author_avatar text,
        architecture text,
        timeline text,
        team_size text,
        user_count text,
        is_active boolean DEFAULT true NOT NULL,
        sort_order integer DEFAULT 0 NOT NULL,
        created_at timestamp DEFAULT now() NOT NULL,
        updated_at timestamp DEFAULT now() NOT NULL,
        CONSTRAINT verified_projects_slug_unique UNIQUE(slug)
      )
    `);

    // Check if empty and seed if so
    const count = await db.execute(sql`SELECT COUNT(*) as cnt FROM verified_projects`);
    const rowCount = parseInt(count[0]?.cnt || count.rows?.[0]?.cnt || "0", 10);

    if (rowCount === 0) {
      for (const project of SEED_PROJECTS) {
        await db.insert(verifiedProjects).values({
          ...project,
          createdAt: new Date(),
          updatedAt: new Date(),
        }).onConflictDoNothing();
      }
      console.log("Auto-seeded verified_projects table");
    }
  } catch (err) {
    console.error("ensureTableAndSeed error:", err.message);
  }
}

// Run on module load
ensureTableAndSeed();

export class DatabaseStorage {
  // User operations
  async getUser(id) {
    const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0] || null;
  }

  async getUserByEmail(email) {
    const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return result[0] || null;
  }

  async getUserBySocialId(provider, socialId) {
    const fieldMap = {
      google: users.googleId,
      discord: users.discordId,
      facebook: users.facebookId,
    };
    const field = fieldMap[provider];
    if (!field) return null;
    const result = await db.select().from(users).where(eq(field, socialId)).limit(1);
    return result[0] || null;
  }

  async getUserByResetToken(token) {
    const result = await db.select().from(users).where(eq(users.resetToken, token)).limit(1);
    return result[0] || null;
  }

  async updateUserResetToken(id, token, expiry) {
    await db.update(users).set({ resetToken: token, resetTokenExpiry: expiry, updatedAt: new Date() }).where(eq(users.id, id));
  }

  async resetUserPassword(id, hashedPassword) {
    await db.update(users).set({ password: hashedPassword, resetToken: null, resetTokenExpiry: null, updatedAt: new Date() }).where(eq(users.id, id));
  }

  async upsertUser(userData) {
    let existingUser = null;
    if (userData.id) {
      existingUser = await this.getUser(userData.id);
    } else if (userData.email) {
      existingUser = await this.getUserByEmail(userData.email);
    }

    if (existingUser) {
      const updateData = {};
      const allowedFields = ['email', 'firstName', 'lastName', 'profileImageUrl', 'password', 'googleId', 'discordId', 'facebookId', 'username', 'resetToken', 'resetTokenExpiry'];
      for (const field of allowedFields) {
        if (userData[field] !== undefined) updateData[field] = userData[field];
      }
      updateData.updatedAt = new Date();
      await db.update(users).set(updateData).where(eq(users.id, existingUser.id));
      return { ...existingUser, ...updateData };
    } else {
      const newUserData = { ...userData, createdAt: new Date(), updatedAt: new Date() };
      const result = await db.insert(users).values(newUserData).returning();
      return result[0];
    }
  }

  // Verified projects operations
  async getAllVerifiedProjects() {
    return await db.select()
      .from(verifiedProjects)
      .where(eq(verifiedProjects.isActive, true))
      .orderBy(verifiedProjects.sortOrder);
  }

  async getVerifiedProjectBySlug(slug) {
    const result = await db.select()
      .from(verifiedProjects)
      .where(and(eq(verifiedProjects.slug, slug), eq(verifiedProjects.isActive, true)))
      .limit(1);
    return result[0] || null;
  }

  // Project request operations
  async createProjectRequest(requestData) {
    const result = await db.insert(projectRequests).values({
      ...requestData,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();
    return result[0];
  }

  async getProjectRequests(userId) {
    return await db.select().from(projectRequests).where(eq(projectRequests.userId, userId));
  }

  async getAllProjectRequests() {
    return await db.select().from(projectRequests);
  }

  async updateProjectRequestStatus(id, status) {
    const result = await db.update(projectRequests)
      .set({ status: sql`${status}::project_request_status`, updatedAt: new Date() })
      .where(eq(projectRequests.id, id))
      .returning();
    return result[0] || null;
  }

  // Project interaction operations
  async getProjectInteractions(projectId) {
    const likesResult = await db.select({ count: sql`count(*)` })
      .from(projectInteractions)
      .where(and(eq(projectInteractions.projectId, projectId), eq(projectInteractions.isLiked, true)));

    const ratingResult = await db.select({ average: sql`avg(${projectInteractions.rating}::numeric)` })
      .from(projectInteractions)
      .where(and(eq(projectInteractions.projectId, projectId), sql`${projectInteractions.rating} is not null`));

    return {
      likes: parseInt(likesResult[0]?.count || "0", 10),
      averageRating: parseFloat(ratingResult[0]?.average || "0"),
    };
  }

  async getUserInteraction(projectId, userId) {
    const result = await db.select()
      .from(projectInteractions)
      .where(and(eq(projectInteractions.projectId, projectId), eq(projectInteractions.userId, userId)))
      .limit(1);
    return result[0] || null;
  }

  async upsertProjectInteraction(interactionData) {
    const existing = await this.getUserInteraction(interactionData.projectId, interactionData.userId);
    if (existing) {
      const updateData = { updatedAt: new Date() };
      if (interactionData.isLiked !== undefined) updateData.isLiked = interactionData.isLiked;
      if (interactionData.rating !== undefined) updateData.rating = interactionData.rating;
      const result = await db.update(projectInteractions).set(updateData).where(eq(projectInteractions.id, existing.id)).returning();
      return result[0];
    } else {
      const result = await db.insert(projectInteractions).values({ ...interactionData, createdAt: new Date(), updatedAt: new Date() }).returning();
      return result[0];
    }
  }
}

export const storage = new DatabaseStorage();
