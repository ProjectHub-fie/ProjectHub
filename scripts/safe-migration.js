// Simple migration script that works with existing setup
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function runMigration() {
  try {
    console.log('Running database migration...');
    
    // Read the migration SQL
    const migrationPath = path.join(process.cwd(), 'drizzle', 'migrations', '0004_safe_verified_projects.sql');
    const migrationSql = fs.readFileSync(migrationPath, 'utf8');
    
    // Write to a temporary file
    const tempFile = path.join(process.cwd(), 'temp_migration.sql');
    fs.writeFileSync(tempFile, migrationSql);
    
    // Run using psql command (assuming it's available)
    console.log('Executing migration...');
    const result = execSync(`psql "${process.env.DATABASE_URL}" -f "${tempFile}"`, {
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    console.log('Migration output:', result);
    console.log('Migration completed successfully!');
    
    // Clean up
    fs.unlinkSync(tempFile);
    
  } catch (error) {
    console.error('Migration failed:', error.message);
    
    // Try alternative method using node-postgres
    console.log('Trying alternative method...');
    try {
      import('pg').then(async (pg) => {
        const { Client } = pg.default;
        const client = new Client({
          connectionString: process.env.DATABASE_URL,
          ssl: { rejectUnauthorized: false }
        });
        
        await client.connect();
        
        const migrationPath = path.join(process.cwd(), 'drizzle', 'migrations', '0004_safe_verified_projects.sql');
        const migrationSql = fs.readFileSync(migrationPath, 'utf8');
        
        await client.query(migrationSql);
        console.log('Alternative migration successful!');
        await client.end();
      });
    } catch (altError) {
      console.error('Alternative method also failed:', altError.message);
      process.exit(1);
    }
  }
}

runMigration();