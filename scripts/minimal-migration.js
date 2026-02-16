import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('❌ DATABASE_URL not found in environment variables');
  process.exit(1);
}

const client = postgres(databaseUrl, {
  ssl: { rejectUnauthorized: false },
  max: 1,
});

const db = drizzle(client);

async function runMinimalMigration() {
  try {
    console.log('🚀 Starting minimal migration for verified_projects table...');
    
    // Read the migration SQL
    const migrationPath = path.join(process.cwd(), 'drizzle', 'migrations', '0007_minimal_verified_projects.sql');
    const migrationSql = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('📝 Executing migration SQL...');
    await db.execute(migrationSql);
    
    console.log('✅ Migration completed successfully!');
    console.log('📋 Summary of changes:');
    console.log('  • Added verified_projects table (if not exists)');
    console.log('  • Added indexes for performance');
    console.log('  • Added missing user columns (if not exists)');
    console.log('  • Preserved all existing admin tables');
    
    // Verify the table was created
    console.log('\n🔍 Verifying table creation...');
    const tableCheck = await db.execute(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'verified_projects'
    `);
    
    if (tableCheck && tableCheck.rows && tableCheck.rows.length > 0) {
      console.log('✅ verified_projects table exists');
      
      // Show current tables
      console.log('\n📊 Current database tables:');
      const allTables = await db.execute(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        ORDER BY table_name
      `);
      
      allTables.rows.forEach(row => {
        console.log(`  • ${row.table_name}`);
      });
      
    } else {
      console.log('❌ verified_projects table was not created');
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('Details:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMinimalMigration();