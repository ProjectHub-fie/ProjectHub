
  import { storage } from './server/storage.js';
  import seedProjects from './server/seed-projects.js';

  async function seed() {
    try {
      console.log('Starting manual seed...');
      const existing = await storage.getAllVerifiedProjects();
      if (existing.length === 0) {
        console.log('Database empty, seeding...');
        for (const project of seedProjects) {
          await storage.createVerifiedProject(project);
        }
        console.log('Seeding complete');
      } else {
        console.log('Database already has data, skipping seed');
      }
      process.exit(0);
    } catch (err) {
      console.error('Seed failed:', err);
      process.exit(1);
    }
  }

  seed();
  