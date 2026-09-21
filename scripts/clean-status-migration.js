import { Client } from 'pg';

async function cleanMigration() {
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
      console.log('Creating temporary enum for mapping...');
      
      // Create a temporary enum with the new values
      await client.query(`
        CREATE TYPE temp_project_request_status AS ENUM(
          'pending', 
          'working', 
          'done', 
          'canceled', 
          'suspended'
        );
      `);
      
      console.log('Adding temporary column...');
      // Add a temporary column with the new enum type
      await client.query(`
        ALTER TABLE project_requests 
        ADD COLUMN temp_status temp_project_request_status;
      `);
      
      console.log('Mapping existing values...');
      // Map existing values to new ones (even though table is empty, this is safe)
      await client.query(`
        UPDATE project_requests 
        SET temp_status = CASE 
          WHEN status = 'pending' THEN 'pending'::temp_project_request_status
          WHEN status = 'approved' THEN 'done'::temp_project_request_status
          WHEN status = 'rejected' THEN 'canceled'::temp_project_request_status
          WHEN status = 'in-review' THEN 'working'::temp_project_request_status
          WHEN status = 'completed' THEN 'done'::temp_project_request_status
          ELSE 'pending'::temp_project_request_status
        END;
      `);
      
      console.log('Dropping old column...');
      // Drop the old status column
      await client.query('ALTER TABLE project_requests DROP COLUMN status;');
      
      console.log('Renaming temporary column...');
      // Rename temp column to status
      await client.query('ALTER TABLE project_requests RENAME COLUMN temp_status TO status;');
      
      console.log('Setting default value...');
      // Set default for new records
      await client.query(`
        ALTER TABLE project_requests 
        ALTER COLUMN status SET DEFAULT 'pending';
      `);
      
      console.log('Dropping old enum type...');
      // Clean up the old enum type
      await client.query('DROP TYPE IF EXISTS project_request_status_old;');
      await client.query('ALTER TYPE project_request_status RENAME TO project_request_status_old;');
      
      console.log('Renaming temp enum to main enum...');
      // Rename temp enum to the main enum name
      await client.query('ALTER TYPE temp_project_request_status RENAME TO project_request_status;');
      
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

cleanMigration();