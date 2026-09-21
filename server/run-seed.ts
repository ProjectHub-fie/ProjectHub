import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { verifiedProjects } from '../drizzle/schema.js';
import { eq } from 'drizzle-orm';
import seedProjects from './seed-projects.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL must be set");

const client = postgres(databaseUrl, { ssl: { rejectUnauthorized: false }, max: 1 });
const db = drizzle(client, { schema: { verifiedProjects } });

async function seed() {
  console.log(`Seeding ${seedProjects.length} projects...`);

  for (const project of seedProjects) {
    try {
      const data: any = {
        slug: project.slug,
        title: project.title,
        description: project.description,
        longDescription: project.longDescription ?? null,
        imageUrl: project.imageUrl ?? null,
        category: project.category as any,
        technologies: project.technologies ?? [],
        features: project.features ?? [],
        highlights: project.highlights ?? [],
        liveUrl: (project as any).liveUrl ?? null,
        githubUrl: (project as any).githubUrl ?? null,
        status: project.status as any,
        authorName: project.authorName ?? null,
        authorAvatar: null,
        architecture: project.architecture ?? null,
        timeline: project.timeline ?? null,
        teamSize: project.teamSize ?? null,
        userCount: (project as any).userCount ?? null,
        isActive: project.isActive,
        sortOrder: project.sortOrder,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Check if exists
      const existing = await db.select({ id: verifiedProjects.id })
        .from(verifiedProjects)
        .where(eq(verifiedProjects.slug, project.slug))
        .limit(1);

      if (existing.length > 0) {
        await db.update(verifiedProjects)
          .set({ ...data, createdAt: undefined })
          .where(eq(verifiedProjects.slug, project.slug));
        console.log(`🔄 Updated: ${project.title}`);
      } else {
        await db.insert(verifiedProjects).values(data);
        console.log(`✅ Inserted: ${project.title}`);
      }
    } catch (err: any) {
      console.error(`❌ Failed: ${project.title}:`, err.message);
    }
  }

  await client.end();
  console.log('Done.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
