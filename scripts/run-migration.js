import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Connected to database');

    // Read and execute the migration file
    const migrationPath = path.join(__dirname, '../drizzle/migrations/0002_add_verified_projects.sql');
    const migrationSql = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('Executing migration...');
    await client.query(migrationSql);
    console.log('Migration completed successfully!');

    // Verify the table was created
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'verified_projects'
    `);
    
    if (result.rows.length > 0) {
      console.log('✅ verified_projects table created successfully');
    } else {
      console.log('❌ verified_projects table was not created');
    }

  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await client.end();
  }
}

runMigration();