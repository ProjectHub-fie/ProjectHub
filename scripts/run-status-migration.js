import { Client } from 'pg';
import fs from 'fs';
import path from 'path';

async function runMigration() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    console.log('Connected to database');

    // Read the migration file
    const migrationPath = path.join(process.cwd(), 'drizzle', 'migrations', '0008_update_project_request_status_with_emojis.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('Executing migration...');
    
    // Split the migration into individual statements
    const statements = migrationSQL
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

    for (const statement of statements) {
      console.log(`Executing: ${statement.substring(0, 50)}...`);
      await client.query(statement);
    }

    console.log('Migration completed successfully!');
    
    // Verify the changes
    console.log('\nVerifying enum values:');
    const result = await client.query(`
      SELECT enumlabel 
      FROM pg_enum 
      WHERE enumtypid = (
        SELECT oid 
        FROM pg_type 
        WHERE typname = 'project_request_status'
      )
      ORDER BY enumsortorder;
    `);
    
    console.log('Current project_request_status enum values:');
    result.rows.forEach(row => {
      console.log(`  - ${row.enumlabel}`);
    });

  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await client.end();
  }
}

runMigration();