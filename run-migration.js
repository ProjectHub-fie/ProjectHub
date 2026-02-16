import { db } from './server/db.js';
import { readFile } from 'fs/promises';

async function runMigration() {
  try {
    const migrationSql = await readFile('./drizzle/migrations/0003_update_project_request_status.sql', 'utf8');
    console.log('Running migration...');
    
    // Split the migration into individual statements
    const statements = migrationSql
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    for (const statement of statements) {
      console.log('Executing:', statement.substring(0, 80) + (statement.length > 80 ? '...' : ''));
      try {
        await db.execute(statement);
        console.log('✓ Success');
      } catch (error) {
        console.log('✗ Error:', error.message);
        // Continue with other statements
      }
    }
    
    console.log('Migration process completed!');
  } catch (error) {
    console.error('Migration failed:', error.message);
  }
}

runMigration();