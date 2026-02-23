import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './drizzle/schema.ts',
  out: './drizzle/migrations',
  dialect: process.env.DATABASE_DIALECT === 'sqlite' ? 'sqlite' : 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});