import { Client } from 'pg';

async function simpleMigration() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    console.log('Connected to database');

    // Start transaction
    await client.query('BEGIN');

    try {
      console.log('Dropping constraint...');
      // First drop the NOT NULL constraint temporarily
      await client.query('ALTER TABLE project_requests ALTER COLUMN status DROP NOT NULL;');
      
      console.log('Setting all status values to NULL...');
      // Set all status values to NULL (safe since table is empty)
      await client.query('UPDATE project_requests SET status = NULL;');
      
      console.log('Dropping old enum type...');
      await client.query('DROP TYPE IF EXISTS project_request_status_old;');
      await client.query('ALTER TYPE project_request_status RENAME TO project_request_status_old;');
      
      console.log('Creating new enum...');
      await client.query(`
        CREATE TYPE project_request_status AS ENUM(
          'pending', 
          'working', 
          'done', 
          'canceled', 
          'suspended'
        );
      `);
      
      console.log('Altering column type...');
      await client.query(`
        ALTER TABLE project_requests 
        ALTER COLUMN status TYPE project_request_status 
        USING status::text::project_request_status;
      `);
      
      console.log('Setting default and NOT NULL...');
      await client.query(`
        ALTER TABLE project_requests 
        ALTER COLUMN status SET DEFAULT 'pending';
      `);
      await client.query(`
        ALTER TABLE project_requests 
        ALTER COLUMN status SET NOT NULL;
      `);
      
      console.log('Dropping old enum...');
      await client.query('DROP TYPE project_request_status_old;');
      
      // Commit transaction
      await client.query('COMMIT');
      console.log('Migration completed successfully!');

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    // Verify the changes
    console.log('\n=== Verification ===');
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
    
    console.log('New project_request_status enum values:');
    result.rows.forEach((row, index) => {
      console.log(`  ${index + 1}. ${row.enumlabel}`);
    });

  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await client.end();
  }
}

simpleMigration();